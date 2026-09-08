/**
 * ranch.js — Roster management: browse, inspect, rename, team-up, release.
 *
 * The Ranch is the "collection" surface. It reads straight from state and
 * performs every mutation through a named action in core/state.js, so the
 * persistence and sync layers stay unaware of the UI.
 *
 * @module ui/screens/ranch
 */

import { h, renderInto, num } from '../dom.js';
import {
  card, sectionHead, creatureCard, grid, spriteEl, hpBar, statBar,
  typeRow, badge, modal, confirmDialog, promptDialog, toast, emptyState, statusBadge,
} from '../components.js';
import * as state from '../../core/state.js';
import { sfx, startMusic } from '../../core/sfx.js';
import { navigate } from '../../core/router.js';
import { getSpecies, STAGE_ORDER } from '../../domain/species.js';
import { getMove } from '../../domain/moves.js';
import {
  statsFor, maxHpOf, displayName, corePotential, healCreature,
  canEvolve, evolutionBlocker, hpRatio, STAT_IDS,
} from '../../domain/creature.js';
import { bondTier, CORE_CAP, xpToNext } from '../../domain/progression.js';

/** View filters are module-scoped so they survive re-renders. */
const filters = { view: 'all', sort: 'level', focus: null };

/**
 * Render the Ranch.
 * @param {HTMLElement} root
 * @param {{query:URLSearchParams}} [ctx]
 */
export function render(root, ctx = { query: new URLSearchParams() }) {
  startMusic('menu');
  const focusUid = ctx.query?.get('focus');
  const creatures = filterAndSort(state.allCreatures());

  const view = h('div.view.view--ranch', [
    controlsBar(),
    creatures.length
      ? grid(creatures.map((c) => creatureCard(c, {
        selected: state.getState().team.includes(c.uid),
        note: state.getState().team.includes(c.uid) ? 'In active team' : null,
        onClick: () => openDetail(c.uid),
      })), { cols: 'auto' })
      : emptyState('Your ranch is empty. Head to Explore to meet wild digi-life.'),
  ]);

  renderInto(root, view);

  if (focusUid && state.getCreature(focusUid)) {
    filters.focus = focusUid;
    openDetail(focusUid);
  }
}

/* ---------------------------------------------------------------- controls */

function controlsBar() {
  const s = state.getState();
  const seg = (id, label) => h(`button.seg-btn${filters.view === id ? '.is-active' : ''}`, {
    type: 'button',
    onclick: () => { filters.view = id; sfx.click(); navigate('/ranch'); },
  }, label);

  return card(null,
    sectionHead(`Ranch · ${Object.keys(s.creatures).length} creatures`,
      h('button.btn.btn--sm.btn--primary', {
        type: 'button',
        onclick: () => { sfx.heal(); state.healAllCreatures(); toast('Roster restored to full health.', 'success'); navigate('/ranch'); },
      }, 'Heal all')),
    h('div.row.row--wrap', [
      h('div.seg', [
        seg('all', 'All'), seg('team', 'Team'), seg('hurt', 'Hurt'), seg('fainted', 'Fainted'),
      ]),
      h('label.field.field--inline', [
        h('span.field__label', 'Sort'),
        h('select.input.input--sm', {
          onchange: (e) => { filters.sort = e.target.value; navigate('/ranch'); },
        }, [
          h('option', { value: 'level', selected: filters.sort === 'level' }, 'Level'),
          h('option', { value: 'species', selected: filters.sort === 'species' }, 'Species'),
          h('option', { value: 'recent', selected: filters.sort === 'recent' }, 'Recently caught'),
          h('option', { value: 'potential', selected: filters.sort === 'potential' }, 'Core potential'),
        ]),
      ]),
    ]),
  );
}

function filterAndSort(list) {
  const s = state.getState();
  let out = list;
  if (filters.view === 'team') out = out.filter((c) => s.team.includes(c.uid));
  if (filters.view === 'hurt') out = out.filter((c) => c.hp > 0 && hpRatio(c) < 0.6);
  if (filters.view === 'fainted') out = out.filter((c) => c.hp <= 0);

  const cmp = {
    level: (a, b) => b.level - a.level,
    species: (a, b) => getSpecies(a.speciesId).name.localeCompare(getSpecies(b.speciesId).name),
    recent: (a, b) => (a.origin.at < b.origin.at ? 1 : -1),
    potential: (a, b) => corePotential(b).total - corePotential(a).total,
  }[filters.sort];
  return [...out].sort(cmp);
}

/* ------------------------------------------------------------------ detail */

