# 🚀 DigiPoke

**A local-first creature-collecting battler.** Raise, battle and evolve digital life —
entirely on your device. Installable PWA, works offline, zero runtime dependencies,
with optional end-to-end encrypted sync that the server cannot read.

> Mix between Digimon and Pokémon: Digimon-style evolution ladders and bonding,
> Pokémon-style catching and elemental combat — minus the always-online account.

---

## Quickstart

```bash
# 1. Run everything (PWA on :8080, sync API on :4000)
npm start

# 2. Open the app
open http://localhost:8080/

# 3. Verify it (40 tests: engine, API, and real headless browser journeys)
npm test

# 4. Static checks (imports, precache, placeholders, external URLs)
npm run lint
```

There is **no build step and nothing to install to run the app** — `apps/web/` is the
artefact. `npm install` is only needed for the *test-only* tools (jsdom, fake-indexeddb);
without them the UI test suite skips itself and everything else still runs.

---

## The opening (splash → Tamer → partner → Nexus)

The first two minutes are hand-built, in five steps:

1. **Splash** — animated starfield, the three starters idling, `Press Start`
   (also the gesture that unlocks the audio context).
2. **Identity** — name entry with live filtering, a vault passphrase with a
   strength meter, and a Tamer ID card that fills in as you type.
3. **Appearance** — a procedural portrait with 6 option groups
   (~98,000 combinations) rendered live on a lit stage, plus *Surprise me*.
4. **Partner** — the three starters with portraits, stats, lore and moves.
5. **Launch** — a "Digitising…" cinematic that hands off to the Nexus.

Every piece of art (34 creatures, NPCs, the Tamer) is generated as SVG from code,
and every sound is synthesised at runtime — no image or audio files anywhere,
so the whole game stays ~400 KB and works offline.

---

## What's inside

| Area | Detail |
|---|---|
| **Species** | 34 across 10 evolution lines (rookie → champion → ultimate) + 4 bond-gated Mega forms |
| **Combat** | 10 elements (0×–4×), 33 moves, 5 status conditions, stat stages, crits, STAB, priority tiers |
| **Progression** | Levels 1–50, bond, cores (IVs 0–15), Data Shards, daily objectives, 6 zones |
| **Collection** | 3 ball types with live catch probability, Glitch (shiny) variants at 1/512, ranch + team management |
| **Lab** | Evolution, core training, move tutoring, shard fabricator |
| **Data** | Plain + encrypted export/import, 5 rolling backups, storage stats, one-click wipe |
| **Sync** | Optional, opt-in, zero-knowledge (AES-256-GCM sealed before upload) |
| **Audio** | ~50 synthesised cues + 5 adaptive music tracks (menu, explore, lab, battle, victory) on a lookahead scheduler |
| **Feedback** | Chip-damage HP bars, floating numbers (crit/super/resist/heal/MISS), impact shake, capture wobbles |
| **PWA** | Installable, offline after first load, 4 themes, reduced-motion support |

---

## Scripts

| Command | What it does |
|---|---|
| `npm start` | PWA on `:8080` + sync API on `:4000` |
| `npm run dev` | PWA only |
| `npm test` | 40 tests (domain, API, headless-browser journeys) |
| `npm run lint` | Import resolution, precache list, placeholders, external URLs, **CSS class coverage** |
| `npm run art` | Regenerate `previews/gallery.html` (every creature, Tamer avatars, expressions) |
| `npm run build:single` | Bundle everything into one self-contained `dist/digipoke.html` |
| `npm run verify:single` | Boot-test that single file (replays its module loader in Node) |
| `npm run tunnel` | Publish the local PWA at a public `https://….lhr.life` URL (no account) |

---

## Architecture at a glance

```
apps/web/          the PWA — vanilla ES modules, no framework, no build step
  src/core/        infrastructure: state, IndexedDB, crypto, router, RNG, audio, bus
  src/domain/      pure game rules (no DOM, no IO): battle engine, species, creatures
  src/ui/          presentation: dom helpers, procedural SVG sprites, components, 7 screens
  src/sync/        optional zero-knowledge sync client
server/            optional sync API — Node standard library only, zero dependencies
tools/             dev server, process runner, dependency-free linter
tests/             domain (18) · API (12) · UI/jsdom (9) = 39 tests
docs/              PRD, architecture, data model + SQL, API spec, security, plan
```

