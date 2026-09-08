/**
 * server.js — DigiPoke sync & auth API.
 *
 * ZERO DEPENDENCIES. Runs on Node 18+ with the standard library only:
 *   node server/src/server.js
 *
 * What this service is
 * --------------------
 * A dumb, authenticated blob store for end-to-end encrypted saves. It can:
 *   • register/login a player (scrypt password hashes, HMAC session tokens),
 *   • store one opaque vault blob per account behind a revision counter,
 *   • delete an account and its blob.
 *
 * What it can never do
 * --------------------
 * Read a save. Vaults arrive as AES-GCM ciphertext produced in the browser;
 * the only keys able to decrypt them are derived from passphrases that are
 * never transmitted to this service.
 *
 * Operational notes
 * -----------------
 *   PORT                  HTTP port (default 4000)
 *   HOST                  Bind address (default 0.0.0.0)
 *   DIGIPOKE_SECRET       HMAC secret; generated and persisted if unset
 *   DIGIPOKE_DATA_DIR     Where store.json lives (default ./data)
 *   DIGIPOKE_ORIGIN       CORS allowlist ("*" by default for dev/preview)
 *
 * @module server
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import {
  hashPassword, verifyPassword, createToken, verifyToken,
  isValidEmail, isStrongEnough,
} from './auth.js';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGIN = process.env.DIGIPOKE_ORIGIN || '*';

/** Maximum accepted request body (a full vault envelope is well under 1 MB). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Per-IP rate limit for authentication endpoints (brute-force protection).
 * Tunable so load tests and CI can raise the ceiling:
 *   DIGIPOKE_RATE_MAX   attempts per window (default 10)
 *   DIGIPOKE_RATE_MS    window length in ms (default 60000)
 */
const RATE_WINDOW_MS = Number(process.env.DIGIPOKE_RATE_MS || 60_000);
const RATE_MAX_ATTEMPTS = Number(process.env.DIGIPOKE_RATE_MAX || 10);
const rateBuckets = new Map();

/* ------------------------------------------------------------------ helpers */

/** Send a JSON response. */
function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Send a structured error. */
function fail(res, status, error, extra = {}) {
  return json(res, status, { error, ...extra });
}

/** Apply CORS headers, handling pre-flight. */
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/**
 * Read and parse a JSON request body with a hard size cap.
 * @returns {Promise<object|null>} null on invalid JSON / oversized body.
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        const err = new Error('Request body too large.');
        err.code = 'BODY_TOO_LARGE';
        // Drain the remainder so the connection can be closed cleanly instead
        // of being reset mid-write (which surfaces as a client-side fetch error).
        req.resume();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => { if (!done) { done = true; resolve(null); } });
  });
}

/** Client IP for rate limiting (proxy-aware). */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Sliding-window rate limiter.
 * @returns {boolean} true when the request is allowed.
 */
function rateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > RATE_MAX_ATTEMPTS) return false;
  return true;
}

/**
 * Resolve the bearer token to a user record.
 * @returns {Promise<{user:object, state:object}|null>}
 */
async function authenticate(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  const state = await store.get();
  const payload = verifyToken(token, state.secret);
  if (!payload) return null;
  const user = state.users[payload.sub];
  if (!user) return null;
  return { user, state };
}

/** Validate that a vault envelope has the expected shape (never its contents). */
function isVaultShape(vault) {
  return !!vault
    && typeof vault === 'object'
    && typeof vault.alg === 'string'
    && typeof vault.iv === 'string'
    && typeof vault.ct === 'string'
    && vault.ct.length <= MAX_BODY_BYTES;
}

/* ------------------------------------------------------------------ routing */

