# DigiPoke — API & Interface Specifications

Part A defines the HTTP sync API. Part B defines the client's internal module
interfaces, state management contract and UI component hierarchy.

---

# PART A — HTTP API

## A.1 Conventions

| Aspect | Rule |
|---|---|
| Base URL | `http://localhost:4000/v1` (dev) — configurable in Settings; the client auto-derives `https://4000-<sandbox-host>/v1` when hosted on a preview origin |
| Transport | HTTPS in production; the client refuses to send credentials over plain HTTP from a secure context |
| Encoding | `application/json; charset=utf-8` |
| Auth | `Authorization: Bearer <token>` |
| Versioning | URL prefix `/v1`; breaking changes get `/v2` |
| Caching | `Cache-Control: no-store` on all responses; the service worker never caches `/v1/*` |
| CORS | `Access-Control-Allow-Origin: *` by default (set `DIGIPOKE_ORIGIN` to restrict) |
| Body limit | 2 MB (HTTP 413 when exceeded) |
| Rate limit | 10 auth requests / minute / IP (tunable via `DIGIPOKE_RATE_MAX`) |
| Errors | `{ "error": "Human readable message" }` with an appropriate status code |

### A.2 Status codes

| Code | Meaning | When |
|---|---|---|
| 200 | OK | Successful read/write |
| 201 | Created | Registration |
| 400 | Bad Request | Malformed body, invalid email, weak password, bad vault shape |
| 401 | Unauthorized | Missing/invalid/expired token; bad credentials |
| 404 | Not Found | Unknown route or method |
| 409 | Conflict | Email already registered **or** stale vault revision |
| 413 | Payload Too Large | Body over 2 MB |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected failure (never leaks stack traces) |

---

## A.3 `GET /v1/health`

Liveness probe used by the Settings screen.

**Response `200`**
```json
{
  "ok": true,
  "service": "digipoke-sync",
  "version": "1.0.0",
  "accounts": 42,
  "updatedAt": "2026-09-07T10:00:00.000Z",
  "time": "2026-09-07T10:42:11.000Z"
}
```

---

## A.4 `POST /v1/auth/register`

**Request**
```json
{ "email": "ada@example.com", "password": "correct-horse-1" }
```
- `email`: valid shape, ≤ 160 chars, lower-cased and trimmed server-side.
- `password`: 8–256 characters.

**Response `201`**
```json
{ "token": "<body>.<hmac>", "userId": "3f1c…uuid", "email": "ada@example.com", "vaultRev": 0 }
```

**Errors:** `400` (invalid email / weak password / bad JSON), `409` (email exists), `429` (rate limit).

---

## A.5 `POST /v1/auth/login`

**Request** — identical shape to register.

**Response `200`**
```json
{ "token": "…", "userId": "3f1c…uuid", "email": "ada@example.com", "vaultRev": 7 }
```

**Errors:** `401` with the *same* message for "unknown email" and "wrong password"
(no user enumeration), `429`.

---

## A.6 `GET /v1/vault`

**Headers:** `Authorization: Bearer <token>`

**Response `200`**
```json
{
  "vault": { "alg": "AES-GCM-256", "iv": "aXZpdmVj", "ct": "Y2lwaGVydGV4dA==", "schema": 3, "updatedAt": "…" },
  "rev": 7,
  "updatedAt": "2026-09-07T10:40:00.000Z"
}
```
When no vault has been uploaded yet: `{ "vault": null, "rev": 0 }`.

**Errors:** `401`.

---

## A.7 `PUT /v1/vault`

**Request**
```json
{
  "vault": { "alg": "AES-GCM-256", "iv": "<b64>", "ct": "<b64>", "schema": 3, "updatedAt": "…" },
  "rev": 7
}
```
- `vault` must be an object with string `alg`, `iv`, `ct` (contents are never inspected).
- `rev` is the revision the client believes is current. If the server's revision is
  higher, the write is refused with `409` (optimistic concurrency).

**Response `200`**
```json
{ "rev": 8, "savedAt": "2026-09-07T10:45:00.000Z" }
```

**Errors:** `400` (bad envelope), `401`, `409` (`{ "error": "…", "serverRev": 8 }`).

---

## A.8 `DELETE /v1/account`

Deletes the account **and** its vault. Local data is untouched.

**Response `200`** `{ "deleted": true }` · **Errors:** `401`.

