/**
 * components.js — Shared presentational components.
 *
 * Screens are composed from these primitives so the visual language stays
 * consistent and each screen file only contains its own logic. Everything here
 * is a pure DOM factory: no global state is mutated except the toast queue and
 * the modal stack (both of which are UI-local).
 *
 * @module ui/components
 */

import { h, clear, renderInto, num, pct } from './dom.js';
import { sprite, portrait } from './sprite.js';
import { tamerAvatar } from './tamerAvatar.js';
import { TYPES } from '../domain/types.js';
import { getSpecies, STAGE_ORDER } from '../domain/species.js';
import { maxHpOf, statsFor, displayName, healthState, corePotential, hpRatio } from '../domain/creature.js';
import { bondTier } from '../domain/progression.js';
import { STATUSES } from '../domain/moves.js';
import * as state from '../core/state.js';
import { on, emit, EVENTS } from '../core/bus.js';
import { sfx } from '../core/sfx.js';
import { navigate, activePath } from '../core/router.js';

/* ------------------------------------------------------------------ toasts */

let toastRoot = null;
let syncLabel = 'Local only';
let syncKind = 'idle';

/** Wire global UI listeners. Called once from main.js. */
export function initUi() {
  toastRoot = document.getElementById('toast-root');
  on(EVENTS.TOAST, ({ message, kind }) => toast(message, kind));
  on(EVENTS.SYNC_STATUS, ({ label, kind }) => { syncLabel = label; syncKind = kind; });
}

/**
 * Show a transient toast.
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} [kind]
 * @param {number} [ms]
 */
