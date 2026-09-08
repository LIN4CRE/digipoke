/**
 * db.js — IndexedDB persistence layer (the "local" in local-first).
 *
 * Stores
 * ------
 *  kv      – key/value: 'state' (the whole save), 'account', 'vault'
 *  dex     – per-species discovery records (never rolled back by sync)
 *  outbox  – queued sync operations awaiting a network round-trip
 *  backups – rolling ring of the last N save snapshots (crash recovery)
 *
 * Everything is promise-wrapped. Every write is a single transaction, so a
 * mid-write tab crash cannot produce a half-written save. IndexedDB's own
 * durability (relaxed by default) is upgraded to "strict" where supported so a
 * power loss cannot lose a completed write.
 *
 * @module core/db
 */

const DB_NAME = 'digipoke';
const DB_VERSION = 1;
export const STORES = { KV: 'kv', DEX: 'dex', OUTBOX: 'outbox', BACKUPS: 'backups' };

/** How many rolling snapshots to keep. */
const BACKUP_LIMIT = 5;

let dbPromise = null;

/** Open (and lazily create) the database. */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.KV)) db.createObjectStore(STORES.KV);
      if (!db.objectStoreNames.contains(STORES.DEX)) db.createObjectStore(STORES.DEX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.OUTBOX)) db.createObjectStore(STORES.OUTBOX, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.BACKUPS)) db.createObjectStore(STORES.BACKUPS, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('DigiPoke database is blocked by another tab. Close other tabs and retry.'));
  });
  return dbPromise;
}

/** Run `fn` inside a transaction, resolving with its result. */
async function tx(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    let transaction;
    try {
      // 'strict' durability where available: flush before the success event.
      transaction = db.transaction(names, mode, { durability: 'strict' });
    } catch {
      transaction = db.transaction(names, mode);
    }
    const stores = names.map((n) => transaction.objectStore(n));
    let result;
    try {
      result = fn(stores.length === 1 ? stores[0] : stores, transaction);
    } catch (err) {
      transaction.abort();
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
  });
}

/** Wrap an IDBRequest in a promise. */
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* -------------------------------------------------------------- kv helpers */

export async function kvGet(key, fallback = null) {
  const value = await tx(STORES.KV, 'readonly', (store) => wrap(store.get(key)));
  return value === undefined ? fallback : value;
}

export async function kvSet(key, value) {
  await tx(STORES.KV, 'readwrite', (store) => wrap(store.put(structuredClone(value), key)));
  return value;
}

export async function kvDelete(key) {
  await tx(STORES.KV, 'readwrite', (store) => wrap(store.delete(key)));
}

/* ------------------------------------------------------------ save files */

/** Load the last persisted save file. */
export async function loadState() {
  try {
    return await kvGet('state', null);
  } catch (err) {
    console.error('[db] failed to load state:', err);
    return null;
  }
}

/**
 * Persist a save file and rotate the backup ring.
 * Backups are written with the current snapshot *before* the new state lands,
 * so recovery can always step one version back.
 */
export async function saveState(state, { backup = true } = {}) {
  const previous = backup ? await kvGet('state', null).catch(() => null) : null;
  await kvSet('state', state);
  if (backup && previous) await pushBackup(previous);
  return state;
}

/** Append a snapshot to the rolling backup ring. */
export async function pushBackup(snapshot) {
  const id = `bk_${Date.now().toString(36)}`;
  await tx(STORES.BACKUPS, 'readwrite', (store) => wrap(store.put({ id, at: new Date().toISOString(), snapshot })));
  const ids = await tx(STORES.BACKUPS, 'readonly', (store) => wrap(store.getAllKeys()));
  if (ids.length > BACKUP_LIMIT) {
    const stale = ids.sort().slice(0, ids.length - BACKUP_LIMIT);
    await tx(STORES.BACKUPS, 'readwrite', (store) => Promise.all(stale.map((k) => wrap(store.delete(k)))));
  }
}

/** List available backups, newest first. */
export async function listBackups() {
  const rows = await tx(STORES.BACKUPS, 'readonly', (store) => wrap(store.getAll())).catch(() => []);
  return rows.sort((a, b) => (a.id < b.id ? 1 : -1));
}

/* --------------------------------------------------------------- dex store */

/** Record that a species was seen or caught. */
export async function recordDex(speciesId, { caught = false } = {}) {
  const existing = await tx(STORES.DEX, 'readonly', (store) => wrap(store.get(speciesId))).catch(() => null);
  const row = existing || { id: speciesId, seen: 0, caught: 0, firstSeenAt: new Date().toISOString() };
  row.seen += 1;
  if (caught) {
    row.caught += 1;
    row.firstCaughtAt = row.firstCaughtAt || new Date().toISOString();
  }
  await tx(STORES.DEX, 'readwrite', (store) => wrap(store.put(row)));
  return row;
}

/** Whole Pokedex-equivalent, keyed by species id. */
export async function readDex() {
  const rows = await tx(STORES.DEX, 'readonly', (store) => wrap(store.getAll())).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/* ------------------------------------------------------------ sync outbox */

/** Queue an operation for the next sync pass. */
export async function enqueueOp(op) {
  return tx(STORES.OUTBOX, 'readwrite', (store) => wrap(store.add({ ...op, queuedAt: new Date().toISOString() })));
}

/** Read every queued operation, oldest first. */
export async function readOutbox() {
  return tx(STORES.OUTBOX, 'readonly', (store) => wrap(store.getAll())).catch(() => []);
}

/** Remove a queued operation by id. */
export async function dequeueOp(id) {
  await tx(STORES.OUTBOX, 'readwrite', (store) => wrap(store.delete(id)));
}

/* ------------------------------------------------------------------ admin */

/** Wipe every DigiPoke store (used by "Delete all data"). */
export async function clearAll() {
  const names = Object.values(STORES);
  await tx(names, 'readwrite', (stores) => Promise.all(stores.map((s) => wrap(s.clear()))));
}

/** Best-effort storage estimate for the Settings > Data panel. */
export async function storageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, pct: quota ? usage / quota : 0 };
  } catch {
    return null;
  }
}

/** Ask the browser to keep IndexedDB alive under storage pressure. */
export async function requestPersistence() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