/** Open the creature inspector modal. */
export function openDetail(uid) {
  const creature = state.getCreature(uid);
  if (!creature) return;
  const species = getSpecies(creature.speciesId);
  const stats = statsFor(creature);
  const pot = corePotential(creature);
  const tier = bondTier(creature.bond);
  const inTeam = state.getState().team.includes(uid);
  const evo = canEvolve(creature);
  const blocker = evolutionBlocker(creature);

  const body = h('div.detail', [
    h('div.detail__head', [
      spriteEl(creature.speciesId, { size: 118, shiny: creature.shiny }),
      h('div.detail__id', [
        h('div.detail__name', [
          displayName(creature),
          creature.shiny ? badge('Glitch', { kind: 'glitch' }) : null,
          statusBadge(null),
        ]),
        h('div.detail__species', `${species.name} · ${species.stage} · Lv ${creature.level}`),
        typeRow(species.types),
        h('p.detail__lore', species.lore),
      ]),
    ]),

    hpBar(creature),
    h('div.detail__xp', [
      h('span', `XP ${num(creature.xp)} / ${num(xpToNext(creature.level))}`),
      h('div.bar.bar--thin', h('div.bar__fill.bar__fill--xp', {
        style: { width: `${(creature.xp / Math.max(1, xpToNext(creature.level))) * 100}%` },
      })),
    ]),

    h('h4.detail__sub', 'Stats'),
    h('div.detail__stats', [
      statBar('HP', `${Math.max(0, Math.round(creature.hp))} / ${maxHpOf(creature)}`, null, { color: '#4fd67c' }),
      statBar('ATK', stats.atk, 220, { color: '#ff6b6b' }),
      statBar('DEF', stats.def, 220, { color: '#3db4ff' }),
      statBar('SPD', stats.spd, 220, { color: '#ffd93d' }),
    ]),

    h('h4.detail__sub', `Cores · ${pot.total}/${pot.max}`),
    h('div.detail__cores', STAT_IDS.map((id) => h('div.core-cell', [
      h('span.core-cell__label', id.toUpperCase()),
      h('span.core-cell__value', `${creature.cores[id]}/${CORE_CAP}`),
      h('div.bar.bar--thin', h('div.bar__fill', {
        style: { width: `${(creature.cores[id] / CORE_CAP) * 100}%`, background: 'var(--accent-2)' },
      })),
    ]))),

    h('h4.detail__sub', 'Moves'),
    h('div.detail__moves', creature.moves.map((id) => {
      const m = getMove(id);
      return h('div.move-row', [
        h('span.move-row__name', m.name),
        typeRow([m.type], { small: true }),
        h('span.move-row__power', m.power ? `PWR ${m.power}` : 'Support'),
        h('span.move-row__desc', m.desc),
      ]);
    })),

    evo || blocker ? h('div.detail__evo', [
      h('span', evo ? `Ready to evolve into ${getSpecies(evo.to).name}.` : blocker),
      evo ? h('button.btn.btn--sm.btn--primary', {
        type: 'button',
        onclick: () => { modal.close(); navigate(`/lab?evolve=${uid}`); },
      }, 'Open Lab') : null,
    ]) : null,

    h('div.detail__footer', [
      h('span.pill', { style: { color: tier.color } }, `Bond ${creature.bond} · ${tier.label}`),
      h('span.pill', `Caught ${new Date(creature.origin.at).toLocaleDateString('en-GB')}`),
      h('span.pill', `Zone: ${creature.origin.zone}`),
    ]),
  ]);

  const modal = modal({
    title: displayName(creature),
    size: 'md',
    body,
    actions: [
      {
        label: inTeam ? 'Remove from team' : 'Add to team',
        kind: inTeam ? 'ghost' : 'primary',
        onClick: () => {
          if (inTeam) {
            state.removeFromTeam(uid);
            toast(`${displayName(creature)} benched.`, 'info');
          } else if (state.getState().team.length >= 6) {
            toast('Your team is full (6 maximum).', 'error');
          } else {
            state.addToTeam(uid);
            toast(`${displayName(creature)} joined your team.`, 'success');
          }
        },
      },
      {
        label: 'Rename',
        kind: 'ghost',
        onClick: async () => {
          const name = await promptDialog({
            title: 'Rename creature',
            message: 'Leave blank to revert to the species name.',
            value: creature.nickname || '',
            maxLength: 18,
          });
          if (name !== null) { state.renameCreature(uid, name); toast('Renamed.', 'success'); }
        },
      },
      {
        label: 'Rest',
        kind: 'ghost',
        onClick: () => {
          state.mutate((s) => healCreature(s.creatures[uid]));
          sfx.heal();
          toast(`${displayName(creature)} is fully rested.`, 'success');
        },
      },
      {
        label: 'Release',
        kind: 'danger',
        onClick: async () => {
          const species2 = getSpecies(creature.speciesId);
          const ok = await confirmDialog({
            title: `Release ${displayName(creature)}?`,
            message: `This permanently removes it from your ranch in exchange for Data Shards. This cannot be undone.`,
            confirmLabel: 'Release',
            danger: true,
          });
          if (!ok) return;
          const res = state.releaseCreature(uid);
          if (!res.ok) { toast(res.reason, 'error'); return; }
          sfx.faint();
          toast(`Released. +◈${res.shards} Data Shards.`, 'info');
          navigate('/ranch');
        },
      },
    ],
  });
}

export const meta = { title: 'Ranch' };
export { STAGE_ORDER };
