/**
 * onboarding.js — The first five minutes.
 *
 * This screen is the single highest-leverage surface in DigiPoke: it is where a
 * player decides whether to stay. It is therefore built as a proper
 * title-sequence → character-creation → partner-selection flow rather than a
 * form:
 *
 *   0  SPLASH      Animated title, audio unlock, "Press Start"
 *   1  IDENTITY    Name + vault passphrase, with a live Tamer ID preview
 *   2  APPEARANCE  Full avatar creator (7×8×8×8×6×4 ≈ 86k combinations)
 *   3  PARTNER     Starter showcase: portraits, stats, lore, confirm
 *   4  LAUNCH      "Digitising…" cinematic, then hand-off to the Nexus
 *
 * No network call happens anywhere in this file. The passphrase derives an
 * AES-GCM vault key entirely on-device.
 *
 * @module ui/screens/onboarding
 */

import { h, renderInto } from '../dom.js';
import {
  card, badge, toast, typeRow, statBar, portraitEl, tamerEl, spriteEl,
  confirmDialog, sectionHead,
} from '../components.js';
import * as state from '../../core/state.js';
import * as db from '../../core/db.js';
import { deriveVaultKey, makeVerifier, newSalt } from '../../core/crypto.js';
import { sfx, unlockAudio, setSoundEnabled, setSfxVolume, setMusicVolume, startMusic, stopMusic } from '../../core/sfx.js';
import { TAMER_OPTIONS, DEFAULT_TAMER, randomTamer, combinationCount } from '../tamerAvatar.js';
import { sprite as spriteMarkup, portrait as portraitMarkup } from '../sprite.js';
import { STARTER_IDS, getSpecies, learnsetFor } from '../../domain/species.js';
import { statsFor, movesAtLevel } from '../../domain/creature.js';
import { getMove } from '../../domain/moves.js';
import { createRng } from '../../core/rng.js';
import { navigate } from '../../core/router.js';

/** Wizard state, module-scoped so re-renders never lose input. */
const wizard = {
  step: 0,
  displayName: '',
  passphrase: '',
  confirm: '',
  tamer: { ...DEFAULT_TAMER },
  starter: STARTER_IDS[0],
  showHelp: false,
  error: '',
};

/** Timers owned by the launch cinematic, cleared on teardown. */
let cinematicTimers = [];

/** Intervals owned by the cinematic (cleared separately — clearTimeout on an
 *  interval id is not something to rely on). */
let cinematicIntervals = [];

/** Keyboard handler that lets the player skip the cinematic. */
let skipHandler = null;

/** Reset the wizard (used when a profile is wiped). */
export function resetOnboarding() {
  clearCinematic();
  identityBusy = false;
  previewTamer = null;
  pendingFocus = null;
  pendingSelector = null;
  justChanged = false;
  lastStep = null;
  Object.assign(wizard, {
    step: 0, displayName: '', passphrase: '', confirm: '',
    tamer: { ...DEFAULT_TAMER }, starter: STARTER_IDS[0], showHelp: false, error: '',
  });
}

/** Which step the wizard is on (router guard uses this). */
export function currentStep() { return wizard.step; }

function clearCinematic() {
  cinematicTimers.forEach(clearTimeout);
  cinematicTimers = [];
  cinematicIntervals.forEach(clearInterval);
  cinematicIntervals = [];
  if (skipHandler) {
    document.removeEventListener('keydown', skipHandler);
    skipHandler = null;
  }
}

/** Advance to a step with a sound cue. */
function goTo(step, sound = 'select') {
  wizard.step = step;
  // Leaving the identity step always releases the submit guard; otherwise
  // Back → Continue would meet a dead button.
  if (step !== 1) identityBusy = false;
  sfx[sound]?.();
  navigate('/onboarding');
}

/* ------------------------------------------------------------------- render */

/**
 * Render the onboarding flow.
 * @param {HTMLElement} root
 */
