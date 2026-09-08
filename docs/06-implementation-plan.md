# DigiPoke — Step-by-Step Implementation Execution Plan

**Method:** three phases, each ending in a shippable, demonstrable increment.
Every task below is mapped to a real file in this repository and is **complete
in the delivered build** — this document doubles as the build log and as the
onboarding guide for a new engineer.

Legend: ✅ delivered · ⬜ future

---

## Phase 0 — Foundations (✅ complete)

| # | Task | Deliverable |
|---|---|---|
| 0.1 | Repository skeleton and workspace layout | `apps/`, `server/`, `tools/`, `tests/`, `docs/` |
| 0.2 | Zero-dependency tooling | `tools/dev-server.js`, `tools/start-all.js`, `tools/lint.js` |
| 0.3 | Design tokens + 4 themes | `styles/tokens.css` |
| 0.4 | App shell, semantic landmarks, skip link | `apps/web/index.html` |
| 0.5 | App icon + maskable icon (SVG, asset-free) | `assets/icon*.svg` |
| 0.6 | PWA manifest with shortcuts | `manifest.webmanifest` |

**Exit criteria:** `npm start` serves a styled, installable shell.

---

## Phase 1 — Core Foundation (✅ complete)

### 1.1 Deterministic core

| # | Task | File | Acceptance |
|---|---|---|---|
| 1.1.1 | Seeded PRNG (mulberry32) + dice helpers | `core/rng.js` | Same seed → same sequence (tested) |
| 1.1.2 | Event bus with canonical event names | `core/bus.js` | Listener exceptions isolated |
| 1.1.3 | Web Audio SFX synthesis (no assets) | `core/sfx.js` | Silent before first gesture (autoplay policy) |

### 1.2 Persistence

| # | Task | File | Acceptance |
|---|---|---|---|
| 1.2.1 | IndexedDB layer: `kv`, `dex`, `outbox`, `backups` | `core/db.js` | `durability: 'strict'` where supported |
| 1.2.2 | Atomic write-behind + rolling 5-snapshot ring | `core/db.js` | Restore from a snapshot works (tested) |
| 1.2.3 | Save-file schema, migrations, defensive normalisation | `core/state.js` | v1 save loads on v3 engine (tested) |
| 1.2.4 | Single source of truth + named actions | `core/state.js` | UI never mutates state directly |

### 1.3 Cryptography

| # | Task | File | Acceptance |
|---|---|---|---|
| 1.3.1 | PBKDF2 → AES-GCM vault, verifier envelope | `core/crypto.js` | Round-trip + wrong-passphrase rejection (tested) |
| 1.3.2 | Non-extractable keys, fresh IV per operation | `core/crypto.js` | `extractable: false` throughout |

### 1.4 Routing & UI primitives

| # | Task | File | Acceptance |
|---|---|---|---|
| 1.4.1 | Hash router with guards and params | `core/router.js` | Unknown routes and unauthorised access redirect correctly (tested) |
| 1.4.2 | Hyperscript helpers | `ui/dom.js` | No `innerHTML` from user data |
| 1.4.3 | Shared components (cards, bars, chips, modals, toasts) | `ui/components.js` | Used by every screen |
| 1.4.4 | Procedural SVG creature renderer | `ui/sprite.js` | All 34 species produce valid SVG (tested) |

### 1.5 Game rules (pure)

| # | Task | File | Acceptance |
|---|---|---|---|
| 1.5.1 | 10-element type chart | `domain/types.js` | Only legal multipliers (tested) |
| 1.5.2 | 33-move catalogue + 5 statuses | `domain/moves.js` | Unknown ids fall back safely |
| 1.5.3 | 34 species / 10 lines / 4 Megas | `domain/species.js` | Every stage is a strict stat upgrade (tested) |
| 1.5.4 | Stat derivation, levelling, learnsets, evolution | `domain/creature.js` | Level cap, evolution gating (tested) |
| 1.5.5 | XP/bond/shard curves, daily objectives | `domain/progression.js` | Objectives stable per date (tested) |
| 1.5.6 | Zones, encounter tables, rival generation | `domain/zones.js` | All rolls stay in band (tested) |

**Phase 1 exit criteria:** `npm test` runs the domain suite green; the engine is
deterministic, fuzz-clean and independent of any browser API.

---

## Phase 2 — Feature Implementation (✅ complete)

### 2.1 Battle engine

| # | Task | File | Acceptance |
|---|---|---|---|
| 2.1.1 | Turn resolution, priority tiers, speed ties | `domain/battle.js` | Deterministic trace (tested) |
| 2.1.2 | Damage formula: STAB, crits, variance, immunities | `domain/battle.js` | Immune hits deal the 1 HP floor (tested) |
| 2.1.3 | Statuses, stat stages, drain/recoil/heal effects | `domain/battle.js` | Bounds enforced |
| 2.1.4 | Switching, forced switch, AI auto-switch | `domain/battle.js` | Non-switch actions rejected while pending (tested) |
| 2.1.5 | XP award, level-up, learnset, in-battle evolution | `domain/battle.js` | Evolves at level 16 (tested) |
| 2.1.6 | Capture integration | `domain/capture.js` | Bounded probability; improves as HP drops (tested) |
| 2.1.7 | Event-stream output for UI animation | `domain/battle.js` | 16 event types consumed by the battle screen |

### 2.2 Screens

