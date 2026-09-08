# DigiPoke — System Architecture & Module Boundaries

| Field | Value |
|---|---|
| **Style** | Local-first PWA, layered monolith client + stateless zero-knowledge API |
| **Client dependencies** | **0** (no framework, no build step, no package manager required to run) |
| **Server dependencies** | **0** (Node.js standard library only) |
| **Persistence** | IndexedDB (primary), JSON file (server-side blob store) |
| **Document status** | v1.0 |

---

## 1. Architectural Drivers

| Driver | Consequence |
|---|---|
| **Local-first** | IndexedDB is the source of truth. The network is never on the critical path. |
| **Offline by default** | Service worker precaches the shell; no CDN, no web fonts, no remote images. |
| **Determinism** | All randomness flows through one seeded PRNG, making battles replayable and fuzz-testable. |
| **Zero build step** | Native ES modules in the browser. What you read in `src/` is what runs. |
| **Zero dependencies** | No supply-chain risk; the app still runs in five years. |
| **Portability** | The save file is plain JSON with a version and migrations. |
| **Privacy** | No analytics; the sync server stores ciphertext it cannot decrypt. |

### 1.1 Key decisions (ADR summary)

| ADR | Decision | Rationale | Trade-off accepted |
|---|---|---|---|
| ADR-01 | No UI framework; a 90-line hyperscript helper | The app is 7 coarse screens; a framework would dominate the bundle and the risk profile | Manual re-render discipline |
| ADR-02 | IndexedDB over localStorage | Structured storage, multi-MB capacity, transactions | Async API, more code |
| ADR-03 | Seeded PRNG (mulberry32) | Reproducible bugs, deterministic tests, shareable seeds | Cannot use `Math.random()` anywhere in the engine |
| ADR-04 | Procedural SVG creatures instead of sprite sheets | ~0 KB assets, recolourable (Glitch variants), infinite variety | Stylised rather than pixel-art |
| ADR-05 | Engine returns an **event stream**; UI animates it | Rules stay testable without a DOM; UI stays dumb | UI must replay events |
| ADR-06 | Hash routing | Static hosting with no server rewrites; works from `file://` | URLs have `#` |
| ADR-07 | Zero-dependency Node API | Single-file deploy, no CVE surface, trivial to self-host | Hand-rolled routing/auth |
| ADR-08 | Client-side encryption with PBKDF2; server-side auth with scrypt | Server can authenticate but never decrypt (different KDFs, same passphrase) | Password is briefly visible to the server at login |
| ADR-09 | Last-write-wins with revision counter | Simple, predictable conflict model for a single-player game | No field-level merge |
| ADR-10 | Mutations persist HP/XP **during** battle | A crash mid-battle never loses progress | Slightly more IndexedDB writes |

---

## 2. System Context

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Player's device (browser)                      │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                      DigiPoke PWA (ES modules)                  │   │
│  │  ui/  →  core/  →  domain/          sync/ (optional)            │   │
│  └───────────────┬──────────────────────────────┬─────────────────┘   │
│                  │                              │                     │
│        ┌─────────▼──────────┐        ┌──────────▼──────────┐          │
│        │  IndexedDB         │        │  Service Worker     │          │
│        │  state · dex       │        │  precache shell     │          │
│        │  outbox · backups  │        │  offline navigation │          │
│        └────────────────────┘        └─────────────────────┘          │
└───────────────────────────────────────────┬────────────────────────────┘
                                            │ HTTPS (opt-in)
                                            │ AES-GCM ciphertext only
                                   ┌────────▼─────────┐
                                   │  DigiPoke Sync   │
                                   │  API (Node std)  │
                                   │  scrypt + HMAC   │
                                   │  store.json      │
                                   └──────────────────┘