export function render(root) {
  const view = h('div.view.view--onboarding');
  const steps = {
    0: stepSplash,
    1: stepIdentity,
    2: stepAppearance,
    3: stepStarter,
    4: stepLaunch,
  };
  const step = steps[wizard.step] || stepSplash;
  view.classList.add(`is-step-${wizard.step}`);
  view.appendChild(step());
  renderInto(root, view);

  const entering = lastStep !== wizard.step;
  lastStep = wizard.step;

  // Focus management, but only on ENTRY. A re-render of the same step (the
  // help box, a validation update) must never yank the caret out of the field
  // the player is typing in.
  if (entering && wizard.step === 1) setTimeout(() => document.querySelector('#tamer-name')?.focus(), 60);
  // The title screen has exactly one affordance: put the keyboard on it.
  if (entering && wizard.step === 0) setTimeout(() => document.querySelector('.splash__start')?.focus?.({ preventScroll: true }), 320);
  if (pendingSelector) {
    document.querySelector(pendingSelector)?.focus?.({ preventScroll: true });
    pendingSelector = null;
  }
  if (pendingFocus) {
    const [group, optId] = pendingFocus.split(':');
    const el = document.querySelector(`.opt[data-group="${group}"][data-opt="${optId}"]`);
    el?.focus?.({ preventScroll: true });
    // jsdom (and some older engines) do not implement scrollIntoView.
    if (typeof el?.scrollIntoView === 'function') {
      try { el.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
    }
    pendingFocus = null;
  }
  if (justChanged) {
    // Sparks fire once per accepted change, then the flag clears itself.
    requestAnimationFrame(() => emitSparks());
    setTimeout(() => { justChanged = false; }, 520);
  }
}

/* -------------------------------------------------------------- 0. splash */

function stepSplash() {
  return h('div.splash', [
    h('div.splash__sky'),
    h('div.splash__beam', { 'aria-hidden': 'true' }),
    h('div.splash__vignette', { 'aria-hidden': 'true' }),
    h('div.splash__logo', { html: bigLogo() }),
    h('h1.splash__title', 'DigiPoke'),
    h('p.splash__tagline', 'Raise, battle and evolve digital life — entirely on your device.'),
    // The starters are the promise of the game, so they get a pedestal each
    // and their names — a title screen should introduce the cast, not just
    // show a logo.
    h('div.splash__creatures', STARTER_IDS.map((id, i) => {
      const species = getSpecies(id);
      return h(`div.splash__creature.splash__creature--${i}`, [
        h('div.splash__creature-art', {
          html: portraitMarkup(species.art, { size: 124, mood: 'idle', platform: true }),
        }),
        h('div.splash__creature-name', species.name),
        h('div.splash__creature-type', species.types.join(' · ')),
      ]);
    })),
    h('button.btn.btn--primary.btn--xl.splash__start.is-ready', {
      type: 'button',
      onclick: () => {
        unlockAudio();
        setSoundEnabled(true);
        const s = state.isReady() ? state.getState() : null;
        if (s?.settings) {
          setSfxVolume(s.settings.sfxVolume ?? 0.7);
          setMusicVolume(s.settings.musicVolume ?? 0.35);
        }
        sfx.boot();
        startMusic('menu');
        goTo(1, 'confirm');
      },
    }, 'Press Start'),
    h('div.splash__meta', [
      badge('Works offline', { kind: 'ok' }),
      badge('No account needed', { kind: 'neutral' }),
      badge('Your data stays here', { kind: 'neutral' }),
    ]),
    h('p.splash__keys', { html: 'Press <kbd>Enter</kbd> or tap to begin' }),
    h('p.splash__hint', 'Tip: sound is synthesised live — switch it off any time in Settings.'),
  ]);
}

/** Large animated wordmark. */
function bigLogo() {
  return `<svg width="148" height="148" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="lgA" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7c5cff"/><stop offset="55%" stop-color="#4a7cff"/><stop offset="100%" stop-color="#23d5ff"/>
      </linearGradient>
    </defs>
    <g class="logo-spin">
      <circle cx="60" cy="60" r="52" fill="none" stroke="url(#lgA)" stroke-width="2" opacity="0.5" stroke-dasharray="6 10"/>
      <circle cx="60" cy="60" r="42" fill="none" stroke="url(#lgA)" stroke-width="1.4" opacity="0.28"/>
    </g>
    <path d="M60 16 L96 36 V76 L60 96 L24 76 V36 Z" fill="rgba(124,92,255,0.14)" stroke="url(#lgA)" stroke-width="4" stroke-linejoin="round"/>
    <path class="logo-pulse" d="M60 30 L84 44 V70 L60 84 L36 70 V44 Z" fill="url(#lgA)" opacity="0.28"/>
    <ellipse cx="48" cy="56" rx="8" ry="10" fill="#0b1020"/>
    <ellipse cx="72" cy="56" rx="8" ry="10" fill="#0b1020"/>
    <circle cx="50.5" cy="52" r="3" fill="#7fdcff"/>
    <circle cx="74.5" cy="52" r="3" fill="#7fdcff"/>
    <circle class="logo-core" cx="60" cy="70" r="8" fill="#23d5ff"/>
  </svg>`;
}

/** Local sprite helper (kept thin: components already re-export it). */
function requireSprite(art, opts) { return spriteMarkup(art, opts); }

/* ------------------------------------------------------------ 1. identity */

/**
 * A stable, human-friendly Tamer ID derived from the name itself.
 *
 * The card has to feel like it belongs to *this* player the moment they type,
 * so the number is a deterministic hash of the name rather than a random
 * value — it changes as they type and then settles, which reads as the system
 * recognising them.
 *
 * @param {string} name
 * @returns {string} e.g. "DP-4F92"
 */
function tamerId(name) {
  const clean = name.trim().toUpperCase();
  if (!clean) return 'DP-····';
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `DP-${hash.toString(16).toUpperCase().padStart(8, '0').slice(-4)}`;
}

/**
 * Requirements the player must satisfy to continue. Rendered as a checklist
 * that ticks itself off as they type, so a disabled button is never a mystery.
 */
const IDENTITY_RULES = [
  { id: 'name', label: 'A name — 2 characters or more', test: () => wizard.displayName.trim().length >= 2 },
  { id: 'pass', label: 'A vault passphrase — 8 characters or more', test: () => wizard.passphrase.length >= 8 },
  { id: 'match', label: 'Both passphrases identical', test: () => wizard.passphrase.length >= 8 && wizard.passphrase === wizard.confirm },
];

/** Guards against double-submits while the vault key is being derived. */
let identityBusy = false;

/** Move focus to the next field — Enter should walk the form, not submit it. */
const focusField = (selector) => document.querySelector(selector)?.focus();

/** Yield to the browser so a busy state is painted before we block on PBKDF2. */
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function stepIdentity() {
  const idValue = h('span.idcard__id-value', tamerId(wizard.displayName));
  const idRow = h('div.idcard__id', [
    h('span.idcard__id-label', 'Tamer ID'),
    idValue,
  ]);

  const preview = h('div.idcard', [
    h('div.idcard__frame', tamerEl(wizard.tamer, { size: 168, mood: 'happy' })),
    h('div.idcard__body', [
      h('div.idcard__label', 'Tamer'),
      h('div.idcard__name', wizard.displayName.trim() || 'Unnamed'),
      idRow,
      h('div.idcard__row', [
        badge(wizard.displayName.trim() ? 'Provisional licence' : 'Awaiting name', {
          kind: wizard.displayName.trim() ? 'primary' : 'muted',
        }),
      ]),
    ]),
  ]);

  const nameError = h('p.form-error#name-error', { role: 'alert' }, wizard.error);
  const counter = h('span.field__counter', `${wizard.displayName.length}/18`);

  const nameInput = h('input.input.input--lg#tamer-name', {
    type: 'text',
    value: wizard.displayName,
    placeholder: 'e.g. Ada',
    maxLength: 18,
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'words',
    'aria-describedby': 'name-error',
    'aria-invalid': wizard.error ? 'true' : 'false',
    oninput: (e) => {
      const cleaned = e.target.value.replace(/[^A-Za-z0-9 '\-]/g, '');
      e.target.value = cleaned;
      wizard.displayName = cleaned;
      if (wizard.error) { wizard.error = ''; nameError.textContent = ''; e.target.setAttribute('aria-invalid', 'false'); }
      counter.textContent = `${cleaned.length}/18`;
      sfx.type();
      refreshName(idValue);
      syncValidity();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); focusField('#tamer-pass'); }
    },
    onblur: () => {
      const value = wizard.displayName.trim();
      if (value.length === 1) {
        wizard.error = 'Just one more character — names need at least two.';
        nameError.textContent = wizard.error;
        nameInput.setAttribute('aria-invalid', 'true');
      }
    },
  });

  const strength = h('div.pass-strength', h('div.pass-strength__fill'));
  const strengthLabel = h('span.pass-strength__label', { 'aria-live': 'polite' }, '');

  const passInput = h('input.input#tamer-pass', {
    type: 'password',
    value: wizard.passphrase,
    placeholder: 'At least 8 characters',
    maxLength: 128,
    autocomplete: 'new-password',
    spellcheck: 'false',
    oninput: (e) => { wizard.passphrase = e.target.value; sfx.type(); updateStrength(); syncValidity(); },
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); focusField('#tamer-pass2'); }
    },
  });

  const confirmInput = h('input.input#tamer-pass2', {
    type: 'password',
    value: wizard.confirm,
    placeholder: 'Repeat passphrase',
    maxLength: 128,
    autocomplete: 'new-password',
    spellcheck: 'false',
    oninput: (e) => { wizard.confirm = e.target.value; sfx.type(); syncValidity(); },
    onkeydown: (e) => { if (e.key === 'Enter' && !nextBtn.disabled) submitIdentity(nextBtn); },
  });

  function updateStrength() {
    const p = wizard.passphrase;
    let score = 0;
    if (p.length >= 8) score += 1;
    if (p.length >= 12) score += 1;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score += 1;
    if (/[0-9]/.test(p) || /[^A-Za-z0-9]/.test(p)) score += 1;
    const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
    // Looked up live, not captured: this step can re-render underneath us
    // (the help box, a Back navigation) and a captured node would quietly
    // detach, leaving a meter that never moves again.
    const meter = document.querySelector('.pass-strength');
    const label = document.querySelector('.pass-strength__label');
    if (meter) {
      const fill = meter.querySelector('.pass-strength__fill');
      if (fill) fill.style.width = `${(score / 4) * 100}%`;
      meter.dataset.score = String(score);
    }
    if (label) {
      label.textContent = p ? labels[score] : '';
      label.style.color = ['var(--danger)', 'var(--danger)', 'var(--warn)', '#9ae66e', 'var(--ok)'][score];
    }
  }

  /** Live-update the ID card without re-rendering (keeps the caret in place). */
  function refreshName(idEl) {
    const target = idEl || idValue;
    const nameEl = document.querySelector('.idcard__name');
    if (nameEl) nameEl.textContent = wizard.displayName.trim() || 'Unnamed';
    const next = tamerId(wizard.displayName);
    if (target.textContent !== next) {
      target.textContent = next;
      // Replay the flicker so the number reads as "recalculating".
      target.classList.remove('is-rolling');
      void target.offsetWidth;
      target.classList.add('is-rolling');
    }
    const badgeEl = document.querySelector('.idcard__row');
    if (badgeEl) {
      badgeEl.replaceChildren(badge(wizard.displayName.trim() ? 'Provisional licence' : 'Awaiting name', {
        kind: wizard.displayName.trim() ? 'primary' : 'muted',
      }));
    }
  }

  // Checklist rows; ticked live so the Continue button is never a dead end.
  const doneRules = new Set();
  const checklist = h('ul.checklist', IDENTITY_RULES.map((rule) => h(`li.checklist__item#check-${rule.id}`, [
    h('span.checklist__mark', { 'aria-hidden': 'true' }, ''),
    h('span.checklist__label', rule.label),
  ])));

  const nextBtn = h('button.btn.btn--primary.btn--lg#identity-next', {
    type: 'button',
    disabled: true,
    onclick: () => submitIdentity(nextBtn),
  }, 'Continue');

  const form = h('div.identity-form', [
    h('label.field', [
      h('span.field__label', [h('span', 'Display name'), counter]),
      nameInput,
      nameError,
    ]),
    h('label.field', [
      h('span.field__label', 'Vault passphrase'),
      passInput,
      h('div.pass-strength-row', [strength, strengthLabel]),
    ]),
    h('label.field', [h('span.field__label', 'Confirm passphrase'), confirmInput]),
  ]);

  /**
   * Re-evaluate the rules in place. Called on every keystroke: no re-render,
   * so focus and caret position survive.
   */
  function syncValidity() {
    let all = true;
    for (const rule of IDENTITY_RULES) {
      const ok = rule.test();
      const el = document.getElementById(`check-${rule.id}`);
      if (el) {
        el.classList.toggle('is-done', ok);
        const mark = el.querySelector('.checklist__mark');
        if (mark) mark.textContent = ok ? '✓' : '';
      }
      if (ok && !doneRules.has(rule.id)) {
        doneRules.add(rule.id);
        sfx.xp(); // a soft tick: something was just earned
      } else if (!ok) {
        doneRules.delete(rule.id);
      }
      if (!ok) all = false;
    }
    const button = document.querySelector('#identity-next') || nextBtn;
    button.disabled = !all;
    button.classList.toggle('is-ready', all);
    // Even a disabled button should say what it is waiting for.
    button.title = all
      ? 'Continue to appearance'
      : `Still needed: ${IDENTITY_RULES.filter((r) => !r.test()).map((r) => r.label.split('—')[0].trim().toLowerCase()).join(', ')}`;
  }

  const view = h('div.creator', [
    h('div.creator__head', [
      h('h2.creator__title', 'Create your Tamer'),
      h('p.muted', 'Step 1 of 3 · Identity'),
    ]),
    h('div.creator__grid', [
      h('div.creator__preview', [
        preview,
        h('p.muted.muted--sm', 'Your portrait is generated live — you can restyle it next.'),
      ]),
      card(null,
        form,
        checklist,
        h('button.btn.btn--ghost.btn--sm.help-toggle', {
          type: 'button',
          'aria-expanded': wizard.showHelp ? 'true' : 'false',
          onclick: () => {
            wizard.showHelp = !wizard.showHelp;
            pendingSelector = '.help-toggle'; // the step re-renders; keep the caret there
            sfx.toggle();
            navigate('/onboarding');
          },
        }, wizard.showHelp ? 'Hide explanation' : 'Why do I need a passphrase?'),
        wizard.showHelp ? h('div.helpbox', [
          h('p', 'DigiPoke is local-first: your save lives in this browser, not on our servers.'),
          h('p', 'The passphrase encrypts your backups and any optional cloud sync. It is never stored or sent — which also means ',
            h('strong', 'we cannot reset it'), ' if you forget it.'),
          h('p.muted', 'Write it down somewhere safe, then continue.'),
        ]) : null,
        h('div.row.row--between', [
          h('button.btn.btn--ghost', { type: 'button', onclick: () => goTo(0, 'back') }, 'Back'),
          nextBtn,
        ]),
      ),
    ]),
  ]);

  // Prime the checklist and button from any state restored by a re-render.
  requestAnimationFrame(() => {
    updateStrength();
    doneRules.clear();
    for (const rule of IDENTITY_RULES) if (rule.test()) doneRules.add(rule.id);
    syncValidity();
  });

  return view;
}

