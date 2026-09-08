/**
 * rng.js — Deterministic, serialisable pseudo-random number generation.
 *
 * DigiPoke is local-first and replayable: every randomised outcome (encounters,
 * capture rolls, critical hits, core values) flows through a seeded generator so
 * that a save file plus a seed reproduces an identical run. That makes bug
 * reports reproducible and enables deterministic unit tests without mocks.
 *
 * Implementation: mulberry32 — a 32-bit PRNG with good distribution, tiny
 * state (a single integer) and no external dependencies.
 *
 * @module core/rng
 */

/**
 * Create a mulberry32 generator.
 * @param {number} seed 32-bit integer seed.
 * @returns {() => number} Uniform random function returning values in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Produce a random 32-bit seed from the platform CSPRNG. */
export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * Mix a string into a 32-bit integer (FNV-1a). Used to derive stable seeds
 * from stable inputs (e.g. daily objectives keyed by date).
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A tiny helper object bundling the common dice rolls the game needs,
 * so call sites read clearly (`rng.int(3, 7)`, `rng.chance(0.2)`).
 */
export function createRng(seed = randomSeed()) {
  const next = mulberry32(seed);
  const api = {
    seed,
    /** Raw uniform float in [0,1). */
    next,
    /** Uniform float in [min, max). */
    float: (min, max) => min + next() * (max - min),
    /** Uniform integer in [min, max] inclusive. */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    /** True with probability p. */
    chance: (p) => next() < p,
    /** Uniformly pick one element. */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** In-place Fisher–Yates shuffle (returns the same array). */
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    /** Weighted pick: entries need a numeric `w` field. */
    weighted: (entries) => {
      const total = entries.reduce((s, e) => s + e.w, 0);
      let roll = next() * total;
      for (const e of entries) {
        roll -= e.w;
        if (roll <= 0) return e;
      }
      return entries[entries.length - 1];
    },
  };
  return api;
}
