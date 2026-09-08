/**
 * creature.js — Creature entity: construction, stat derivation, levelling,
 * learnsets and evolution.
 *
 * A creature is a plain, structured-clonable object so it can be persisted
 * directly into IndexedDB and exported as JSON without adapters:
 *
 *   {
 *     uid, speciesId, nickname, level, xp, bond, hp,
 *     cores: { hp, atk, def, spd },   // 0..15, aka IVs
 *     moves: string[],                // active moves (max 4)
 *     origin: { zone, at, wild },
 *     shiny: boolean,
 *     stats: { battles, wins }
 *   }
 *
 * All functions here are pure except where explicitly noted (mutating helpers
 * return a change report so callers can emit UI events).
 *
 * @module domain/creature
 */

import { getSpecies, learnsetFor } from './species.js';
import { getMove } from './moves.js';
import { LEVEL_CAP, BOND_CAP, CORE_CAP, xpToNext, BOND_GAIN } from './progression.js';
import { randomSeed } from '../core/rng.js';

/** Probability that a freshly encountered creature is a "Glitch" (shiny). */
export const GLITCH_RATE = 1 / 512;

/** Stat ids in canonical display order. */
export const STAT_IDS = ['hp', 'atk', 'def', 'spd'];

/**
 * Derive a creature's maximum stats from species base stats, level and cores.
 * Standard formula: floor((2 * base + core) * level / 100) + offset.
 *
 * @param {object} creature
 * @returns {{hp:number, atk:number, def:number, spd:number}}
 */
export function statsFor(creature) {
  const base = getSpecies(creature.speciesId).base;
  const lv = creature.level;
  const c = creature.cores;
  return {
    hp: Math.floor(((2 * base.hp + c.hp) * lv) / 100) + lv + 10,
    atk: Math.floor(((2 * base.atk + c.atk) * lv) / 100) + 5,
    def: Math.floor(((2 * base.def + c.def) * lv) / 100) + 5,
    spd: Math.floor(((2 * base.spd + c.spd) * lv) / 100) + 5,
  };
}

/** Convenience: max HP only (hot path in battle rendering). */
export function maxHpOf(creature) {
  return statsFor(creature).hp;
}

/** Roll a fresh set of core values using the provided RNG. */
export function rollCores(rand) {
  return {
    hp: rand.int(0, CORE_CAP),
    atk: rand.int(0, CORE_CAP),
    def: rand.int(0, CORE_CAP),
    spd: rand.int(0, CORE_CAP),
  };
}

/** Sum of cores / maximum possible — shown as "potential" in the UI. */
export function corePotential(creature) {
  const total = STAT_IDS.reduce((s, k) => s + creature.cores[k], 0);
  return { total, max: STAT_IDS.length * CORE_CAP, pct: total / (STAT_IDS.length * CORE_CAP) };
}

/**
 * Determine which moves a creature knows at its current level.
 * Falls back to the first four learnset entries if nothing is learned yet.
 *
 * @param {object} creature
 * @returns {string[]} Up to four move ids.
 */
export function movesAtLevel(creature) {
  const set = learnsetFor(creature.speciesId)
    .filter((e) => e.level <= creature.level)
    .map((e) => e.move);
  // Preserve any tutored/legacy moves the creature already has.
  const preserved = (creature.moves || []).filter((m) => !set.includes(m));
  const merged = [...set, ...preserved];
  return merged.slice(-4);
}

/** Create a new creature instance.
 *
 * @param {object} opts
 * @param {string} opts.speciesId
 * @param {number} [opts.level=5]
 * @param {object} [opts.rand] RNG from core/rng.js (needs .int/.chance).
 * @param {object} [opts.cores] Explicit cores (overrides rolling).
 * @param {string} [opts.nickname]
 * @param {object} [opts.origin] Provenance metadata.
 * @param {boolean} [opts.shiny] Force glitch variant.
 * @returns {object} A fresh creature record.
 */
