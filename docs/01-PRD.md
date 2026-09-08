# DigiPoke — Product Requirements Document

| Field | Value |
|---|---|
| **Product** | DigiPoke — a local-first creature-collecting battler |
| **Platform** | Progressive Web App (installable, offline-capable) |
| **Stack** | Vanilla ES modules + Service Worker (client); zero-dependency Node.js HTTP API (optional sync) |
| **Architecture style** | Local-first with optional zero-knowledge cloud replication |
| **Document owner** | Principal Systems Architect |
| **Status** | v1.0 — approved for build |
| **Date** | 2026-09-07 |

---

## 1. Vision & Positioning

**DigiPoke is what happens when a Tamagotchi-style evolution ladder (Digimon) collides with a
collection-and-battle loop (Pokémon) — and then the cloud is removed from the critical path.**

Three pillars:

1. **Collection with depth.** 34 species across 10 evolution lines, each with a defined
   identity, elemental typing, learnset and evolution conditions.
2. **Battling with decisions, not grinding.** A deterministic, type-chart-driven combat system
   where outcome is decided by match-ups, switching and resource management — not by who
   pressed "attack" more times.
3. **Ownership.** The save file lives on the player's device. Sync is opt-in and
   end-to-end encrypted; the server that stores it cannot read it. The player can export,
   move, inspect and delete everything at any time.

**One-sentence pitch:** Raise, battle and evolve digital life — entirely on your device.

---

## 2. Problem Statement

| # | Problem | Evidence / Rationale |
|---|---|---|
| P1 | Retro monster-collecting games are either unofficial ROM hacks or cloud-only live services that vanish when a server is retired. | Entire genres of fan-favourite games are unplayable the moment a publisher pulls the plug. |
| P2 | Mobile monster games are engineered around monetised waiting (energy timers, gacha pulls). | Retention mechanics optimise for spend, not play. |
| P3 | Players have no ownership of their collection. | Progress is a row in someone else's database; there is no export, no portability, no offline. |
| P4 | Offline-first gaming is rare even though connectivity is unreliable (commutes, flights, data caps). | A PWA can deliver a native-grade, installable experience with zero app-store friction. |

---

## 3. Goals & Non-Goals

### 3.1 Goals

| ID | Goal | Success measure |
|---|---|---|
| G1 | A complete core loop (catch → train → evolve → battle) playable in 5 minutes from a cold install | Median time-to-first-capture < 5 min |
| G2 | 100% of gameplay available offline after first load | Zero network calls during a session with sync disabled |
| G3 | Player owns their data | Encrypted export + import round-trips with no loss |
| G4 | Deterministic, testable combat | A seed + action list reproduces a battle exactly; fuzz-tested |
| G5 | Installable as a first-class app | Passes PWA installability; works in standalone display mode |

### 3.2 Non-Goals (explicitly out of scope for v1)

- Multiplayer battles, trading, or a global leaderboard.
- Server-authoritative progression or anti-cheat.
- Native iOS/Android wrappers (the PWA is the distribution channel).
- Monetisation of any kind (no ads, no IAP, no gacha).
- Real-money economies, NFTs or blockchain-adjacent features.

---

## 4. Personas

### 4.1 Primary — "Rook", the Returning Fan (age 25–40)
- **Context:** Grew up on monster-collecting games; plays in short bursts on a commute; owns a phone and a laptop.
- **Needs:** Depth without a 20-hour tutorial; respect for their time; the ability to stop and resume instantly.
- **Pain:** Live-service games demand daily logins and punish breaks.
- **Success:** Finishes a session on the train with no signal and loses nothing.

### 4.2 Primary — "Mira", the Systems Tinkerer (age 18–30)
- **Context:** Enjoys optimising: type match-ups, stat spreads, evolution timing.
- **Needs:** Transparent mechanics; visible numbers; a game that rewards planning.
- **Pain:** Hidden formulae and luck-heavy combat.
- **Success:** Can predict a match-up outcome before committing, and can inspect cores (IVs), stats and learnsets.

### 4.3 Secondary — "Sam", the Privacy-Conscious Player (age 30–50)
- **Context:** Skeptical of always-online accounts and data collection.
- **Needs:** A game that works without an account, and, if sync is offered, one whose server cannot read their data.
- **Success:** Can play fully without registering, and can verify (in Settings) that only ciphertext leaves the device.

