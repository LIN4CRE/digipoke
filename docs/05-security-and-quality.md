# DigiPoke — Security, Auth & Quality Standards

---

## 1. Security Principles

| # | Principle | Implementation |
|---|---|---|
| P1 | **Local-first is a security property** | No account is required to play; the attack surface of "no server" is zero |
| P2 | **Collect nothing** | No analytics, no telemetry, no third-party scripts, no CDN, no cookies |
| P3 | **The server is untrusted** | It stores ciphertext it cannot decrypt; keys never leave the device |
| P4 | **Least privilege** | Tokens grant access to exactly one vault; no admin paths |
| P5 | **Fail closed, degrade gracefully** | Auth failures deny; network failures fall back to local play |
| P6 | **Defence in depth** | Validation on both client and server; CSP-compatible markup; no `eval` |
| P7 | **Secure by default** | 250k PBKDF2 iterations, scrypt password hashing, non-extractable keys |

---

## 2. Threat Model (STRIDE-lite)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Server operator reads a save | Malicious/curious operator, subpoena, breach | AES-256-GCM encryption in the browser; PBKDF2 key derivation; server stores only `{alg, iv, ct}` | None — the server never holds key material |
| Database exfiltration | SQL injection / file disclosure | No SQL (JSON store); no user-controlled file paths; vault contents never parsed | Attacker learns email addresses and ciphertext sizes only |
| Credential stuffing | Reused passwords | scrypt (N=2¹⁵, r=8, p=1) with per-user salt; rate limiting (10/min/IP) | Weak user passwords remain guessable — mitigated by the 8-char minimum and strength meter |
| User enumeration | Register/login error differences | Identical `401` message and comparable work for both branches | Timing differences are negligible |
| Token forgery | Crafting/modifying a JWT-like token | HMAC-SHA256 signature verified with `timingSafeEqual`; `exp` enforced | Server secret compromise invalidates all tokens (rotate `DIGIPOKE_SECRET`) |
| Token replay | Stolen token from device | 30-day expiry; `DELETE /v1/account` + sign-out; token stored only in IndexedDB | Physical device access |
| XSS in the PWA | Injected script in creature names, imported saves | No `innerHTML` from user data — the only `innerHTML` sink is `dom.js`'s `html` prop, fed exclusively by our own sprite generator; text nodes elsewhere | A dependency-free client has a very small XSS surface |
| Malicious save import | Crafted JSON with huge arrays, bad ids | `migrate()` normalises defensively; unknown ids fall back; schema-checked before replacing | A pathological file can balloon local storage — bounded by browser quota |
| Path traversal (static server) | `../../../etc/passwd` | `path.normalize` + `startsWith(ROOT)` check in `tools/dev-server.js` | None |
| DoS | Oversized bodies / request floods | 2 MB body cap (413); rate limiting; single-threaded store with debounced writes | No horizontal scaling without a shared store |
| Replay of a stale vault overwrite | Second device pushes an old revision | Optimistic concurrency: `rev` must be ≥ server revision, else 409 | User must choose on conflict (explicit UX) |
| Lost passphrase | Forgetfulness | **Unrecoverable by design** — no reset, because a reset path would require escrowing keys | Documented prominently |

---

## 3. Cryptography

| Purpose | Algorithm | Parameters | Where |
|---|---|---|---|
| Vault key derivation | PBKDF2-HMAC-SHA256 | 250 000 iterations, 16-byte random salt, 256-bit output | `core/crypto.js` |
| Save encryption | AES-256-GCM | Fresh 12-byte IV per operation; GCM tag for integrity | `core/crypto.js` |
| Passphrase verification | AES-GCM-encrypted constant marker | Same derived key | `core/crypto.js` |
| Password storage (server) | scrypt | N=32768, r=8, p=1, 64-byte key, 16-byte salt, `maxmem` raised to 96 MB | `server/src/auth.js` |
| Session tokens | HMAC-SHA256 over base64url JSON | 30-day expiry, constant-time compare | `server/src/auth.js` |
| Ids | CSPRNG (`crypto.getRandomValues` / `randomUUID`) | 96-bit / 128-bit | client + server |
| Game randomness | mulberry32 (seeded) | 32-bit state | `core/rng.js` |

**Key properties:**
- Derived `CryptoKey` objects are created with `extractable: false`, so even a successful
  XSS payload cannot export raw key material (it could only use the key in-session).
- The **same passphrase** serves authentication (scrypt, server-side) and encryption
  (PBKDF2, client-side). Because the KDFs differ, the server's stored hash is useless
  for deriving the encryption key.
- IVs are never reused: a fresh 12-byte IV is generated per encryption.

---

## 4. Input Validation

| Layer | Rule |
|---|---|
| **Client UI** | Max lengths on every input; numeric clamps; disabled buttons when unaffordable; confirmation dialogs for destructive actions |
| **State actions** | Re-validated at the action boundary (e.g. `releaseCreature` refuses to remove the last team member; `spendShards` refuses when short) |
| **Engine** | `normalise()` rejects illegal actions; unknown move/species ids resolve to safe fallbacks; combatants clamp HP to `[0, maxHp]` and stages to `[−2, +2]` |
| **Server** | Email shape + length; password 8–256; JSON parse guarded; body-size streaming check; vault envelope shape check (`alg`/`iv`/`ct` strings); revision monotonicity |
| **Import** | Structural check (`profile` + `creatures` present) before any replace; `migrate()` normalises the rest |

**No `eval`, no `new Function`, no `innerHTML` from user data.** The single `innerHTML`
sink lives in `ui/dom.js` (`html` prop) and is used only for our own generated SVG.

---

## 5. Secret Distribution & Configuration

