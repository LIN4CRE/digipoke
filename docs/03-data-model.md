# DigiPoke — Database Schema & Data Models

**Scope.** DigiPoke has two persistence surfaces:

1. **Client (authoritative):** IndexedDB, holding one plain-JSON save file plus
   dex records, a sync outbox and a backup ring.
2. **Server (optional, opaque):** a single JSON store holding users and their
   encrypted vault blobs.

This document defines both, plus the reference SQL schema used if the server is
ported to a relational database (`docs/03-schema.sql`).

---

## 1. Entity Relationship Overview

```
┌──────────────┐       1:N      ┌────────────────┐       N:1      ┌─────────────┐
│   Profile    │───────────────►│    Creature    │◄───────────────│   Species   │
│  (1 per save)│                │  (owned roster)│                │ (static dex)│
│              │                │                │                │             │
│ displayName  │                │ uid (PK)       │                │ id (PK)     │
│ shards       │                │ speciesId (FK) │                │ types[]     │
│ stats{}      │                │ level, xp      │                │ base{}      │
│ seed         │                │ bond, hp       │                │ moves[]     │
└──────┬───────┘                │ cores{}        │                │ evolve{}    │
       │                        │ moves[]        │                │ capture     │
       │ 1:N                    │ shiny, origin  │                └─────────────┘
       │                        └───────┬────────┘                       ▲
       │                                │ M:N (learnset)                  │
       ▼                                ▼                                 │
┌──────────────┐                ┌────────────────┐                        │
│  Objective   │                │     Move       │────────────────────────┘
│ (daily, 3)   │                │  (static)      │
└──────────────┘                └────────────────┘

┌──────────────┐       N:M      ┌─────────────┐       1:1      ┌──────────────┐
│     Zone     │◄──────────────►│   Species   │                │   DexEntry   │
│ (static)     │  encounters    │             │                │ (seen/caught)│
└──────────────┘                └─────────────┘                └──────────────┘

Server-side (opaque):
┌──────────────┐       1:1      ┌──────────────────────────────────────────┐
│     User     │───────────────►│  Vault { alg, iv, ct, schema, updatedAt }│
│ id (PK)      │                │  ← AES-GCM ciphertext, unreadable here   │
│ email (UQ)   │                └──────────────────────────────────────────┘
│ passHash     │
│ rev          │
└──────────────┘
```

---

## 2. Client Save File (IndexedDB → `kv` store, key `state`)

The save file is **plain JSON**: no class instances, no `Date` objects, no `Map`s.
It round-trips through `structuredClone`, `JSON.stringify` and the network unchanged.

```jsonc
{
  "schema": 3,
  "profile": {
    "id": "profile_9f2c1a7b4e8d",
    "displayName": "Ada",
    "createdAt": "2026-09-07T10:00:00.000Z",
    "lastSeenAt": "2026-09-07T10:42:11.000Z",
    "seed": 3712938471,
    "shards": 148,
    "stats": {
      "battles": 42, "battlesWon": 38, "captures": 11, "evolutions": 3,
      "steps": 96, "trainersBeaten": 6, "faints": 2, "releases": 4
    }
  },

  "creatures": {
    "cr_lz8x2k_a1b2c3": {
      "uid": "cr_lz8x2k_a1b2c3",
      "speciesId": "flarion",
      "nickname": null,
      "level": 22,
      "xp": 612,
      "bond": 46,
      "hp": 71,
      "cores": { "hp": 11, "atk": 14, "def": 6, "spd": 9 },
      "moves": ["rend", "cinderLash", "pyroFang", "focus"],
      "origin": { "zone": "ember_ridge", "at": "2026-09-07T10:12:00.000Z", "wild": true },
      "shiny": false,
      "stats": { "battles": 19, "wins": 18 }
    }
  },

  "team": ["cr_lz8x2k_a1b2c3"],                 // ordered uids, max 6
  "inventory": { "dataBall": 12, "cipherBall": 4, "matrixBall": 1, "healPatch": 3, "statusPatch": 2 },

  "progress": {
    "zoneId": "ember_ridge",
    "unlocked": ["pixel_plains", "static_springs", "ember_ridge"],
    "defeatedTrainers": ["Cinder Adept"],
    "objectives": {
      "dateKey": "2026-09-07",
      "items": [
        { "id": "captures", "text": "Capture creatures", "goal": 2, "reward": 25, "stat": "captures", "progress": 1 },
        { "id": "steps",    "text": "Scan the wilds",     "goal": 12, "reward": 12, "stat": "steps",    "progress": 7 },
        { "id": "evolutions","text": "Trigger evolutions","goal": 1,  "reward": 40, "stat": "evolutions","progress": 0 }
      ],
      "claimed": []
    }
  },

  "settings": {
    "theme": "nexus", "motion": true, "sound": true, "autosave": true,
    "syncEnabled": true, "serverUrl": null, "autoHealOnLevelUp": true
  },

  "account": { "email": "ada@example.com", "token": "<opaque>", "vaultRev": 7, "lastSyncedAt": "2026-09-07T10:40:00.000Z" },

  "updatedAt": "2026-09-07T10:42:11.000Z"
}
```