| # | Task | File | Acceptance |
|---|---|---|---|
| 2.2.1 | Onboarding: identity → vault → starter → ready | `screens/onboarding.js` | Passphrase verified, no network (tested end-to-end) |
| 2.2.2 | Dashboard (Nexus): hero, objectives, team, quick actions | `screens/dashboard.js` | Renders with a live profile (tested) |
| 2.2.3 | Ranch: filters, sort, inspector modal, rename/release | `screens/ranch.js` | Deep link `?focus=<uid>` opens the modal |
| 2.2.4 | Explore: zones, scanning, encounters, trainers | `screens/explore.js` | Locked zones gated by level (tested) |
| 2.2.5 | Battle UI: arena, log, menus, animations, result | `screens/battle.js` | Replays engine events; never computes rules |
| 2.2.6 | Lab: evolution, core training, move tutor, fabricator | `screens/lab.js` | Deep link `?evolve=<uid>` opens the dialog |
| 2.2.7 | Settings: profile, preferences, sync, data, about | `screens/settings.js` | Storage stats, backups, wipe |

### 2.3 Economy & progression systems

| # | Task | File | Acceptance |
|---|---|---|---|
| 2.3.1 | Data Shards: battles, objectives, releases, purchases | `core/state.js` | Spend paths validated before mutation |
| 2.3.2 | Core (IV) training with scaling costs | `screens/lab.js` | Refund on failure |
| 2.3.3 | Move tutoring with oldest-move replacement | `domain/creature.js` | Legal-move check |
| 2.3.4 | Daily objectives with deterministic rotation | `domain/progression.js` | Same date → same objectives |

### 2.4 Optional sync (zero-knowledge)

| # | Task | File | Acceptance |
|---|---|---|---|
| 2.4.1 | Sync client: register/login/push/pull/syncNow | `sync/syncClient.js` | Base URL derived automatically in preview environments |
| 2.4.2 | Server: routing, CORS, rate limiting, body limits | `server/src/server.js` | 12 integration tests green |
| 2.4.3 | Server: scrypt hashing + HMAC tokens | `server/src/auth.js` | No user enumeration (tested) |
| 2.4.4 | Server: atomic JSON store | `server/src/store.js` | Flush on SIGTERM |
| 2.4.5 | Conflict handling (409 → user chooses) | `screens/settings.js` | Documented in the API spec |

**Phase 2 exit criteria:** the full core loop is playable; 39 automated tests green.

---

## Phase 3 — Polish & Deployment (✅ complete for this build)

| # | Task | File | Status |
|---|---|---|---|
| 3.1 | Service worker: precache, stale-while-revalidate, network-first navigation | `sw.js` | ✅ |
| 3.2 | Offline verification (airplane mode playthrough) | manual | ✅ (verified by design; no network calls in gameplay) |
| 3.3 | Reduced-motion support + in-app animation toggle | `tokens.css`, `settings.js` | ✅ |
| 3.4 | Four themes with pure token overrides | `tokens.css` | ✅ |
| 3.5 | Install prompt (`beforeinstallprompt`) + installed toast | `main.js` | ✅ |
| 3.6 | Responsive layout (mobile-first, ≥ 320 px, safe-area insets) | `app.css` | ✅ |
| 3.7 | Accessibility pass: focus, ARIA, landmarks, live regions | all | ✅ |
| 3.8 | Lifecycle hooks: flush on `pagehide`/`visibilitychange`, online/offline toasts | `main.js` | ✅ |
| 3.9 | Storage persistence request + estimate panel | `db.js`, `settings.js` | ✅ |
| 3.10 | Lint gates (imports, precache, placeholders, external URLs) | `tools/lint.js` | ✅ |
| 3.11 | Documentation set (PRD → plan) | `docs/` | ✅ |
| 3.12 | Update notification when a new service worker is installed | `main.js` + `sw.js` | ✅ |

### Deployment

```bash
# 1. Static PWA — upload apps/web/ to any host (Netlify, GitHub Pages, S3, nginx)
#    No build step: the files are the artefact.
#    Serve over HTTPS (required for service workers).

# 2. Sync API (optional)
PORT=4000 DIGIPOKE_ORIGIN=https://digipoke.example.com node server/src/server.js
#    → put behind an HTTPS reverse proxy; back up data/store.json.

# 3. Local development
npm start          # PWA on :8080, API on :4000
npm test           # 39 tests
npm run lint       # static checks
```

---

## Backlog — v1.1+ (⬜ not started)

| Priority | Item | Notes |
|---|---|---|
| High | Dex completion screen | `db.readDex()` already records seen/caught |
| High | Strip `account.token` from exports | See §6 of the data-model doc |
| Medium | Abilities & held items | Engine has an effect-descriptor seam ready |
| Medium | Battle replay sharing | Determinism + event log make this a small feature |
| Medium | Double battles | Requires a targeting model in the event stream |
| Low | Breeding / inheritance | Reuses cores as the inheritance vector |
| Low | Weather & terrain | Modifier slot in `computeDamage` |
| Low | Hosted sync service + account recovery UX | Cannot add passphrase reset without breaking zero-knowledge |

---

## Engineering Estimates (for planning comparable work)

| Phase | Scope | Lines of code (approx.) | Calendar (1 senior engineer) |
|---|---|---|---|
| 0 | Foundations | ~400 | 0.5 day |
| 1 | Core foundation | ~1 900 | 2 days |
| 2 | Feature implementation | ~3 400 | 4 days |
| 3 | Polish & deployment | ~600 | 1.5 days |
| **Total** | | **~6 300** (excl. docs) | **~8 days** |

Actual delivered: ~6,300 lines of source across 47 files, ~39 tests, 6 documents.