| Secret | Location | Rotation |
|---|---|---|
| `DIGIPOKE_SECRET` (HMAC key) | `data/store.json`, auto-generated on first run; can be injected via env | Rotating invalidates every session (intentional logout lever) |
| `passHash` | `data/store.json` per user | On password change |
| Vault `salt` / `verifier` | Client IndexedDB (`kv:vault`) | On passphrase change (Settings) |
| Session token | Client IndexedDB (inside the save file) | 30-day expiry; sign out; account deletion |
| **Nothing else** | — | No API keys, no service accounts, no third-party credentials exist |

**Operational guidance:**
- Restrict CORS with `DIGIPOKE_ORIGIN` in production.
- Terminate TLS at a reverse proxy; the API assumes it is behind one.
- Back up `data/store.json` (it contains only hashes and ciphertext).
- Never log request bodies (the server logs methods, statuses and durations only).

---

## 6. Access Control

| Actor | May | May not |
|---|---|---|
| Anonymous | `GET /v1/health`, `POST /v1/auth/*` (rate-limited) | Read or write any vault |
| Authenticated user | Read/write **their own** vault, delete **their own** account | Enumerate users, read other vaults, escalate to admin |
| Server operator | Count accounts, delete the store file | Decrypt any vault |

There are no roles, no admin endpoints and no impersonation paths.

---

## 7. Privacy

- **No accounts required.** A player can use the entire product without ever creating one.
- **No analytics or cookies.** Zero third-party requests (verified by `npm run lint`,
  which fails on any hard-coded external URL in client source).
- **No personal data beyond an email address**, and only if sync is enabled.
- **Data minimisation:** the server stores email, password hash, vault ciphertext and a
  revision counter — nothing about the player's progress, IP history or device.
- **Deletion:** `DELETE /v1/account` removes the account and vault; "Delete all data"
  wipes local IndexedDB, dex records and backups.

---

## 8. Quality Standards

### 8.1 Testing strategy

| Layer | Tooling | Scope | Current |
|---|---|---|---|
| **Unit / property** | `node:test` | Curves, stat derivation, evolution, type chart, capture bounds | ✅ |
| **Fuzz** | `node:test` + seeded RNG | 400 randomised battles asserted against invariants (HP bounds, persisted-HP parity, stage bounds, level bounds, termination, legal outcome) | ✅ 400 cases in ~113 ms |
| **Determinism** | `node:test` | Same seed → identical event trace, outcome and final snapshot | ✅ |
| **API integration** | `node:test` + `fetch` | Real server spawned on an ephemeral port: auth, vault round-trip, concurrency, authz, rate limiting, payload limits | ✅ 12 cases |
| **UI integration** | `node:test` + `jsdom` + `fake-indexeddb` | Boots the real app: onboarding journey, every route renders, battle writes through, persistence round-trip, crypto round-trip, sprite generation, router guards | ✅ 9 cases |
| **Static analysis** | `tools/lint.js` | Import resolution, SW precache completeness, no placeholders, no external URLs, no stray `innerHTML` | ✅ 0 errors |
| **Manual** | Checklist | Install flow, offline mode (airplane), reduced motion, 4 themes, screen reader pass | ⬜ per release |

**Totals: 39 automated tests, all passing.**

```bash
npm test              # 39 tests across 3 suites
npm run lint          # dependency-free static checks
```

### 8.2 Coverage targets

| Module group | Target | Rationale |
|---|---|---|
| `domain/*` (engine) | ≥ 95% | All game rules; a regression here silently corrupts saves |
| `core/crypto.js`, `server/src/auth.js` | ≥ 90% | Security-critical |
| `core/state.js` | ≥ 80% | Migrations and actions |
| `ui/*` | Smoke + integration jsdom tests | Presentational; verified by rendering assertions |

### 8.3 Code standards

- **ES modules only**, no build step; `"type": "module"`.
- **JSDoc on every exported symbol** with `@param`/`@returns`.
- **Pure functions** in `domain/`; side effects confined to `core/` and `ui/`.
- **Named actions only** for state writes (no ad-hoc mutation from screens).
- **No magic numbers in logic** — all tuning constants live in `domain/progression.js`,
  `domain/capture.js` or `styles/tokens.css`.
- **Comments explain *why*, not *what*** (see any file in `domain/`).
- **Error handling:** never swallow; catch → user-visible toast + `console.error`.

### 8.4 Accessibility

| Requirement | Status |
|---|---|
| Semantic landmarks (`header`, `main`, `nav`) and heading order | ✅ |
| Visible `:focus-visible` ring on all interactive elements | ✅ |
| Modals: `role="dialog"`, `aria-modal`, label, Esc + backdrop dismissal | ✅ |
| Toasts in an `aria-live="polite"` region | ✅ |
| Skip link to main content | ✅ |
| `prefers-reduced-motion` supported globally plus an in-app toggle | ✅ |
| Colour contrast: text on background ≥ 7:1 in all four themes | ✅ |
| Icon-only buttons carry `aria-label` | ✅ |

### 8.5 CI pipeline (recommended)

```yaml
on: [push, pull_request]
jobs:
  quality:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4   # 20.x
      - run: npm ci                    # dev-only: jsdom, fake-indexeddb
      - run: npm run lint
      - run: npm test                  # domain + api + ui
      - run: npx lighthouse-ci         # optional: PWA + a11y budgets
```

### 8.6 Release checklist

- [ ] `npm test` green (39/39) and `npm run lint` clean
- [ ] `CACHE_VERSION` bumped in `sw.js` whenever any shell asset changes
- [ ] Save schema bumped **and** a migration added in `state.js` if the shape changed
- [ ] Manual offline pass (install → airplane mode → play a battle)
- [ ] Manual pass on iOS Safari standalone mode
- [ ] `data/store.json` backup verified on the sync host