/**
 * Derive the vault key and advance.
 *
 * The click must feel instant, so: cue the sound and paint the busy state
 * *first*, yield to the browser, and only then run PBKDF2 — which blocks the
 * main thread for a few hundred milliseconds on a phone.
 *
 * @param {HTMLButtonElement} button
 */
async function submitIdentity(button) {
  if (identityBusy) return;
  const name = wizard.displayName.trim();

  if (name.length < 2) {
    wizard.error = 'Please enter at least 2 characters.';
    sfx.error();
    const err = document.querySelector('#name-error');
    if (err) err.textContent = wizard.error;
    const input = document.querySelector('#tamer-name');
    input?.setAttribute('aria-invalid', 'true');
    input?.classList.add('is-shake');
    setTimeout(() => input?.classList.remove('is-shake'), 420);
    input?.focus();
    return;
  }
  if (wizard.passphrase.length < 8) return toast('Passphrase must be at least 8 characters.', 'error');
  if (wizard.passphrase !== wizard.confirm) return toast('Passphrases do not match.', 'error');

  identityBusy = true;
  sfx.confirm(); // immediate acknowledgement — never leave a click unanswered
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(h('span.spinner', { 'aria-hidden': 'true' }), h('span', 'Securing your vault…'));
  }
  document.querySelectorAll('#tamer-name, #tamer-pass, #tamer-pass2').forEach((el) => { el.readOnly = true; });

  await nextPaint();

  try {
    const salt = newSalt();
    const key = await deriveVaultKey(wizard.passphrase, salt);
    const verifier = await makeVerifier(key);
    await db.kvSet('vault', { salt, verifier, createdAt: new Date().toISOString(), iterations: 250000 });
    // Cache the key for this session so encrypted export/sync need no re-prompt.
    (await import('../../sync/syncClient.js')).cacheVaultKey?.(key);
    sfx.reward();
    identityBusy = false;
    goTo(2, 'confirm');
  } catch (err) {
    console.error(err);
    identityBusy = false;
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.textContent = label || 'Continue';
    }
    document.querySelectorAll('#tamer-name, #tamer-pass, #tamer-pass2').forEach((el) => { el.readOnly = false; });
    toast(`Could not create the vault: ${err.message}`, 'error');
  }
}

