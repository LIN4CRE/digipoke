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
import { sprite as spriteMarkup } from '../sprite.js';
import { STARTER_IDS, getSpecies } from '../../domain/species.js';
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

/** Reset the wizard (used when a profile is wiped). */
export function resetOnboarding() {
  clearCinematic();
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
}

/** Advance to a step with a sound cue. */
function goTo(step, sound = 'select') {
  wizard.step = step;
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

  // Focus management: put the caret in the first field of text-entry steps.
  if (wizard.step === 1) setTimeout(() => document.querySelector('#tamer-name')?.focus(), 60);
}

/* -------------------------------------------------------------- 0. splash */

function stepSplash() {
  return h('div.splash', [
    h('div.splash__sky'),
    h('div.splash__logo', { html: bigLogo() }),
    h('h1.splash__title', 'DigiPoke'),
    h('p.splash__tagline', 'Raise, battle and evolve digital life — entirely on your device.'),
    h('div.splash__creatures', STARTER_IDS.map((id, i) => h(`div.splash__creature.splash__creature--${i}`, {
      html: requireSprite(getSpecies(id).art, { size: 78, mood: 'idle' }),
    }))),
    h('button.btn.btn--primary.btn--xl.splash__start', {
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

function stepIdentity() {
  const preview = h('div.idcard', [
    h('div.idcard__frame', tamerEl(wizard.tamer, { size: 168, mood: 'happy' })),
    h('div.idcard__body', [
      h('div.idcard__label', 'Tamer'),
      h('div.idcard__name', wizard.displayName.trim() || 'Unnamed'),
      h('div.idcard__row', [
        badge(wizard.displayName.trim() ? 'ID pending' : 'Awaiting name', { kind: wizard.displayName.trim() ? 'primary' : 'muted' }),
      ]),
    ]),
  ]);

  const nameInput = h('input.input.input--lg#tamer-name', {
    type: 'text', value: wizard.displayName, placeholder: 'e.g. Ada', maxLength: 18,
    spellcheck: 'false', autocomplete: 'off',
    oninput: (e) => {
      const cleaned = e.target.value.replace(/[^A-Za-z0-9 '\-]/g, '');
      e.target.value = cleaned;
      wizard.displayName = cleaned;
      wizard.error = '';
      sfx.type();
      refreshName();
    },
  });

  const nameError = h('p.form-error', wizard.error);

  const passInput = h('input.input', {
    type: 'password', value: wizard.passphrase, placeholder: 'At least 8 characters', maxLength: 128,
    oninput: (e) => { wizard.passphrase = e.target.value; sfx.type(); updateStrength(); },
  });
  const confirmInput = h('input.input', {
    type: 'password', value: wizard.confirm, placeholder: 'Repeat passphrase', maxLength: 128,
    oninput: (e) => { wizard.confirm = e.target.value; sfx.type(); },
    onkeydown: (e) => { if (e.key === 'Enter') submitIdentity(); },
  });

  const strength = h('div.pass-strength', h('div.pass-strength__fill'));
  const strengthLabel = h('span.pass-strength__label', '');

  function updateStrength() {
    const p = wizard.passphrase;
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/[0-9]/.test(p) || /[^A-Za-z0-9]/.test(p)) score++;
    const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
    strength.querySelector('.pass-strength__fill').style.width = `${(score / 4) * 100}%`;
    strength.dataset.score = String(score);
    strengthLabel.textContent = p ? labels[score] : '';
    strengthLabel.style.color = ['var(--danger)', 'var(--danger)', 'var(--warn)', '#9ae66e', 'var(--ok)'][score];
  }

  function refreshName() {
    const nameEl = document.querySelector('.idcard__name');
    if (nameEl) nameEl.textContent = wizard.displayName.trim() || 'Unnamed';
    const badgeEl = document.querySelector('.idcard__row');
    if (badgeEl) {
      badgeEl.replaceChildren(badge(wizard.displayName.trim() ? 'ID pending' : 'Awaiting name', {
        kind: wizard.displayName.trim() ? 'primary' : 'muted',
      }));
    }
  }

  const canContinue = () => wizard.displayName.trim().length >= 2
    && wizard.passphrase.length >= 8
    && wizard.passphrase === wizard.confirm;

  return h('div.creator', [
    h('div.creator__head', [
      h('h2.creator__title', 'Create your Tamer'),
      h('p.muted', 'Step 1 of 3 · Identity'),
    ]),
    h('div.creator__grid', [
      h('div.creator__preview', [preview, h('p.muted.muted--sm', 'Your portrait is generated live — you can restyle it next.')]),
      card(null,
        h('label.field', [
          h('span.field__label', 'Display name'),
          nameInput,
          nameError,
        ]),
        h('label.field', [
          h('span.field__label', 'Vault passphrase'),
          passInput,
          h('div.pass-strength-row', [strength, strengthLabel]),
        ]),
        h('label.field', [h('span.field__label', 'Confirm passphrase'), confirmInput]),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: () => { wizard.showHelp = !wizard.showHelp; sfx.toggle(); navigate('/onboarding'); },
        }, wizard.showHelp ? 'Hide explanation' : 'Why do I need a passphrase?'),
        wizard.showHelp ? h('div.helpbox', [
          h('p', 'DigiPoke is local-first: your save lives in this browser, not on our servers.'),
          h('p', 'The passphrase encrypts your backups and any optional cloud sync. It is never stored or sent — which also means ',
            h('strong', 'we cannot reset it'), ' if you forget it.'),
          h('p.muted', 'Write it down somewhere safe, then continue.'),
        ]) : null,
        h('div.row.row--between', [
          h('button.btn.btn--ghost', { type: 'button', onclick: () => goTo(0, 'back') }, 'Back'),
          h('button.btn.btn--primary.btn--lg', {
            type: 'button',
            disabled: !canContinue(),
            onclick: () => submitIdentity(),
          }, 'Continue'),
        ]),
      ),
    ]),
  ]);
}

async function submitIdentity() {
  const name = wizard.displayName.trim();
  const pass = wizard.passphrase;
  if (name.length < 2) { wizard.error = 'Please enter at least 2 characters.'; sfx.error(); return navigate('/onboarding'); }
  if (pass.length < 8) return toast('Passphrase must be at least 8 characters.', 'error');
  if (pass !== wizard.confirm) return toast('Passphrases do not match.', 'error');

  try {
    const salt = newSalt();
    const key = await deriveVaultKey(pass, salt);
    const verifier = await makeVerifier(key);
    await db.kvSet('vault', { salt, verifier, createdAt: new Date().toISOString(), iterations: 250000 });
    // Cache the key for this session so encrypted export/sync need no re-prompt.
    (await import('../../sync/syncClient.js')).cacheVaultKey?.(key);
    goTo(2, 'confirm');
  } catch (err) {
    console.error(err);
    toast(`Could not create the vault: ${err.message}`, 'error');
  }
}

/* ---------------------------------------------------------- 2. appearance */

function stepAppearance() {
  // Each group key maps 1:1 onto both TAMER_OPTIONS and wizard.tamer.
  const groupUi = (key, label) => h('div.opt-group', [
    h('div.opt-group__label', label),
    h('div.opt-group__options', TAMER_OPTIONS[key].map((opt) => h(
      `button.opt${wizard.tamer[key] === opt.id ? '.is-active' : ''}${opt.hex ? '.opt--color' : ''}`,
      {
        type: 'button',
        title: opt.name,
        style: opt.hex ? { '--swatch': opt.hex } : {},
        onclick: () => { wizard.tamer[key] = opt.id; sfx.select(); navigate('/onboarding'); },
      },
      opt.hex ? '' : opt.name,
    ))),
  ]);

  return h('div.creator', [
    h('div.creator__head', [
      h('h2.creator__title', 'Design your Tamer'),
      h('p.muted', 'Step 2 of 3 · Appearance'),
    ]),
    h('div.creator__grid', [
      h('div.creator__preview', [
        h('div.stage', [
          h('div.stage__ring'),
          h('div.stage__avatar', tamerEl(wizard.tamer, { size: 230, mood: 'happy' })),
        ]),
        h('p.muted.muted--sm', `${combinationCount().toLocaleString('en-GB')} possible Tamers — none of them stored anywhere but here.`),
      ]),
      card(null,
        groupUi('skin', 'Skin tone'),
        groupUi('hairStyle', 'Hair style'),
        groupUi('hairColor', 'Hair colour'),
        groupUi('outfit', 'Outfit'),
        groupUi('accessory', 'Accessory'),
        groupUi('eyes', 'Expression'),
        h('div.row.row--between', [
          h('button.btn.btn--ghost', { type: 'button', onclick: () => goTo(1, 'back') }, 'Back'),
          h('div.row', [
            h('button.btn.btn--ghost', {
              type: 'button',
              onclick: () => {
                wizard.tamer = randomTamer(createRng(Date.now() >>> 0).next);
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

function stepStarter() {
  const selected = getSpecies(wizard.starter);
  const previewStats = statsFor({ speciesId: wizard.starter, level: 5, cores: { hp: 8, atk: 8, def: 8, spd: 8 } });
  const moves = movesAtLevel({ speciesId: wizard.starter, level: 5, moves: [], cores: { hp: 8, atk: 8, def: 8, spd: 8 } });

  const cards = STARTER_IDS.map((id) => {
    const species = getSpecies(id);
    const active = wizard.starter === id;
    return h(`button.starter-card${active ? '.is-selected' : ''}`, {
      type: 'button',
      onclick: () => { wizard.starter = id; sfx.select(); navigate('/onboarding'); },
      onmouseenter: () => sfx.hover(),
    }, [
      h('div.starter-card__art', active
        ? portraitEl(id, { size: 150, mood: 'happy' })
        : spriteEl(id, { size: 96 })),
      h('div.starter-card__name', species.name),
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
      sectionHead(selected.name, typeRow(selected.types)),
      h('div.partner', [
        h('div.partner__art', portraitEl(wizard.starter, { size: 200, mood: 'happy' })),
        h('div.partner__info', [
          h('p.partner__lore', selected.lore),
          h('div.partner__stats', [
            statBar('HP', previewStats.hp, 60, { color: '#4fd67c' }),
            statBar('ATK', previewStats.atk, 40, { color: '#ff6b6b' }),
            statBar('DEF', previewStats.def, 40, { color: '#3db4ff' }),
            statBar('SPD', previewStats.spd, 40, { color: '#ffd93d' }),
          ]),
          h('div.partner__moves', [
            h('span.pill', 'Starting moves'),
            ...moves.map((id) => {
              const m = getMove(id);
              return h('span.pill', `${m.name}${m.power ? ` · ${m.power}` : ''}`);
            }),
          ]),
          h('p.muted.muted--sm', `Evolves into ${getSpecies(selected.evolve.to).name} at level ${selected.evolve.level}.`),
        ]),
      ]),
      h('div.row.row--between', [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => goTo(2, 'back') }, 'Back'),
        h('button.btn.btn--primary.btn--lg', {
          type: 'button',
          onclick: () => confirmStarter(),
        }, `Choose ${selected.name}`),
      ]),
    ),
  ]);
}

async function confirmStarter() {
  const species = getSpecies(wizard.starter);
  const ok = await confirmDialog({
    title: `Partner with ${species.name}?`,
    message: `${species.name} will join you at level 5. You can catch more partners immediately — this choice just starts your journey.`,
    confirmLabel: `Yes, choose ${species.name}`,
    cancelLabel: 'Let me reconsider',
  });
  if (!ok) return;
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

  const lineEl = h('p.launch__line', lines[0]);
  const bar = h('div.launch__bar', h('div.launch__fill'));

  clearCinematic();
  lines.slice(1).forEach((text, i) => {
    cinematicTimers.push(setTimeout(() => {
      lineEl.textContent = text;
      sfx.notify();
    }, (i + 1) * 520));
  });
  const fill = bar.querySelector('.launch__fill');
  requestAnimationFrame(() => { fill.style.width = '100%'; });

  cinematicTimers.push(setTimeout(() => {
    stopMusic();
    startMusic('menu');
    sfx.victory();
    toast(`Welcome, ${name}. ${species.name} is eager to begin.`, 'success', 4200);
    navigate('/');
  }, lines.length * 520 + 320));

  return h('div.launch', [
    h('div.launch__avatar', tamerEl(wizard.tamer, { size: 132, mood: 'determined' })),
    h('h2.launch__title', 'Digitising your Tamer'),
    lineEl,
    bar,
    h('div.launch__partner', [
      spriteEl(wizard.starter, { size: 84, mood: 'happy' }),
      h('span', `${species.name} has joined your team.`),
    ]),
  ]);
}

export const meta = { title: 'Welcome' };
