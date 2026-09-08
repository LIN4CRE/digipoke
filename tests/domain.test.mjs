/**
 * domain.test.mjs — Unit + property tests for the pure game engine.
 *
 * Runs on the Node.js built-in test runner (node:test), zero dependencies:
 *   npm test
 *
 * These tests prove the two properties the rest of the architecture relies on:
 *   1. Determinism — the same seed produces the same battle, every time.
 *   2. Safety — no matter what the player does, creature state stays inside
 *      its legal bounds (HP clamping, level caps, stat floors).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../apps/web/src/core/rng.js';
import { Battle, SIDE, computeDamage } from '../apps/web/src/domain/battle.js';
import { createCreature, statsFor, gainXp, canEvolve, maxHpOf, movesAtLevel } from '../apps/web/src/domain/creature.js';
import { getSpecies, SPECIES_IDS, learnsetFor } from '../apps/web/src/domain/species.js';
import { effectiveness } from '../apps/web/src/domain/types.js';
import { captureChance, BALLS } from '../apps/web/src/domain/capture.js';
import { ZONES, rollEncounter, rollRival } from '../apps/web/src/domain/zones.js';
import { xpToNext, LEVEL_CAP, dailyObjectives } from '../apps/web/src/domain/progression.js';

/* -------------------------------------------------------------- fixtures */

function team(speciesIds, level = 20) {
  const rng = createRng(7);
  return speciesIds.map((id) => createCreature({ speciesId: id, level, rand: rng }));
}

/* ----------------------------------------------------------------- tests */

test('rng: same seed yields identical sequences', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((n) => n >= 0 && n < 1));
});

test('species: every species is internally consistent', () => {
  for (const id of SPECIES_IDS) {
    const s = getSpecies(id);
    assert.equal(s.id, id, `${id} id mismatch`);
    assert.ok(s.types.length >= 1 && s.types.length <= 2, `${id} bad types`);
    for (const stat of ['hp', 'atk', 'def', 'spd']) {
      assert.ok(s.base[stat] > 0, `${id} bad base ${stat}`);
    }
    assert.ok(s.moves.length >= 1, `${id} has no moves`);
    assert.ok(s.capture > 0 && s.capture <= 255, `${id} bad capture rate`);
    if (s.evolve) assert.ok(getSpecies(s.evolve.to), `${id} evolves into unknown species`);
    assert.ok(learnsetFor(id).length === s.moves.length, `${id} learnset length mismatch`);
  }
});

test('species: stat totals increase monotonically across evolution lines', () => {
  const total = (id) => {
    const b = getSpecies(id).base;
    return b.hp + b.atk + b.def + b.spd;
  };
  for (const id of SPECIES_IDS) {
    const s = getSpecies(id);
    if (s.evolve) {
      assert.ok(total(s.evolve.to) > total(id), `${id} -> ${s.evolve.to} is not an upgrade`);
    }
  }
});

test('creature: stats scale with level and cores, and stay positive', () => {
  const rng = createRng(1);
  const c = createCreature({ speciesId: 'emberling', level: 5, rand: rng });
  const s5 = statsFor(c);
  c.level = 50;
  const s50 = statsFor(c);
  for (const k of ['hp', 'atk', 'def', 'spd']) {
    assert.ok(s50[k] > s5[k], `${k} did not scale`);
    assert.ok(Number.isInteger(s50[k]) && s50[k] > 0, `${k} not a positive integer`);
  }
});

test('creature: XP accumulation levels up and triggers evolution', () => {
  const rng = createRng(3);
  const c = createCreature({ speciesId: 'emberling', level: 15, rand: rng });
  let report = gainXp(c, xpToNext(15) + 5);
  assert.ok(report.levels.includes(16), 'should have reached level 16');
  assert.equal(c.speciesId, 'flarion', 'should have evolved at level 16');
  assert.deepEqual(report.evolved, { from: 'emberling', to: 'flarion' });

  // Mega evolution is gated behind bond, not just level.
  const m = createCreature({ speciesId: 'pyrovern', level: 46, rand: rng });
  assert.equal(canEvolve(m), null, 'mega should require bond 80');
  m.bond = 90;
  assert.ok(canEvolve(m), 'mega should be available at bond 90');
});