### 2.1 Field constraints

| Field | Type | Constraint |
|---|---|---|
| `schema` | int | Current `3`; migrations run on load |
| `profile.displayName` | string | 2–18 chars |
| `profile.shards` | int | ≥ 0 |
| `creatures[uid].level` | int | 1–50 (`LEVEL_CAP`) |
| `creatures[uid].xp` | int | 0 ≤ xp < xpToNext(level); 0 at cap |
| `creatures[uid].bond` | int | 0–100 (`BOND_CAP`) |
| `creatures[uid].cores.*` | int | 0–15 (`CORE_CAP`) |
| `creatures[uid].moves` | string[] | 1–4 move ids, all legal for the species |
| `creatures[uid].hp` | int | 0 ≤ hp ≤ maxHp(level, base, cores) |
| `team` | uid[] | ≤ 6; every uid resolves to a creature |
| `inventory` | map | Non-negative integers; unknown keys ignored |
| `progress.unlocked` | zoneId[] | Always contains `pixel_plains` |
| `account.token` | string\|null | Session token; **never** written to exports? — see §6 |

---

## 3. IndexedDB Physical Schema

Database `digipoke`, version 1.

| Store | Key path | Purpose | Retention |
|---|---|---|---|
| `kv` | (out-of-line key) | `state` (the save file), `vault` (salt + verifier), `account` | Until wipe |
| `dex` | `id` (species id) | Discovery records: `{ id, seen, caught, firstSeenAt, firstCaughtAt? }` | Survives save import |
| `outbox` | `id` (auto-increment) | Queued sync operations | Drained on sync |
| `backups` | `id` (`bk_<timestamp>`) | Rolling snapshots of the save file | Last 5 |

**Transactions.** Every write is a single transaction with `durability: 'strict'`
where supported, so a tab crash cannot produce a partially written save.

**Vault record (`kv` key `vault`):**
```json
{ "salt": "<base64 16 bytes>", "verifier": { "alg": "AES-GCM-256", "iv": "...", "ct": "..." },
  "iterations": 250000, "createdAt": "2026-09-07T10:00:00.000Z" }
```

---

## 4. Static Game Data (compiled into the client)

| Entity | Records | Key fields |
|---|---|---|
| `species` | 34 (10 lines × 3 stages + 4 Megas) | `types[]`, `base{hp,atk,def,spd}`, `moves[]`, `evolve{to,level,bond}`, `capture`, `xp`, `art`, `lore` |
| `moves` | 33 | `type`, `power`, `acc`, `pp`, `effect{kind,…}`, `desc` |
| `types` | 10 (+ sparse 10×10 chart) | `name`, `glyph`, `color` |
| `zones` | 6 | `minLevel`, `maxLevel`, `recommended`, `encounters[{id,w}]`, `rivals[]` |
| `balls` | 3 | `mult`, `color`, `desc`, price |
| `statuses` | 5 | `dot`, `atkMult`, `spdMult`, `skipChance`, `thawChance`, `turns` |

### 4.1 Derived stat formula

