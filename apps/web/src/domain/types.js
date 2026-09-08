/**
 * types.js — Elemental type system for DigiPoke.
 *
 * The type chart is the single source of truth for damage multipliers.
 * It is stored as a SPARSE matrix: any (attacker, defender) pair that is not
 * explicitly listed resolves to a multiplier of 1.0 (neutral). This keeps the
 * data readable and makes it trivial to diff/balance during tuning.
 *
 * Design goals:
 *  - Deterministic: pure lookup, no RNG.
 *  - Data-driven: balance changes never touch engine code.
 *  - Total: every type has a defined interaction with every other type.
 *
 * @module domain/types
 */

/** Canonical element identifiers. Order matters only for UI rendering. */
export const TYPE_IDS = [
  'flame',   // Combustion / heat
  'aqua',    // Water / liquid
  'verdant', // Plant / organic growth
  'volt',    // Electricity
  'terra',   // Rock / ground / mineral
  'aero',    // Air / wind / flight
  'frost',   // Ice / cold
  'byte',    // Data / machine / digital
  'virus',   // Corruption / toxin / dark data
  'null',    // Neutral / formless
];

/**
 * Human-facing metadata for each element.
 * `color` drives chips, bars and sprite auras; `glyph` is an inline-safe symbol.
 */
export const TYPES = {
  flame:   { name: 'Flame',   glyph: '🜂', color: '#ff6b3d', weak: ['aqua', 'terra', 'flame'] },
  aqua:    { name: 'Aqua',    glyph: '🜄', color: '#3db4ff', weak: ['verdant', 'aqua'] },
  verdant: { name: 'Verdant', glyph: '🜁', color: '#4fd67c', weak: ['flame', 'verdant', 'aero'] },
  volt:    { name: 'Volt',    glyph: '🜇', color: '#ffd93d', weak: ['volt', 'verdant'] },
  terra:   { name: 'Terra',   glyph: '🜃', color: '#c98a4b', weak: ['aqua', 'verdant', 'frost'] },
  aero:    { name: 'Aero',    glyph: '🜀', color: '#9fe8ff', weak: ['volt', 'frost', 'terra'] },
  frost:   { name: 'Frost',   glyph: '🜆', color: '#7fdcff', weak: ['flame', 'frost', 'byte'] },
  byte:    { name: 'Byte',    glyph: '⌗', color: '#b48cff', weak: ['flame', 'aqua'] },
  virus:   { name: 'Virus',   glyph: '☣', color: '#ff5fa2', weak: ['byte', 'virus'] },
  null:    { name: 'Null',    glyph: '∅', color: '#c8cfe0', weak: ['virus'] },
};

/**
 * Sparse effectiveness chart.
 * CHART[attacker][defender] = multiplier (0, 0.25, 0.5, 2 or 4).
 * Missing entries default to 1.
 */
const CHART = {
  flame:   { verdant: 2, frost: 2, byte: 2, aqua: 0.5, terra: 0.5, flame: 0.5 },
  aqua:    { flame: 2, terra: 2, verdant: 0.5, aqua: 0.5, frost: 0.5 },
  verdant: { aqua: 2, terra: 2, flame: 0.5, verdant: 0.5, aero: 0.5, frost: 0.5 },
  volt:    { aqua: 2, aero: 2, verdant: 0.5, volt: 0.5, terra: 0 },
  terra:   { flame: 2, volt: 2, byte: 2, frost: 2, aero: 0, verdant: 0.5 },
  aero:    { verdant: 2, virus: 2, volt: 0.5, terra: 0.5, byte: 0.5 },
  frost:   { verdant: 2, terra: 2, aero: 2, flame: 0.5, frost: 0.5, aqua: 0.5 },
  byte:    { frost: 2, virus: 2, aero: 2, flame: 0.5, byte: 0.5, aqua: 0.5 },
  virus:   { null: 2, verdant: 2, virus: 0.5, byte: 0.5 },
  null:    { virus: 2, byte: 0.5, terra: 0.5 },
};

/**
 * Resolve the damage multiplier for an attacking type against one or more
 * defending types (dual-type creatures multiply both factors together).
 *
 * @param {string} attackType  Element id of the move.
 * @param {string[]} defendTypes Element ids of the defender (1 or 2 entries).
 * @returns {number} Multiplier: 0 (immune), 0.25, 0.5, 1, 2 or 4.
 */
export function effectiveness(attackType, defendTypes) {
  let mult = 1;
  for (const def of defendTypes) {
    const row = CHART[attackType];
    mult *= (row && row[def] !== undefined) ? row[def] : 1;
  }
  return mult;
}

/** Verbose label used by the battle log ("It's super effective!"). */
export function effectivenessLabel(mult) {
  if (mult === 0) return "It has no effect…";
  if (mult >= 2) return "It's super effective!";
  if (mult > 0 && mult < 1) return "It's not very effective…";
  return '';
}

/** Defensive profile summary used by the Ranch / Lab inspector panels. */
export function defensiveProfile(types) {
  const out = [];
  for (const atk of TYPE_IDS) {
    const m = effectiveness(atk, types);
    if (m > 1) out.push({ type: atk, mult: m, kind: 'weak' });
    else if (m < 1) out.push({ type: atk, mult: m, kind: 'resist' });
  }
  return out;
}
