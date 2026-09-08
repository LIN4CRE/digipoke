/**
 * store.js — Atomic JSON persistence for the sync server.
 *
 * Deliberately dependency-free: the API is a stateless blob store, and a
 * single-file journal keeps deployment trivial (one process, one file, no
 * database to provision). Writes are atomic (temp file + rename) and coalesced
 * so a burst of saves cannot corrupt the file.
 *
 * For multi-instance deployments, swap this module for a shared store — the
 * interface (load/save/patch) is intentionally tiny.
 *
 * @module server/store
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Default on-disk location of the store file. */
const DATA_DIR = process.env.DIGIPOKE_DATA_DIR || path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

/** @type {{users:Object<string, object>, secret:string, updatedAt:string}} */
let cache = null;
let writeTimer = null;
let writing = false;

/** Default, empty store shape. */
function emptyStore() {
  return {
    users: {},
    // Persistent HMAC secret: rotating it invalidates all sessions, which is
    // the intended "log everyone out" lever after a suspected compromise.
    secret: requireRandomSecret(),
    updatedAt: new Date().toISOString(),
  };
}

/** 32 random bytes as hex (Node's CSPRNG). */
function requireRandomSecret() {
  return randomBytes(32).toString('hex');
}

/** Load the store, creating it on first run. */
export async function load() {
  if (cache) return cache;
  try {
    if (!existsSync(STORE_FILE)) {
      cache = emptyStore();
      await saveNow();
      return cache;
    }
    const raw = await readFile(STORE_FILE, 'utf8');
    cache = JSON.parse(raw);
    if (!cache.users) cache.users = {};
    if (!cache.secret) cache.secret = requireRandomSecret();
    return cache;
  } catch (err) {
    console.error('[store] failed to load, starting empty:', err.message);
    cache = emptyStore();
    return cache;
  }
}

/** Persist immediately (awaited). */
export async function saveNow() {
  if (!cache) return;
  if (writing) {
    // Coalesce: a write is already in flight, schedule another.
    scheduleSave();
    return;
  }
  writing = true;
  try {
    cache.updatedAt = new Date().toISOString();
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await rename(tmp, STORE_FILE); // atomic on POSIX and Windows NTFS
  } catch (err) {
    console.error('[store] save failed:', err.message);
  } finally {
    writing = false;
  }
}

/** Debounced write-behind (200 ms). */
export function scheduleSave() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { saveNow().catch(() => {}); }, 200);
  writeTimer.unref?.();
}

/**
 * Mutate the store and schedule a save.
 * @param {(store:object) => void} fn
 */
export async function patch(fn) {
  const store = await load();
  fn(store);
  scheduleSave();
  return store;
}

/** Direct access to the cached store (callers must not mutate nested state). */
export async function get() {
  return load();
}

/** Exposed for tests and operational scripts. */
export const paths = { DATA_DIR, STORE_FILE };