/* ---------------------------------------------------------- 2. appearance */

/**
 * Transient preview state for the avatar editor.
 *
 * Hovering or focusing an option shows the player what it would look like
 * without committing to it. Because that must not disturb what they have
 * already chosen, the preview lives outside `wizard.tamer` and is discarded on
 * pointer-leave / blur.
 */
let previewTamer = null;
/** Which option is hovered / focused, as `group:optId`. */
let hoverOpt = null;
let focusOpt = null;

/** Option to re-focus after the next re-render (`group:optionId`). */
let pendingFocus = null;

/** Set when an option was just committed, so the stage can react. */
let justChanged = false;

/** Selector to re-focus after the next re-render (generic form of pendingFocus). */
let pendingSelector = null;

/** Last step that was mounted, so entry effects only fire on entry. */
let lastStep = null;

/**
 * Build one option group.
 *
 * @param {string} key TAMER_OPTIONS key (also the wizard.tamer key).
 * @param {string} label Group heading.
 * @param {object} ctx Shared step state: the live avatar element and caption.
 */
function groupUi(key, label, ctx) {
  const options = TAMER_OPTIONS[key];
  return h('div.opt-group', [
    h(`div.opt-group__label#grp-${key}`, label),
    h('div.opt-group__options', {
      role: 'radiogroup',
      'aria-labelledby': `grp-${key}`,
    }, options.map((opt, index) => h(
      `button.opt${wizard.tamer[key] === opt.id ? '.is-active' : ''}${opt.hex ? '.opt--color' : ''}`,
      {
        type: 'button',
        title: opt.name,
        'aria-checked': wizard.tamer[key] === opt.id ? 'true' : 'false',
        'aria-label': `${label}: ${opt.name}`,
        role: 'radio',
        // Roving tabindex: one stop per group, arrows move within it. Tab
        // through 42 swatches would be hostile.
        tabindex: wizard.tamer[key] === opt.id ? '0' : '-1',
        dataset: { group: key, opt: opt.id, index: String(index) },
        style: opt.hex ? { '--swatch': opt.hex } : {},
        // Preview on hover/focus so choosing is exploratory rather than blind.
        onpointerenter: () => showPreview(key, opt.id),
        onpointerleave: () => clearPreview(),
        onfocus: () => focusPreview(key, opt.id),
        onblur: () => blurPreview(),
        onkeydown: (e) => arrowNav(e, key, index, options.length),
        onclick: () => commitOption(key, opt.id),
      },
      opt.hex ? '' : opt.name,
    ))),
  ]);
}

