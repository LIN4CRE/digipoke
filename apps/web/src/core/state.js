/**
 * state.js — Single source of truth for the player's save file.
 *
 * Architecture
 * ------------
 * One immutable-by-convention state object lives in memory. Screens read it
 * directly; every write goes through a named action in this module, which
 * mutates, notifies subscribers (via the bus) and schedules a debounced
 * IndexedDB write. This gives us:
 *
 *   • predictable data flow (no hidden writes scattered across the UI),
 *   • cheap "dirty" tracking for the sync engine,
 *   • one place to add migrations and invariants.
 *
 * The save file is plain JSON — no class instances, no Dates, no Maps — so it
 * round-trips through IndexedDB, `JSON.stringify` and the network unchanged.
 *
 * @module core/state
 */

import * as db from './db.js';
import { emit, EVENTS } from './bus.js';
import { createRng, randomSeed } from './rng.js';
import { randomId } from './crypto.js';
import { createCreature, displayName, healCreature, maxHpOf } from '../domain/creature.js';
import { getSpecies } from '../domain/species.js';
import { STARTER_INVENTORY, BALL_PRICES, BALLS } from '../domain/capture.js';
import { dailyObjectives, shardValue, victoryRewards } from '../domain/progression.js';
import { ZONES, getZone } from '../domain/zones.js';

/** Bump this whenever the shape of the save file changes. */
export const SCHEMA_VERSION = 4;

/** Maximum size of the active battle team. */
export const TEAM_SIZE = 6;

/** Local seed used for deterministic world rolls tied to this profile. */
const rng = createRng(randomSeed());

/* ------------------------------------------------------------- defaults */

/** Build a fresh save file. */
export function defaultState({ displayName = 'Tamer', starterId = 'emberling', tamer = null } = {}) {
  const now = new Date().toISOString();
  const starter = createCreature({ speciesId: starterId, level: 5, rand: rng, origin: { zone: 'lab', wild: false } });
  starter.bond = 20;
  return {
    schema: SCHEMA_VERSION,
    profile: {
      id: randomId('profile'),
      displayName,
      tamer,                       // avatar config from ui/tamerAvatar.js
      starterId,
      tutorial: { nexus: false, ranch: false, lab: false, battle: false },
      createdAt: now,
      lastSeenAt: now,
      seed: randomSeed(),
      shards: 40,
      stats: {
        battles: 0, battlesWon: 0, captures: 0, evolutions: 0,
        steps: 0, trainersBeaten: 0, faints: 0, releases: 0,
      },
    },
    creatures: { [starter.uid]: starter },
    team: [starter.uid],
    inventory: { ...STARTER_INVENTORY, healPatch: 3, statusPatch: 2 },
    progress: {
      zoneId: ZONES[0].id,
      unlocked: [ZONES[0].id],
      defeatedTrainers: [],
      objectives: null,
    },
    settings: {
      theme: 'nexus',
      motion: true,
      sound: true,
      music: true,
      sfxVolume: 0.7,
      musicVolume: 0.35,
      autosave: true,
      syncEnabled: false,
      serverUrl: null,
      autoHealOnLevelUp: true,
    },
    account: { email: null, token: null, vaultRev: 0, lastSyncedAt: null },
    updatedAt: now,
  };
}

/* ---------------------------------------------------------------- module */

let state = null;
let persistTimer = null;
let lastPersistedAt = null;

/** Current save file (throws before `init()` if used too early). */
export function getState() {
  if (!state) throw new Error('state accessed before init()');
  return state;
}

/** True once `init()` has completed and the in-memory save is usable. */
export function isReady() { return !!state; }

/** True when a profile exists in memory. */
export function hasProfile() {
  return !!state?.profile;
}

/** Subscribe to change notifications. Returns an unsubscribe function. */
export function subscribe(fn) {
  return onStateChanged(fn);
}
function onStateChanged(fn) {
  return subscribeToBus(EVENTS.STATE_CHANGED, fn);
}
// Imported lazily to keep the module graph flat.
import { on as subscribeToBus } from './bus.js';