test('creature: level cap is respected', () => {
  const rng = createRng(11);
  const c = createCreature({ speciesId: 'nulkit', level: 49, rand: rng });
  gainXp(c, 10_000_000);
  assert.equal(c.level, LEVEL_CAP);
  assert.equal(c.xp, 0, 'xp should clamp to 0 at the cap');
});

test('creature: learnset never exceeds four active moves', () => {
  const rng = createRng(5);
  const c = createCreature({ speciesId: 'aetherion', level: 50, rand: rng });
  assert.ok(c.moves.length <= 4, 'too many active moves');
  assert.ok(c.moves.length >= 1, 'no active moves');
  assert.deepEqual(c.moves, movesAtLevel(c));
});

test('types: chart returns only legal multipliers', () => {
  const legal = new Set([0, 0.25, 0.5, 1, 2, 4]);
  const ids = ['flame', 'aqua', 'verdant', 'volt', 'terra', 'aero', 'frost', 'byte', 'virus', 'null'];
  for (const a of ids) {
    for (const d of ids) {
      const m = effectiveness(a, [d]);
      assert.ok(legal.has(m), `${a} -> ${d} produced illegal multiplier ${m}`);
    }
  }
});

test('capture: probability is bounded and improves as HP drops', () => {
  const base = { maxHp: 100, rate: 190, ballId: 'dataBall', level: 10 };
  const full = captureChance({ ...base, hp: 100 });
  const low = captureChance({ ...base, hp: 5 });
  assert.ok(full > 0 && full < 1, 'full-HP chance must be strictly between 0 and 1');
  assert.ok(low > full, 'low HP must be easier to catch');
  assert.ok(low <= 0.97, 'chance must respect the 0.97 ceiling');
  for (const id of Object.keys(BALLS)) {
    const p = captureChance({ ...base, hp: 1, ballId: id });
    assert.ok(p <= 0.97 && p > 0, `${id} produced out-of-range probability`);
  }
});

test('zones: encounter and rival rolling stay inside the level band', () => {
  const rng = createRng(99);
  for (const zone of ZONES) {
    for (let i = 0; i < 200; i++) {
      const id = rollEncounter(zone, () => rng.next());
      assert.ok(getSpecies(id), `zone ${zone.id} produced unknown species ${id}`);
    }
    for (let i = 0; i < 20; i++) {
      const rival = rollRival(zone, 30, () => rng.next());
      assert.ok(rival.members.length >= 2 && rival.members.length <= 6, 'rival team size out of range');
      for (const m of rival.members) {
        assert.ok(m.level >= 1 && m.level <= LEVEL_CAP, 'rival level out of range');
        assert.ok(getSpecies(m.speciesId), 'rival has unknown species');
      }
    }
  }
});

test('battle: a deterministic seed produces a deterministic battle', () => {
  const runOnce = () => {
    const rng = createRng(2024);
    const b = new Battle({ allyTeam: team(['pyrovern']), foeTeam: team(['leviaroc']), rng });
    const trace = [];
    let guard = 0;
    while (!b.over && guard++ < 200) {
      const events = b.submit({ type: 'move', moveId: b.active(SIDE.ALLY).moves[0] });
      trace.push(JSON.stringify(events.map((e) => [e.t, e.amount ?? e.text ?? e.outcome ?? ''])));
    }
    return { trace, outcome: b.outcome, snap: b.snapshot() };
  };
  const a = runOnce();
  const b2 = runOnce();
  assert.deepEqual(a.trace, b2.trace, 'battle traces diverged for the same seed');
  assert.equal(a.outcome, b2.outcome);
  assert.deepEqual(a.snap, b2.snap);
});