/**
 * Recompute the preview from the hover and focus slots. Either one can drive
 * it; the committed look returns only when both are empty.
 */
function updatePreview(source) {
  const selection = hoverOpt || focusOpt;
  if (!selection) {
    if (!previewTamer) return;
    previewTamer = null;
    paintAvatar(wizard.tamer, { preview: false });
    return;
  }
  const [group, optId] = selection.split(':');
  const next = { ...wizard.tamer, [group]: optId };
  if (previewTamer && previewTamer[group] === optId) return;
  previewTamer = next;
  paintAvatar(next, { caption: captionFor(group, optId), preview: true });
  // Only the pointer gets a hover tick; the global handler already covers it.
  if (source === 'pointer') sfx.hover();
}

/** Pointer entered an option — preview it. */
function showPreview(group, optId) {
  hoverOpt = `${group}:${optId}`;
  updatePreview('pointer');
}

/** Pointer left an option — fall back to focus, if any. */
function clearPreview() {
  hoverOpt = null;
  updatePreview('focus');
}

/** Keyboard focus entered an option — preview it. */
function focusPreview(group, optId) {
  focusOpt = `${group}:${optId}`;
  updatePreview('focus');
}

/** Keyboard focus left an option. */
function blurPreview() {
  focusOpt = null;
  updatePreview('pointer');
}