**Dependency rules:** `domain/` imports nothing from `ui/` or `core/state`; the UI never
mutates state directly (all writes go through named actions in `core/state.js`);
`core/state.js` is the only module that touches IndexedDB; deleting `sync/` removes cloud
features and breaks nothing else.

**Determinism:** every random outcome flows through one seeded PRNG (mulberry32), so a
save plus a seed reproduces a battle exactly. That is what makes the 400-battle fuzz
test possible — it runs in ~113 ms with no browser.

---

## Engineering documentation

| Document | Contents |
|---|---|
| [`docs/01-PRD.md`](docs/01-PRD.md) | Personas, journeys, functional + non-functional requirements, MVP scope |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Folder tree, module boundaries, dependency manifest, ADRs, data flow, budgets |
| [`docs/03-data-model.md`](docs/03-data-model.md) | Save-file schema, IndexedDB stores, entity model, migrations |
| [`docs/03-schema.sql`](docs/03-schema.sql) | Reference PostgreSQL schema (SQLite/MySQL notes included) |
| [`docs/04-api-spec.md`](docs/04-api-spec.md) | HTTP endpoints, request/response, state contract, component hierarchy |
| [`docs/05-security-and-quality.md`](docs/05-security-and-quality.md) | Threat model, crypto, validation, access control, testing strategy |
| [`docs/06-implementation-plan.md`](docs/06-implementation-plan.md) | Phase 0 → 3 task breakdown with acceptance criteria and estimates |

---

## Configuration

**Client** (Settings screen, stored locally):

| Setting | Default | Notes |
|---|---|---|
| Theme | `nexus` | Also: `ember`, `abyss`, `mono` |
| Animations / Sound / Autosave | on | Reduced-motion OS setting is honoured automatically |
| Server URL | auto-derived | Falls back to `http://localhost:4000/v1` |

**Server** (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DIGIPOKE_ORIGIN` | `*` | CORS allowlist (restrict in production) |
| `DIGIPOKE_DATA_DIR` | `./data` | Where `store.json` lives |
| `DIGIPOKE_RATE_MAX` | `10` | Auth attempts per minute per IP |
| `DIGIPOKE_RATE_MS` | `60000` | Rate-limit window |

---

## Deploying

```bash
# PWA — upload apps/web/ to any static host. Serve over HTTPS (required for service
# workers). No build, no bundler, no pipeline.

# …or ship a single file: everything inlined, opens from disk, drops on any host
npm run build:single     # → dist/digipoke.html
npm run verify:single    # boots it headlessly and plays the first two steps

# …or share your dev machine for a playtest, no account and no signup:
npm run dev &            # PWA on :8080
npm run tunnel           # prints https://<id>.lhr.life

# Sync API (optional)
PORT=4000 DIGIPOKE_ORIGIN=https://digipoke.example.com node server/src/server.js
# Put it behind an HTTPS reverse proxy and back up data/store.json.
```

When you change any shell asset, bump `CACHE_VERSION` in `apps/web/sw.js`.

---

## Security in one paragraph

Your save is encrypted in your browser with AES-256-GCM, using a key derived from your
passphrase with PBKDF2 (250 000 iterations). The sync server stores only the ciphertext
plus a scrypt hash of your password for authentication — two different KDFs, so the
server can verify you but can never decrypt your data. Losing the passphrase means
losing encrypted backups: there is deliberately no reset path, because a reset path
would require the server to hold a key.

Full details: [`docs/05-security-and-quality.md`](docs/05-security-and-quality.md).

---

## Browser support

Evergreen Chrome, Edge, Firefox and Safari (iOS 16.4+ for standalone install mode).
Requires IndexedDB and Web Crypto (i.e. a secure context: HTTPS or localhost).

---

## Licence

MIT.
