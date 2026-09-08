/**
 * battle.js — Deterministic turn-based battle engine.
 *
 * Design contract
 * ---------------
 * 1. The engine is a *state machine with a pure-ish surface*: `submit(action)`
 *    returns an ordered array of events describing everything that happened.
 *    No DOM, no timers, no persistence. The UI replays events to animate;
 *    tests assert against them.
 * 2. All randomness flows through the injected RNG, so a seed fully determines
 *    a battle. This is what makes the engine fuzz-testable (see tests/).
 * 3. Creatures passed in are the LIVE persisted objects: HP and XP are written
 *    back as they change. If the tab dies mid-battle, no progress is lost —
 *    a core property of the local-first architecture.
 *
 * @module domain/battle
 */

import { getMove, STATUSES } from './moves.js';
import { effectiveness, effectivenessLabel } from './types.js';
import { getSpecies } from './species.js';
import { displayName, maxHpOf, gainXp, statsFor } from './creature.js';
import { attemptCapture, BALLS } from './capture.js';
import { LEVEL_CAP } from './progression.js';

/** Side keys. */
export const SIDE = { ALLY: 'ally', FOE: 'foe' };

/** Action priority tiers (higher resolves first, before Speed is consulted). */
const PRIORITY = { switch: 6, flee: 6, item: 5, ball: 4, move: 0 };

/** Combat stage bounds. */
const STAGE_MIN = -2;
const STAGE_MAX = 2;