/** Human-readable caption for the option under the cursor. */
function captionFor(group, optId) {
  const opt = (TAMER_OPTIONS[group] || []).find((o) => o.id === optId);
  return opt ? opt.name : '';
}

/**
 * Redraw the stage avatar in place (no re-render, no focus loss).
 * @param {object} tamer
 * @param {{caption?:string, preview?:boolean}} [opts]
 */
function paintAvatar(tamer, { caption = '', preview = false } = {}) {
  const host = document.querySelector('.stage__avatar');
  if (host) {
    host.replaceChildren(tamerEl(tamer, { size: 230, mood: 'happy' }));
    host.classList.toggle('is-preview', preview);
  }
  const cap = document.querySelector('.stage__caption');
  if (cap) {
    const idle = wizard.displayName.trim() ? wizard.displayName.trim() : 'Your Tamer';
    cap.textContent = caption || (preview ? '' : idle);
    cap.classList.toggle('is-visible', Boolean(caption));
  }
}

/** Arrow-key navigation inside an option group (roving with real focus). */
function arrowNav(e, group, index, count) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const step = keys[e.key];
  if (!step) return;
  e.preventDefault();
  const next = (index + step + count) % count;
  const target = document.querySelector(`.opt[data-group="${group}"][data-index="${next}"]`);
  if (target) { target.focus(); sfx.hover(); }
}

/** Commit an option: remember focus, animate, re-render. */
function commitOption(group, optId) {
  if (wizard.tamer[group] === optId) { sfx.select(); return; }
  wizard.tamer = { ...wizard.tamer, [group]: optId };
  previewTamer = null;
  hoverOpt = null;
  justChanged = true;
  pendingFocus = `${group}:${optId}`;
  sfx.select();
  navigate('/onboarding');
}

/**
 * A burst of sparks on the pedestal whenever the player accepts a change.
 * Purely decorative, pointer-events: none, and cleaned up after it plays.
 */
function emitSparks() {
  const host = document.querySelector('.stage__sparks');
  if (!host) return;
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
    const dist = 70 + Math.random() * 60;
    const spark = h('span.spark', {
      style: {
        '--sx': `${Math.cos(angle) * dist}px`,
        '--sy': `${Math.sin(angle) * dist}px`,
        '--sd': `${Math.round(Math.random() * 120)}ms`,
        background: i % 3 === 0 ? 'var(--accent-2)' : 'var(--accent)',
      },
    });
    host.appendChild(spark);
    setTimeout(() => spark.remove(), 900);
  }
  const avatar = document.querySelector('.stage__avatar');
  if (avatar) {
    avatar.classList.remove('is-pop');
    void avatar.offsetWidth;
    avatar.classList.add('is-pop');
  }
}

function stepAppearance() {
  const ctx = {};
  const stage = h('div.stage', [
    h('div.stage__ring'),
    h('div.stage__sparks', { 'aria-hidden': 'true' }),
    h('div.stage__avatar', tamerEl(wizard.tamer, { size: 230, mood: 'happy' })),
    h('p.stage__caption', 'Your Tamer'),
  ]);
  if (justChanged) stage.classList.add('is-pop');

  return h('div.creator', [
    h('div.creator__head', [
      h('h2.creator__title', 'Design your Tamer'),
      h('p.muted', 'Step 2 of 3 · Appearance'),
    ]),
    h('div.creator__grid', [
      h('div.creator__preview', [
        stage,
        h('p.muted.muted--sm', `${combinationCount().toLocaleString('en-GB')} possible Tamers — none of them stored anywhere but here.`),
      ]),
      card(null,
        groupUi('skin', 'Skin tone', ctx),
        groupUi('hairStyle', 'Hair style', ctx),
        groupUi('hairColor', 'Hair colour', ctx),
        groupUi('outfit', 'Outfit', ctx),
        groupUi('accessory', 'Accessory', ctx),
        groupUi('eyes', 'Expression', ctx),
        h('div.row.row--between', [
          h('button.btn.btn--ghost', { type: 'button', onclick: () => goTo(1, 'back') }, 'Back'),
          h('div.row', [
            h('button.btn.btn--ghost', {
              type: 'button',
              onclick: () => {
                wizard.tamer = randomTamer(createRng(Date.now() >>> 0).next);
                previewTamer = null;
                hoverOpt = null;
                focusOpt = null;
                justChanged = true;
                sfx.confirm();
                navigate('/onboarding');
              },
            }, '🎲 Surprise me'),
            h('button.btn.btn--primary.btn--lg', { type: 'button', onclick: () => goTo(3, 'confirm') }, 'Continue'),
          ]),
        ]),
      ),
    ]),
  ]);
}
/* ------------------------------------------------------------- 3. partner */

