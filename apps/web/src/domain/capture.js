/**
 * capture.js — Capture resolution.
 *
 * A pure function of (target HP, species catch rate, ball multiplier, level,
 * status). Kept separate from the battle engine so it can be unit-tested and
 * rebalanced in isolation, and so the UI can show a live catch-probability
 * estimate before the player commits a ball.
 *
 * Formula (genre-standard shape):
 *   a = (3*maxHp - 2*hp) * rate * ball / (3*maxHp)
 *   p = a * levelFactor * statusBonus, clamped to [0.01, 0.97]
 *
 * @module domain/capture
 */

/** Ball catalogue. `mult` multiplies the base catch rate. */
export const BALLS = {
  dataBall:   { id: 'dataBall',   name: 'Data Ball',   mult: 1.0, color: '#7fdcff', desc: 'Standard issue. Reliable, unremarkable.' },
  cipherBall: { id: 'cipherBall', name: 'Cipher Ball', mult: 1.6, color: '#b48cff', desc: 'Encrypts the target’s escape routines.' },
  matrixBall: { id: 'matrixBall', name: 'Matrix Ball', mult: 2.6, color: '#ffd93d', desc: 'Near-certain capture. Reserve for legends.' },
};

/** Status bonuses applied to the catch roll. */
const STATUS_BONUS = { sleep: 2.2, freeze: 2.2, paralyze: 1.6, poison: 1.4, burn: 1.4 };

/**
 * Compute the probability (0..1) of capturing a target right now.
 *
 * @param {object} o
 * @param {number} o.hp Current HP of the target.
 * @param {number} o.maxHp Maximum HP of the target.
 * @param {number} o.rate Species capture rate (0–255).
 * @param {string} o.ballId Ball id.
 * @param {number} o.level Target level.
 * @param {string|null} [o.status] Volatile status id.
 * @returns {number} Probability in [0.01, 0.97].
 */
export function captureChance({ hp, maxHp, rate, ballId, level, status = null }) {
  const ball = BALLS[ballId] || BALLS.dataBall;
  const safeMax = Math.max(1, maxHp);
  const safeHp = Math.max(0, Math.min(maxHp, hp));

  // Health term: full HP ≈ rate/3 of nominal, 1 HP ≈ rate.
  const health = ((3 * safeMax - 2 * safeHp) * (rate / 255)) / (3 * safeMax);
  // Lower-level targets are easier to hold.
  const levelFactor = Math.max(0.4, 1.25 - level / 100);
  const statusFactor = status ? (STATUS_BONUS[status] || 1) : 1;

  const p = health * ball.mult * levelFactor * statusFactor;
  return Math.max(0.01, Math.min(0.97, p));
}

/**
 * Resolve a capture attempt.
 * @param {object} o Same shape as `captureChance`, plus `rand` (RNG with .next()).
 * @returns {{success:boolean, chance:number, roll:number, shakes:number}}
 */
export function attemptCapture({ hp, maxHp, rate, ballId, level, status = null, rand }) {
  const chance = captureChance({ hp, maxHp, rate, ballId, level, status });
  const roll = rand.next();
  const success = roll < chance;
  // Visual "wobble" count: more shakes when the roll was nearly a success.
  const nearMiss = Math.abs(roll - chance);
  const shakes = success ? 3 : Math.max(1, 3 - Math.ceil(nearMiss * 6));
  return { success, chance, roll, shakes };
}

/** Starting inventory granted to a new profile. */
export const STARTER_INVENTORY = { dataBall: 12, cipherBall: 4, matrixBall: 1 };

/** Shop pricing (Data Shards) if the player runs dry. */
export const BALL_PRICES = { dataBall: 6, cipherBall: 16, matrixBall: 40 };