test('battle: victory is reached and XP is awarded', () => {
  const rng = createRng(8);
  const ally = team(['solarion'], 50);
  const foe = team(['nulkit'], 2);
  const b = new Battle({ allyTeam: ally, foeTeam: foe, rng });
  let guard = 0;
  while (!b.over && guard++ < 50) {
    b.submit({ type: 'move', moveId: b.active(SIDE.ALLY).moves[0] });
  }
  assert.equal(b.outcome, 'win');
  assert.ok(b.log.some((e) => e.t === 'xp' || e.t === 'faint'), 'expected faint or xp events');
});

test('battle: capture succeeds with a Matrix Ball and ends the battle', () => {
  const rng = createRng(4);
  const foe = team(['nulkit'], 5);
  foe[0].hp = 1;
  const b = new Battle({
    allyTeam: team(['nulkit'], 20),
    foeTeam: foe, kind: 'wild', rng,
    inventory: { matrixBall: 5 },
  });
  const events = b.submit({ type: 'ball', ballId: 'matrixBall' });
  assert.equal(b.outcome, 'caught');
  assert.equal(b.inventory.matrixBall, 4, 'ball should be consumed');
  assert.ok(events.some((e) => e.t === 'ball' && e.success));
});

test('battle: fleeing is impossible in trainer battles', () => {
  const rng = createRng(6);
  const b = new Battle({ allyTeam: team(['nulkit'], 20), foeTeam: team(['nulkit'], 20), kind: 'trainer', rng });
  b.submit({ type: 'flee' });
  assert.equal(b.over, false, 'trainer battle must not end on flee');
  assert.equal(b.canCapture(), false, 'trainer battles disallow capture');
});

test('battle: forced switch is required after a faint and blocks other actions', () => {
  const rng = createRng(21);
  const ally = team(['nulkit', 'emberling'], 20);
  ally[0].hp = 1;
  const b = new Battle({ allyTeam: ally, foeTeam: team(['solarion'], 50), rng });
  let guard = 0;
  while (!b.awaitingSwitch() && !b.over && guard++ < 40) {
    b.submit({ type: 'move', moveId: b.active(SIDE.ALLY).moves[0] });
  }
  assert.ok(b.log.some((e) => e.t === 'faint' && e.side === SIDE.ALLY), 'the 1 HP creature should have fainted');
  assert.ok(b.awaitingSwitch(), 'the player must be forced to pick a replacement');
  assert.deepEqual(b.legalActions(), ['switch'], 'only a switch is legal while awaiting a replacement');

  // Non-switch actions are rejected outright while a replacement is pending.
  const rejected = b.submit({ type: 'move', moveId: b.team(SIDE.ALLY)[1].moves[0] });
  assert.equal(b.awaitingSwitch(), true, 'rejected action must not advance state');
  assert.ok(rejected.some((e) => e.t === 'msg'));

  // Sending in the healthy creature clears the pending switch.
  b.sendIn(1);
  assert.equal(b.awaitingSwitch(), false);
  assert.equal(b.active(SIDE.ALLY).uid, ally[1].uid);
});