```
HP  = floor((2·base.hp  + cores.hp ) · level / 100) + level + 10
ATK = floor((2·base.atk + cores.atk) · level / 100) + 5
DEF = floor((2·base.def + cores.def) · level / 100) + 5
SPD = floor((2·base.spd + cores.spd) · level / 100) + 5
```

### 4.2 Progression curves

| Curve | Formula |
|---|---|
| XP to reach level L | `L³` (so XP for level n → n+1 is `(n+1)³ − n³`) |
| XP yield | `floor(species.xp · level / 7)` × 1.5 for trainers, × 0.5 for non-participants |
| Capture chance | `clamp(((3·maxHp − 2·hp)·rate/255)/(3·maxHp) · ballMult · levelFactor · statusBonus, 0.01, 0.97)` |
| Core training cost | `6 + currentCore · 3` shards |
| Shards from release | `4 + stageBonus + floor(level/4)` |
| Glitch (shiny) rate | `1 / 512` |

---

## 5. Server Store (`data/store.json`) & Reference SQL

Physical store (default deployment):

```jsonc
{
  "users": {
    "3f1c…uuid": {
      "id": "3f1c…uuid",
      "email": "ada@example.com",
      "passHash": "scrypt$32768$8$1$<saltB64>$<hashB64>",
      "vault": { "alg": "AES-GCM-256", "iv": "<b64>", "ct": "<b64>", "schema": 3, "updatedAt": "…" },
      "rev": 7,
      "createdAt": "…", "updatedAt": "…"
    }
  },
  "secret": "<64 hex chars — HMAC signing key>",
  "updatedAt": "…"
}
```

The equivalent relational schema is in **`docs/03-schema.sql`** and is the target
for any deployment that outgrows a single node.

### 5.1 Server invariants

| Invariant | Enforced by |
|---|---|
| `email` unique (case-insensitive) | Lookup before insert → HTTP 409 |
| `rev` monotonic per user | `401`/`409` on stale writes; server always increments |
| `passHash` never leaves the server | Responses return only `token`, `userId`, `email`, `vaultRev` |
| Vault envelope shape (`alg`,`iv`,`ct` strings) | `isVaultShape()` → HTTP 400 |
| Body ≤ 2 MB | Streaming size check → HTTP 413 |

---

## 6. Secrets in the Save File — Policy

| Secret | Stored? | Notes |
|---|---|---|
| Passphrase | ❌ Never | Only a PBKDF2-derived, non-extractable `CryptoKey` and a verifier envelope |
| Raw encryption key | ❌ Never | `CryptoKey` is created non-extractable |
| Session token | ⚠️ In IndexedDB | Enables "stay signed in"; **stripped from plain exports**? — currently included in `exportPayload()`. Exports are therefore treated as bearer credentials: prefer **encrypted export**. |

> **Recommendation for production:** strip `account.token` in `exportPayload()` and
> require re-authentication after import. The field is retained today so that a
> single-device restore keeps sync alive; the encrypted export path already
> mitigates the risk.

---

## 7. Migrations

`core/state.js:migrate(raw)` is additive and idempotent — a v1 save can jump straight to v3.

| From → To | Change |
|---|---|
| v1 → v2 | Added `profile.shards` and `progress.objectives` |
| v2 → v3 | Extracted `settings` from `profile`; added `account` block and `healPatch`/`statusPatch` inventory |

Every migration ends with a **defensive normalisation** pass that, regardless of
input, guarantees: `creatures` is an object, `team` only contains resolvable uids
and is capped at 6, `profile.stats` has every counter, `progress.unlocked`
contains `pixel_plains`, and `schema` is set to the current version.

Unknown species ids resolve to `nulkit` via `getSpecies()`; unknown move ids
resolve to a "Struggle" fallback via `getMove()`. Corrupt saves degrade, they do not crash.

---

## 8. Volume Estimates

| Entity | Typical | Upper bound |
|---|---|---|
| Creatures per save | 10–60 | ~300 |
| Save file size | 40–120 KB | ~500 KB (JSON) |
| Encrypted vault | +33% overhead | ~700 KB (well under the 2 MB API cap) |
| Dex entries | 34 | 34 |
| Backups retained | 5 | 5 (≈ 2.5 MB worst case) |
| Browser storage used | < 5 MB | Quota is typically hundreds of MB |
