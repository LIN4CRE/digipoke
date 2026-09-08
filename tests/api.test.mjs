/**
 * api.test.mjs — End-to-end tests for the sync API.
 *
 * Spawns the real server on an ephemeral port with an isolated data directory,
 * then drives it over HTTP with the same calls the browser client makes.
 * Covers the happy paths and, more importantly, the security boundaries:
 * unauthenticated access, user enumeration, stale writes and rate limiting.
 *
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..', 'server', 'src', 'server.js');
const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}/v1`;

let child;
let dataDir;

/**
 * Start a server instance with an isolated data directory.
 * The main instance raises the rate limit so that the suite's many legitimate
 * auth calls never trip it; the rate-limit test spawns its own strict instance.
 *
 * @param {number} port
 * @param {Record<string,string>} extraEnv
 * @returns {Promise<{child:import('node:child_process').ChildProcess, kill:Function}>}
 */
async function startServer(port = PORT, extraEnv = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'digipoke-test-'));
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1', DIGIPOKE_DATA_DIR: dir,
      DIGIPOKE_RATE_MAX: '1000',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});

  const base = `http://127.0.0.1:${port}/v1`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return { child: proc, dir, kill: () => proc.kill('SIGKILL') };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on port ${port} failed to start`);
}

/** Stop the server and clean up. */
async function stopServer() {
  child?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  child?.kill('SIGKILL');
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}

/** Tiny JSON client. */
async function call(pathname, { method = 'GET', body = null, token = null } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const uniqueEmail = () => `tamer.${Math.random().toString(36).slice(2)}@example.com`;
const fakeVault = (ct = 'Y3R') => ({ alg: 'AES-GCM-256', iv: 'aXZpdmVj', ct, schema: 3, updatedAt: new Date().toISOString() });

test.before(async () => {
  const started = await startServer();
  child = started.child;
  dataDir = started.dir;
});
test.after(stopServer);

test('health: reports service metadata', async () => {
  const { status, data } = await call('/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, 'digipoke-sync');
  assert.equal(typeof data.accounts, 'number');
});

test('auth: register issues a token and login returns a usable token', async () => {
  const email = uniqueEmail();
  const reg = await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });
  assert.equal(reg.status, 201);
  assert.ok(reg.data.token, 'expected a token');
  assert.equal(typeof reg.data.userId, 'string');

  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'correct-horse-1' } });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);
});

test('auth: duplicate registration is rejected with 409', async () => {
  const email = uniqueEmail();
  await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });
  const dupe = await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });
  assert.equal(dupe.status, 409);
  assert.match(dupe.data.error, /already exists/i);
});

test('auth: wrong password and unknown user are indistinguishable (no enumeration)', async () => {
  const email = uniqueEmail();
  await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });

  const wrongPass = await call('/auth/login', { method: 'POST', body: { email, password: 'nope-wrong-1' } });
  const noUser = await call('/auth/login', { method: 'POST', body: { email: uniqueEmail(), password: 'nope-wrong-1' } });

  assert.equal(wrongPass.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPass.data.error, noUser.data.error, 'error text must not differ');
});

test('auth: weak passwords and malformed bodies are rejected', async () => {
  const short = await call('/auth/register', { method: 'POST', body: { email: uniqueEmail(), password: 'short' } });
  assert.equal(short.status, 400);

  const badEmail = await call('/auth/register', { method: 'POST', body: { email: 'not-an-email', password: 'correct-horse-1' } });
  assert.equal(badEmail.status, 400);
});

test('vault: unauthenticated reads and writes are refused', async () => {
  const read = await call('/vault');
  assert.equal(read.status, 401);

  const write = await call('/vault', { method: 'PUT', body: { vault: fakeVault(), rev: 0 } });
  assert.equal(write.status, 401);

  const forged = await call('/vault', { method: 'PUT', token: 'forged.token.here', body: { vault: fakeVault(), rev: 0 } });
  assert.equal(forged.status, 401, 'a forged token must not authenticate');
});

test('vault: round-trip stores the envelope and bumps the revision', async () => {
  const email = uniqueEmail();
  const { data: auth } = await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });

  const empty = await call('/vault', { token: auth.token });
  assert.equal(empty.status, 200);
  assert.equal(empty.data.vault, null);
  assert.equal(empty.data.rev, 0);

  const vault = fakeVault('first-blob');
  const put = await call('/vault', { method: 'PUT', token: auth.token, body: { vault, rev: 0 } });
  assert.equal(put.status, 200);
  assert.equal(put.data.rev, 1);

  const get = await call('/vault', { token: auth.token });
  assert.equal(get.data.rev, 1);
  assert.equal(get.data.vault.ct, 'first-blob');
  // The server stores the envelope opaquely — it never inspects or rewrites it.
  assert.equal(get.data.vault.alg, vault.alg);
  assert.equal(get.data.vault.iv, vault.iv);
});

test('vault: stale writes are rejected with 409 (optimistic concurrency)', async () => {
  const email = uniqueEmail();
  const { data: auth } = await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });

  await call('/vault', { method: 'PUT', token: auth.token, body: { vault: fakeVault('a'), rev: 0 } });
  await call('/vault', { method: 'PUT', token: auth.token, body: { vault: fakeVault('b'), rev: 1 } });

  // A second device still holding rev 0 must not clobber rev 2.
  const stale = await call('/vault', { method: 'PUT', token: auth.token, body: { vault: fakeVault('old'), rev: 0 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.serverRev, 2);

  const after = await call('/vault', { token: auth.token });
  assert.equal(after.data.vault.ct, 'b', 'the newer blob must survive');
});

test('vault: malformed envelopes are rejected and oversized bodies refused', async () => {
  const email = uniqueEmail();
  const { data: auth } = await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });

  const bad = await call('/vault', { method: 'PUT', token: auth.token, body: { vault: { nope: true }, rev: 0 } });
  assert.equal(bad.status, 400);

  const huge = await fetch(`${BASE}/vault`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ vault: fakeVault('x'.repeat(3 * 1024 * 1024)), rev: 0 }),
  });
  assert.equal(huge.status, 413, 'oversized bodies must be refused with 413');
});

test('account: deletion removes the vault and invalidates the account', async () => {
  const email = uniqueEmail();
  const { data: auth } = await call('/auth/register', { method: 'POST', body: { email, password: 'correct-horse-1' } });
  await call('/vault', { method: 'PUT', token: auth.token, body: { vault: fakeVault('secret'), rev: 0 } });

  const del = await call('/account', { method: 'DELETE', token: auth.token });
  assert.equal(del.status, 200);
  assert.equal(del.data.deleted, true);

  const read = await call('/vault', { token: auth.token });
  assert.equal(read.status, 401, 'the token must stop working once the account is gone');

  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'correct-horse-1' } });
  assert.equal(login.status, 401);
});

test('routing: unknown routes and methods return 404', async () => {
  const missing = await call('/v1/does-not-exist');
  assert.equal(missing.status, 404);
  const wrongMethod = await call('/health', { method: 'DELETE' });
  assert.equal(wrongMethod.status, 404);
});

test('security: rate limiting kicks in after repeated auth attempts', async () => {
  // Dedicated instance with a deliberately tiny ceiling.
  const strict = await startServer(4600, { DIGIPOKE_RATE_MAX: '3' });
  try {
    let sawRateLimit = false;
    for (let i = 0; i < 8; i++) {
      const res = await fetch('http://127.0.0.1:4600/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail(), password: 'correct-horse-1' }),
      });
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    assert.ok(sawRateLimit, 'expected a 429 after exceeding the auth rate limit');
  } finally {
    strict.kill();
    await rm(strict.dir, { recursive: true, force: true });
  }
});