export function createCreature({
  speciesId,
  level = 5,
  rand = { int: (a, b) => Math.floor(a + Math.random() * (b - a + 1)), chance: (p) => Math.random() < p },
  cores = null,
  nickname = null,
  origin = {},
  shiny = null,
}) {
  const lv = Math.max(1, Math.min(LEVEL_CAP, Math.floor(level)));
  const creature = {
    uid: `cr_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    speciesId,
    nickname,
    level: lv,
    xp: 0,
    bond: 10,
    hp: 0,
    cores: cores || rollCores(rand),
    moves: [],
    origin: { zone: origin.zone || 'unknown', at: origin.at || new Date().toISOString(), wild: origin.wild ?? false },
    shiny: shiny ?? rand.chance(GLITCH_RATE),
    stats: { battles: 0, wins: 0 },
  };
  creature.moves = movesAtLevel(creature);
  creature.hp = maxHpOf(creature);
  return creature;
}

/** Display name: nickname if set, otherwise the species name. */
export function displayName(creature) {
  return creature.nickname || getSpecies(creature.speciesId).name;
}

/** Restore a creature to full health and clear volatile battle state. */
export function healCreature(creature) {
  creature.hp = maxHpOf(creature);
  return creature;
}

/** Percentage of remaining HP (0..1), floored at 0. */
export function hpRatio(creature) {
  const max = maxHpOf(creature);
  if (!max) return 0;
  return Math.max(0, Math.min(1, creature.hp / max));
}

/** Coarse health bucket used for UI colouring. */
export function healthState(creature) {
  const r = hpRatio(creature);
  if (r <= 0) return 'fainted';
  if (r < 0.25) return 'critical';
  if (r < 0.55) return 'hurt';
  return 'healthy';
}

/** True when a creature can no longer battle. */
export function isFainted(creature) {
  return creature.hp <= 0;
}

/**
 * Grant XP and resolve any number of level-ups, learnset changes and
 * evolutions. Mutates `creature`.
 *
 * @param {object} creature
 * @param {number} amount
 * @returns {{gained:number, levels:number[], learned:string[], evolved:null|{from:string,to:string}}}
 */
export function gainXp(creature, amount) {
  const report = { gained: amount, levels: [], learned: [], evolved: null };
  if (creature.level >= LEVEL_CAP) return report;

  creature.xp += amount;
  while (creature.level < LEVEL_CAP && creature.xp >= xpToNext(creature.level)) {
    creature.xp -= xpToNext(creature.level);
    creature.level += 1;
    creature.bond = Math.min(BOND_CAP, creature.bond + BOND_GAIN.levelUp);
    report.levels.push(creature.level);

    const before = new Set(creature.moves);
    creature.moves = movesAtLevel(creature);
    for (const m of creature.moves) if (!before.has(m)) report.learned.push(m);

    // HP gained from levelling is granted immediately (feels good, matches genre).
    creature.hp = Math.min(maxHpOf(creature), creature.hp + Math.max(1, Math.floor((maxHpOf(creature) - creature.hp) * 0.15)) + 2);
  }
  if (creature.level >= LEVEL_CAP) creature.xp = 0;

  const evo = canEvolve(creature);
  if (evo) {
    const from = creature.speciesId;
    applyEvolution(creature, evo.to);
    report.evolved = { from, to: evo.to };
  }
  return report;
}

/**
 * Check whether a creature currently satisfies its evolution conditions.
 * @param {object} creature
 * @returns {{to:string, level:number, bond?:number}|null}
 */
export function canEvolve(creature) {
  const species = getSpecies(creature.speciesId);
  if (!species.evolve) return null;
  const { to, level, bond } = species.evolve;
  if (creature.level < level) return null;
  if (bond && creature.bond < bond) return null;
  return species.evolve;
}

/**
 * Describe *why* an evolution is not yet available, for the Lab UI.
 * @param {object} creature
 * @returns {string|null} Null when evolution is ready right now.
 */
export function evolutionBlocker(creature) {
  const species = getSpecies(creature.speciesId);
  if (!species.evolve) return 'Final form reached.';
  const { level, bond } = species.evolve;
  if (creature.level < level) return `Needs level ${level} (currently ${creature.level}).`;
  if (bond && creature.bond < bond) return `Needs bond ${bond} (currently ${creature.bond}).`;
  return null;
}

/**
 * Mutate a creature into its next form. Recomputes moves and tops up HP so the
 * transformation is never a downgrade.
 *
 * @param {object} creature
 * @param {string} toSpeciesId
 * @returns {object} The mutated creature.
 */
export function applyEvolution(creature, toSpeciesId) {
  const ratio = hpRatio(creature);
  creature.speciesId = toSpeciesId;
  creature.moves = movesAtLevel(creature);
  creature.hp = Math.max(1, Math.round(maxHpOf(creature) * Math.max(ratio, 0.35)));
  creature.bond = Math.min(BOND_CAP, creature.bond + 5);
  return creature;
}

/** Raise one core stat by a point, respecting the cap. Mutates. */
export function raiseCore(creature, statId) {
  if (!STAT_IDS.includes(statId)) return false;
  if (creature.cores[statId] >= CORE_CAP) return false;
  creature.cores[statId] += 1;
  if (statId === 'hp') creature.hp = Math.min(maxHpOf(creature), creature.hp + 1);
  creature.bond = Math.min(BOND_CAP, creature.bond + BOND_GAIN.trained);
  return true;
}

/**
 * Teach (or re-teach) a move from the species learnset. Mutates.
 * Returns false when the move is unknown to this species or already held.
 */
export function teachMove(creature, moveId) {
  const legal = learnsetFor(creature.speciesId).map((e) => e.move);
  const alsoLegal = getSpecies(creature.speciesId).moves;
  if (!legal.includes(moveId) && !alsoLegal.includes(moveId)) return false;
  if (creature.moves.includes(moveId)) return false;
  if (creature.moves.length >= 4) creature.moves.shift(); // drop the oldest
  creature.moves.push(moveId);
  creature.bond = Math.min(BOND_CAP, creature.bond + BOND_GAIN.trained);
  return true;
}

/** Battle-ready snapshot consumed by the engine (never mutated by the UI). */
export function toCombatSnapshot(creature) {
  return {
    uid: creature.uid,
    speciesId: creature.speciesId,
    level: creature.level,
    hp: creature.hp,
    maxHp: maxHpOf(creature),
    stats: statsFor(creature),
    moves: [...creature.moves],
    shiny: creature.shiny,
    nickname: creature.nickname,
  };
}

/** Human-readable move summary for cards and tooltips. */
export function moveSummary(moveId) {
  const m = getMove(moveId);
  return `${m.name} · ${m.type} · PWR ${m.power || '—'} · ACC ${m.acc}`;
}

/** Deterministic per-creature "personality" seed used for idle animations. */
export function personaSeed(creature) {
  return randomSeed();
}