test('battle: fuzz — invariants hold across 400 randomised battles', () => {
  for (let seed = 0; seed < 400; seed++) {
    const rng = createRng(seed + 1);
    const pool = SPECIES_IDS;
    const mkTeam = (n, lv) => Array.from({ length: n }, () => {
      const id = pool[Math.floor(rng.next() * pool.length)];
      return createCreature({ speciesId: id, level: lv, rand: rng });
    });
    const ally = mkTeam(1 + Math.floor(rng.next() * 3), 5 + Math.floor(rng.next() * 45));
    const foe = mkTeam(1 + Math.floor(rng.next() * 3), 5 + Math.floor(rng.next() * 45));
    const b = new Battle({
      allyTeam: ally, foeTeam: foe,
      kind: rng.next() < 0.5 ? 'wild' : 'trainer',
      rng, inventory: { dataBall: 50, cipherBall: 50, matrixBall: 50, healPatch: 20, statusPatch: 20 },
    });

    let turns = 0;
    while (!b.over && turns++ < 300) {
      const actions = b.legalActions();
      let action;
      if (b.awaitingSwitch()) {
        const idx = b.team(SIDE.ALLY).findIndex((c) => !c.fainted);
        action = { type: 'switch', index: idx };
      } else {
        const type = actions[Math.floor(rng.next() * actions.length)];
        if (type === 'move') {
          const moves = b.active(SIDE.ALLY)?.moves || ['strike'];
          action = { type: 'move', moveId: moves[Math.floor(rng.next() * moves.length)] };
        } else if (type === 'switch') {
          const idx = Math.floor(rng.next() * b.team(SIDE.ALLY).length);
          action = { type: 'switch', index: idx };
        } else if (type === 'ball') {
          action = { type: 'ball', ballId: ['dataBall', 'cipherBall', 'matrixBall'][Math.floor(rng.next() * 3)] };
        } else if (type === 'item') {
          action = { type: 'item', itemId: rng.next() < 0.5 ? 'healPatch' : 'statusPatch' };
        } else {
          action = { type: 'flee' };
        }
      }
      b.submit(action);

      // Invariants after every action.
      for (const key of [SIDE.ALLY, SIDE.FOE]) {
        for (const c of b.team(key)) {
          assert.ok(Number.isInteger(c.hp), `seed ${seed}: hp not an integer`);
          assert.ok(c.hp >= 0, `seed ${seed}: hp fell below zero (${c.hp})`);
          assert.ok(c.hp <= c.maxHp, `seed ${seed}: hp exceeded max (${c.hp}/${c.maxHp})`);
          assert.ok(c.ref.hp === c.hp, `seed ${seed}: persisted hp drifted from combat hp`);
          for (const st of ['atk', 'def', 'spd']) {
            assert.ok(c.stages[st] >= -2 && c.stages[st] <= 2, `seed ${seed}: stage out of bounds`);
          }
          assert.ok(c.ref.level >= 1 && c.ref.level <= LEVEL_CAP, `seed ${seed}: level out of bounds`);
          assert.ok(Number.isFinite(maxHpOf(c.ref)), `seed ${seed}: maxHp is not finite`);
        }
      }
    }
    assert.ok(b.over, `seed ${seed}: battle never terminated (${turns} turns)`);
    assert.ok(['win', 'lose', 'flee', 'caught'].includes(b.outcome), `seed ${seed}: bad outcome ${b.outcome}`);
  }
});

test('battle: damage is always at least 1 on a hit and respects immunities', () => {
  const rng = createRng(77);
  const mk = (id) => {
    const c = createCreature({ speciesId: id, level: 30, rand: rng, cores: { hp: 15, atk: 15, def: 15, spd: 15 } });
    return { uid: c.uid, ref: c, speciesId: c.speciesId, species: getSpecies(id), level: 30, maxHp: maxHpOf(c), hp: maxHpOf(c), stats: statsFor(c), moves: [...c.moves], stages: { atk: 0, def: 0, spd: 0 }, status: null, statusTurns: 0, fainted: false, participated: true, nickname: null };
  };
  const attacker = mk('sparkit');
  const defender = mk('roccolith'); // terra: immune to volt
  let immunitySeen = false;
  for (let i = 0; i < 200; i++) {
    const res = computeDamage(attacker, defender, { name: 'Static Nip', type: 'volt', power: 45, acc: 100 }, rng);
    if (res.hit) {
      assert.equal(res.eff, 0, 'volt vs terra must be immune');
      assert.equal(res.damage, 1, 'immune hits still deal the 1 HP floor');
      immunitySeen = true;
    }
  }
  assert.ok(immunitySeen, 'expected at least one landed move');
});

test('progression: daily objectives are stable for a given date', () => {
  const a = dailyObjectives('2026-09-07');
  const b = dailyObjectives('2026-09-07');
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.notDeepEqual(a, dailyObjectives('2026-09-08'));
});
