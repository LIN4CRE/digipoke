/**
 * battle.js — Turn-based battle UI on top of the deterministic engine.
 *
 * Separation of concerns
 * -----------------------
 * domain/battle.js decides *what happens* and returns an ordered event list.
 * This module decides *how it feels*: it replays that event list with delays,
 * animations and sound, then re-renders the action menu from engine state.
 * The UI never computes damage, accuracy or AI decisions.
 *
 * @module ui/screens/battle
 */

import { h, renderInto, pct } from '../dom.js';
import { spriteEl, hpBar, typeChip, badge, statusBadge, toast, typeRow, floatText, impact, animateNumber } from '../components.js';
import * as state from '../../core/state.js';
import { Battle, SIDE, typeHint } from '../../domain/battle.js';
import { createRng } from '../../core/rng.js';
import { getSpecies } from '../../domain/species.js';
import { getMove } from '../../domain/moves.js';
import { createCreature, displayName, maxHpOf, statsFor } from '../../domain/creature.js';
import { BALLS, captureChance } from '../../domain/capture.js';
import { ZONES, getZone } from '../../domain/zones.js';
import { sfx, startMusic, stopMusic } from '../../core/sfx.js';
import { navigate } from '../../core/router.js';
import { emit, EVENTS } from '../../core/bus.js';

/* ------------------------------------------------------------ module state */

let battle = null;
let context = null;          // { kind, zoneId, wildCreature, trainerName }
let busy = false;
let els = {};                // DOM references for in-place updates

/**
 * Last rendered HP per side. Feeding the previous value into the HP bar draws
 * the trailing "chip" bar, so damage is readable at a glance.
 */
const lastHp = { [SIDE.ALLY]: null, [SIDE.FOE]: null };

/** Reduced-motion aware delay helper. */
function beat(ms) {
  const fast = !state.getState()?.settings?.motion;
  return new Promise((resolve) => setTimeout(resolve, fast ? Math.min(ms, 120) : ms));
}

/* ------------------------------------------------------------------ render */

/**
 * Render (or continue) a battle.
 * @param {HTMLElement} root
 * @param {{query:URLSearchParams}} ctx
 */
export function render(root, ctx = { query: new URLSearchParams() }) {
  const query = ctx.query;
  const isWild = query.get('wild') === '1';
  const isTrainer = query.get('trainer') === '1';

  if (!battle || battle.over) {
    const started = isTrainer ? startTrainer(query) : startWild(query);
    if (!started) return;
  } else if (isWild || isTrainer) {
    // Navigating here with a fresh query while a battle is live: keep the live one.
    if (context?.kind !== (isTrainer ? 'trainer' : 'wild')) {
      const started = isTrainer ? startTrainer(query) : startWild(query);
      if (!started) return;
    }
  }

  document.body.classList.add('in-battle');

  const view = h('div.view.view--battle', [
    h('div.arena', [
      // Each side is two layers: `.slot__card` is re-rendered on every state
      // change, `.slot__fx` persists so floating numbers survive the re-render.
      h('div.arena__foe#foeSlot', [h('div.slot__card#foeCard'), h('div.slot__fx#foeFx')]),
      h('div.arena__vs', 'VS'),
      h('div.arena__ally#allySlot', [h('div.slot__card#allyCard'), h('div.slot__fx#allyFx')]),
    ]),
    h('div.log#battleLog'),
    h('div.battle-menu#battleMenu'),
  ]);

  renderInto(root, view);
  els = {
    foe: root.querySelector('#foeSlot'),
    ally: root.querySelector('#allySlot'),
    foeCard: root.querySelector('#foeCard'),
    allyCard: root.querySelector('#allyCard'),
    foeFx: root.querySelector('#foeFx'),
    allyFx: root.querySelector('#allyFx'),
    log: root.querySelector('#battleLog'),
    menu: root.querySelector('#battleMenu'),
  };

  renderSide(SIDE.FOE);
  renderSide(SIDE.ALLY);
  pushLog(`A ${context.kind === 'trainer' ? 'trainer battle' : 'wild encounter'} begins!`);
  renderMenu();
  startMusic('battle');
  emit(EVENTS.BATTLE_START, { kind: context.kind });
}

