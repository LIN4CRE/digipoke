/**
 * dashboard.js — The Nexus: player's home screen and primary workflow hub.
 *
 * Design intent: everything the player needs for a session is one tap away —
 * team state, today's objectives, and the two entry points into the core loop
 * (Explore and Lab). No screen in the app is more than two taps from here.
 *
 * @module ui/screens/dashboard
 */

import { h, num, renderInto } from '../dom.js';
import {
  card, sectionHead, creatureCard, grid, spriteEl, hpBar, statBar,
  badge, timeAgo, emptyState, tamerEl,
} from '../components.js';
import * as state from '../../core/state.js';
import { sfx, startMusic } from '../../core/sfx.js';
import { navigate } from '../../core/router.js';
import { getZone, ZONES, unlockedZones } from '../../domain/zones.js';
import { getSpecies } from '../../domain/species.js';
import { STAT_IDS, maxHpOf } from '../../domain/creature.js';

/**
 * Render the dashboard.
 * @param {HTMLElement} root
 */
export function render(root) {
  const s = state.getState();
  const team = state.teamCreatures();
  const zone = getZone(s.progress.zoneId);
  const objectives = state.ensureObjectives();

  startMusic('menu');

  // Sequencing: on a brand-new save the objectives card is just three greyed
  // rows shouting "locked". Hold it back until the coach card is dismissed so
  // the first screen reads as one clear next step instead of five.
  const firstRun = state.tutorialPending('nexus');

  const view = h('div.view.view--dashboard', [
    heroCard(s, team, zone),
    coachCard(),
    firstRun ? null : objectivesCard(objectives),
    teamCard(team),
    quickActionsCard(zone, firstRun),
  ]);
  renderInto(root, view);
}

/* --------------------------------------------------------------- sections */

function heroCard(s, team, zone) {
  const stats = s.profile.stats;
  const hpTotal = team.reduce((sum, c) => sum + Math.max(0, c.hp), 0);
  const hpMax = team.reduce((sum, c) => sum + maxHpOf(c), 0);

  return card(null,
    h('div.hero', [
      h('div.hero__avatar', tamerEl(s.profile.tamer, { size: 72, mood: 'happy' })),
      h('div.hero__id', [
        h('h1.hero__name', s.profile.displayName),
        h('div.hero__meta', [
          badge(`Tamer since ${new Date(s.profile.createdAt).toLocaleDateString('en-GB')}`, { kind: 'neutral' }),
          // "Last seen just now" is nonsense on a profile made five seconds ago.
          Date.now() - new Date(s.profile.createdAt).getTime() < 60_000
            ? badge('Just started', { kind: 'primary' })
            : badge(`Last seen ${timeAgo(s.profile.lastSeenAt)}`, { kind: 'neutral' }),
        ]),
      ]),
      h('div.hero__shards', [
        h('span.hero__shard-value', `◈ ${num(s.profile.shards)}`),
        h('span.hero__shard-label', 'Data Shards'),
      ]),
    ]),
    h('div.hero__bars', [
      statBar('Team vitality', hpTotal, hpMax, { color: hpTotal / Math.max(1, hpMax) < 0.3 ? '#ff6b6b' : '#4fd67c' }),
    ]),
    h('div.stat-grid', [
      statBox('Battles', stats.battles),
      statBox('Wins', stats.battlesWon),
      statBox('Caught', stats.captures),
      statBox('Evolutions', stats.evolutions),
      statBox('Scans', stats.steps),
      statBox('Zones', `${unlockedZones(state.strongestLevel()).length}/${ZONES.length}`),
    ]),
    h('p.muted.muted--sm', `Current zone: ${zone.name} — ${zone.blurb}`),
  );
}

/**
 * First-run coach marks. Shown once, then remembered in the save file —
 * a three-line primer is the difference between "what do I do?" and playing.
 */