---

## A.9 Sequence: first sync

```
Client                                            Server
  │ 1. passphrase ──PBKDF2(250k)──► AES key       │
  │ 2. POST /v1/auth/register {email, password} ─►│  scrypt hash stored
  │◄──────────────────────── {token, vaultRev:0} ─│
  │ 3. sealVault(key, save) ──► {alg, iv, ct}     │
  │ 4. PUT /v1/vault {vault, rev:0} ─────────────►│  ct stored verbatim
  │◄──────────────────────────────── {rev: 1} ────│
```

## A.10 Sequence: conflict

```
Device A pushes rev 0 → server rev 1
Device B (still at rev 0) pushes rev 0 → 409 { serverRev: 1 }
Device B: pull → decrypt → player chooses "use cloud save" or "keep local"
```

---

# PART B — Client Interfaces

## B.1 State management contract

`core/state.js` owns a single in-memory object. **The UI never mutates it directly.**

```js
import * as state from './core/state.js';

state.getState();                       // the whole save file (throws before init)
state.mutate((s) => { s.profile.shards += 10; });   // mutate + notify + persist (debounced)
state.subscribe((s) => render(s));      // via bus: EVENTS.STATE_CHANGED
await state.flush();                    // force an immediate IndexedDB write
```

### B.1.1 Named actions (the only sanctioned writes)

| Domain | Actions |
|---|---|
| Profile | `init`, `createProfile`, `replaceState`, `wipe`, `migrate`, `flush`, `lastPersisted` |
| Creatures | `getCreature`, `allCreatures`, `teamCreatures`, `strongestLevel`, `teamIsWiped`, `healAllCreatures`, `addCreature`, `releaseCreature`, `renameCreature`, `addToTeam`, `removeFromTeam`, `setTeam` |
| Economy | `addItem`, `consumeItem`, `buyBall`, `addShards`, `spendShards`, `ballCounts` |
| Progress | `ensureObjectives`, `bumpStat`, `claimObjective`, `recordSteps`, `recordBattleResult`, `recordCapture`, `recordEvolution` |
| Settings | `updateSettings`, `setAccount`, `clearAccount` |
| Portability | `exportPayload`, `saveSummary` |

### B.1.2 Events (`core/bus.js`)

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `state:changed` | the state object | `state.mutate` | main (re-render), chrome |
| `state:persisted` | ISO timestamp | `state.flush` | Settings |
| `ui:toast` | `{message, kind}` | anything | toast host |
| `battle:start` / `battle:end` | `{kind}` / `{outcome}` | battle screen | (extension points) |
| `creature:caught`, `creature:evolved` | creature / `{uid, from, to}` | state | toasts, future achievements |
| `sync:status` | `{label, kind}` | syncClient | topbar pill |

---

## B.2 Domain engine interfaces

### `domain/battle.js`

```js
const battle = new Battle({
  allyTeam: [creature, …],   // 1–6 LIVE creature objects (HP/XP written through)
  foeTeam:  [creature, …],
  kind: 'wild' | 'trainer',
  foeName: 'Wild Flarion',
  rng: createRng(seed),      // required
  inventory: { dataBall: 12, … },   // mutated when items are consumed
  zoneId: 'ember_ridge',
});

battle.submit({ type: 'move',   moveId: 'pyroFang' });
battle.submit({ type: 'switch', index: 2 });
battle.submit({ type: 'item',   itemId: 'healPatch' });
battle.submit({ type: 'ball',   ballId: 'cipherBall' });
battle.submit({ type: 'flee' });
battle.sendIn(index);        // forced replacement (does not consume a turn)
battle.active(SIDE.ALLY);    // combatant or null
battle.awaitingSwitch();     // boolean
battle.legalActions();       // ['move','switch','item','flee'(,'ball')]
battle.canCapture();
battle.snapshot();           // JSON-safe debug view
```

**Event stream** returned by `submit()` — the UI replays it in order:

| Event | Key fields |
|---|---|
| `start` | `kind`, `foeName`, `ally`, `foe` |
| `move` | `side`, `moveId`, `name`, `actor` |
| `damage` | `side`, `amount`, `hp`, `maxHp`, `eff`, `crit`, `text` |
| `miss` | `side`, `name` |
| `heal` | `side`, `amount`, `hp`, `maxHp` |
| `status` | `side`, `status`, `text` |
| `statusTick` | `side`, `status`, `text` |
| `cure` | `side`, `name`, `text` |
| `stat` | `side`, `stat`, `delta`, `text` |
| `faint` | `side`, `uid`, `name`, `text` |
| `switch` | `side`, `index`, `name`, `text` |
| `ball` | `ballId`, `chance`, `shakes`, `success`, `text` |
| `xp` | `uid`, `name`, `amount` |
| `level` | `uid`, `name`, `level`, `learned[]` |
| `learned` | `uid`, `name`, `moveId`, `moveName` |
| `evolve` | `uid`, `from`, `to`, `name`, `oldName`, `text` |
| `item` | `side`, `itemId` |
| `flee` | `ok`, `text` |
| `end` | `outcome`, `text` |
| `msg` | `text` |

### Other domain modules

| Module | Signature | Notes |
|---|---|---|
| `types.js` | `effectiveness(atk, defTypes[]) → 0\|0.25\|0.5\|1\|2\|4` | Total function; unknown types resolve to 1 |
| `moves.js` | `getMove(id) → move` | Falls back to "Struggle" for unknown ids |
| `species.js` | `getSpecies(id)`, `learnsetFor(id)`, `STARTER_IDS` | Falls back to `nulkit` |
| `creature.js` | `createCreature({speciesId, level, rand, cores, nickname, origin, shiny})`<br>`statsFor(c)`, `maxHpOf(c)`, `gainXp(c, n)`, `canEvolve(c)`, `evolutionBlocker(c)`, `applyEvolution(c, to)`, `raiseCore(c, stat)`, `teachMove(c, moveId)` | `gainXp` returns `{gained, levels[], learned[], evolved}` |
| `capture.js` | `captureChance({hp,maxHp,rate,ballId,level,status})`, `attemptCapture({…, rand})` | Bounded to `[0.01, 0.97]` |
| `progression.js` | `xpToNext(l)`, `xpReward(species, level, isTrainer)`, `shardValue`, `coreCost`, `dailyObjectives(dateKey)` | |
| `zones.js` | `rollEncounter(zone, rand)`, `rollRival(zone, level, rand)`, `unlockedZones(level)` | |

---

## B.3 Component hierarchy