/* ------------------------------------------------------------ lifecycle */

/**
 * Load the save file from IndexedDB (running migrations if needed).
 * @returns {Promise<object|null>} The loaded state, or null for a fresh install.
 */
export async function init() {
  const raw = await db.loadState();
  if (!raw) return null;
  state = migrate(raw);
  ensureObjectives();
  state.profile.lastSeenAt = new Date().toISOString();
  return state;
}

/**
 * Upgrade an older save file to the current schema.
 * Migrations are additive and idempotent: a v1 save can jump straight to v3.
 *
 * @param {object} raw
 * @returns {object}
 */
export function migrate(raw) {
  const out = { ...raw };
  out.schema = out.schema ?? 1;

  if (out.schema < 2) {
    // v2 introduced the Data Shard currency and the objectives block.
    out.profile = { ...out.profile, shards: out.profile?.shards ?? 0 };
    out.progress = { ...out.progress, objectives: out.progress?.objectives ?? null };
  }
  if (out.schema < 3) {
    // v3 split settings out of profile and added the sync account block.
    out.settings = {
      theme: 'nexus', motion: true, sound: true, autosave: true,
      syncEnabled: false, serverUrl: null, autoHealOnLevelUp: true,
      ...(out.settings || {}),
    };
    out.account = { email: null, token: null, vaultRev: 0, lastSyncedAt: null, ...(out.account || {}) };
    out.inventory = { healPatch: 3, statusPatch: 2, ...(out.inventory || {}) };
  }

  // Defensive normalisation: never trust persisted data.
  out.creatures = out.creatures || {};
  out.team = (out.team || []).filter((uid) => out.creatures[uid]).slice(0, TEAM_SIZE);
  out.profile = out.profile || { displayName: 'Tamer', stats: {}, shards: 0 };
  out.profile.stats = {
    battles: 0, battlesWon: 0, captures: 0, evolutions: 0,
    steps: 0, trainersBeaten: 0, faints: 0, releases: 0,
    ...(out.profile.stats || {}),
  };
  if (out.schema < 4) {
    // v4 adds the Tamer avatar, tutorial flags and separate audio volumes.
    out.profile = {
      ...out.profile,
      tamer: out.profile?.tamer || null,
      starterId: out.profile?.starterId || null,
      tutorial: { nexus: false, ranch: false, lab: false, battle: false, ...(out.profile?.tutorial || {}) },
    };
    out.settings = {
      music: true, sfxVolume: 0.7, musicVolume: 0.35,
      ...(out.settings || {}),
    };
  }

  out.progress = { zoneId: ZONES[0].id, unlocked: [ZONES[0].id], defeatedTrainers: [], ...(out.progress || {}) };
  out.progress.unlocked = Array.from(new Set([ZONES[0].id, ...out.progress.unlocked]));
  out.schema = SCHEMA_VERSION;
  return out;
}

/**
 * Apply a mutation and notify subscribers.
 * @param {(s:object)=>void} fn
 * @param {{persist?:boolean, silent?:boolean}} [opts]
 */
export function mutate(fn, { persist = true, silent = false } = {}) {
  fn(state);
  state.updatedAt = new Date().toISOString();
  if (!silent) emit(EVENTS.STATE_CHANGED, state);
  if (persist) schedulePersist();
  return state;
}

/** Debounced write-behind persistence. */
export function schedulePersist(delay = 600) {
  if (!state?.settings?.autosave) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { flush().catch((err) => console.error('[state] persist failed', err)); }, delay);
}

/** Write the save file immediately. */
export async function flush() {
  clearTimeout(persistTimer);
  if (!state) return null;
  await db.saveState(state);
  lastPersistedAt = new Date().toISOString();
  emit(EVENTS.STATE_PERSISTED, lastPersistedAt);
  return lastPersistedAt;
}