/* ------------------------------------------------------------ battle setup */

function startWild(query) {
  const s = state.getState();
  const zoneId = query.get('zone') || s.progress.zoneId;
  const zone = getZone(zoneId);
  const rng = createRng((s.profile.seed ^ Date.now()) >>> 0);

  const speciesId = query.get('species') || zone.encounters[0].id;
  const level = Number(query.get('level')) || zone.minLevel;

  const wild = createCreature({
    speciesId, level, rand: rng,
    origin: { zone: zoneId, wild: true },
  });

  const allyTeam = readyTeam();
  if (!allyTeam.length) return false;

  lastHp[SIDE.ALLY] = null;
  lastHp[SIDE.FOE] = null;
  context = { kind: 'wild', zoneId, wildCreature: wild, trainerName: null };
  battle = new Battle({
    allyTeam, foeTeam: [wild], kind: 'wild', foeName: `Wild ${getSpecies(speciesId).name}`,
    rng, inventory: s.inventory, zoneId,
  });
  return true;
}

function startTrainer(query) {
  const s = state.getState();
  const zoneId = query.get('zone') || s.progress.zoneId;
  const rng = createRng((s.profile.seed ^ Date.now()) >>> 0);

  const rival = consumePendingRival(zoneId, rng);
  const foeTeam = rival.members.map((m) => createCreature({
    speciesId: m.speciesId, level: m.level, rand: rng,
    origin: { zone: zoneId, wild: false },
  }));

  const allyTeam = readyTeam();
  if (!allyTeam.length) return false;

  lastHp[SIDE.ALLY] = null;
  lastHp[SIDE.FOE] = null;
  context = { kind: 'trainer', zoneId, wildCreature: null, trainerName: rival.name };
  battle = new Battle({
    allyTeam, foeTeam, kind: 'trainer', foeName: rival.name,
    rng, inventory: s.inventory, zoneId,
  });
  return true;
}

/**
 * Get a battle-ready team, healing (and warning) if the player blacked out.
 * @returns {object[]}
 */
function readyTeam() {
  const team = state.teamCreatures();
  if (!team.length) {
    toast('You have no creatures in your team.', 'error');
    navigate('/ranch');
    return [];
  }
  if (team.every((c) => c.hp <= 0)) {
    state.healAllCreatures();
    toast('Your team was rushed to the nearest Node and restored.', 'warn');
  }
  return state.teamCreatures();
}

/* ------------------------------------------------------------------ panels */

/** Render one side's status card in place. */
/** The element whose children are replaced on re-render (`.slot__card`). */
function cardLayer(key) { return key === SIDE.FOE ? els.foeCard : els.allyCard; }

/** The persistent effects overlay for a side (`.slot__fx`). */
function fxLayer(key) { return key === SIDE.FOE ? els.foeFx : els.allyFx; }

function renderSide(key) {
  const host = cardLayer(key);
  if (!host) return;
  const side = battle.sides[key];
  const c = battle.active(key);
  const isFoe = key === SIDE.FOE;

  if (!c) {
    host.replaceChildren(h('div.combat-card.combat-card--empty', '—'));
    return;
  }

  const species = getSpecies(c.speciesId);
  const card = h(`div.combat-card.combat-card--${isFoe ? 'foe' : 'ally'}`, [
    h('div.combat-card__id', [
      h('div.combat-card__name', [
        c.nickname || species.name,
        c.shiny ? badge('Glitch', { kind: 'glitch' }) : null,
        statusBadge(c.status),
      ]),
      h('div.combat-card__meta', `Lv ${c.level} · ${side.name}`),
      typeRow(species.types, { small: true }),
    ]),
    h('div.combat-card__sprite', spriteEl(c.speciesId, { size: isFoe ? 112 : 104, shiny: c.shiny, flip: isFoe ? 'left' : 'right' })),
    hpBar({ ...c.ref, hp: c.hp }, { showNumbers: true, maxHp: c.maxHp, ghostFrom: lastHp[key] }),
    h('div.combat-card__stages', stagePips(c.stages)),
  ]);
  host.replaceChildren(card);
  lastHp[key] = c.hp;
}