/**
 * Playstyle summary derived from the species' base stats.
 *
 * Three cards with near-identical numbers tell the player nothing; a single
 * word ("Hard hitter", "Sturdy", "Swift") is what actually drives the choice.
 *
 * @param {object} species
 * @returns {string}
 */
function playstyleTag(species) {
  const { atk, def, spd, hp } = species.base;
  // HP lives on a different scale to the other three (roughly 1.55x), so it is
  // normalised before comparison — otherwise every species reads as "Tough".
  const scores = [
    { key: 'atk', value: atk, label: 'Hard hitter' },
    { key: 'def', value: def, label: 'Sturdy' },
    { key: 'spd', value: spd, label: 'Swift' },
    { key: 'hp', value: hp / 1.55, label: 'Tough' },
  ].sort((a, b) => b.value - a.value);
  // Within a few points of each other there is no honest speciality.
  if (scores[0].value - scores[scores.length - 1].value <= 6) return 'All-rounder';
  return scores[0].label;
}

/**
 * Stat row for the partner showcase.
 *
 * The bar compares *natural strength* (base stats, normalised into a readable
 * band) rather than the level-5 number, because that is what differs between
 * the three starters. The trailing figure is where the stat lands at level 50,
 * so the player can see what they are growing into.
 */
function partnerStat(label, value, base, potential, color) {
  const scaled = Math.max(6, Math.min(100, ((base - 28) / 30) * 100));
  // Start empty and grow on the next frame: the bar is the first thing the eye
  // lands on, so it has to move rather than simply appear.
  const fill = h('div.bar__fill', { style: { background: color, width: '0%' } });
  requestAnimationFrame(() => { fill.style.width = `${scaled}%`; });
  return h('div.stat-row.partner__stat', [
    h('div.stat-row__head', [
      h('span.stat-row__label', label),
      h('span.stat-row__value', String(value)),
    ]),
    h('div.bar.bar--stat', fill),
    h('span.stat-row__potential', `→ ${potential} at Lv 50`),
  ]);
}

function stepStarter() {
  const selected = getSpecies(wizard.starter);
  const CORES = { hp: 8, atk: 8, def: 8, spd: 8 };
  const previewStats = statsFor({ speciesId: wizard.starter, level: 5, cores: CORES });
  const ceiling = statsFor({ speciesId: wizard.starter, level: 50, cores: { hp: 15, atk: 15, def: 15, spd: 15 } });
  const moves = movesAtLevel({ speciesId: wizard.starter, level: 5, moves: [], cores: CORES });
  const upcoming = (learnsetFor(wizard.starter) || []).filter((m) => m.level > 5).slice(0, 2);

  const cards = STARTER_IDS.map((id) => {
    const species = getSpecies(id);
    const active = wizard.starter === id;
    return h(`button.starter-card${active ? '.is-selected' : ''}`, {
      type: 'button',
      'aria-pressed': active ? 'true' : 'false',
      dataset: { type: species.types[0] },
      onclick: () => {
        if (wizard.starter === id) return;
        wizard.starter = id;
        sfx.select();
        navigate('/onboarding');
      },
      onpointerenter: () => sfx.hover(),
    }, [
      h('div.starter-card__art', active
        ? portraitEl(id, { size: 150, mood: 'happy' })
        : spriteEl(id, { size: 96 })),
      h('div.starter-card__name', species.name),
      h('div.starter-card__tag', playstyleTag(species)),
      typeRow(species.types, { small: true }),
    ]);
  });

  return h('div.creator', [
    h('div.creator__head', [
      h('h2.creator__title', 'Choose your first partner'),
      h('p.muted', 'Step 3 of 3 · Partner'),
    ]),
    h('div.starter-grid', cards),
    card(null,
      sectionHead(selected.name, [
        badge(playstyleTag(selected), { kind: 'primary' }),
        typeRow(selected.types),
      ]),
      h('div.partner', [
        h('div.partner__art', portraitEl(wizard.starter, { size: 200, mood: 'happy' })),
        h('div.partner__info', [
          h('p.partner__lore', selected.lore),
          h('div.partner__stats', [
            partnerStat('HP', previewStats.hp, selected.base.hp, ceiling.hp, '#4fd67c'),
            partnerStat('ATK', previewStats.atk, selected.base.atk, ceiling.atk, '#ff6b6b'),
            partnerStat('DEF', previewStats.def, selected.base.def, ceiling.def, '#3db4ff'),
            partnerStat('SPD', previewStats.spd, selected.base.spd, ceiling.spd, '#ffd93d'),
          ]),
          h('p.partner__legend', 'Bars compare natural strength · the arrow is the level 50 ceiling'),
          h('div.partner__moves', [
            h('span.pill.pill--label', 'Starts with'),
            ...moves.map((id) => {
              const m = getMove(id);
              return h('span.pill', `${m.name}${m.power ? ` · ${m.power}` : ''}`);
            }),
            ...upcoming.map((entry) => {
              const m = getMove(entry.move);
              return h('span.pill.pill--next', `${m.name} · Lv ${entry.level}`);
            }),
          ]),
          h('p.muted.muted--sm', `Evolves into ${getSpecies(selected.evolve.to).name} at level ${selected.evolve.level}.`),
        ]),
      ]),
      h('div.row.row--between', [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => goTo(2, 'back') }, 'Back'),
        h('button.btn.btn--primary.btn--lg#choose-partner', {
          type: 'button',
          onclick: () => confirmStarter(),
        }, `Choose ${selected.name}`),
      ]),
    ),
  ]);
}

