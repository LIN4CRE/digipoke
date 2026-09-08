/**
 * crypto.js — Client-side cryptography for the local-first vault.
 *
 * Threat model
 * ------------
 * The sync server is treated as *hostile but curious*: it stores opaque
 * ciphertext and can never read it. Everything below runs in the browser via
 * Web Crypto; the passphrase and derived keys never leave the device.
 *
 *   Key derivation : PBKDF2-HMAC-SHA256, 250 000 iterations, 16-byte salt
 *   Encryption     : AES-256-GCM, fresh 12-byte IV per operation
 *   Integrity      : GCM authentication tag (built in)
 *
 * Keys are non-extractable CryptoKey objects, so even a successful XSS payload
 * cannot export the raw key material (it can still use it — hence the
 * passphrase re-prompt for destructive operations in the UI).
 *
 * @module core/crypto
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto?.subtle;

/** Assert Web Crypto availability (HTTPS or localhost). */
export function assertCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable. Serve DigiPoke over HTTPS or localhost.');
  }
}

/* --------------------------------------------------------- base64 helpers */

/** Encode bytes as standard base64. */
export function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

/** Decode standard base64 into a Uint8Array. */
export function fromB64(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* --------------------------------------------------------------- identities */

/** Cryptographically random hex id (uid, profile id, request id…). */
export function randomId(prefix = 'id') {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/** Fresh 16-byte salt, base64 encoded. */
export function newSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

/* ------------------------------------------------------------ key derivation */

/**
 * Derive a non-extractable AES-GCM key from a passphrase.
 * @param {string} passphrase
 * @param {string} saltB64
 * @param {number} [iterations=250000]
 * @returns {Promise<CryptoKey>}
 */
export async function deriveVaultKey(passphrase, saltB64, iterations = 250000) {
  assertCrypto();
  const material = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,          // non-extractable
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

/* ------------------------------------------------------------- encryption */

/**
 * Encrypt any structured-clonable value.
 * @param {CryptoKey} key
 * @param {any} data
 * @returns {Promise<{alg:string, iv:string, ct:string}>}
 */
export async function encryptJson(key, data) {
  assertCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(data)),
  );
  return { alg: 'AES-GCM-256', iv: toB64(iv), ct: toB64(ct) };
}

/**
 * Decrypt a value produced by `encryptJson`.
 * @param {CryptoKey} key
 * @param {{alg:string, iv:string, ct:string}} envelope
 * @returns {Promise<any>}
 */
export async function decryptJson(key, envelope) {
  assertCrypto();
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv) },
    key,
    fromB64(envelope.ct),
  );
  return JSON.parse(dec.decode(plain));
}

/* ---------------------------------------------------------------- verifier */

/** Constant marker encrypted under the vault key, used to validate passphrases. */
const VERIFIER_MARKER = 'digipoke.vault.v1';

/**
 * Create a verifier envelope for a derived key.
 * Storing this lets the app confirm a passphrase without persisting it.
 */
export async function makeVerifier(key) {
  return encryptJson(key, { marker: VERIFIER_MARKER });
}

/**
 * Check a passphrase against a stored verifier.
 * @returns {Promise<boolean>}
 */
export async function verifyPassphrase(passphrase, saltB64, verifier) {
  try {
    const key = await deriveVaultKey(passphrase, saltB64);
    const data = await decryptJson(key, verifier);
    return data?.marker === VERIFIER_MARKER;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ hashing */

/** SHA-256 hex digest (e.g. fingerprinting a vault before upload). */
export async function sha256Hex(text) {
  const digest = await subtle().digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the opaque sync payload uploaded to the server.
 * The server sees only this: an IV, ciphertext, and a schema version.
 */
export async function sealVault(key, payload) {
  return {
    schema: payload.schema ?? 1,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
    ...(await encryptJson(key, payload)),
  };
}

/** Inverse of `sealVault`. Throws on tampering or a wrong passphrase. */
export async function openVault(key, sealed) {
  return decryptJson(key, { alg: sealed.alg, iv: sealed.iv, ct: sealed.ct });
}
