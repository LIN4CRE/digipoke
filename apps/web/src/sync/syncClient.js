/**
 * syncClient.js — Optional cloud sync client (zero-knowledge).
 *
 * The server is a dumb blob store: it authenticates the player with a scrypt
 * hash and stores an opaque AES-GCM envelope it cannot open. Encryption keys
 * are derived in the browser with PBKDF2 and never transmitted, so a server
 * breach (or a malicious operator) yields ciphertext only.
 *
 * Conflict policy: last-write-wins on a monotonic revision counter, with the
 * server rejecting stale pushes (HTTP 409). The client resolves a 409 by
 * pulling the newer vault and letting the player choose (see settings.js).
 *
 * @module sync/syncClient
 */

import { emit, EVENTS } from '../core/bus.js';
import * as state from '../core/state.js';
import { deriveVaultKey, sealVault, openVault, verifyPassphrase } from '../core/crypto.js';
import * as db from '../core/db.js';

/** Cached vault key for the session (never persisted). */
let vaultKey = null;
let vaultSalt = null;

/**
 * Resolve the sync API base URL.
 * Order: explicit setting → sibling sandbox host (preview) → localhost.
 */
export function serverUrl() {
  const configured = state.getState?.()?.settings?.serverUrl;
  if (configured) return configured.replace(/\/$/, '');
  return defaultServerUrl();
}

/**
 * In the sandbox/IDE preview the PWA is served from `https://<port>-<id>.e2b.app`.
 * The API runs on port 4000 of the same sandbox, so we derive its origin.
 */
export function defaultServerUrl() {
  const match = location.hostname.match(/^(\d+)-(.*)$/);
  if (match) return `${location.protocol}//4000-${match[2]}/v1`;
  return `${location.protocol}//${location.hostname}:4000/v1`;
}

/** Status broadcast helper. */
function status(label, kind = 'idle') {
  emit(EVENTS.SYNC_STATUS, { label, kind });
  return { label, kind };
}

/**
 * Low-level JSON request wrapper.
 * @throws {Error} with a human-readable message from the API.
 */
async function request(path, { method = 'GET', body = null, token = null, timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${serverUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0, 200) || 'Malformed response' }; }

    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Check the server URL.');
    if (err instanceof TypeError) throw new Error('Cannot reach the sync server. Check the server URL and that the API is running.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------- vault */

/** Read the local vault record (salt + verifier), creating nothing. */
export async function readVaultRecord() {
  if (vaultSalt) return vaultSalt;
  vaultSalt = await db.kvGet('vault', null);
  return vaultSalt;
}

/**
 * Derive and cache the vault key by prompting for the passphrase.
 *
 * @param {object} [opts]
 * @param {string} [opts.passphrase] Skip the prompt when already known.
 * @param {() => Promise<string|null>} [opts.prompt] Prompt implementation
 *        (injected so this module stays UI-free and testable).
 * @returns {Promise<CryptoKey|null>}
 */
export async function ensureVaultKey({ passphrase = null, prompt = null } = {}) {
  if (vaultKey) return vaultKey;
  const record = await readVaultRecord();
  if (!record) throw new Error('No local vault found. Complete onboarding first.');

  let secret = passphrase;
  if (!secret) {
    if (!prompt) throw new Error('A passphrase is required to unlock the vault.');
    secret = await prompt();
  }
  if (!secret) return null;

  const ok = await verifyPassphrase(secret, record.salt, record.verifier);
  if (!ok) throw new Error('Incorrect passphrase.');

  vaultKey = await deriveVaultKey(secret, record.salt, record.iterations);
  return vaultKey;
}

/** Forget the cached key (logout / screen lock). */
export function forgetVaultKey() { vaultKey = null; }

/**
 * Seed the cached key (used immediately after onboarding derives it, so the
 * first export/sync does not ask for the passphrase again in the same session).
 */
export function cacheVaultKey(key) { vaultKey = key; }

/** True when an encrypted vault can be produced without prompting. */
export function hasCachedKey() { return !!vaultKey; }

/* ------------------------------------------------------------------- API */

/** Liveness probe used by the Settings screen. */
export async function health() {
  return request('/health');
}

/**
 * Create a cloud account.
 * @param {string} email
 * @param {string} password
 */
export async function register(email, password) {
  const res = await request('/auth/register', { method: 'POST', body: { email, password } });
  state.setAccount({ email, token: res.token, vaultRev: res.vaultRev ?? 0 });
  status('Registered', 'ok');
  return res;
}

/** Log into an existing account. */
export async function login(email, password) {
  const res = await request('/auth/login', { method: 'POST', body: { email, password } });
  state.setAccount({ email, token: res.token, vaultRev: res.vaultRev ?? 0 });
  status('Signed in', 'ok');
  return res;
}

/** Push the current save file as an encrypted envelope. */
export async function push({ passphrase = null, prompt = null } = {}) {
  const account = state.getState().account;
  if (!account?.token) throw new Error('Sign in first.');
  const key = await ensureVaultKey({ passphrase, prompt });
  if (!key) return null;

  status('Encrypting…', 'busy');
  const sealed = await sealVault(key, state.exportPayload());
  status('Uploading…', 'busy');
  const res = await request('/vault', {
    method: 'PUT',
    token: account.token,
    body: { vault: sealed, rev: account.vaultRev ?? 0 },
  });
  state.setAccount({ vaultRev: res.rev, lastSyncedAt: new Date().toISOString() });
  status('Synced', 'ok');
  return res;
}

/** Pull the remote envelope and decrypt it. Returns the parsed save file. */
export async function pull({ passphrase = null, prompt = null } = {}) {
  const account = state.getState().account;
  if (!account?.token) throw new Error('Sign in first.');
  status('Downloading…', 'busy');
  const res = await request('/vault', { token: account.token });
  if (!res?.vault) return null;
  const key = await ensureVaultKey({ passphrase, prompt });
  if (!key) return null;
  status('Decrypting…', 'busy');
  const payload = await openVault(key, res.vault);
  state.setAccount({ vaultRev: res.rev });
  status('Downloaded', 'ok');
  return payload;
}

/**
 * Two-way sync: pull, and if the remote is newer than our last known revision,
 * surface it for the player to accept; otherwise push.
 *
 * @returns {Promise<{action:'pushed'|'pulled'|'conflict'|'unchanged', remote?:object}>}
 */
export async function syncNow(opts = {}) {
  const account = state.getState().account;
  if (!account?.token) throw new Error('Sign in first.');
  const res = await request('/vault', { token: account.token }).catch(() => null);
  if (!res?.vault) {
    await push(opts);
    return { action: 'pushed' };
  }
  if ((res.rev ?? 0) > (account.vaultRev ?? 0)) {
    status('Conflict', 'warn');
    const key = await ensureVaultKey(opts);
    const remote = key ? await openVault(key, res.vault) : null;
    return { action: 'conflict', remote, rev: res.rev };
  }
  await push(opts);
  return { action: 'pushed' };
}

/** Delete the remote account and vault. Local data is untouched. */
export async function deleteRemoteAccount() {
  const account = state.getState().account;
  if (!account?.token) return;
  await request('/account', { method: 'DELETE', token: account.token });
  state.clearAccount();
  forgetVaultKey();
  status('Local only', 'idle');
}

/** Sign out locally (keeps the remote account and data). */
export function signOut() {
  state.clearAccount();
  forgetVaultKey();
  status('Local only', 'idle');
}