/** Timestamp of the last successful write (Settings > Data). */
export function lastPersisted() { return lastPersistedAt; }

/* ------------------------------------------------------------- profiles */

/** Create a brand-new profile with the chosen starter. */
export async function createProfile({ displayName, starterId, tamer = null }) {
  state = defaultState({ displayName, starterId, tamer });
  ensureObjectives();
  await flush();
  emit(EVENTS.STATE_CHANGED, state);
  return state;
}

/**
 * Replace the in-memory state with an imported save file.
 * @param {object} raw Parsed save file.
 */
export async function replaceState(raw) {
  state = migrate(raw);
  ensureObjectives();
  await flush();
  emit(EVENTS.STATE_CHANGED, state);
  return state;
}

/** Erase everything: IndexedDB, dex, backups and memory. */
export async function wipe() {
  await db.clearAll();
  state = null;
  lastPersistedAt = null;
  emit(EVENTS.STATE_CHANGED, null);
}

/* ------------------------------------------------------------ creatures */

/** Look up a creature by uid. */
export function getCreature(uid) {
  return state?.creatures?.[uid] || null;
}

/** Every owned creature, newest first. */
export function allCreatures() {
  return Object.values(state.creatures).sort((a, b) => (a.origin.at < b.origin.at ? 1 : -1));
}

/** The active battle team, padded-safe (missing uids are skipped). */
export function teamCreatures() {
  return state.team.map((uid) => state.creatures[uid]).filter(Boolean);
}

/** Highest level among owned creatures (drives zone unlocks). */
export function strongestLevel() {
  return allCreatures().reduce((max, c) => Math.max(max, c.level), 1);
}

/** True when every team member has fainted. */
export function teamIsWiped() {
  const team = teamCreatures();
  return team.length === 0 || team.every((c) => c.hp <= 0);
}

/** Restore the whole roster to full health. */
export function healAllCreatures() {
  return mutate((s) => {
    for (const c of Object.values(s.creatures)) healCreature(c);
  });
}

/**
 * Add a creature to the save file (and to the team if there is room).
 * @returns {object} The stored creature.
 */
export function addCreature(creature, { toTeam = true } = {}) {
  mutate((s) => {
    s.creatures[creature.uid] = creature;
    if (toTeam && s.team.length < TEAM_SIZE && !s.team.includes(creature.uid)) {
      s.team.push(creature.uid);
    }
  });
  return creature;
}

/**
 * Release a creature back to the wild in exchange for Data Shards.
 * @param {string} uid
 * @returns {{ok:boolean, shards?:number, reason?:string}}
 */
export function releaseCreature(uid) {
  const creature = state.creatures[uid];
  if (!creature) return { ok: false, reason: 'Creature not found.' };
  if (state.team.length === 1 && state.team.includes(uid)) {
    return { ok: false, reason: 'You cannot release your last team member.' };
  }
  const value = shardValue(getSpecies(creature.speciesId), creature.level);
  mutate((s) => {
    delete s.creatures[uid];
    s.team = s.team.filter((u) => u !== uid);
    s.profile.shards += value;
    s.profile.stats.releases += 1;
  });
  return { ok: true, shards: value };
}

/** Rename a creature (empty string clears the nickname). */
export function renameCreature(uid, nickname) {
  return mutate((s) => {
    const c = s.creatures[uid];
    if (c) c.nickname = nickname?.trim() ? nickname.trim().slice(0, 18) : null;
  });
}

/** Move a creature into the active team (max 6). */
export function addToTeam(uid) {
  return mutate((s) => {
    if (!s.creatures[uid] || s.team.includes(uid)) return;
    if (s.team.length >= TEAM_SIZE) return;
    s.team.push(uid);
  });
}

/** Remove a creature from the active team (keeps it in storage). */
export function removeFromTeam(uid) {
  return mutate((s) => {
    if (s.team.length === 1) return;
    s.team = s.team.filter((u) => u !== uid);
  });
}

