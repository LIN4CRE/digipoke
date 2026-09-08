/**
 * progression.js — Curves for experience, bonding, currencies and objectives.
 *
 * All numbers live here so balance passes never require touching engine code.
 *
 * Curve choice: "medium-fast" (cumulative XP to reach level L = L³).
 * It keeps early levels snappy while still making level 50 feel earned.
 *
 * @module domain/progression
 */

/** Maximum reachable level. Evolution thresholds are tuned against this. */
export const LEVEL_CAP = 50;

/** Maximum bond value (bond gates Mega evolution and some flavour text). */
export const BOND_CAP = 100;

/** Maximum value of a single core (IV) stat. */
export const CORE_CAP = 15;

/** Cumulative XP required to reach a given level. */
export function xpToReach(level) {
  return Math.pow(Math.max(1, level), 3);
}

/** XP required to go from `level` to `level + 1`. */
export function xpToNext(level) {
  if (level >= LEVEL_CAP) return 0;
  return xpToReach(level + 1) - xpToReach(level);
}

/**
 * XP yielded when a creature is defeated.
 * @param {object} species Species record.
 * @param {number} level Defeated creature's level.
 * @param {boolean} isTrainer Trainer battles pay a 1.5× premium.
 */
export function xpReward(species, level, isTrainer = false) {
  const base = Math.floor((species.xp * level) / 7);
  return Math.max(1, Math.floor(base * (isTrainer ? 1.5 : 1)));
}

/** Bond gained for a given event. */
export const BOND_GAIN = {
  battleWon: 2,
  levelUp: 2,
  captured: 5,
  trained: 1, // Lab: core synthesis / move tutoring
};

/** Data Shards awarded for releasing a creature. */
export function shardValue(species, level) {
  const stageBonus = { rookie: 0, champion: 12, ultimate: 30, mega: 60 }[species.stage] ?? 0;
  return 4 + stageBonus + Math.floor(level / 4);
}

/** Shard cost to raise one core point at its current value. */
export function coreCost(currentCore) {
  return 6 + currentCore * 3;
}

/** Shard cost to tutor (relearn) a move. */
export const MOVE_TUTOR_COST = 18;

/** Bond tier labels shown in the Ranch inspector. */
export function bondTier(bond) {
  if (bond >= 80) return { label: 'Sovereign', color: '#ffd93d' };
  if (bond >= 60) return { label: 'Devoted', color: '#4fd67c' };
  if (bond >= 35) return { label: 'Trusting', color: '#3db4ff' };
  if (bond >= 15) return { label: 'Wary', color: '#c8cfe0' };
  return { label: 'Feral', color: '#ff5fa2' };
}

/** Battle rewards paid out for a victory. */
export function victoryRewards(isTrainer, zoneTier = 0) {
  return {
    shards: isTrainer ? 12 + zoneTier * 6 : 3 + zoneTier * 2,
  };
}

/**
 * Daily objectives. Derived deterministically from the calendar date so all
 * players see the same set on the same day, and so a reload never rerolls them.
 *
 * @param {string} dateKey ISO date, e.g. "2026-09-07".
 * @param {import('../core/rng.js').createRng} _rng Unused; kept for parity.
 * @returns {{id:string, text:string, goal:number, reward:number, stat:string}[]}
 */
export function dailyObjectives(dateKey) {
  const templates = [
    { id: 'battles', text: 'Win battles', goal: 3, reward: 20, stat: 'battlesWon' },
    { id: 'captures', text: 'Capture creatures', goal: 2, reward: 25, stat: 'captures' },
    { id: 'evolutions', text: 'Trigger evolutions', goal: 1, reward: 40, stat: 'evolutions' },
    { id: 'steps', text: 'Scan the wilds', goal: 12, reward: 12, stat: 'steps' },
    { id: 'train', text: 'Defeat a trainer', goal: 1, reward: 30, stat: 'trainersBeaten' },
  ];
  // Rotate the template list by the day number so the mix varies daily.
  const day = Number(dateKey.slice(8, 10)) || 1;
  const rotated = templates.map((_, i) => templates[(i + day) % templates.length]);
  return rotated.slice(0, 3);
}