/**
 * Handle a request.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  if (cors(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  const method = req.method || 'GET';

  // Reject anything outside the /v1 surface early.
  if (!pathname.startsWith('/v1/')) {
    return fail(res, 404, 'Not found. DigiPoke API lives under /v1/.');
  }

  const route = `${method} ${pathname}`;

  try {
    switch (route) {
      /* ------------------------------------------------------------ health */
      case 'GET /v1/health': {
        const state = await store.get();
        return json(res, 200, {
          ok: true,
          service: 'digipoke-sync',
          version: '1.0.0',
          accounts: Object.keys(state.users).length,
          updatedAt: state.updatedAt,
          time: new Date().toISOString(),
        });
      }

      /* ------------------------------------------------------- auth: create */
      case 'POST /v1/auth/register': {
        if (!rateLimit(clientIp(req))) return fail(res, 429, 'Too many attempts. Try again in a minute.');
        const body = await readJson(req);
        if (body === null) return fail(res, 400, 'Invalid or oversized JSON body.');
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        if (!isValidEmail(email)) return fail(res, 400, 'A valid email address is required.');
        if (!isStrongEnough(password)) return fail(res, 400, 'Password must be 8–256 characters.');

        const state = await store.get();
        const existing = Object.values(state.users).find((u) => u.email === email);
        if (existing) return fail(res, 409, 'An account with that email already exists.');

        const id = randomUUID();
        const now = new Date().toISOString();
        state.users[id] = {
          id, email,
          passHash: await hashPassword(password),
          vault: null,
          rev: 0,
          createdAt: now,
          updatedAt: now,
        };
        await store.saveNow();

        console.log(`[auth] registered ${email}`);
        return json(res, 201, {
          token: createToken(id, state.secret),
          userId: id,
          email,
          vaultRev: 0,
        });
      }

      /* --------------------------------------------------------- auth: login */
      case 'POST /v1/auth/login': {
        if (!rateLimit(clientIp(req))) return fail(res, 429, 'Too many attempts. Try again in a minute.');
        const body = await readJson(req);
        if (body === null) return fail(res, 400, 'Invalid or oversized JSON body.');
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!email || !password) return fail(res, 400, 'Email and password are required.');

        const state = await store.get();
        const user = Object.values(state.users).find((u) => u.email === email);
        // Same message and comparable work for both branches: no user enumeration.
        if (!user || !(await verifyPassword(password, user.passHash))) {
          return fail(res, 401, 'Invalid email or password.');
        }

        console.log(`[auth] login ${email}`);
        return json(res, 200, {
          token: createToken(user.id, state.secret),
          userId: user.id,
          email: user.email,
          vaultRev: user.rev ?? 0,
        });
      }

      /* -------------------------------------------------------- vault: read */
      case 'GET /v1/vault': {
        const auth = await authenticate(req);
        if (!auth) return fail(res, 401, 'Missing or invalid token.');
        if (!auth.user.vault) return json(res, 200, { vault: null, rev: auth.user.rev ?? 0 });
        return json(res, 200, {
          vault: auth.user.vault,
          rev: auth.user.rev ?? 0,
          updatedAt: auth.user.updatedAt,
        });
      }

      /* -------------------------------------------------------- vault: write */
      case 'PUT /v1/vault': {
        const auth = await authenticate(req);
        if (!auth) return fail(res, 401, 'Missing or invalid token.');
        const body = await readJson(req);
        if (body === null) return fail(res, 400, 'Invalid or oversized JSON body.');
        if (!isVaultShape(body.vault)) return fail(res, 400, 'Vault must be an encrypted envelope {alg, iv, ct}.');

        const incomingRev = Number(body.rev ?? 0);
        const currentRev = Number(auth.user.rev ?? 0);
        // Optimistic concurrency: reject stale writes so a second device cannot
        // silently overwrite newer data; the client resolves the conflict.
        if (Number.isFinite(incomingRev) && incomingRev < currentRev) {
          return fail(res, 409, 'A newer version of this vault exists. Pull before pushing.', {
            serverRev: currentRev,
          });
        }

        auth.user.vault = {
          alg: body.vault.alg,
          iv: body.vault.iv,
          ct: body.vault.ct,
          schema: body.vault.schema ?? 1,
          updatedAt: body.vault.updatedAt ?? new Date().toISOString(),
        };
        auth.user.rev = currentRev + 1;
        auth.user.updatedAt = new Date().toISOString();
        await store.saveNow();

        return json(res, 200, { rev: auth.user.rev, savedAt: auth.user.updatedAt });
      }

      /* ------------------------------------------------------ account: delete */
      case 'DELETE /v1/account': {
        const auth = await authenticate(req);
        if (!auth) return fail(res, 401, 'Missing or invalid token.');
        const state = await store.get();
        delete state.users[auth.user.id];
        await store.saveNow();
        console.log(`[auth] deleted account ${auth.user.email}`);
        return json(res, 200, { deleted: true });
      }

      default:
        return fail(res, 404, `No handler for ${route}.`);
    }
  } catch (err) {
    if (err?.code === 'BODY_TOO_LARGE') {
      return fail(res, 413, 'Request body too large.');
    }
    console.error('[server] unhandled error:', err);
    return fail(res, 500, 'Internal server error.');
  }
}

/* -------------------------------------------------------------------- start */

const server = http.createServer(handle);

server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, async () => {
  const state = await store.load();
  console.log('┌───────────────────────────────────────────────┐');
  console.log('│  DigiPoke sync API                            │');
  console.log(`│  Listening  http://${HOST}:${PORT}/v1${' '.repeat(Math.max(0, 18 - String(PORT).length))}│`);
  console.log(`│  Accounts   ${String(Object.keys(state.users).length).padEnd(34)}│`);
  console.log(`│  Data       ${store.paths.STORE_FILE.slice(-34).padEnd(34)}│`);
  console.log('│  Zero-knowledge: vaults are opaque ciphertext │');
  console.log('└───────────────────────────────────────────────┘');
});

/** Graceful shutdown: finish in-flight writes before exiting. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n[server] ${signal} received — flushing store and exiting.`);
    await store.saveNow();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

export { server };