/** Small +/− indicators for combat stat stages. */
function stagePips(stages) {
  const cells = Object.entries(stages)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => h('span.pill.pill--stage', `${k.toUpperCase()} ${v > 0 ? `+${v}` : v}`));
  return cells.length ? h('div.combat-card__stage-row', cells) : null;
}

/** Append a line to the battle log (auto-scrolled). */
function pushLog(text, kind = '') {
  if (!els.log || !text) return;
  const line = h(`div.log__line${kind ? `.log__line--${kind}` : ''}`, text);
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
  while (els.log.children.length > 60) els.log.removeChild(els.log.firstChild);
}

/* -------------------------------------------------------------------- menus */

function renderMenu() {
  if (!els.menu) return;
  if (battle.over) return;

  if (battle.awaitingSwitch()) {
    els.menu.replaceChildren(teamMenu({ forced: true }));
    return;
  }

  const active = battle.active(SIDE.ALLY);
  const moves = (active?.moves || []).map((id) => {
    const move = getMove(id);
    const hint = battle.active(SIDE.FOE)
      ? typeHint(id, getSpecies(battle.active(SIDE.FOE).speciesId).types)
      : { mult: 1, label: '' };
    return h('button.move-btn', {
      type: 'button',
      dataset: { type: move.type },
      title: move.desc,
      onclick: () => runTurn({ type: 'move', moveId: id }),
    }, [
      h('div.move-btn__top', [
        h('span.move-btn__name', move.name),
        h('span.move-btn__power', move.power ? move.power : '—'),
      ]),
      h('div.move-btn__bottom', [
        typeChip(move.type, { small: true }),
        hint.mult > 1 ? h('span.move-btn__eff.move-btn__eff--up', '×' + hint.mult) : null,
        hint.mult < 1 && hint.mult > 0 ? h('span.move-btn__eff.move-btn__eff--down', '×' + hint.mult) : null,
        hint.mult === 0 ? h('span.move-btn__eff.move-btn__eff--none', 'No effect') : null,
      ]),
    ]);
  });

  els.menu.replaceChildren(
    h('div.menu-root', [
      h('div.move-grid', moves),
      h('div.menu-actions', [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => els.menu.replaceChildren(ballMenu()) }, 'Ball'),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => els.menu.replaceChildren(bagMenu()) }, 'Bag'),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => els.menu.replaceChildren(teamMenu({})) }, 'Team'),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => runTurn({ type: 'flee' }) }, 'Flee'),
      ]),
    ]),
  );
}

function ballMenu() {
  const foe = battle.active(SIDE.FOE);
  if (!foe || !battle.canCapture()) {
    return menuWrap([h('p.muted', 'You cannot capture in a trainer battle.')]);
  }
  const rows = Object.values(BALLS).map((ball) => {
    const count = state.getState().inventory[ball.id] ?? 0;
    const chance = captureChance({
      hp: foe.hp, maxHp: foe.maxHp, rate: foe.species.capture,
      ballId: ball.id, level: foe.level, status: foe.status,
    });
    return h('button.list-row', {
      type: 'button',
      disabled: count <= 0,
      onclick: () => runTurn({ type: 'ball', ballId: ball.id }),
    }, [
      h('span.list-row__name', ball.name),
      h('span.list-row__meta', `${Math.round(chance * 100)}% · ${count} left`),
    ]);
  });
  return menuWrap(rows, 'Capture');
}

function bagMenu() {
  const inv = state.getState().inventory;
  const rows = [
    { id: 'healPatch', name: 'Heal Patch', desc: 'Restore 60% HP' },
    { id: 'statusPatch', name: 'Status Patch', desc: 'Cure any status' },
  ].map((item) => h('button.list-row', {
    type: 'button',
    disabled: (inv[item.id] ?? 0) <= 0,
    onclick: () => runTurn({ type: 'item', itemId: item.id }),
  }, [
    h('span.list-row__name', item.name),
    h('span.list-row__meta', `${item.desc} · ${inv[item.id] ?? 0} left`),
  ]));
  return menuWrap(rows, 'Bag');
}