export function toast(message, kind = 'info', ms = 2800) {
  if (!toastRoot) toastRoot = document.getElementById('toast-root');
  if (!toastRoot) return;
  const el = h(`div.toast.toast--${kind}`, { role: 'status' }, message);
  toastRoot.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ------------------------------------------------------------------ modals */

let modalStack = 0;

/**
 * Open a modal dialog.
 *
 * @param {object} o
 * @param {string} o.title
 * @param {Node|Node[]} o.body
 * @param {{label:string, kind?:string, value?:any, onClick?:Function}[]} [o.actions]
 * @param {'sm'|'md'|'lg'} [o.size]
 * @param {boolean} [o.dismissible] Allow backdrop/Esc close (default true).
 * @returns {{close:(result?:any)=>void, el:HTMLElement}}
 */
export function modal({ title, body, actions = [], size = 'md', dismissible = true }) {
  const root = document.getElementById('modal-root');
  let closed = false;

  const panel = h(`div.modal__panel.modal__panel--${size}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  panel.appendChild(h('h2.modal__title', title));

  const bodyEl = h('div.modal__body');
  [].concat(body).forEach((n) => n && bodyEl.appendChild(n));
  panel.appendChild(bodyEl);

  const actionsEl = h('div.modal__actions');
  for (const action of actions) {
    const btn = h(`button.btn${action.kind ? `.btn--${action.kind}` : ''}`, {
      type: 'button',
      onclick: () => {
        if (closed) return;
        const result = action.onClick ? action.onClick() : action.value;
        // A handler returning exactly `false` keeps the modal open (validation).
        if (result !== false) close(result);
      },
    }, action.label);
    actionsEl.appendChild(btn);
  }
  if (!actions.length) {
    actionsEl.appendChild(h('button.btn.btn--primary', { type: 'button', onclick: () => close() }, 'Close'));
  }
  panel.appendChild(actionsEl);

  const backdrop = h('div.modal__backdrop', {
    onclick: (e) => { if (dismissible && e.target === backdrop) close(); },
  }, panel);

  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) close();
  };

  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-in');
    setTimeout(() => backdrop.remove(), 180);
    modalStack = Math.max(0, modalStack - 1);
    if (typeof result !== 'undefined') emit('modal:closed', result);
  }

  document.addEventListener('keydown', onKey);
  root.appendChild(backdrop);
  modalStack += 1;
  requestAnimationFrame(() => backdrop.classList.add('is-in'));
  (panel.querySelector('button') || panel).focus?.();
  return { close, el: panel };
}

/**
 * Promise-based confirmation dialog.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p.modal__text', message),
      size: 'sm',
      actions: [
        { label: cancelLabel, kind: 'ghost', onClick: () => { resolve(false); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { resolve(true); } },
      ],
    });
  });
}

/**
 * Promise-based text prompt.
 * @returns {Promise<string|null>} Entered value, or null when cancelled.
 */
export function promptDialog({ title, message, value = '', placeholder = '', maxLength = 18, confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const input = h('input.input', { type: 'text', value, placeholder, maxLength, spellcheck: 'false' });
    modal({
      title,
      size: 'sm',
      body: [h('p.modal__text', message), input],
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => resolve(null) },
        { label: confirmLabel, kind: 'primary', onClick: () => resolve(input.value.trim() || null) },
      ],
    });
    setTimeout(() => input.focus(), 40);
  });
}

/* ------------------------------------------------------------------- chips */

/** Elemental type chip. */
export function typeChip(typeId, { small = false } = {}) {
  const t = TYPES[typeId] || TYPES.null;
  return h(`span.chip.chip--type${small ? '.chip--sm' : ''}`, {
    dataset: { type: typeId },
    style: { '--chip': t.color },
    title: `${t.name} type`,
  }, `${t.glyph} ${t.name}`);
}

/** Row of type chips. */
export function typeRow(types, opts) {
  return h('div.chip-row', types.map((t) => typeChip(t, opts)));
}

/** Stage / status badge. */
export function badge(text, { kind = 'neutral', title = '' } = {}) {
  return h(`span.badge.badge--${kind}`, { title }, text);
}

/** Status condition badge, or null when healthy. */
export function statusBadge(status) {
  if (!status || !STATUSES[status]) return null;
  return h('span.badge.badge--status', {
    style: { '--chip': STATUSES[status].color },
    title: STATUSES[status].note,
  }, STATUSES[status].name);
}

/* -------------------------------------------------------------------- bars */

/**
 * Labelled stat bar with an animated fill and tabular value read-out.
 * The fill animates from 0 on first paint so stats always feel alive.
 */
export function statBar(label, value, max, { color = 'var(--accent)', showValue = true, animate = true } = {}) {
  const numeric = typeof value === 'number' ? value : parseFloat(value) || 0;
  const ceiling = max || Math.max(numeric, 1);
  const fill = h('div.bar__fill', { style: { background: color, width: animate ? '0%' : `${pct(numeric, ceiling)}%` } });
  if (animate) {
    requestAnimationFrame(() => { fill.style.width = `${pct(numeric, ceiling)}%`; });
  }
  return h('div.stat-row', [
    h('div.stat-row__head', [
      h('span.stat-row__label', label),
      showValue ? h('span.stat-row__value', String(value)) : null,
    ]),
    h('div.bar.bar--stat', fill),
  ]);
}

/**
 * Health bar with a "chip" ghost layer.
 *
 * The ghost bar holds the previous HP value for a moment before collapsing to
 * the real value, so the player sees *how much* damage was just taken — a
 * genre-standard readability trick that makes damage legible at a glance.
 *
 * @param {object} creature Anything with `hp` (plus a species/base for max HP).
 * @param {object} [opts]
 * @param {boolean} [opts.showNumbers]
 * @param {boolean} [opts.compact]
 * @param {number} [opts.ghostFrom] Previous HP; renders the trailing damage bar.
 * @param {number} [opts.maxHp] Override max HP (avoids recomputing in hot paths).
 */
export function hpBar(creature, { showNumbers = true, compact = false, ghostFrom = null, maxHp = null } = {}) {
  const max = maxHp ?? maxHpOf(creature);
  const hp = Math.max(0, Math.min(max, creature.hp));
  const st = healthState(creature);
  const width = pct(hp, max);

  const fill = h(`div.hp__fill.hp__fill--${st}`, { style: { width: `${width}%` } });
  const track = h('div.hp__track', fill);

  if (ghostFrom != null && ghostFrom > hp) {
    const ghost = h('div.hp__ghost', { style: { width: `${pct(Math.min(ghostFrom, max), max)}%` } });
    track.insertBefore(ghost, fill);
    // Collapse the ghost after the eye has registered the delta.
    setTimeout(() => { ghost.style.width = `${width}%`; }, 260);
  }

  const numbers = showNumbers
    ? h('div.hp__numbers', h('span.hp__value', `${Math.max(0, Math.round(hp))}`), h('span.hp__sep', ' / '), h('span.hp__max', `${max}`))
    : null;

  return h(`div.hp${compact ? '.hp--compact' : ''}${st === 'critical' ? '.hp--pulse' : ''}`, [track, numbers]);
}

/**
 * Smoothly count an element's text from one number to another.
 * @param {HTMLElement} el
 * @param {number} from
 * @param {number} to
 * @param {number} [ms]
 */
export function animateNumber(el, from, to, ms = 420) {
  if (!el) return;
  const start = performance.now();
  const delta = to - from;
  if (!delta) { el.textContent = String(to); return; }
  function frame(now) {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(from + delta * eased));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/**
 * Spawn floating combat text (damage, crits, healing) above a target.
 * @param {HTMLElement} host Positioned container (the combat card).
 * @param {string} text
 * @param {'damage'|'crit'|'heal'|'info'|'miss'|'status'} [kind]
 */
export function floatText(host, text, kind = 'damage') {
  if (!host) return;
  // Slight horizontal drift so stacked floaters stay readable.
  const drift = Math.round((Math.random() * 2 - 1) * 14);
  const el = h(`div.floater.floater--${kind}`, { style: { '--drift': `${drift}px` } }, text);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-up'));
  setTimeout(() => el.remove(), 1150);
}

/** Shake + flash an element (impacts, capture wobbles). */
export function impact(el, kind = 'hit') {
  if (!el) return;
  el.classList.remove(`is-${kind}`);
  void el.offsetWidth; // force reflow so the animation can restart
  el.classList.add(`is-${kind}`);
  setTimeout(() => el.classList.remove(`is-${kind}`), 620);
}

/** XP bar for a creature. */
export function xpBar(creature) {
  return h('div.bar.bar--xp', h('div.bar__fill.bar__fill--xp', {
    style: { width: `${pct(creature.xp, Math.max(1, xpNeeded(creature)))}%` },
  }));
}

/** Local helper: XP required for the next level (imported lazily to avoid cycles). */
function xpNeeded(creature) {
  // Imported from progression via a cached reference set by creature module.
  return Math.max(1, Math.pow(creature.level + 1, 3) - Math.pow(creature.level, 3));
}

/* ----------------------------------------------------------------- sprites */

/** Inline-SVG creature sprite element. */
export function spriteEl(speciesId, { size = 96, shiny = false, mood = 'idle', flip = 'right', animate = true } = {}) {
  const art = getSpecies(speciesId).art;
  return h('div.sprite-wrap', {
    html: sprite(art, { size, shiny, mood, flip, animate }),
    style: { width: `${size}px`, height: `${size}px` },
  });
}

/** Large framed portrait used by the starter showcase. */
export function portraitEl(speciesId, { size = 220, shiny = false, mood = 'idle', flip = 'right' } = {}) {
  const art = getSpecies(speciesId).art;
  return h('div.portrait-wrap', {
    html: portrait(art, { size, shiny, mood, flip }),
  });
}

/** Circular tamer portrait from a saved avatar config. */
export function tamerEl(config, { size = 64, mood = 'idle' } = {}) {
  return h('div.avatar-wrap', {
    html: tamerAvatar(config, { size, mood }),
    style: { width: `${size}px`, height: `${size}px` },
  });
}

/* ------------------------------------------------------------------- cards */

/** Titled surface panel. */
export function card(title, ...children) {
  const el = h('section.card.card--pad');
  if (title) el.appendChild(h('h2.card__title', title));
  children.flat().forEach((c) => c && el.appendChild(c));
  return el;
}

/** Empty-state placeholder with an optional action. */
export function emptyState(text, action = null) {
  return h('div.empty', [h('p.empty__text', text), action]);
}

/**
 * Creature summary card used across Ranch, Lab and team pickers.
 *
 * @param {object} creature
 * @param {object} [opts]
 * @param {() => void} [opts.onClick]
 * @param {Node[]} [opts.actions] Buttons rendered in the footer.
 * @param {boolean} [opts.compact] Hide stats rows.
 * @param {boolean} [opts.selected] Highlight (team/selected state).
 * @param {string} [opts.note] Extra line under the name.
 */
export function creatureCard(creature, { onClick, actions = [], compact = false, selected = false, note = null } = {}) {
  const species = getSpecies(creature.speciesId);
  const pot = corePotential(creature);
  const tier = bondTier(creature.bond);

  const el = h(`div.creature-card${selected ? '.is-selected' : ''}${onClick ? '.is-clickable' : ''}`, {
    onclick: onClick ? () => { sfx.select(); onClick(); } : null,
  }, [
    h('div.creature-card__top', [
      spriteEl(creature.speciesId, { size: compact ? 56 : 76, shiny: creature.shiny, flip: 'right' }),
      h('div.creature-card__id', [
        h('div.creature-card__name', [
          displayName(creature),
          creature.shiny ? badge('Glitch', { kind: 'glitch', title: 'Rare colour variant (1 in 512)' }) : null,
        ]),
        h('div.creature-card__meta', `Lv ${creature.level} · ${species.name}`),
        typeRow(species.types, { small: true }),
      ]),
    ]),
    hpBar(creature),
    compact ? null : h('div.creature-card__stats', [
      statBar('ATK', statsFor(creature).atk, 200, { color: '#ff6b6b' }),
      statBar('DEF', statsFor(creature).def, 200, { color: '#4fd67c' }),
      statBar('SPD', statsFor(creature).spd, 200, { color: '#3db4ff' }),
    ]),
    h('div.creature-card__footer', [
      h('span.pill', { title: 'Core potential (IVs)' }, `Core ${pot.total}/${pot.max}`),
      h('span.pill', { style: { color: tier.color }, title: 'Bond' }, `${tier.label} ${creature.bond}`),
    ]),
    note ? h('div.creature-card__note', note) : null,
    actions.length ? h('div.creature-card__actions', actions) : null,
  ]);
  return el;
}

/* ------------------------------------------------------------------ chrome */

/** Top application bar: brand, tamer, currency, sync state. */
export function renderTopbar(el) {
  const s = state.getState();
  const strongest = state.strongestLevel();
  renderInto(el,
    h('div.topbar__brand', { onclick: () => navigate('/') }, [
      h('span.topbar__mark', { html: logoSvg(20) }),
      h('span.topbar__name', 'DigiPoke'),
    ]),
    h('div.topbar__stats', [
      h('span.pill.pill--shards', { title: 'Data Shards' }, `◈ ${num(s.profile.shards)}`),
      h('span.pill', { title: 'Highest creature level' }, `Lv ${strongest}`),
      h(`span.pill.pill--sync.is-${syncKind}`, { title: 'Sync status' }, syncLabel),
    ]),
    h('button.icon-btn', {
      type: 'button', title: 'Settings', 'aria-label': 'Settings',
      onclick: () => { sfx.click(); navigate('/settings'); },
    }, '⚙'),
  );
}

/** Bottom tab navigation (mobile-first, also used on desktop). */
export function renderTabbar(el) {
  const tabs = [
    { path: '/', label: 'Nexus', icon: '◈' },
    { path: '/ranch', label: 'Ranch', icon: '❖' },
    { path: '/explore', label: 'Explore', icon: '➤' },
    { path: '/lab', label: 'Lab', icon: '⚗' },
    { path: '/settings', label: 'Data', icon: '⚙' },
  ];
  const current = activePath();
  renderInto(el, tabs.map((tab) => h(`button.tabbar__item${current === tab.path ? '.is-active' : ''}`, {
    type: 'button',
    onclick: () => {
      sfx.click();
      if (current === tab.path) return;
      navigate(tab.path);
    },
  }, [
    h('span.tabbar__icon', tab.icon),
    h('span.tabbar__label', tab.label),
  ])));
}

/** Inline brand mark (no external assets). */
export function logoSvg(size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7c5cff"/><stop offset="100%" stop-color="#23d5ff"/>
    </linearGradient></defs>
    <circle cx="16" cy="16" r="14" fill="url(#lg)"/>
    <path d="M16 5 L26 11 V21 L16 27 L6 21 V11 Z" fill="none" stroke="#0b1020" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="4" fill="#0b1020"/>
  </svg>`;
}

/* ------------------------------------------------------------------ misc */

/** Section heading with an optional right-hand action. */
export function sectionHead(title, action = null) {
  return h('div.section-head', [h('h3.section-head__title', title), action]);
}

/** Grid wrapper. */
export function grid(children, { cols = 'auto' } = {}) {
  return h(`div.grid.grid--${cols}`, children.flat().filter(Boolean));
}

/** Format a relative time ("3 minutes ago"). */
export function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Re-export convenience used by several screens. */
export { num, pct, clear, renderInto, hpRatio, STAGE_ORDER, state };