function coachCard() {
  if (!state.tutorialPending('nexus')) return null;
  return card(null,
    sectionHead('Welcome to your Nexus', badge('Getting started', { kind: 'primary' })),
    h('ol.help-list', [
      h('li', [h('strong', 'Explore'), ' — scan a zone to meet wild digi-life, weaken it, then throw a Data Ball.']),
      h('li', [h('strong', 'Lab'), ' — evolve, train cores and tutor moves with the Data Shards you earn.']),
      h('li', [h('strong', 'Own it'), ' — everything is stored on this device. Export a backup any time from Data.']),
    ]),
    h('div.row.row--end', h('button.btn.btn--primary', {
      type: 'button',
      onclick: () => { state.markTutorialSeen('nexus'); sfx.confirm(); navigate('/'); },
    }, 'Got it')),
  );
}

function statBox(label, value) {
  return h('div.stat-box', [h('span.stat-box__value', String(value)), h('span.stat-box__label', label)]);
}

function objectivesCard(objectives) {
  const rows = objectives.items.map((item) => {
    const done = item.progress >= item.goal;
    const claimed = objectives.claimed.includes(item.id);
    return h('div.objective', [
      h('div.objective__main', [
        h('div.objective__text', item.text),
        h('div.bar.bar--thin', h('div.bar__fill', {
          style: { width: `${(item.progress / item.goal) * 100}%`, background: done ? '#4fd67c' : 'var(--accent)' },
        })),
        h('div.objective__meta', `${Math.min(item.progress, item.goal)} / ${item.goal} · +◈${item.reward}`),
      ]),
      claimed
        ? badge('Claimed', { kind: 'muted' })
        : h('button.btn.btn--sm', {
          type: 'button',
          disabled: !done,
          onclick: () => {
            const res = state.claimObjective(item.id);
            if (res.ok) { sfx.capture(); navigate('/'); } else sfx.error();
          },
        }, done ? 'Claim' : 'Locked'),
    ]);
  });

  return card('Daily objectives',
    h('p.muted.muted--sm', `Resets daily · ${objectives.dateKey}`),
    h('div.objective-list', rows),
  );
}

function teamCard(team) {
  const slots = Array.from({ length: 6 }, (_, i) => {
    const c = team[i];
    if (!c) return h('div.team-slot.team-slot--empty', h('span', 'Empty'));
    return h('button.team-slot', {
      type: 'button',
      title: `${getSpecies(c.speciesId).name} · Lv ${c.level}`,
      onclick: () => { sfx.select(); navigate(`/ranch?focus=${c.uid}`); },
    }, [
      spriteEl(c.speciesId, { size: 64, shiny: c.shiny }),
      h('div.team-slot__name', getSpecies(c.speciesId).name),
      hpBar(c, { showNumbers: false }),
    ]);
  });

  return card(null,
    sectionHead('Active team',
      h('button.btn.btn--sm', { type: 'button', onclick: () => { sfx.heal(); state.healAllCreatures(); } }, 'Heal team')),
    h('div.team-grid', slots),
    team.length === 0
      ? emptyState('No creatures in your team. Visit the Ranch to assign some.')
      : null,
  );
}

function quickActionsCard(zone, firstRun = false) {
  const actions = [
    {
      icon: '➤', title: 'Explore', text: `Scan ${zone.name} for wild digi-life.`,
      kind: 'primary', hint: firstRun, onClick: () => navigate('/explore'),
    },
    {
      icon: '⚗', title: 'Lab', text: 'Evolve, train cores and tutor moves.',
      kind: 'ghost', onClick: () => navigate('/lab'),
    },
    {
      icon: '❖', title: 'Ranch', text: 'Manage your roster and team order.',
      kind: 'ghost', onClick: () => navigate('/ranch'),
    },
    {
      icon: '⚙', title: 'Data', text: 'Export, import and sync your vault.',
      kind: 'ghost', onClick: () => navigate('/settings'),
    },
  ];

  return card('Quick actions',
    grid(actions.map((a) => h(`button.quick-action.quick-action--${a.kind}${a.hint ? '.is-hint' : ''}`, {
      type: 'button',
      onclick: () => { sfx.click(); a.onClick(); },
    }, [
      h('span.quick-action__icon', a.icon),
      h('div', [h('div.quick-action__title', a.title), h('div.quick-action__text', a.text)]),
      a.hint ? badge('Start here', { kind: 'primary' }) : null,
    ])), { cols: '2' }),
  );
}

/* ---------------------------------------------------------------- art */

/** Re-exported for the router title. */
export const meta = { title: 'Nexus' };