### 4.4 Secondary — "Kai", the Young Explorer (age 10–15, supervised)
- **Context:** Plays on a tablet; short attention span; highly motivated by collection and colour.
- **Needs:** Immediate feedback, visible progress, no punishing loss states.
- **Success:** Losing a battle costs nothing permanent (the team is restored at the nearest Node).

---

## 5. Core User Journeys

### J1 — First run (cold install → first battle)
1. Land on the PWA shell (works offline after the first load).
2. **Identity:** enter display name + vault passphrase (8+ chars, strength meter).
   The passphrase derives an AES-GCM key *on-device*; nothing is uploaded.
3. **Starter:** choose one of three rookies (Emberling / Drizzle / Sproutle).
4. **Ready screen:** 4-line "how it works" primer.
5. Land on the Nexus dashboard with the starter on the team.

> Guard: if a save exists, `/onboarding` redirects to the dashboard. If no save exists, every
> other route redirects to `/onboarding`.

### J2 — The core loop (explore → encounter → battle → capture/reward)
1. **Explore** → pick an unlocked zone (gated by team level).
2. **Scan** (1 step) → 42% encounter chance; otherwise "nothing but stray data".
3. **Battle** → turn-based: Fight / Ball / Bag / Team / Flee.
   Move buttons show a live effectiveness hint (×2, ×0.5, "No effect").
4. **Capture** → per-ball catch probability is shown *before* committing a ball.
5. **Resolution** → XP, possible level-up, learnset update, possible evolution, Data Shards.
6. **Lab** → spend shards on core training, move tutoring or capture hardware.

### J3 — Progression & mastery
1. Level creatures; bond rises with wins, level-ups, training and capture.
2. Evolve at level thresholds; four lines have a **Mega** form gated by level 46 **and** bond 80.
3. Train cores (IVs, 0–15 each) with Data Shards for long-term ceiling chasing.
4. Unlock six zones as the team's strongest level rises.
5. Complete three daily objectives for shards (deterministic per calendar date).

### J4 — Data ownership
1. **Settings → Data** shows storage used, creature counts and schema version.
2. **Export JSON** (portable, plaintext) or **Export encrypted** (`.dpvault`, AES-GCM + PBKDF2).
3. **Import** accepts either format; encrypted files prompt for the passphrase.
4. **Automatic backups:** the last 5 save snapshots are retained and restorable in one click.
5. **Optional sync:** register/login; the save is sealed client-side before upload.
6. **Delete all data** wipes IndexedDB, dex, backups and memory.

### J5 — Losing (graceful failure)
1. Team wiped → battle ends in `lose`; the roster is restored at the nearest Node.
2. No permanent loss: no items are consumed by losing, no creatures are lost, no currency is deducted.

---

## 6. Functional Requirements

Priority: **P0** = MVP-blocking, **P1** = important, **P2** = desirable.

### 6.1 Onboarding & Identity
| ID | Requirement | Pri |
|---|---|---|
| FR-1.1 | Create a local profile (display name + passphrase) with no network call | P0 |
| FR-1.2 | Derive a non-extractable AES-GCM vault key via PBKDF2 (250k iterations) | P0 |
| FR-1.3 | Store a verifier envelope so the passphrase can be validated without storing it | P0 |
| FR-1.4 | Passphrase strength feedback and 8-character minimum | P1 |
| FR-1.5 | Choose one of three starters | P0 |
| FR-1.6 | Change the vault passphrase later (re-derive verifier) | P1 |

### 6.2 Dashboard & Core Workflow
| ID | Requirement | Pri |
|---|---|---|
| FR-2.1 | Show tamer identity, Data Shards, team vitality and lifetime stats | P0 |
| FR-2.2 | Three daily objectives with progress bars and claimable shard rewards | P1 |
| FR-2.3 | Active team panel (6 slots) with one-tap heal | P0 |
| FR-2.4 | Quick actions into Explore, Lab, Ranch and Settings | P0 |

### 6.3 Exploration & Encounters
| ID | Requirement | Pri |
|---|---|---|
| FR-3.1 | Six zones with level bands, encounter tables and unlock thresholds | P0 |
| FR-3.2 | Weighted random encounters rolled from a seeded PRNG | P0 |
| FR-3.3 | Procedurally generated rival trainers (2–6 creatures, level-scaled) | P0 |
| FR-3.4 | "Glitch" (shiny) variants at 1/512, visually distinct | P2 |
| FR-3.5 | Zone unlocks as team level rises | P0 |