/** Convert a combat stage (-2..+2) into a stat multiplier. */
export function stageMultiplier(stage) {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

/**
 * Wrap a persisted creature into a volatile combatant.
 * @param {object} creature
 * @returns {object}
 */
function makeCombatant(creature) {
  const stats = statsFor(creature);
  return {
    uid: creature.uid,
    ref: creature,
    speciesId: creature.speciesId,
    species: getSpecies(creature.speciesId),
    nickname: creature.nickname,
    level: creature.level,
    maxHp: stats.hp,
    hp: Math.max(0, Math.min(stats.hp, creature.hp)),
    stats,
    moves: [...creature.moves],
    stages: { atk: 0, def: 0, spd: 0 },
    status: null,
    statusTurns: 0,
    fainted: creature.hp <= 0,
    participated: false,
  };
}

/** Effective stat after stages and status modifiers. */
function effStat(c, stat) {
  let v = c.stats[stat] * stageMultiplier(c.stages[stat]);
  if (stat === 'atk' && c.status === 'burn') v *= STATUSES.burn.atkMult;
  if (stat === 'spd' && c.status === 'paralyze') v *= STATUSES.paralyze.spdMult;
  return Math.max(1, Math.floor(v));
}

/**
 * Damage roll. Mirrors the genre-standard formula, tuned for a 4-stat model.
 *
 * @param {object} attacker Combatant.
 * @param {object} defender Combatant.
 * @param {object} move Move record.
 * @param {object} rng RNG.
 * @returns {{damage:number, eff:number, crit:boolean, hit:boolean}}
 */
export function computeDamage(attacker, defender, move, rng) {
  const hitRoll = rng.next() * 100;
  const acc = move.acc ?? 100;
  if (acc < 100 && hitRoll >= acc) {
    return { damage: 0, eff: 1, crit: false, hit: false };
  }

  const atk = effStat(attacker, 'atk');
  const def = effStat(defender, 'def');
  const level = attacker.level;

  const base = Math.floor(((2 * level) / 5 + 2) * move.power * (atk / def) / 50 + 2);
  const stab = attacker.species.types.includes(move.type) ? 1.25 : 1;
  const crit = rng.next() < 0.0625;
  const critMult = crit ? 1.5 : 1;
  const eff = effectiveness(move.type, defender.species.types);
  const variance = 0.85 + rng.next() * 0.15;

  const damage = Math.max(1, Math.floor(base * stab * eff * critMult * variance));
  return { damage, eff, crit, hit: true };
}

/** Rough expected damage used by the AI (no variance, no crit). */
function expectedDamage(attacker, defender, move) {
  if (!move.power) return 0;
  const atk = effStat(attacker, 'atk');
  const def = effStat(defender, 'def');
  const base = Math.floor(((2 * attacker.level) / 5 + 2) * move.power * (atk / def) / 50 + 2);
  const stab = attacker.species.types.includes(move.type) ? 1.25 : 1;
  const eff = effectiveness(move.type, defender.species.types);
  return base * stab * eff;
}

export class Battle {
  /**
   * @param {object} cfg
   * @param {object[]} cfg.allyTeam Player creatures (1..6, live objects).
   * @param {object[]} cfg.foeTeam  Opponent creatures (live or generated).
   * @param {'wild'|'trainer'} [cfg.kind]
   * @param {string} [cfg.foeName]
   * @param {object} cfg.rng RNG instance from core/rng.js.
   * @param {object} [cfg.inventory] Mutable inventory (balls/items consumed).
   * @param {string} [cfg.zoneId] Zone the battle started in (provenance).
   */
  constructor({ allyTeam, foeTeam, kind = 'wild', foeName = 'Wild Digi', rng, inventory = {}, zoneId = null }) {
    if (!rng) throw new Error('Battle requires an RNG instance');
    const ally = allyTeam.filter(Boolean).slice(0, 6);
    const foe = foeTeam.filter(Boolean).slice(0, 6);
    if (!ally.length || !foe.length) throw new Error('Battle requires at least one creature per side');

    this.rng = rng;
    this.kind = kind;
    this.zoneId = zoneId;
    this.inventory = inventory;
    this.turn = 0;
    this.over = false;
    this.outcome = null; // 'win' | 'lose' | 'flee' | 'caught'
    this.pendingSwitch = null; // side key forced to send in a replacement
    this.capturedUid = null;
    this.log = [];
    this.sides = {
      [SIDE.ALLY]: {
        key: SIDE.ALLY,
        name: 'Your team',
        isPlayer: true,
        team: ally.map(makeCombatant),
        index: firstHealthyIndex(ally),
      },
      [SIDE.FOE]: {
        key: SIDE.FOE,
        name: foeName,
        isPlayer: false,
        team: foe.map(makeCombatant),
        index: 0,
      },
    };
    // Sync back: the engine's HP view is authoritative from here on.
    for (const key of [SIDE.ALLY, SIDE.FOE]) {
      for (const c of this.sides[key].team) c.ref.hp = c.hp;
    }
    this.emit({ t: 'start', kind, foeName, ally: this.active(SIDE.ALLY).species.name, foe: this.active(SIDE.FOE).species.name });
  }

  /* ------------------------------------------------------------------ read */

  /** Active combatant for a side (or null when the team is wiped). */
  active(key) {
    const side = this.sides[key];
    if (!side) return null;
    const c = side.team[side.index];
    return c && !c.fainted ? c : null;
  }

  team(key) { return this.sides[key].team; }
  sideName(key) { return this.sides[key].name; }

  /** True when the player may throw a ball right now. */
  canCapture() {
    return this.kind === 'wild' && !this.over && !!this.active(SIDE.FOE);
  }

  /** True when the player is being forced to choose a replacement. */
  awaitingSwitch() { return this.pendingSwitch === SIDE.ALLY; }

  /** Legal action types for the current moment (drives UI enable/disable). */
  legalActions() {
    if (this.over) return [];
    if (this.awaitingSwitch()) return ['switch'];
    const acts = ['move', 'switch', 'item', 'flee'];
    if (this.canCapture()) acts.push('ball');
    return acts;
  }

  /* ----------------------------------------------------------------- write */

  /** Internal: append an event to the log and return it. */
  emit(ev) { this.log.push(ev); return ev; }

  /**
   * Submit the player's action for this turn and resolve the whole turn.
   *
   * @param {{type:string}} action
   *   { type:'move',   moveId }
   *   { type:'switch', index }    index into the player's team
   *   { type:'item',   itemId }   'healPatch' | 'statusPatch'
   *   { type:'ball',   ballId }
   *   { type:'flee' }
   * @returns {object[]} Ordered event list produced by this turn.
   */
  submit(action) {
    const events = [];
    const start = this.log.length;
    if (this.over) return [{ t: 'msg', text: 'The battle has already ended.' }];

    if (this.awaitingSwitch() && action.type !== 'switch') {
      return [{ t: 'msg', text: 'You must send in a replacement first.' }];
    }

    const playerAction = this.normalise(action);
    if (!playerAction) return [{ t: 'msg', text: 'That action is not available.' }];

    const foeAction = this.chooseFoeAction();

    const order = this.resolveOrder(playerAction, foeAction);
    for (const entry of order) {
      if (this.over) break;
      this.execute(entry.side, entry.action, events);
      this.resolveFaints(events);
      if (this.over) break;
    }

    if (!this.over) {
      this.endOfTurn(events);
      this.resolveFaints(events);
      this.turn += 1;
    }

    return this.log.slice(start);
  }

  /** Validate and shape an incoming action, or null when illegal. */
  normalise(action) {
    switch (action.type) {
      case 'move': {
        const c = this.active(SIDE.ALLY);
        if (!c || !c.moves.includes(action.moveId)) return null;
        return { type: 'move', moveId: action.moveId };
      }
      case 'switch': {
        const side = this.sides[SIDE.ALLY];
        const target = side.team[action.index];
        if (!target || target.fainted || action.index === side.index) return null;
        return { type: 'switch', index: action.index };
      }
      case 'item': {
        const count = this.inventory[action.itemId] ?? 0;
        if (count <= 0) return { type: 'item', itemId: action.itemId, empty: true };
        return { type: 'item', itemId: action.itemId };
      }
      case 'ball': {
        if (!this.canCapture() || !BALLS[action.ballId]) return null;
        if ((this.inventory[action.ballId] ?? 0) <= 0) return { type: 'ball', ballId: action.ballId, empty: true };
        return { type: 'ball', ballId: action.ballId };
      }
      case 'flee':
        return { type: 'flee' };
      default:
        return null;
    }
  }

  /** Determine which side acts first this turn. */
  resolveOrder(playerAction, foeAction) {
    const entries = [
      { side: SIDE.ALLY, action: playerAction },
      { side: SIDE.FOE, action: foeAction },
    ];
    const prio = (a) => PRIORITY[a.type] ?? 0;
    entries.sort((a, b) => {
      const d = prio(b.action) - prio(a.action);
      if (d !== 0) return d;
      const ca = this.active(a.side);
      const cb = this.active(b.side);
      if (!ca || !cb) return 0;
      const sd = effStat(cb, 'spd') - effStat(ca, 'spd');
      if (sd !== 0) return sd;
      return this.rng.next() < 0.5 ? -1 : 1;
    });
    return entries;
  }

  /** Execute one side's action, appending events. */
  execute(key, action, events) {
    const side = this.sides[key];
    const actor = this.active(key);
    const other = key === SIDE.ALLY ? SIDE.FOE : SIDE.ALLY;

    switch (action.type) {
      case 'move': {
        if (!actor) return;
        if (!this.preMoveStatus(key, actor, events)) return;
        const move = getMove(action.moveId);
        const target = this.active(other);
        if (!target) return;

        actor.participated = true;
        events.push(this.emit({ t: 'move', side: key, moveId: action.moveId, name: move.name, actor: nameOf(actor) }));

        if (move.power > 0) {
          const res = computeDamage(actor, target, move, this.rng);
          if (!res.hit) {
            events.push(this.emit({ t: 'miss', side: key, name: nameOf(actor) }));
            return;
          }
          this.applyDamage(other, res.damage, events, { eff: res.eff, crit: res.crit });

          // Secondary effects (drain / recoil) resolved off the damage dealt.
          if (move.effect?.kind === 'drain') {
            const healed = Math.max(1, Math.floor(res.damage * move.effect.pct));
            this.applyHeal(key, healed, events, { source: 'drain' });
          }
          if (move.effect?.kind === 'recoil') {
            const hurt = Math.max(1, Math.floor(res.damage * move.effect.pct));
            this.applyDamage(key, hurt, events, { source: 'recoil' });
          }
        } else if (move.effect?.kind === 'heal') {
          const healed = Math.max(1, Math.floor(actor.maxHp * move.effect.pct));
          if (actor.hp >= actor.maxHp) {
            events.push(this.emit({ t: 'msg', text: `${nameOf(actor)}'s HP is already full!` }));
          } else {
            this.applyHeal(key, healed, events, { source: 'move' });
          }
        } else if (move.effect?.kind === 'stat') {
          const delta = this.modifyStage(key, action.targetSide ?? key, move.effect.stat, move.effect.stages);
          if (delta === 0) {
            events.push(this.emit({ t: 'msg', text: `${nameOf(actor)}'s ${move.effect.stat.toUpperCase()} won't go higher!` }));
          } else {
            events.push(this.emit({
              t: 'stat', side: key, stat: move.effect.stat, delta, name: nameOf(actor),
              text: `${nameOf(actor)}'s ${statLabel(move.effect.stat)} ${delta > 0 ? 'rose' : 'fell'}!`,
            }));
          }
        }

        // Non-volatile status application.
        if (move.effect?.kind === 'status' && !this.active(other)?.status) {
          const t = this.active(other);
          if (t && this.rng.next() < (move.effect.chance ?? 0)) {
            this.applyStatus(other, move.effect.status, events);
          }
        }
        break;
      }

      case 'switch': {
        const incoming = side.team[action.index];
        if (!incoming || incoming.fainted) return;
        side.index = action.index;
        incoming.participated = true;
        events.push(this.emit({
          t: 'switch', side: key, index: action.index,
          name: nameOf(incoming),
          text: key === SIDE.ALLY ? `Go, ${nameOf(incoming)}!` : `${side.name} sends out ${nameOf(incoming)}!`,
        }));
        if (this.pendingSwitch === key) this.pendingSwitch = null;
        break;
      }

      case 'item': {
        if (action.empty) {
          events.push(this.emit({ t: 'msg', text: 'You don’t have any of those left.' }));
          return;
        }
        this.inventory[action.itemId] = (this.inventory[action.itemId] ?? 0) - 1;
        const target = this.active(key);
        if (action.itemId === 'healPatch' && target) {
          const healed = Math.max(1, Math.floor(target.maxHp * 0.6));
          this.applyHeal(key, healed, events, { source: 'item' });
        } else if (action.itemId === 'statusPatch' && target) {
          target.status = null; target.statusTurns = 0;
          events.push(this.emit({ t: 'cure', side: key, name: nameOf(target), text: `${nameOf(target)} was restored!` }));
        }
        events.push(this.emit({ t: 'item', side: key, itemId: action.itemId }));
        break;
      }

      case 'ball': {
        if (action.empty) {
          events.push(this.emit({ t: 'msg', text: 'You don’t have any of those left.' }));
          return;
        }
        const target = this.active(SIDE.FOE);
        if (!target) return;
        this.inventory[action.ballId] = (this.inventory[action.ballId] ?? 0) - 1;
        const res = attemptCapture({
          hp: target.hp, maxHp: target.maxHp, rate: target.species.capture,
          ballId: action.ballId, level: target.level, status: target.status, rand: this.rng,
        });
        events.push(this.emit({
          t: 'ball', ballId: action.ballId, chance: res.chance, shakes: res.shakes, success: res.success,
          text: `${BALLS[action.ballId].name} thrown at ${nameOf(target)}!`,
        }));
        if (res.success) {
          target.fainted = true;
          target.captured = true;
          this.capturedUid = target.uid;
          this.finish('caught', events);
        } else {
          events.push(this.emit({ t: 'msg', text: `Argh! It broke free after ${res.shakes} shake${res.shakes === 1 ? '' : 's'}!` }));
        }
        break;
      }

      case 'flee': {
        if (this.kind !== 'wild') {
          events.push(this.emit({ t: 'msg', text: 'You can’t flee from a trainer battle!' }));
          return;
        }
        const me = this.active(key);
        const them = this.active(other);
        const speedEdge = me && them ? effStat(me, 'spd') / (effStat(me, 'spd') + effStat(them, 'spd')) : 0.5;
        const ok = this.rng.next() < 0.55 + speedEdge * 0.4;
        events.push(this.emit({ t: 'flee', ok, text: ok ? 'Got away safely!' : 'Can’t escape!' }));
        if (ok) this.finish(key === SIDE.ALLY ? 'flee' : 'win', events);
        break;
      }
      default:
        break;
    }
  }

  /** Sleep/freeze/paralysis gate at the start of a move. Returns false if the turn is consumed. */
  preMoveStatus(key, actor, events) {
    if (!actor.status) return true;
    if (actor.status === 'sleep') {
      actor.statusTurns -= 1;
      if (actor.statusTurns > 0) {
        events.push(this.emit({ t: 'msg', text: `${nameOf(actor)} is fast asleep…` }));
        return false;
      }
      actor.status = null;
      events.push(this.emit({ t: 'cure', side: key, name: nameOf(actor), text: `${nameOf(actor)} woke up!` }));
      return true;
    }
    if (actor.status === 'freeze') {
      if (this.rng.next() < STATUSES.freeze.thawChance) {
        actor.status = null;
        events.push(this.emit({ t: 'cure', side: key, name: nameOf(actor), text: `${nameOf(actor)} thawed out!` }));
        return true;
      }
      events.push(this.emit({ t: 'msg', text: `${nameOf(actor)} is frozen solid!` }));
      return false;
    }
    if (actor.status === 'paralyze' && this.rng.next() < STATUSES.paralyze.skipChance) {
      events.push(this.emit({ t: 'msg', text: `${nameOf(actor)} is paralysed! It can’t move!` }));
      return false;
    }
    return true;
  }

  /** Apply damage to a side's active combatant and persist it to the creature. */
  applyDamage(key, amount, events, meta = {}) {
    const target = this.active(key);
    if (!target) return;
    const dealt = Math.min(target.hp, Math.max(1, Math.floor(amount)));
    target.hp -= dealt;
    target.ref.hp = target.hp; // persist immediately (crash-safe local-first)
    events.push(this.emit({
      t: 'damage', side: key, amount: dealt, hp: target.hp, maxHp: target.maxHp,
      eff: meta.eff ?? 1, crit: !!meta.crit, source: meta.source || 'move',
      text: meta.eff !== undefined && meta.eff !== 1 ? effectivenessLabel(meta.eff) : '',
    }));
    if (target.hp <= 0) {
      target.hp = 0;
      target.ref.hp = 0;
    }
  }

  /** Heal a side's active combatant (never above max) and persist. */
  applyHeal(key, amount, events, meta = {}) {
    const target = this.active(key);
    if (!target) return;
    const healed = Math.min(target.maxHp - target.hp, Math.max(1, Math.floor(amount)));
    if (healed <= 0) return;
    target.hp += healed;
    target.ref.hp = target.hp;
    events.push(this.emit({
      t: 'heal', side: key, amount: healed, hp: target.hp, maxHp: target.maxHp, source: meta.source || 'item',
    }));
  }

  /** Apply a non-volatile status if the target has none. */
  applyStatus(key, status, events) {
    const target = this.active(key);
    if (!target || target.status || !STATUSES[status]) return false;
    target.status = status;
    target.statusTurns = status === 'sleep' ? this.rng.int(...STATUSES.sleep.turns) : 0;
    events.push(this.emit({
      t: 'status', side: key, status, name: nameOf(target),
      text: `${nameOf(target)} was ${statusVerb(status)}!`,
    }));
    return true;
  }

  /** Shift a combat stage, clamped. Returns the actual delta applied. */
  modifyStage(_actorSide, targetSide, stat, stages) {
    const target = this.active(targetSide);
    if (!target) return 0;
    const before = target.stages[stat] ?? 0;
    const after = Math.max(STAGE_MIN, Math.min(STAGE_MAX, before + stages));
    target.stages[stat] = after;
    return after - before;
  }

  /** End-of-turn residual effects (burn/poison ticks, sleep countdown). */
  endOfTurn(events) {
    for (const key of [SIDE.ALLY, SIDE.FOE]) {
      const c = this.active(key);
      if (!c || !c.status) continue;
      const def = STATUSES[c.status];
      if (def.dot) {
        const dmg = Math.max(1, Math.floor(c.maxHp * def.dot));
        events.push(this.emit({ t: 'statusTick', side: key, status: c.status, name: nameOf(c), text: `${nameOf(c)} is hurt by its ${def.name.toLowerCase()}!` }));
        this.applyDamage(key, dmg, events, { source: 'status' });
      } else if (c.status === 'sleep') {
        c.statusTurns -= 1;
        if (c.statusTurns <= 0) {
          c.status = null;
          events.push(this.emit({ t: 'cure', side: key, name: nameOf(c), text: `${nameOf(c)} woke up!` }));
        }
      }
    }
  }

  /** Detect faints, award XP, and force/auto replacements. */
  resolveFaints(events) {
    for (const key of [SIDE.ALLY, SIDE.FOE]) {
      const side = this.sides[key];
      const c = side.team[side.index];
      if (c && c.hp <= 0 && !c.fainted) {
        c.fainted = true;
        c.hp = 0;
        c.ref.hp = 0;
        events.push(this.emit({
          t: 'faint', side: key, uid: c.uid, name: nameOf(c),
          text: key === SIDE.FOE
            ? (c.captured ? `${nameOf(c)} was captured!` : `Wild ${nameOf(c)} fainted!`)
            : `${nameOf(c)} fainted!`,
        }));
        if (key === SIDE.FOE && !c.captured) this.awardXp(c, events);
      }
    }

    const allyAlive = this.sides[SIDE.ALLY].team.some((c) => !c.fainted);
    const foeAlive = this.sides[SIDE.FOE].team.some((c) => !c.fainted);

    if (this.over) return;
    if (!foeAlive) { this.finish('win', events); return; }
    if (!allyAlive) { this.finish('lose', events); return; }

    for (const key of [SIDE.ALLY, SIDE.FOE]) {
      const side = this.sides[key];
      const active = side.team[side.index];
      if (active && active.fainted) {
        if (side.isPlayer) {
          this.pendingSwitch = key;
        } else {
          const next = side.team.findIndex((c) => !c.fainted);
          if (next >= 0) {
            side.index = next;
            events.push(this.emit({ t: 'switch', side: key, index: next, name: nameOf(side.team[next]), text: `${side.name} sends out ${nameOf(side.team[next])}!` }));
          }
        }
      }
    }
  }

  /** Distribute XP from a defeated foe and resolve level-ups/evolutions. */
  awardXp(defeated, events) {
    const species = getSpecies(defeated.speciesId);
    const isTrainer = this.kind === 'trainer';
    const pool = this.sides[SIDE.ALLY].team.filter((c) => c.participated || !c.fainted);
    const recipients = pool.length ? pool : [this.active(SIDE.ALLY)].filter(Boolean);
    for (const member of recipients) {
      if (!member.ref || member.fainted) continue;
      const share = member.participated ? 1 : 0.5;
      const amount = Math.max(1, Math.floor((species.xp * defeated.level) / 7 * (isTrainer ? 1.5 : 1) * share));
      events.push(this.emit({ t: 'xp', uid: member.uid, name: nameOf(member), amount }));
      if (member.ref.level >= LEVEL_CAP) continue;
      const report = gainXp(member.ref, amount);
      member.participated = true;
      for (const lv of report.levels) {
        events.push(this.emit({ t: 'level', uid: member.uid, name: nameOf(member), level: lv, learned: report.learned }));
        member.level = member.ref.level;
        member.maxHp = maxHpOf(member.ref);
        member.stats = statsFor(member.ref);
        member.hp = member.ref.hp;
        for (const m of report.learned) {
          events.push(this.emit({ t: 'learned', uid: member.uid, name: nameOf(member), moveId: m, moveName: getMove(m).name }));
        }
        member.moves = [...member.ref.moves];
      }
      if (report.evolved) {
        events.push(this.emit({
          t: 'evolve', uid: member.uid, from: report.evolved.from, to: report.evolved.to,
          name: getSpecies(report.evolved.to).name,
          oldName: getSpecies(report.evolved.from).name,
          text: `${getSpecies(report.evolved.from).name} is evolving…`,
        }));
        member.speciesId = member.ref.speciesId;
        member.species = getSpecies(member.speciesId);
        member.moves = [...member.ref.moves];
        member.maxHp = maxHpOf(member.ref);
        member.stats = statsFor(member.ref);
        member.hp = member.ref.hp;
      }
    }
  }

  /** Send in a replacement for the player (also used after a forced switch). */
  sendIn(index) {
    const events = [];
    const side = this.sides[SIDE.ALLY];
    const target = side.team[index];
    if (!target || target.fainted || index === side.index) {
      return [{ t: 'msg', text: 'That creature can’t battle right now.' }];
    }
    const start = this.log.length;
    side.index = index;
    target.participated = true;
    this.pendingSwitch = null;
    events.push(this.emit({ t: 'switch', side: SIDE.ALLY, index, name: nameOf(target), text: `Go, ${nameOf(target)}!` }));
    return this.log.slice(start);
  }

  /** Terminate the battle. */
  finish(outcome, events) {
    if (this.over) return;
    this.over = true;
    this.outcome = outcome;
    // Persist final HP for every participant.
    for (const key of [SIDE.ALLY, SIDE.FOE]) {
      for (const c of this.sides[key].team) c.ref.hp = c.hp;
    }
    const text = {
      win: 'You won the battle!',
      lose: 'You blacked out… your team was rushed to the nearest Node.',
      flee: 'You escaped.',
      caught: 'Capture successful!',
    }[outcome] || 'The battle ended.';
    events.push(this.emit({ t: 'end', outcome, text }));
  }

  /* -------------------------------------------------------------------- AI */

  /** Pick an action for the opposing side. */
  chooseFoeAction() {
    const me = this.active(SIDE.FOE);
    const them = this.active(SIDE.ALLY);
    if (!me) return { type: 'flee' };
    if (!them) return { type: 'move', moveId: me.moves[0] };

    const damaging = me.moves.map((id) => ({ id, move: getMove(id) })).filter((m) => m.move.power > 0);
    if (damaging.length && this.rng.next() < 0.72) {
      let best = damaging[0];
      let bestScore = -1;
      for (const cand of damaging) {
        const score = expectedDamage(me, them, cand.move);
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      return { type: 'move', moveId: best.id };
    }
    // Status / setup moves as a secondary option.
    const utility = me.moves.filter((id) => {
      const m = getMove(id);
      return m.power === 0 && m.effect;
    });
    if (utility.length && this.rng.next() < 0.6) {
      return { type: 'move', moveId: this.rng.pick(utility) };
    }
    return { type: 'move', moveId: this.rng.pick(me.moves) || me.moves[0] };
  }

  /** Debug/test helper: a compact, JSON-safe view of the battle. */
  snapshot() {
    const view = (key) => this.sides[key].team.map((c) => ({
      name: nameOf(c), speciesId: c.speciesId, hp: c.hp, maxHp: c.maxHp,
      status: c.status, fainted: c.fainted, stages: { ...c.stages },
    }));
    return {
      turn: this.turn, over: this.over, outcome: this.outcome,
      ally: { index: this.sides[SIDE.ALLY].index, team: view(SIDE.ALLY) },
      foe: { index: this.sides[SIDE.FOE].index, team: view(SIDE.FOE) },
    };
  }
}

/* --------------------------------------------------------------- utilities */

function firstHealthyIndex(team) {
  const i = team.findIndex((c) => c.hp > 0);
  return i >= 0 ? i : 0;
}

function nameOf(c) {
  return c.nickname || c.species?.name || getSpecies(c.speciesId).name;
}

function statusVerb(status) {
  return { burn: 'burned', poison: 'poisoned', paralyze: 'paralysed', freeze: 'frozen solid', sleep: 'put to sleep' }[status] || status;
}

function statLabel(stat) {
  return { atk: 'Attack', def: 'Defence', spd: 'Speed' }[stat] || stat;
}

/**
 * Type-effectiveness hint shown next to move buttons (no RNG, no damage range).
 * @param {string} moveId
 * @param {string[]} defenderTypes
 * @returns {{mult:number, label:string}}
 */
export function typeHint(moveId, defenderTypes) {
  const move = getMove(moveId);
  const mult = effectiveness(move.type, defenderTypes);
  return { mult, label: effectivenessLabel(mult) };
}

export { displayName };