/** Reorder / replace the team wholesale (validated). */
export function setTeam(uids) {
  return mutate((s) => {
    const valid = uids.filter((u) => s.creatures[u]).slice(0, TEAM_SIZE);
    if (valid.length) s.team = valid;
  });
}

/* ------------------------------------------------------------ inventory */

/** Add items to the bag. */
export function addItem(itemId, count = 1) {
  return mutate((s) => { s.inventory[itemId] = (s.inventory[itemId] ?? 0) + count; });
}

/** Remove items if available. Returns false when the bag is short. */
export function consumeItem(itemId, count = 1) {
  if ((state.inventory[itemId] ?? 0) < count) return false;
  mutate((s) => { s.inventory[itemId] -= count; });
  return true;
}

/** Buy a ball with Data Shards. */
export function buyBall(ballId, count = 1) {
  const price = (BALL_PRICES[ballId] ?? 999) * count;
  if (state.profile.shards < price) return { ok: false, reason: 'Not enough Data Shards.' };
  mutate((s) => {
    s.profile.shards -= price;
    s.inventory[ballId] = (s.inventory[ballId] ?? 0) + count;
  });
  return { ok: true, spent: price };
}

/** Grant Data Shards. */
export function addShards(n) { return mutate((s) => { s.profile.shards += n; }); }

/** Spend Data Shards if affordable. */
export function spendShards(n) {
  if (state.profile.shards < n) return false;
  mutate((s) => { s.profile.shards -= n; });
  return true;
}

/* ------------------------------------------------------------ objectives */

/** Ensure today's objectives exist, rolling them over at midnight. */
export function ensureObjectives() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.progress.objectives?.dateKey === today) return state.progress.objectives;
  const items = dailyObjectives(today).map((o) => ({ ...o, progress: 0 }));
  state.progress.objectives = { dateKey: today, items, claimed: [] };
  return state.progress.objectives;
}

/**
 * Increment a profile statistic and feed any matching objectives.
 * @param {string} key Stat key (battles, captures, evolutions, steps…).
 * @param {number} [by]
 */
export function bumpStat(key, by = 1) {
  return mutate((s) => {
    s.profile.stats[key] = (s.profile.stats[key] ?? 0) + by;
    const objs = ensureObjectives();
    for (const item of objs.items) {
      if (item.stat === key) item.progress = Math.min(item.goal, item.progress + by);
    }
  });
}

/**
 * Claim a completed objective's reward.
 * @param {string} id Objective id.
 * @returns {{ok:boolean, reward?:number, reason?:string}}
 */
export function claimObjective(id) {
  const objs = ensureObjectives();
  const item = objs.items.find((o) => o.id === id);
  if (!item) return { ok: false, reason: 'Unknown objective.' };
  if (objs.claimed.includes(id)) return { ok: false, reason: 'Already claimed.' };
  if (item.progress < item.goal) return { ok: false, reason: 'Not finished yet.' };
  objs.claimed.push(id);
  addShards(item.reward);
  emit(EVENTS.STATE_CHANGED, state);
  schedulePersist();
  return { ok: true, reward: item.reward };
}

/* ------------------------------------------------------------- battle IO */

/**
 * Record the outcome of a battle and pay out rewards.
 * Called by the battle screen once the engine reports `end`.
 *
 * @param {object} o
 * @param {'win'|'lose'|'flee'|'caught'} o.outcome
 * @param {boolean} o.isTrainer
 * @param {string} [o.zoneId]
 * @param {string} [o.trainerName]
 */
