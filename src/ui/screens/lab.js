/**
 * lab.js — Progression workshop: evolution, core training, move tutoring,
 * and the Data Shard fabricator.
 *
 * Every action here spends a resource (levels, bond, shards), so each handler
 * validates affordability *before* mutating state and reports failures with a
 * toast rather than throwing.
 *
 * @module ui/screens/lab
 */

import { h, renderInto, num } from '../dom.js';
import {
  card, sectionHead, creatureCard, spriteEl, badge, toast, modal,
  confirmDialog, emptyState, typeRow, statBar,
} from '../components.js';
import * as state from '../../core/state.js';
import { sfx, startMusic } from '../../core/sfx.js';
import { navigate } from '../../core/router.js';
import { getSpecies, learnsetFor } from '../../domain/species.js';
import { getMove } from '../../domain/moves.js';
import {
  canEvolve, applyEvolution, evolutionBlocker, raiseCore, teachMove,
  displayName, corePotential, statsFor, STAT_IDS,
} from '../../domain/creature.js';
import {
  coreCost, MOVE_TUTOR_COST, CORE_CAP, bondTier,
} from '../../domain/progression.js';
import { BALLS, BALL_PRICES } from '../../domain/capture.js';

/** Lab tab + selection state, preserved across re-renders. */
const lab = { tab: 'evolve', uid: null, stat: 'atk', moveId: null, evolveUid: null };

/**
 * Render the Lab.
 * @param {HTMLElement} root
 * @param {{query:URLSearchParams}} [ctx]
 */
export function render(root, ctx = { query: new URLSearchParams() }) {
  startMusic('lab');
  const evolveUid = ctx.query?.get('evolve');
  if (evolveUid && state.getCreature(evolveUid)) {
    lab.tab = 'evolve';
    lab.evolveUid = evolveUid;
  }

  const creatures = state.allCreatures();
  if (!lab.uid || !state.getCreature(lab.uid)) lab.uid = creatures[0]?.uid || null;

  const tabBtn = (id, label) => h(`button.seg-btn${lab.tab === id ? '.is-active' : ''}`, {
    type: 'button',
    onclick: () => { lab.tab = id; sfx.click(); navigate('/lab'); },
  }, label);

  const view = h('div.view.view--lab', [
    card(null,
      sectionHead('Lab', h('span.pill', `◈ ${num(state.getState().profile.shards)} Data Shards`)),
      h('p.muted', 'Train cores, tutor moves and evolve your partners. Everything here costs time, bond or shards.'),
      h('div.seg', [
        tabBtn('evolve', 'Evolution'),
        tabBtn('cores', 'Core training'),
        tabBtn('moves', 'Move tutor'),
        tabBtn('fabricate', 'Fabricator'),
      ]),
    ),
    lab.tab === 'evolve' ? evolvePanel(creatures)
      : lab.tab === 'cores' ? coresPanel(creatures)
        : lab.tab === 'moves' ? movesPanel(creatures)
          : fabricatePanel(),
  ]);

  renderInto(root, view);

  // Deep link: open the evolution confirmation straight away.
  if (lab.evolveUid) {
    const uid = lab.evolveUid;
    lab.evolveUid = null;
    openEvolveDialog(uid);
  }
}

/* ----------------------------------------------------------------- evolve */

function evolvePanel(creatures) {
  const ready = creatures.filter((c) => canEvolve(c));
  const pending = creatures.filter((c) => !canEvolve(c) && c.species && getSpecies(c.speciesId).evolve);

  return h('div.stack', [
    card('Ready to evolve',
      ready.length
        ? h('div.grid.grid--auto', ready.map((c) => creatureCard(c, {
          note: `→ ${getSpecies(getSpecies(c.speciesId).evolve.to).name}`,
          onClick: () => openEvolveDialog(c.uid),
          actions: [
            h('button.btn.btn--sm.btn--primary', {
              type: 'button',
              onclick: (e) => { e.stopPropagation(); openEvolveDialog(c.uid); },
            }, 'Evolve'),
          ],
        })))
        : emptyState('No creature is ready to evolve right now. Level and bond them up!')),

    card('Evolution paths',
      pending.length
        ? h('div.path-list', pending.map((c) => {
          const species = getSpecies(c.speciesId);
          const next = getSpecies(species.evolve.to);
          const blocker = evolutionBlocker(c);
          return h('div.path-row', [
            spriteEl(c.speciesId, { size: 44, shiny: c.shiny }),
            h('div.path-row__main', [
              h('div.path-row__names', `${displayName(c)} → ${next.name}`),
              h('div.bar.bar--thin', h('div.bar__fill', {
                style: {
                  width: `${Math.min(100, (c.level / species.evolve.level) * 100)}%`,
                  background: blocker ? 'var(--accent-2)' : '#4fd67c',
                },
              })),
              h('div.path-row__meta', blocker || 'Ready'),
            ]),
            h('div.path-row__types', typeRow(next.types, { small: true })),
          ]);
        }))
        : emptyState('Every creature that can evolve already has.')),
  ]);
}