```

---

## 3. Canonical Folder Tree

```
digipoke/
├── README.md                      # Quickstart, scripts, overview
├── package.json                   # Root manifest: scripts + workspaces (no runtime deps)
│
├── docs/                          # Engineering documentation (this set)
│   ├── 01-PRD.md                  # Personas, journeys, functional + non-functional specs
│   ├── 02-architecture.md         # This document
│   ├── 03-data-model.md           # Entities, save schema, migrations
│   ├── 03-schema.sql              # Reference SQL schema (relational port of the model)
│   ├── 04-api-spec.md             # HTTP API, state management, UI component hierarchy
│   ├── 05-security-and-quality.md # Threat model, crypto, validation, testing strategy
│   └── 06-implementation-plan.md  # Phase 1 → 2 → 3 execution plan
│
├── apps/
│   └── web/                       # ─────────── THE PWA (zero dependencies) ───────────
│       ├── index.html             # App shell; semantic landmarks; inline boot fallback
│       ├── manifest.webmanifest   # Install metadata, icons, shortcuts
│       ├── sw.js                  # Service worker: precache, SWR, network-first nav
│       ├── assets/
│       │   ├── icon.svg           # App icon (any purpose)
│       │   └── icon-maskable.svg  # Maskable icon (safe-zone compliant)
│       ├── styles/
│       │   ├── tokens.css         # Design tokens + 4 themes + reduced motion
│       │   └── app.css            # Layout, components, screens, overlays
│       └── src/
│           ├── main.js            # Bootstrap: state → routes → SW → lifecycle
│           ├── core/              # Infrastructure (no game rules)
│           │   ├── bus.js         # Pub/sub + canonical event names
│           │   ├── crypto.js      # PBKDF2 → AES-GCM; vault seal/open; verifiers
│           │   ├── db.js          # IndexedDX stores, transactions, backups, dex
│           │   ├── rng.js         # mulberry32 + dice helpers
│           │   ├── router.js      # Hash router with guards and params
│           │   ├── sfx.js         # Web Audio synthesis (no audio assets)
│           │   └── state.js       # Single source of truth, actions, migrations
│           ├── domain/            # Pure game rules (no DOM, no IO)
│           │   ├── types.js       # Element chart
│           │   ├── moves.js       # Move catalogue + status registry
│           │   ├── species.js     # 34 species across 10 lines
│           │   ├── creature.js    # Stats, levelling, learnsets, evolution
│           │   ├── battle.js      # The engine (event-stream output)
│           │   ├── capture.js     # Catch probability resolution
│           │   ├── progression.js # XP/bond/shard curves, daily objectives
│           │   └── zones.js       # Zones, encounter tables, rival generation
│           ├── ui/                # Presentation
│           │   ├── dom.js         # Hyperscript helpers
│           │   ├── sprite.js      # Procedural SVG creature renderer (+ portraits)
│           │   ├── tamerAvatar.js # Procedural SVG Tamer portrait (~98k combos)
│           │   ├── components.js  # Cards, bars, chips, modals, toasts, chrome
│           │   └── screens/       # One module per route
│           │       ├── onboarding.js
│           │       ├── dashboard.js
│           │       ├── ranch.js
│           │       ├── explore.js
│           │       ├── battle.js
│           │       ├── lab.js
│           │       └── settings.js
│           └── sync/
│               └── syncClient.js  # Zero-knowledge sync client (fetch wrapper)
│
├── server/                        # ─────── OPTIONAL SYNC API (zero deps) ───────
│   ├── package.json
│   └── src/
│       ├── server.js              # HTTP routing, CORS, rate limiting, handlers
│       ├── auth.js                # scrypt hashes, HMAC tokens, input policy
│       └── store.js               # Atomic JSON store with debounced writes
│
├── tools/
│   ├── dev-server.js              # Static file server for the PWA (+ /single)
│   ├── start-all.js               # Runs PWA + API together
│   ├── lint.js                    # Dependency-free project checks
│   ├── gallery.mjs                # Renders an art contact sheet from the renderers
│   ├── build-single.mjs           # Bundles the app into one self-contained HTML file
│   └── verify-single.mjs          # Boot-tests that single file headlessly
│
├── tests/
│   ├── domain.test.mjs            # Engine unit tests + 400-battle fuzz
│   ├── api.test.mjs               # HTTP integration tests (spawns the real server)
│   └── ui.test.mjs                # jsdom boot + end-to-end journey tests
│
├── previews/                      # Generated art contact sheet (gallery.html)
├── dist/                          # Generated one-file build (digipoke.html)
└── data/                          # Server store (git-ignored; created at runtime)
    └── store.json