function teamMenu({ forced }) {
  const team = battle.team(SIDE.ALLY);
  const rows = team.map((c, index) => {
    const isActive = index === battle.sides[SIDE.ALLY].index;
    return h('button.list-row.list-row--team', {
      type: 'button',
      disabled: c.fainted || isActive,
      onclick: () => (forced ? runSwitch(index) : runTurn({ type: 'switch', index })),
    }, [
      spriteEl(c.speciesId, { size: 36, shiny: c.shiny }),
      h('span.list-row__name', `${c.nickname || getSpecies(c.speciesId).name} · Lv ${c.level}`),
      h('span.list-row__meta', c.fainted ? 'Fainted' : (isActive ? 'In battle' : `${c.hp}/${c.maxHp} HP`)),
    ]);
  });
  return menuWrap(rows, forced ? 'Choose a replacement' : 'Switch');
}

function menuWrap(children, title = 'Back to actions') {
  return h('div.menu-panel', [
    h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => renderMenu() }, `← ${title}`),
    h('div.menu-panel__list', children),
  ]);
}

/* ------------------------------------------------------------------ turns */

/** Submit a player action and animate the resulting events. */
async function runTurn(action) {
  if (busy || !battle || battle.over) return;
  busy = true;
  els.menu.replaceChildren(h('div.menu-panel', h('p.muted', '…')));
  const events = battle.submit(action);
  await playEvents(events);
  busy = false;
  afterTurn();
}

/** Dedicated path for a forced switch (does not consume the opponent's turn). */
async function runSwitch(index) {
  if (busy || !battle || battle.over) return;
  busy = true;
  const events = battle.sendIn(index);
  await playEvents(events);
  busy = false;
  afterTurn();
}

/** Post-turn state resolution: forced switch, end screen, or re-render menu. */
function afterTurn() {
  if (!battle) return;
  renderSide(SIDE.ALLY);
  renderSide(SIDE.FOE);
  if (battle.over) showResult();
  else if (battle.awaitingSwitch()) renderMenu();
  else renderMenu();
}

/** Replay an engine event list with pacing and feedback. */
async function playEvents(events) {
  for (const ev of events) {
    await applyEvent(ev);
  }
}