async function openEvolveDialog(uid) {
  const creature = state.getCreature(uid);
  if (!creature) return;
  const evo = canEvolve(creature);
  if (!evo) {
    toast(evolutionBlocker(creature) || 'This creature cannot evolve further.', 'error');
    return;
  }
  const from = getSpecies(creature.speciesId);
  const to = getSpecies(evo.to);

  const ok = await confirmDialog({
    title: `Evolve ${displayName(creature)}?`,
    message: `${from.name} will become ${to.name}. Its moves are recalculated for the new form and it gains a bond boost. Evolutions are permanent.`,
    confirmLabel: 'Evolve',
  });
  if (!ok) return;

  state.mutate((s) => applyEvolution(s.creatures[uid], evo.to));
  state.recordEvolution(uid, from.id, to.id);
  sfx.evolve();
  toast(`${from.name} evolved into ${to.name}!`, 'success');
  navigate('/lab');
}

/* ------------------------------------------------------------------ cores */

function coresPanel(creatures) {
  if (!creatures.length) return card('Core training', emptyState('No creatures yet.'));
  const creature = state.getCreature(lab.uid);
  const pot = corePotential(creature);

  const statButtons = STAT_IDS.map((id) => {
    const value = creature.cores[id];
    const cost = coreCost(value);
    const maxed = value >= CORE_CAP;
    const affordable = state.getState().profile.shards >= cost;
    return h(`button.core-btn${lab.stat === id ? '.is-selected' : ''}`, {
      type: 'button',
      disabled: maxed || !affordable,
      onclick: () => trainCore(creature, id, cost),
    }, [
      h('span.core-btn__label', id.toUpperCase()),
      h('span.core-btn__value', `${value}/${CORE_CAP}`),
      h('div.bar.bar--thin', h('div.bar__fill', {
        style: { width: `${(value / CORE_CAP) * 100}%`, background: 'var(--accent)' },
      })),
      h('span.core-btn__cost', maxed ? 'MAX' : `◈ ${cost}`),
    ]);
  });

  return h('div.stack', [
    card('Core training',
      h('p.muted', 'Cores are the genetic ceiling of a creature. Each point permanently raises a stat. Cost scales with the current value.'),
      creaturePicker(creatures),
      creature ? h('div.core-panel', [
        h('div.core-panel__head', [
          spriteEl(creature.speciesId, { size: 84, shiny: creature.shiny }),
          h('div', [
            h('div.core-panel__name', `${displayName(creature)} · Lv ${creature.level}`),
            h('div.pill', `Potential ${pot.total}/${pot.max}`),
            statBar('ATK', statsFor(creature).atk, 220, { color: '#ff6b6b' }),
            statBar('DEF', statsFor(creature).def, 220, { color: '#3db4ff' }),
            statBar('SPD', statsFor(creature).spd, 220, { color: '#ffd93d' }),
          ]),
        ]),
        h('div.core-grid', statButtons),
      ]) : null),
  ]);
}

function trainCore(creature, statId, cost) {
  if (!state.spendShards(cost)) {
    sfx.error();
    toast('Not enough Data Shards.', 'error');
    return;
  }
  state.mutate((s) => raiseCore(s.creatures[creature.uid], statId));
  sfx.levelUp();
  toast(`${displayName(creature)}’s ${statId.toUpperCase()} core rose to ${creature.cores[statId]}.`, 'success');
  navigate('/lab');
}

/* ------------------------------------------------------------------ moves */