async function confirmStarter() {
  const species = getSpecies(wizard.starter);
  sfx.open();
  const ok = await confirmDialog({
    title: `Partner with ${species.name}?`,
    message: `${species.name} will join you at level 5 — ${playstyleTag(species).toLowerCase()}, and ready to grow. You can catch more partners immediately; this choice just starts your journey.`,
    confirmLabel: `Yes, choose ${species.name}`,
    cancelLabel: 'Let me reconsider',
  });
  if (!ok) { sfx.back(); return; }
  await finishOnboarding();
}

/* -------------------------------------------------------------- 4. launch */

async function finishOnboarding() {
  try {
    await state.createProfile({
      displayName: wizard.displayName.trim(),
      starterId: wizard.starter,
      tamer: { ...wizard.tamer },
    });
    sfx.digitise();
    goTo(4, 'confirm');
  } catch (err) {
    console.error(err);
    toast(`Could not create your profile: ${err.message}`, 'error');
  }
}

function stepLaunch() {
  const lines = [
    'Allocating digital genome…',
    'Seeding elemental lattice…',
    'Bonding Tamer signature…',
    'Welcome to the Nexus.',
  ];
  const name = wizard.displayName.trim() || 'Tamer';
  const species = getSpecies(wizard.starter);
  const total = lines.length * 520;

  const lineEl = h('p.launch__line', { 'aria-live': 'polite' }, lines[0]);
  const fill = h('div.launch__fill');
  const bar = h('div.launch__bar', {
    role: 'progressbar', 'aria-label': 'Digitising your Tamer',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  }, fill);
  const pctEl = h('p.launch__pct', '0%');

  clearCinematic();
  let done = false;

  /** Jump straight to the end — a cinematic must never trap the player. */
  const finish = () => {
    if (done) return;
    done = true;
    clearCinematic();
    fill.style.width = '100%';
    pctEl.textContent = '100%';
    bar.setAttribute('aria-valuenow', '100');
    lineEl.textContent = lines[lines.length - 1];
    sfx.victory();
    toast(`Welcome, ${name}. ${species.name} is eager to begin.`, 'success', 4200);
    navigate('/');
  };

  lines.slice(1).forEach((text, i) => {
    cinematicTimers.push(setTimeout(() => {
      lineEl.textContent = text;
      lineEl.classList.remove('is-fresh');
      void lineEl.offsetWidth;
      lineEl.classList.add('is-fresh');
      sfx.notify();
    }, (i + 1) * 520));
  });

  // Drive the bar from the clock so the number and the fill never disagree.
  const started = Date.now();
  const tick = setInterval(() => {
    const progress = Math.min(1, (Date.now() - started) / total);
    fill.style.width = `${progress * 100}%`;
    pctEl.textContent = `${Math.round(progress * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    if (progress >= 1) clearInterval(tick);
  }, 60);
  cinematicIntervals.push(tick);
  cinematicTimers.push(setTimeout(finish, total + 260));

  // Skipping must work from anywhere, without making the whole screen a
  // focusable control that screen readers have to announce.
  skipHandler = (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
  };
  document.addEventListener('keydown', skipHandler);

  const view = h('div.launch', {
    onclick: finish,
    role: 'status',
    'aria-label': 'Digitising your Tamer',
  }, [
    h('div.launch__avatar', tamerEl(wizard.tamer, { size: 132, mood: 'determined' })),
    h('h2.launch__title', 'Digitising your Tamer'),
    lineEl,
    bar,
    pctEl,
    h('div.launch__partner', [
      spriteEl(wizard.starter, { size: 84, mood: 'happy' }),
      h('span', `${species.name} has joined your team.`),
    ]),
    h('p.launch__skip', 'Tap or press Enter to skip'),
  ]);
  return view;
}
/* -------------------------------------------------------------- 4. launch */

export const meta = { title: 'Welcome' };