```
<body>
└─ .app-shell
   ├─ header.topbar                     ← components.renderTopbar()
   │   ├─ .topbar__brand                → navigate('/')
   │   ├─ .topbar__stats
   │   │   ├─ .pill--shards    (◈ shards)
   │   │   ├─ .pill            (Lv strongest)
   │   │   └─ .pill--sync      (sync status)
   │   └─ button.icon-btn               → navigate('/settings')  + #install-btn
   │
   ├─ main#view.view                    ← router mounts one screen here
   │   │
   │   ├─ screens/onboarding  .view--onboarding
   │   │   ├─ .onboard__head (+ .onboard__step ×3)
   │   │   ├─ card → stepIdentity   (3× input.input, .pass-strength, Continue)
   │   │   ├─ card → stepStarter    (.starter-grid → .starter-card ×3)
   │   │   └─ card → stepReady      (.help-list, .ready-starter, Enter the Nexus)
   │   │
   │   ├─ screens/dashboard   .view--dashboard
   │   │   ├─ heroCard     (.hero, .hero__bars, .stat-grid → .stat-box ×6)
   │   │   ├─ objectivesCard(.objective ×3 → .bar + Claim button)
   │   │   ├─ teamCard      (.team-grid → .team-slot ×6)
   │   │   └─ quickActions  (.quick-action ×4)
   │   │
   │   ├─ screens/ranch      .view--ranch
   │   │   ├─ controlsBar   (.seg → .seg-btn ×4, sort select, Heal all)
   │   │   ├─ grid → creatureCard ×N
   │   │   └─ modal(openDetail) → .detail
   │   │        ├─ .detail__head (sprite + identity + lore)
   │   │        ├─ hpBar, .detail__xp
   │   │        ├─ .detail__stats  (statBar ×4)
   │   │        ├─ .detail__cores  (.core-cell ×4)
   │   │        ├─ .detail__moves  (.move-row ×≤4)
   │   │        └─ actions: Team / Rename / Rest / Release
   │   │
   │   ├─ screens/explore    .view--explore
   │   │   ├─ .zone-grid → .zone-card ×6 (locked states)
   │   │   └─ zonePanel (Scan / Challenge trainer, .encounter-list)
   │   │
   │   ├─ screens/battle     .view--battle
   │   │   ├─ .arena
   │   │   │   ├─ .arena__foe  → .combat-card--foe
   │   │   │   ├─ .arena__vs
   │   │   │   └─ .arena__ally → .combat-card--ally
   │   │   ├─ .log  → .log__line (replayed from engine events)
   │   │   └─ .battle-menu
   │   │        ├─ .menu-root   (.move-grid → .move-btn ×≤4 + .menu-actions)
   │   │        ├─ .menu-panel  → ballMenu / bagMenu / teamMenu (.list-row)
   │   │        └─ .menu-panel--result (.result__title, rewards, actions)
   │   │
   │   ├─ screens/lab        .view--lab
   │   │   ├─ .seg (Evolution | Core training | Move tutor | Fabricator)
   │   │   ├─ evolvePanel   (creatureCard ×N, .path-list → .path-row)
   │   │   ├─ coresPanel    (.picker, .core-panel, .core-grid → .core-btn ×4)
   │   │   ├─ movesPanel    (.picker, .detail__moves, .tutor-list)
   │   │   └─ fabricate     (.shop-list → .shop-row ×3)
   │   │
   │   └─ screens/settings   .view--settings
   │       ├─ profileCard     (.kv-list → .kv-row, Edit / Copy / Save now / Change passphrase)
   │       ├─ preferencesCard (theme select, .toggle ×3)
   │       ├─ syncCard        (server URL, Connect / Sync now / Restore / Sign out / Delete)
   │       ├─ dataCard        (Export JSON, Export encrypted, Import, .backup-list, Delete all)
   │       └─ aboutCard       (.kv-list)
   │
   └─ nav.tabbar                        ← components.renderTabbar()
       └─ .tabbar__item ×5 (Nexus, Ranch, Explore, Lab, Data)

#modal-root  → .modal__backdrop → .modal__panel (.modal__title/.modal__body/.modal__actions)
#toast-root  → .toast (auto-dismiss)
```

### B.3.1 Shared primitives (`ui/components.js`)

`card`, `sectionHead`, `grid`, `statBar`, `hpBar`, `xpBar`, `typeChip`, `typeRow`,
`badge`, `statusBadge`, `pill`, `spriteEl`, `creatureCard`, `emptyState`, `modal`,
`confirmDialog`, `promptDialog`, `toast`, `renderTopbar`, `renderTabbar`, `timeAgo`.

### B.3.2 Design tokens (`styles/tokens.css`)

Themes `nexus` (default), `ember`, `abyss`, `mono` are pure token overrides on
`[data-theme]`. Spacing (4–44 px), radii (8–26 px), motion (120/190/340 ms) and
elevation are tokenised; `prefers-reduced-motion` collapses all durations.

---

## B.4 Routing contract

| Hash | Screen | Guard |
|---|---|---|
| `#/onboarding` | onboarding | Redirects to `/` when a profile exists (except the final "ready" step) |
| `#/` | dashboard (Nexus) | Requires a profile, else `/onboarding` |
| `#/ranch` | ranch | Requires a profile |
| `#/ranch?focus=<uid>` | ranch + creature modal | — |
| `#/explore` | explore | Requires a profile |
| `#/battle?wild=1&zone=<id>&species=<id>&level=<n>` | battle (wild) | Requires a profile |
| `#/battle?trainer=1&zone=<id>` | battle (trainer) | Requires a profile |
| `#/lab` | lab | Requires a profile |
| `#/lab?evolve=<uid>` | lab + evolution dialog | — |
| `#/settings` | settings | Requires a profile |

---

## B.5 Error handling & UX states

| Situation | Behaviour |
|---|---|
| IndexedDB unavailable | Boot continues; persistent error toast |
| Invalid action submitted to the engine | Returns `[{t:'msg',…}]`; the UI logs it and re-renders the menu |
| Not enough shards / items | Buttons disabled; actions re-checked server-side (state) and toast on failure |
| Sync unreachable | Error toast; local play unaffected |
| Lost passphrase | Documented as unrecoverable; no reset path (by design — otherwise the server could be coerced) |
| Reduced motion | Durations collapse to ~0; sprite idle animations disabled |