function movesPanel(creatures) {
  if (!creatures.length) return card('Move tutor', emptyState('No creatures yet.'));
  const creature = state.getCreature(lab.uid);
  const learnset = learnsetFor(creature.speciesId);
  const known = new Set(creature.moves);
  const options = learnset.filter((e) => !known.has(e.move));
  const affordable = state.getState().profile.shards >= MOVE_TUTOR_COST;

  return h('div.stack', [
    card('Move tutor',
      h('p.muted', `Relearn a technique this species knows but has forgotten. Costs ◈${MOVE_TUTOR_COST}. If all four slots are full, the oldest move is replaced.`),
      creaturePicker(creatures),
      creature ? h('div.stack', [
        h('h4.detail__sub', 'Known moves'),
        h('div.detail__moves', creature.moves.map((id) => {
          const m = getMove(id);
          return h('div.move-row', [
            h('span.move-row__name', m.name),
            typeRow([m.type], { small: true }),
            h('span.move-row__power', m.power ? `PWR ${m.power}` : 'Support'),
            h('span.move-row__desc', m.desc),
          ]);
        })),
        h('h4.detail__sub', 'Available to tutor'),
        options.length
          ? h('div.tutor-list', options.map((e) => {
            const m = getMove(e.move);
            return h('button.list-row', {
              type: 'button',
              disabled: !affordable,
              onclick: () => tutorMove(creature, e.move),
            }, [
              h('span.list-row__name', `${m.name} (Lv ${e.level})`),
              h('span.list-row__meta', `${m.power ? `PWR ${m.power}` : 'Support'} · ACC ${m.acc} · ◈${MOVE_TUTOR_COST}`),
            ]);
          }))
          : emptyState('This creature already knows everything it can learn.'),
      ]) : null),
  ]);
}

function tutorMove(creature, moveId) {
  if (!state.spendShards(MOVE_TUTOR_COST)) {
    sfx.error();
    toast('Not enough Data Shards.', 'error');
    return;
  }
  const ok = state.mutate((s) => teachMove(s.creatures[creature.uid], moveId));
  if (!ok) {
    state.addShards(MOVE_TUTOR_COST); // refund: nothing was taught
    sfx.error();
    toast('That move cannot be tutored to this creature.', 'error');
    return;
  }
  sfx.levelUp();
  toast(`${displayName(creature)} learned ${getMove(moveId).name}!`, 'success');
  navigate('/lab');
}

/* -------------------------------------------------------------- fabricator */

function fabricatePanel() {
  const s = state.getState();
  const rows = Object.values(BALLS).map((ball) => {
    const price = BALL_PRICES[ball.id];
    const owned = s.inventory[ball.id] ?? 0;
    return h('div.shop-row', [
      h('div.shop-row__main', [
        h('div.shop-row__name', ball.name),
        h('p.shop-row__desc', ball.desc),
        h('span.pill', `×${owned} owned`),
      ]),
      h('div.shop-row__buy', [
        h('button.btn.btn--sm', {
          type: 'button',
          disabled: s.profile.shards < price,
          onclick: () => buy(ball.id, 1),
        }, `◈ ${price}`),
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          disabled: s.profile.shards < price * 5,
          onclick: () => buy(ball.id, 5),
        }, `×5 ◈${price * 5}`),
      ]),
    ]);
  });

  return card('Fabricator',
    h('p.muted', 'Convert Data Shards into capture hardware. Shards come from battles, objectives and releasing creatures.'),
    h('div.shop-list', rows),
  );
}

function buy(ballId, count) {
  const res = state.buyBall(ballId, count);
  if (!res.ok) {
    sfx.error();
    toast(res.reason, 'error');
    return;
  }
  sfx.capture();
  toast(`Fabricated ${count}× ${BALLS[ballId].name}.`, 'success');
  navigate('/lab');
}

/* ------------------------------------------------------------------ shared */

function creaturePicker(creatures) {
  return h('div.picker', creatures.map((c) => h(`button.picker__item${lab.uid === c.uid ? '.is-selected' : ''}`, {
    type: 'button',
    title: `${displayName(c)} · Lv ${c.level}`,
    onclick: () => { lab.uid = c.uid; sfx.click(); navigate('/lab'); },
  }, [
    spriteEl(c.speciesId, { size: 40, shiny: c.shiny }),
    h('span.picker__label', `Lv ${c.level}`),
  ])));
}

export const meta = { title: 'Lab' };
export { bondTier };