async function applyEvent(ev) {
  switch (ev.t) {
    case 'msg':
      pushLog(ev.text);
      await beat(420);
      break;

    case 'move': {
      pushLog(`${ev.actor} used ${ev.name}!`, 'move');
      const move = getMove(ev.moveId);
      if (!move.power) sfx.moveSupport();
      else if (['byte', 'volt', 'frost', 'aqua', 'virus', 'null'].includes(move.type)) sfx.moveSpecial();
      else sfx.movePhysical();
      // Lean the attacker into the strike.
      impact(cardLayer(ev.side), 'lunge');
      await beat(420);
      break;
    }

    case 'damage': {
      const slot = ev.side === SIDE.FOE ? els.foe : els.ally;

      // Sound scales with impact: resisted → weak, super → heavy, crit → both.
      if (ev.eff > 1) sfx.superHit();
      else if (ev.eff < 1) sfx.weakHit();
      else sfx.hit();
      if (ev.crit) sfx.crit();

      pushLog(`${ev.amount} damage.${ev.crit ? ' A critical hit!' : ''}`, ev.eff > 1 ? 'good' : '');
      if (ev.text) pushLog(ev.text, ev.eff > 1 ? 'good' : 'warn');

      // Re-render first so the chip bar is drawn against the new HP, then
      // animate the fresh card and float the number on the persistent layer.
      renderSide(ev.side);
      impact(cardLayer(ev.side), ev.crit ? 'crit' : 'hit');
      floatText(fxLayer(ev.side), `${ev.crit ? 'CRIT ' : ''}−${ev.amount}`,
        ev.crit ? 'crit' : (ev.eff > 1 ? 'super' : (ev.eff < 1 ? 'weak' : 'damage')));
      if (ev.text) floatText(fxLayer(ev.side), ev.text, ev.eff > 1 ? 'super' : 'weak');
      if (ev.crit) impact(document.querySelector('.arena'), 'flash');
      await beat(520);
      break;
    }

    case 'miss': {
      sfx.miss();
      floatText(fxLayer(SIDE.FOE), 'MISS', 'miss');
      pushLog(`${ev.name} missed!`, 'warn');
      await beat(420);
      break;
    }

    case 'heal': {
      sfx.heal();
      floatText(fxLayer(ev.side), `+${ev.amount}`, 'heal');
      pushLog(`Recovered ${ev.amount} HP.`, 'good');
      renderSide(ev.side);
      await beat(420);
      break;
    }

    case 'status': {
      sfx.status();
      floatText(fxLayer(ev.side), ev.text, 'status');
      pushLog(ev.text, 'warn');
      renderSide(ev.side);
      await beat(460);
      break;
    }

    case 'statusTick': {
      pushLog(ev.text, 'warn');
      floatText(fxLayer(ev.side), 'residual', 'status');
      renderSide(ev.side);
      await beat(420);
      break;
    }

    case 'cure':
      pushLog(ev.text, 'good');
      renderSide(ev.side);
      await beat(360);
      break;

    case 'stat': {
      if (ev.delta > 0) sfx.statUp(); else sfx.statDown();
      floatText(fxLayer(ev.side), `${ev.stat.toUpperCase()} ${ev.delta > 0 ? '▲' : '▼'}`,
        ev.delta > 0 ? 'heal' : 'weak');
      pushLog(ev.text, 'good');
      renderSide(ev.side);
      await beat(400);
      break;
    }

    case 'switch':
      pushLog(ev.text, 'move');
      sfx.switchIn();
      lastHp[ev.side] = null; // a fresh creature has no previous HP to chip from
      renderSide(ev.side);
      await beat(480);
      break;

    case 'faint':
      sfx.faint();
      pushLog(ev.text, 'bad');
      renderSide(ev.side);
      await beat(700);
      break;

    case 'ball': {
      pushLog(ev.text);
      sfx.ballThrow();
      floatText(fxLayer(SIDE.FOE), `${BALLS[ev.ballId]?.name || 'Ball'}!`, 'info');
      impact(cardLayer(SIDE.FOE), 'throw');
      await beat(620);
      for (let i = 0; i < ev.shakes; i++) {
        pushLog('· wobble ·');
        sfx.ballWobble();
        impact(cardLayer(SIDE.FOE), 'wobble');
        await beat(420);
      }
      if (ev.success) {
        sfx.captureSuccess();
        pushLog('Click! Captured!', 'good');
        floatText(fxLayer(SIDE.FOE), 'CAUGHT!', 'heal');
      } else {
        sfx.captureFail();
        floatText(fxLayer(SIDE.FOE), 'Broke free!', 'weak');
      }
      await beat(340);
      break;
    }

    case 'xp':
      pushLog(`${ev.name} gained ${ev.amount} XP.`, 'good');
      await beat(360);
      break;

    case 'level': {
      sfx.levelUp();
      floatText(fxLayer(SIDE.ALLY), `LEVEL ${ev.level}!`, 'heal');
      pushLog(`${ev.name} grew to level ${ev.level}!`, 'good');
      toast(`${ev.name} reached level ${ev.level}!`, 'success');
      renderSide(SIDE.ALLY);
      await beat(620);
      break;
    }

    case 'learned':
      sfx.learn();
      pushLog(`${ev.name} learned ${ev.moveName}!`, 'good');
      await beat(420);
      break;

    case 'evolve': {
      sfx.evolve();
      pushLog(`${ev.oldName} is evolving…`, 'good');
      await beat(700);
      pushLog(`Congratulations! It evolved into ${ev.name}!`, 'good');
      toast(`${ev.oldName} evolved into ${ev.name}!`, 'success');
      state.recordEvolution(ev.uid, ev.from, ev.to);
      renderSide(SIDE.ALLY);
      await beat(800);
      break;
    }

    case 'item':
      await beat(200);
      break;

    case 'flee':
      if (ev.ok) sfx.flee();
      pushLog(ev.text, ev.ok ? 'good' : 'warn');
      await beat(420);
      break;

    case 'end':
      if (ev.outcome === 'win' || ev.outcome === 'caught') { sfx.victory(); startMusic('victory'); }
      if (ev.outcome === 'lose') sfx.defeat();
      pushLog(ev.text, ev.outcome === 'lose' ? 'bad' : 'good');
      await beat(400);
      break;

    default:
      break;
  }
}

