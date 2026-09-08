/**
 * auth.js — Password hashing and session tokens.
 *
 * Password storage
 * ----------------
 * scrypt (N=2^15, r=8, p=1) with a per-user 16-byte salt, compared with
 * `timingSafeEqual`. The stored format is a self-describing string:
 *   scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
 * so parameters can be raised later without invalidating old hashes.
 *
 * Sessions
 * --------
 * Stateless HMAC-SHA256 tokens: base64url(JSON payload) + "." + base64url(HMAC).
 * The server keeps no session table, so it can be scaled horizontally as long
 * as DIGIPOKE_SECRET is shared. Tokens expire (default 30 days).
 *
 * IMPORTANT: the password is used *only* for authentication. Vault encryption
 * keys are derived independently in the browser with PBKDF2 and never reach
 * this server, so a full database disclosure yields ciphertext only.
 *
 * @module server/auth
 */

import { scrypt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * scrypt cost parameters.
 * N=2^15 with r=8 needs ~32 MiB, which exceeds Node's 32 MB default `maxmem`
 * ceiling — so we raise it explicitly. Raising N later is supported: the
 * stored hash string records the parameters it was created with.
 */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

/** Token lifetime. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Hash a password with a fresh salt.
 * @param {string} password
 * @returns {Promise<string>} Encoded hash string.
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, PARAMS.keylen, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Verify a password against a stored hash.
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Base64url encode. */
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode (tolerant of padding). */
function fromB64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

/** HMAC-SHA256 over a message with the server secret. */
function sign(message, secret) {
  return createHmac('sha256', secret).update(message).digest();
}

/**
 * Issue a session token.
 * @param {string} userId
 * @param {string} secret Server secret.
 * @param {number} [ttlMs]
 * @returns {string}
 */
export function createToken(userId, secret, ttlMs = TOKEN_TTL_MS) {
  const payload = { sub: userId, iat: Date.now(), exp: Date.now() + ttlMs };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(sign(body, secret));
  return `${body}.${sig}`;
}

/**
 * Validate a token and return its payload.
 * @param {string} token
 * @param {string} secret
 * @returns {{sub:string, iat:number, exp:number}|null}
 */
export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  // Constant-time signature comparison.
  const expected = sign(body, secret);
  const provided = fromB64url(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'));
    if (!payload?.sub || !payload?.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Constant-time comparison helper for any two strings (e.g. revision checks).
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Very light email shape check (deliberately permissive). */
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

/** Password policy: length-first, matching the client's onboarding rule. */
export function isStrongEnough(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 256;
}