export function recordBattleResult({ outcome, isTrainer, zoneId, trainerName }) {
  const zone = getZone(zoneId || state.progress.zoneId);
  const tier = ZONES.indexOf(zone);
  mutate((s) => {
    s.profile.stats.battles += 1;
    if (outcome === 'win' || outcome === 'caught') {
      s.profile.stats.battlesWon += 1;
      if (isTrainer) s.profile.stats.trainersBeaten += 1;
      const reward = victoryRewards(isTrainer, tier);
      s.profile.shards += reward.shards;
    }
    if (outcome === 'lose') {
      s.profile.stats.faints += 1;
    }
    if (isTrainer && trainerName && !s.progress.defeatedTrainers.includes(trainerName)) {
      s.progress.defeatedTrainers.push(trainerName);
    }
  });
  // Objective counters (routed through bumpStat so progress rolls over daily).
  bumpStat('battlesWon', outcome === 'win' || outcome === 'caught' ? 1 : 0);
  if (isTrainer && (outcome === 'win' || outcome === 'caught')) bumpStat('trainersBeaten', 1);
}

/** Register a capture: adds the creature, dex entry and objective progress. */
export function recordCapture(creature, zoneId) {
  addCreature(creature);
  db.recordDex(creature.speciesId, { caught: true }).catch(() => {});
  mutate((s) => { s.profile.stats.captures += 1; });
  bumpStat('captures', 1);
  emit(EVENTS.CREATURE_CAUGHT, creature);
  return creature;
}

/** Register an evolution (dex + stats + objectives). */
export function recordEvolution(uid, fromId, toId) {
  db.recordDex(toId, { caught: true }).catch(() => {});
  mutate((s) => { s.profile.stats.evolutions += 1; });
  bumpStat('evolutions', 1);
  emit(EVENTS.EVOLVED, { uid, fromId, toId });
}

/** Advance the exploration step counter and unlock zones as the team grows. */
export function recordSteps(n = 1) {
  bumpStat('steps', n);
  return mutate((s) => {
    const level = strongestLevel();
    for (const zone of ZONES) {
      if (level >= zone.recommended - 4 && !s.progress.unlocked.includes(zone.id)) {
        s.progress.unlocked.push(zone.id);
      }
    }
  });
}

/* ------------------------------------------------------------- settings */

/** Patch settings and persist. */
export function updateSettings(patch) {
  return mutate((s) => { s.settings = { ...s.settings, ...patch }; });
}

/** Replace the Tamer avatar configuration. */
export function setTamer(tamer) {
  return mutate((s) => { s.profile.tamer = { ...(s.profile.tamer || {}), ...tamer }; });
}

/** True when a first-run coach mark has not been dismissed yet. */
export function tutorialPending(key) {
  return !state?.profile?.tutorial?.[key];
}

/** Dismiss a first-run coach mark permanently (stored in the save file). */
export function markTutorialSeen(key) {
  return mutate((s) => {
    s.profile.tutorial = { ...(s.profile.tutorial || {}), [key]: true };
  });
}

/** Store cloud credentials returned by the sync API. */
export function setAccount(account) {
  return mutate((s) => { s.account = { ...s.account, ...account }; });
}

/** Forget cloud credentials (local data is untouched). */
export function clearAccount() {
  return mutate((s) => {
    s.account = { email: null, token: null, vaultRev: 0, lastSyncedAt: null };
    s.settings.syncEnabled = false;
  });
}

/* ---------------------------------------------------------------- export */

/** Serialise the save file for download or encryption. */
export function exportPayload() {
  return JSON.parse(JSON.stringify(state));
}

/** Human-readable summary used by the Settings screen. */
export function saveSummary() {
  const creatures = allCreatures();
  return {
    creatures: creatures.length,
    team: state.team.length,
    strongest: strongestLevel(),
    shards: state.profile.shards,
    dexSeen: Object.keys(state.creatures).length,
    maxHpTeam: teamCreatures().reduce((sum, c) => sum + maxHpOf(c), 0),
    names: teamCreatures().map(displayName),
  };
}

/** Inventory helper used by the battle bag and shop. */
export function ballCounts() {
  return Object.keys(BALLS).reduce((acc, id) => {
    acc[id] = state.inventory[id] ?? 0;
    return acc;
  }, {});
}