```

---

## 4. Module Boundaries & Dependency Rules

```
        ui/screens ──┐
                     ├──► ui/components ──► ui/dom ──► (none)
        ui/components┘         │
             │                 └──► ui/sprite ──► domain/species
             ▼
        core/state ──► core/db ──► IndexedDB
             │    └──► core/bus, core/crypto, core/rng
             ▼
        domain/* ──► (pure; imports only other domain modules and core/rng)
             ▲
        sync/syncClient ──► core/crypto, core/state, core/bus
```

**Rules (enforced by review and `npm run lint`):**

1. **`domain/` imports nothing from `ui/`, `core/state`, or `core/db`.** The engine is pure:
   same inputs → same outputs, in Node or in a browser.
2. **`ui/` never mutates state directly.** Every write goes through a named action in
   `core/state.js` (`addCreature`, `spendShards`, `recordCapture`, …).
3. **`core/state.js` is the only module that writes to IndexedDB.**
4. **`sync/` is optional.** Removing the directory removes cloud features; nothing else breaks.
5. **No module reaches for `Math.random()`.** All randomness comes from an injected RNG.
6. **No hard-coded external URLs** in client source (checked by the linter).

### 4.1 Dependency manifest

| Module | Imports | Exports (primary) |
|---|---|---|
| `core/rng.js` | — | `createRng`, `mulberry32`, `randomSeed`, `hashString` |
| `core/crypto.js` | — | `deriveVaultKey`, `encryptJson`, `decryptJson`, `makeVerifier`, `verifyPassphrase`, `sealVault`, `openVault`, `randomId`, `newSalt` |
| `core/db.js` | — | `loadState`, `saveState`, `pushBackup`, `listBackups`, `recordDex`, `readDex`, `clearAll`, `storageEstimate` |
| `core/bus.js` | — | `on`, `off`, `emit`, `EVENTS` |
| `core/state.js` | db, bus, rng, crypto, domain/* | `init`, `getState`, `mutate`, `flush`, `createProfile`, 30+ named actions, `migrate` |
| `core/router.js` | — | `route`, `navigate`, `startRouter`, `refresh`, `activePath` |
| `core/sfx.js` | — | `sfx.*`, `setSoundEnabled`, `unlockAudio` |
| `domain/types.js` | — | `TYPES`, `effectiveness`, `effectivenessLabel`, `defensiveProfile` |
| `domain/moves.js` | — | `MOVES`, `STATUSES`, `getMove` |
| `domain/species.js` | — | `SPECIES`, `SPECIES_IDS`, `STARTER_IDS`, `getSpecies`, `learnsetFor` |
| `domain/creature.js` | species, moves, progression, rng | `createCreature`, `statsFor`, `gainXp`, `canEvolve`, `applyEvolution`, `raiseCore`, `teachMove` |
| `domain/battle.js` | moves, types, species, creature, capture, progression | `Battle`, `SIDE`, `computeDamage`, `typeHint` |
| `domain/capture.js` | — | `BALLS`, `captureChance`, `attemptCapture` |
| `domain/progression.js` | — | `xpToNext`, `xpReward`, `shardValue`, `coreCost`, `dailyObjectives`, `bondTier` |
| `domain/zones.js` | — | `ZONES`, `getZone`, `rollEncounter`, `rollRival`, `unlockedZones` |
| `ui/dom.js` | — | `h`, `append`, `clear`, `renderInto`, `qs`, `num`, `pct` |
| `ui/sprite.js` | — | `sprite`, `portrait`, `lighten`, `darken`, `shiftHue` |
| `ui/tamerAvatar.js` | — | `tamerAvatar`, `TAMER_OPTIONS`, `randomTamer`, `combinationCount` |
| `ui/components.js` | dom, sprite, tamerAvatar, domain/*, core/* | `card`, `creatureCard`, `modal`, `confirmDialog`, `promptDialog`, `toast`, `hpBar`, `statBar`, `animateNumber`, `floatText`, `impact`, `spriteEl`, `portraitEl`, `tamerEl`, `renderTopbar`, `renderTabbar` |
| `core/sfx.js` | — | ~50 named cues, `startMusic`, `stopMusic`, `setSfxVolume`, `setMusicVolume`, `unlockAudio`, `sinceLastSound` |
| `ui/screens/*.js` | dom, components, core/*, domain/* | `render(root, ctx)` (+ `meta`, and a few named exports) |
| `sync/syncClient.js` | bus, state, crypto, db | `health`, `register`, `login`, `push`, `pull`, `syncNow`, `signOut`, `ensureVaultKey` |
| `server/src/server.js` | node:http, node:crypto, store, auth | HTTP listeners |
| `server/src/auth.js` | node:crypto | `hashPassword`, `verifyPassword`, `createToken`, `verifyToken` |
| `server/src/store.js` | node:fs/promises, node:crypto | `load`, `saveNow`, `patch`, `get` |

---

## 5. Data Flow

### 5.1 Read path
```
IndexedDB ──load──► core/state.state (in-memory) ──read──► ui/screens ──► DOM
```

### 5.2 Write path
```
UI event ──► named action in core/state ──► mutate() ──► bus:STATE_CHANGED ──► re-render
                                              │
                                              └──► debounce 600ms ──► db.saveState() ──► IndexedDB
                                                                          └──► pushBackup(previous snapshot)
```

### 5.3 Battle path (the interesting one)
```
ui/screens/battle.js
   │  submit(action)
   ▼
domain/battle.js  ──► ordered event list  ──►  UI replays with delays
   │  (writes HP/XP straight through to the live creature objects)
   ▼
core/state.recordBattleResult / recordCapture / recordEvolution
   ▼
persist + re-render
```

The engine never touches the DOM, and the UI never computes damage. This is why
`tests/domain.test.mjs` can fuzz 400 battles in 113 ms with no browser.

### 5.4 Sync path
```
state.exportPayload() ──► sealVault(key, payload) ──► PUT /v1/vault {vault, rev}
                              ▲                              │
                              │                              ▼
                    PBKDF2(passphrase)            server stores opaque ciphertext
                                                             │
GET /v1/vault ──► openVault(key, envelope) ──► state.replaceState()
```

---

## 6. Offline & Resilience Strategy

| Layer | Mechanism |
|---|---|
| **Shell** | `sw.js` precaches HTML/CSS/JS/icons; installs offline-capable on first visit |
| **Assets** | Stale-while-revalidate for static files; network-first for navigations with shell fallback |
| **API** | Explicitly excluded from caching — a sync failure degrades to local play, never to broken state |
| **Data** | IndexedDB with `durability: 'strict'` where supported; atomic single-transaction writes |
| **In-battle** | HP and XP are written to the creature record on every change, so a crash loses nothing |
| **Recovery** | Rolling ring of 5 automatic snapshots, restorable from Settings → Data |
| **Connectivity** | `online`/`offline` events surface toasts; no gameplay is gated on connectivity |

---

## 7. Performance Budget

| Resource | Budget | Actual |
|---|---|---|
| HTML + CSS | ≤ 60 KB | ~45 KB (uncompressed) |
| JavaScript | ≤ 120 KB | ~150 KB uncompressed / ~35 KB over the wire (gzip) |
| Images | 0 KB | 0 KB — creatures are generated SVG |
| Fonts | 0 KB | 0 KB — system font stack |
| Requests on boot | ≤ 12 | 12 (all local, all precached) |
| Time to interactive | < 2 s (mid-tier mobile) | No framework parse; modules load natively |

---

## 8. Observability & Operations

- **Client:** structured `console` prefixes (`[state]`, `[db]`, `[pwa]`, `[sync]`);
  `window.onerror` and `unhandledrejection` are captured and logged. No telemetry is sent.
- **Server:** request logging to stdout with status and duration; `SIGINT`/`SIGTERM`
  flush the store before exit; `/v1/health` exposes account count and last-write time.
- **Failure modes:**

| Failure | Behaviour |
|---|---|
| IndexedDB unavailable (private mode) | Boot continues; a toast warns that progress cannot be saved |
| Sync server unreachable | Toast; local play unaffected; retry on next manual sync |
| Corrupt save file | `migrate()` normalises defensively; unknown species/items fall back safely |
| Stale push (409) | Client offers "use cloud save" vs "keep local" |
| Passphrase lost | Unrecoverable by design — documented prominently in onboarding and Settings |