### 6.4 Battle System
| ID | Requirement | Pri |
|---|---|---|
| FR-4.1 | Turn-based combat with priority tiers (switch/flee > item > ball > move) | P0 |
| FR-4.2 | 10 elemental types with 0×/0.25×/0.5×/1×/2×/4× multipliers | P0 |
| FR-4.3 | STAB (1.25×), crits (6.25%, 1.5×), accuracy checks, damage variance 0.85–1.0 | P0 |
| FR-4.4 | Five non-volatile statuses (burn, poison, paralyse, freeze, sleep) with tick/skip rules | P0 |
| FR-4.5 | Combat stat stages (−2…+2) for ATK/DEF/SPD | P1 |
| FR-4.6 | Capture with three ball types and a live success probability | P0 |
| FR-4.7 | Bag items: Heal Patch (60% HP), Status Patch (cure) | P1 |
| FR-4.8 | Flee (wild only; speed-influenced) | P0 |
| FR-4.9 | Forced switch after a faint; AI auto-switches | P0 |
| FR-4.10 | XP, level-up, learnset updates and in-battle evolution | P0 |
| FR-4.11 | Event-stream output so the UI can animate without computing rules | P0 |
| FR-4.12 | Deterministic given a seed (replayable, fuzz-testable) | P0 |

### 6.5 Collection & Progression
| ID | Requirement | Pri |
|---|---|---|
| FR-5.1 | Ranch: browse/filter/sort roster, inspect, rename, rest, release for shards | P0 |
| FR-5.2 | Team management up to 6 members | P0 |
| FR-5.3 | Lab: evolution, core training, move tutoring, ball fabricator | P0 |
| FR-5.4 | Cores (IVs) 0–15 per stat with shard costs that scale | P1 |
| FR-5.5 | Bond tiers; Mega evolution gated on level + bond | P1 |
| FR-5.6 | Dex records (seen/caught) persisted independently of the save | P2 |

### 6.6 Settings & Data
| ID | Requirement | Pri |
|---|---|---|
| FR-6.1 | Theme, animation, sound and autosave preferences | P1 |
| FR-6.2 | Plain and encrypted export; import of both | P0 |
| FR-6.3 | Rolling backup ring (5 snapshots) with one-click restore | P1 |
| FR-6.4 | Storage estimate and schema version display | P2 |
| FR-6.5 | Optional cloud sync with register/login/push/pull/conflict resolution | P1 |
| FR-6.6 | Delete all local data (with confirmation) | P0 |
| FR-6.7 | Offline capability: full gameplay with no network | P0 |

---

## 7. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | First meaningful paint < 2s on mid-tier mobile; whole app shell < 250 KB (no image assets) |
| NFR-2 | Offline | 100% of gameplay after first load; service worker precaches the shell |
| NFR-3 | Durability | Every state change persisted within 600 ms; HP/XP written through during battle |
| NFR-4 | Privacy | No analytics, no trackers, no third-party requests. Ever. |
| NFR-5 | Security | AES-256-GCM vault, PBKDF2 250k, scrypt server-side, HMAC tokens, non-extractable keys |
| NFR-6 | Accessibility | Visible focus rings, semantic landmarks, ARIA on dialogs, reduced-motion support |
| NFR-7 | Compatibility | Evergreen browsers (Chrome/Edge/Safari/Firefox) + iOS 16.4+ standalone mode |
| NFR-8 | Testability | Deterministic engine; ≥ 90% coverage of battle/creature/crypto modules |
| NFR-9 | Portability | Save file is plain JSON with a schema version and forward/backward migrations |
| NFR-10 | Maintainability | Zero runtime dependencies in the client; zero in the server |

---

## 8. MVP Scope (this build)

**Included:** everything marked P0 above, plus P1 items already implemented
(objectives, core training, move tutoring, backup ring, theming, sound, sync).

**Deferred to v1.1+:** discovery/dex completion screens, abilities/held items, double battles,
weather/terrain, breeding, a battle-replay sharing format, and a hosted sync service.

**Definition of Done (MVP):**
- `npm start` serves the PWA and API; `npm test` is green (39 tests: domain, API, UI).
- A new player can onboard, battle, capture, evolve, export and re-import without errors.
- Airplane mode: the app remains fully playable after the first visit.
- Lighthouse PWA checks pass (installable manifest, service worker, HTTPS/localhost).