/* ------------------------------------------------------------------ result */

/** Show the post-battle summary and commit results to state. */
function showResult() {
  const outcome = battle.outcome;
  const isTrainer = context.kind === 'trainer';
  let captured = null;

  if (outcome === 'caught' && context.wildCreature) {
    captured = context.wildCreature;
    captured.hp = maxHpOf(captured); // digitised and restored
    state.recordCapture(captured, context.zoneId);
  }

  state.recordBattleResult({ outcome, isTrainer, zoneId: context.zoneId, trainerName: context.trainerName });

  if (outcome === 'win' || outcome === 'caught') sfx.victory();
  if (outcome === 'lose') {
    sfx.defeat();
    state.healAllCreatures();
  }

  emit(EVENTS.BATTLE_END, { outcome });

  const rewards = [];
  if (captured) rewards.push(`${getSpecies(captured.speciesId).name} added to your ranch`);
  if (outcome === 'win' || outcome === 'caught') {
    rewards.push(`+◈ ${isTrainer ? 12 + ZONES.findIndex((z) => z.id === context.zoneId) * 6 : 3 + ZONES.findIndex((z) => z.id === context.zoneId) * 2} Data Shards`);
  }
  if (outcome === 'lose') rewards.push('Your team was restored at the nearest Node');

  const panel = h('div.menu-panel.menu-panel--result', [
    h(`h3.result__title.result__title--${outcome}`, resultTitle(outcome)),
    h('ul.result__list', rewards.map((r) => h('li', r))),
    h('div.row.row--wrap', [
      h('button.btn.btn--primary', {
        type: 'button',
        onclick: () => { leave(); navigate('/explore'); },
      }, 'Keep exploring'),
      h('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => { leave(); navigate('/ranch'); },
      }, 'Manage team'),
      h('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => { leave(); navigate('/'); },
      }, 'Nexus'),
    ]),
  ]);
  els.menu.replaceChildren(panel);
}

function resultTitle(outcome) {
  return {
    win: 'Victory!', lose: 'You blacked out…', flee: 'Got away safely', caught: 'Captured!',
  }[outcome] || 'Battle over';
}

/** Tear down battle state and restore normal chrome. */
export function leave() {
  battle = null;
  context = null;
  busy = false;
  lastHp[SIDE.ALLY] = null;
  lastHp[SIDE.FOE] = null;
  document.body.classList.remove('in-battle');
  startMusic('menu');
}

/** True while a battle is live (router guard uses this). */
export function isInBattle() { return !!battle && !battle.over; }

/**
 * Rival handoff: `explore.js` stashes the generated rival here so the URL stays
 * clean and the save file is not polluted with transient battle data.
 */
let pendingRival = null;
export function setPendingRival(rival) { pendingRival = rival; }

function consumePendingRival(zoneId, rng) {
  if (pendingRival && pendingRival.zoneId === zoneId) {
    const r = pendingRival;
    pendingRival = null;
    return r;
  }
  // Fallback (e.g. deep link / reload): generate one on the spot.
  const zone = getZone(zoneId);
  const pool = zone.encounters;
  return {
    name: zone.rivals[0],
    zoneId,
    members: Array.from({ length: 3 }, () => {
      const pick = pool[Math.floor(rng.next() * pool.length)];
      return { speciesId: pick.id, level: rng.int(zone.minLevel, zone.maxLevel) };
    }),
  };
}

export const meta = { title: 'Battle' };
export { statsFor };
