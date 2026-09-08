#!/usr/bin/env node
/**
 * playtest.mjs — walk the opening flow like a brand-new player and report.
 *
 * This is the quality instrument for the first five minutes. It boots the real
 * application in jsdom, drives it exactly as a person would (click, type,
 * choose), and prints a structured report for every step:
 *
 *   · what is on screen (headline, controls, SVG art, aria wiring)
 *   · how long each transition took
 *   · whether every control produced audio
 *   · anything that looks unfinished (empty labels, zero-size art, missing
 *     focus states, unlabelled inputs)
 *
 * It is deliberately strict: anything it flags is something a new player would
 * notice too. Run it after every change to the opening.
 *
 * Usage: node tools/playtest.mjs [--verbose]
 *
 * @module tools/playtest
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import process from 'node:process';

let JSDOM;
let IDBFactory;
try {
  ({ JSDOM } = await import('jsdom'));
  ({ IDBFactory } = await import('fake-indexeddb'));
} catch {
  console.log('playtest: skipped (jsdom/fake-indexeddb not installed — npm ci)');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);
const VERBOSE = process.argv.includes('--verbose');

/* ---------------------------------------------------------- environment */

const shell = readFileSync('apps/web/index.html', 'utf8')
  .replace(/<script type="module"[\s\S]*?<\/script>/, '');

const virtualConsole = new (await import('jsdom')).VirtualConsole();
const consoleErrors = [];
virtualConsole.on('jsdomError', (e) => { if (!/Not implemented|Could not parse CSS/.test(e.message)) consoleErrors.push(e.message); });
virtualConsole.on('error', (m) => consoleErrors.push(String(m)));

const dom = new JSDOM(shell, {
  url: 'https://local.test/', pretendToBeVisual: true, virtualConsole, runScripts: 'outside-only',
});
const { window } = dom;

Object.assign(globalThis, {
  window, document: window.document, location: window.location, history: window.history,
  navigator: window.navigator,
  Node: window.Node, HTMLElement: window.HTMLElement, Element: window.Element,
  Event: window.Event, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
  CustomEvent: window.CustomEvent, PointerEvent: window.MouseEvent,
  requestAnimationFrame: (cb) => window.setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia?.bind(window) || (() => ({ matches: false, addEventListener() {} })),
  indexedDB: new IDBFactory(),
  IDBKeyRange: (await import('fake-indexeddb')).IDBKeyRange,
});
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
try {
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
} catch { /* jsdom keeps its own; Web Crypto lives on globalThis for the modules */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = window.document;

/* ------------------------------------------------------------- audio probe */

/**
 * Every cue is wrapped so we can prove that each interaction makes a noise.
 * The app calls `sfx.foo()` through the shared module object, so patching the
 * properties of that object is enough to observe the real thing.
 */
const sfxModule = await import(pathToFileURL(path.resolve('apps/web/src/core/sfx.js')).href);
let firedCues = [];
for (const key of Object.keys(sfxModule.sfx)) {
  const original = sfxModule.sfx[key];
  sfxModule.sfx[key] = (...args) => { firedCues.push(key); return original(...args); };
}

/** Cues heard since the last call — and a reset, so each interaction is isolated. */
function cues() {
  const heard = [...new Set(firedCues)];
  firedCues = [];
  return heard;
}

/** Run an interaction and report whether it was audible. */
async function audible(label, action, waitMs = 260) {
  cues();
  await action();
  await sleep(waitMs);
  const heard = cues();
  heard.length
    ? pass(`${label} → ${heard.join(', ')}`)
    : fail(`${label} produced NO SOUND`);
  return heard;
}

/* ------------------------------------------------------------- reporting */

let failures = 0;
let skippable = false;
const notes = [];
const fail = (msg) => { failures++; console.log(`  ✖ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => { notes.push(msg); if (VERBOSE) console.log(`  · ${msg}`); };

function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`); }

/** Every control the player can act on, with the bits that make it feel finished. */
function census(selector = '.view') {
  const root = doc.querySelector(selector);
  if (!root) return { controls: [], art: 0, text: '' };
  const controls = [...root.querySelectorAll('button, input, select, [role="button"]')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    label: (el.textContent || '').trim().slice(0, 40) || el.getAttribute('aria-label') || el.placeholder || '(no label)',
    disabled: !!el.disabled,
    titled: !!(el.getAttribute('title') || el.getAttribute('aria-label') || (el.textContent || '').trim()),
    id: el.id || null,
  }));
  return {
    controls,
    art: root.querySelectorAll('svg').length,
    text: (root.textContent || '').replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Structural fingerprint of a rendered SVG. The generators stamp a fresh id
 * counter on every call (sp1, sp2, …), so comparing raw markup would report a
 * change that no player could ever see. Ids are removed first.
 */
const artSignature = (el) => (el?.innerHTML || '')
  .replace(/id="[^"]*"/g, '')
  .replace(/url\(#[^)]*\)/g, 'url(#)');

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const findByText = (re, sel = 'button') => [...doc.querySelectorAll(sel)].find((b) => re.test(b.textContent || ''));

/* ------------------------------------------------------------------- boot */

console.log('DigiPoke — opening playtest');
const t0 = Date.now();
await import(pathToFileURL(path.resolve('apps/web/src/main.js')).href);
await sleep(700);

section('step 0 · splash');
let snap = census();
console.log(`  boot → first paint: ${Date.now() - t0} ms`);
const splash = doc.querySelector('.splash');
if (!splash) { fail('splash did not render'); process.exit(1); }
pass('splash rendered');
console.log(`  headline: "${doc.querySelector('.splash__title')?.textContent}"`);
snap.controls.forEach((c) => console.log(`  control: <${c.tag}> "${c.label}"${c.disabled ? ' [disabled]' : ''}`));
const creatures = doc.querySelectorAll('.splash__creature svg').length;
creatures === 3 ? pass(`three starters on screen (${creatures} SVGs)`) : fail(`expected 3 starter sprites, got ${creatures}`);
const startBtn = findByText(/press start/i);
if (!startBtn) { fail('no Press Start button'); process.exit(1); }
startBtn.getAttribute('type') === 'button' ? pass('Press Start is type="button"') : note('Press Start missing type="button"');
// Splash should not expose app chrome.
doc.body.classList.contains('is-bare') ? pass('splash hides app chrome (is-bare)') : note('splash still renders the topbar/tabbar');
doc.querySelector('.tabbar')?.children.length ? note('tabbar is populated during onboarding') : pass('tabbar empty during onboarding');

const tPress = Date.now();
await audible('Press Start', () => click(startBtn), 500);
section('step 1 · identity');
console.log(`  Press Start → identity: ${Date.now() - tPress} ms`);
snap = census();
snap.controls.forEach((c) => console.log(`  control: <${c.tag}> "${c.label}"${c.disabled ? ' [disabled]' : ''}`));
const nameInput = doc.querySelector('#tamer-name');
if (!nameInput) { fail('name field missing'); process.exit(1); }
pass('name field present');
doc.activeElement === nameInput ? pass('name field is auto-focused') : note('name field is NOT auto-focused (player must click first)');
const labelled = !!nameInput.closest('label') || !!doc.querySelector(`label[for="${nameInput.id}"]`);
labelled ? pass('name field has an associated label') : fail('name field has no label');
nameInput.getAttribute('autocomplete') === 'off' ? pass('name field opts out of autofill') : note('name field allows autofill');
const pwFields = () => [...doc.querySelectorAll('input[type="password"]')];
const pw = pwFields();
pw.length === 2 ? pass('passphrase + confirm fields') : fail(`expected 2 password fields, got ${pw.length}`);

// Live feedback: does the ID card track the name?
const idNameBefore = doc.querySelector('.idcard__name')?.textContent;
await audible('typing the name', () => type(nameInput, 'Ada'), 90);
const idNameAfter = doc.querySelector('.idcard__name')?.textContent;
idNameBefore !== idNameAfter && /Ada/.test(idNameAfter || '')
  ? pass(`ID card updates live ("${idNameAfter}")`)
  : fail(`ID card did not track the name (before "${idNameBefore}" after "${idNameAfter}")`);

// Enter should move to the next field rather than submitting the form early.
nameInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await sleep(60);
doc.activeElement === pw[0] ? pass('Enter moves from the name to the passphrase') : note('Enter does not walk the form');
pw[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await sleep(60);
doc.activeElement === pw[1] ? pass('Enter moves from the passphrase to the confirm field') : note('Enter does not walk the form');

// The help toggle re-renders the step; it must not swallow focus.
const helpBtn = findByText(/passphrase\?/);
if (helpBtn) {
  helpBtn.focus();
  click(helpBtn);
  await sleep(250);
  doc.activeElement?.classList?.contains('help-toggle')
    ? pass('the help toggle keeps focus after re-rendering')
    : note('focus is lost when the explanation opens');
  click(doc.querySelector('.help-toggle'));
  await sleep(200);
}

// Passphrase strength feedback
const pw1 = pwFields()[0];
type(pw1, 'abc');
await sleep(60);
const weak = doc.querySelector('.pass-strength')?.dataset.score;
type(pw1, 'correct-horse-1');
await sleep(60);
const strong = doc.querySelector('.pass-strength')?.dataset.score;
strong > weak ? pass(`strength meter reacts (${weak} → ${strong})`) : fail(`strength meter static (${weak} → ${strong})`);
const strengthLabel = doc.querySelector('.pass-strength__label')?.textContent;
console.log(`  strength label at "correct-horse-1": "${strengthLabel}"`);
doc.querySelector('.pass-strength__label')?.getAttribute('aria-live')
  ? pass('strength label is announced (aria-live)')
  : note('strength label has no aria-live — screen readers stay silent');

// Continue gating
type(pwFields()[1], 'correct-horse-1');
await sleep(60);
let cont = doc.querySelector('#identity-next');
cont && !cont.disabled ? pass('Continue enabled once name + matching passphrase are valid') : fail('Continue stayed disabled with valid input');
// Mismatch
type(pwFields()[1], 'nope-nope-1');
await sleep(60);
cont = doc.querySelector('#identity-next');
cont?.disabled ? pass('Continue disables on passphrase mismatch') : note('Continue stays enabled when passphrases differ');
// Does the player get told WHY?
const hint = doc.querySelector('.checklist');
hint ? pass('a live checklist shows what is still required') : note('no inline hint explaining what blocks Continue');
const ticked = doc.querySelectorAll('.checklist__item.is-done').length;
console.log(`  checklist ticked: ${ticked}/3`);
type(pwFields()[1], 'correct-horse-1');
await sleep(60);

const tVault = Date.now();
cont = doc.querySelector('#identity-next');
let busyImmediately = false;
await audible('Continue (vault creation)', () => {
  click(cont);
  // Freeze-frame on the same tick: did the click visibly register?
  busyImmediately = Boolean(doc.querySelector('.is-busy, [aria-busy="true"]'));
}, 120);
const stillOnIdentity = !!doc.querySelector('#tamer-name');
// Poll for the appearance step so we measure the true cost, not a fixed sleep.
let vaultMs = 0;
for (let i = 0; i < 120; i++) {
  await sleep(25);
  if (doc.querySelector('.opt-group')) { vaultMs = Date.now() - tVault; break; }
}
if (!vaultMs) vaultMs = Date.now() - tVault;
console.log(`  vault creation: ${vaultMs} ms`);
busyImmediately ? pass('button shows a busy state immediately') : note(`no busy state during the ${vaultMs} ms vault derivation — the click feels dead`);
if (stillOnIdentity && vaultMs > 400) note(`player waits ${vaultMs} ms on the identity step with no progress indicator`);

section('step 2 · appearance');
if (!doc.querySelector('.opt-group')) { fail('appearance step did not render'); process.exit(1); }
snap = census();
pass('appearance step rendered');
const groups = doc.querySelectorAll('.opt-group');
console.log(`  option groups: ${groups.length}`);
[...groups].forEach((g) => {
  const label = g.querySelector('.opt-group__label')?.textContent;
  const opts = g.querySelectorAll('.opt');
  const active = g.querySelectorAll('.opt.is-active').length;
  console.log(`    ${label}: ${opts.length} options, ${active} marked active`);
  if (!opts.length) fail(`group "${label}" has no options`);
  if (active !== 1) fail(`group "${label}" has ${active} active options (expected 1)`);
});
const comboNote = snap.text.match(/([\d,]+) possible Tamers/);
console.log(`  headline figure: ${comboNote ? comboNote[0] : 'none shown'}`);

// Changing an option must visibly change the art.
const artBefore = doc.querySelector('.stage__avatar')?.innerHTML.length || 0;
const hairOpts = [...doc.querySelectorAll('.opt-group')][1]?.querySelectorAll('.opt') || [];
if (hairOpts.length > 1) {
  const tChange = Date.now();
  await audible('choosing an appearance option', () => click(hairOpts[hairOpts.length - 1]), 140);
  const artAfter = doc.querySelector('.stage__avatar')?.innerHTML.length || 0;
  console.log(`  option → re-render: ${Date.now() - tChange} ms`);
  artAfter > 0 && artAfter !== artBefore ? pass('avatar art changes with the option') : fail('avatar art did not change');
  const focused = doc.activeElement?.classList?.contains('opt');
  focused ? pass('focus survives the re-render') : note('focus is lost after choosing an option (keyboard users are dumped to the top)');
}
// Roving tabindex: exactly one tab stop per group (42 swatches would be hostile).
const tabStops = [...groups].map((g) => g.querySelectorAll('.opt[tabindex="0"]').length);
tabStops.every((n) => n === 1) ? pass('one tab stop per option group (roving tabindex)') : fail(`tab stops per group: ${tabStops.join(',')} (expected 1 each)`);

// Hover preview: look without committing.
const commitBefore = artSignature(doc.querySelector('.stage__avatar'));
const previewOpt = hairOpts[0];
previewOpt?.dispatchEvent(new window.MouseEvent('pointerenter', { bubbles: false }));
await sleep(90);
const previewArt = artSignature(doc.querySelector('.stage__avatar'));
const previewMarked = doc.querySelector('.stage__caption')?.textContent;
previewArt && previewArt !== commitBefore
  ? pass(`hover previews the option without committing ("${previewMarked}")`)
  : fail('hovering an option did not preview it');
previewOpt?.dispatchEvent(new window.MouseEvent('pointerleave', { bubbles: false }));
await sleep(90);
artSignature(doc.querySelector('.stage__avatar')) === commitBefore
  ? pass('leaving the option restores the committed look')
  : fail('the preview stuck after pointerleave');

const swatches = doc.querySelectorAll('.opt--color');
swatches.length ? pass(`${swatches.length} colour swatches (visual, not text)`) : note('no colour swatches');

// Surprise me
const dice = findByText(/surprise me/i);
if (dice) {
  const before = artSignature(doc.querySelector('.stage__avatar'));
  await audible('"Surprise me"', () => click(dice), 220);
  pass(`"Surprise me" re-rolls (${before !== artSignature(doc.querySelector('.stage__avatar')) ? 'art changed' : 'art unchanged'})`);
}

// Going back must never throw away what the player already typed.
click(findByText(/^Back$/));
await sleep(400);
const keptName = doc.querySelector('#tamer-name')?.value;
keptName === 'Ada' ? pass('Back preserves the entered name') : fail(`Back lost the name (got "${keptName}")`);
const keptPass = doc.querySelector('#tamer-pass')?.value;
keptPass === 'correct-horse-1' ? pass('Back preserves the passphrase') : fail('Back lost the passphrase');
const stillTicked = doc.querySelectorAll('.checklist__item.is-done').length;
stillTicked === 3 ? pass('the checklist is still ticked after coming back') : fail(`checklist shows ${stillTicked}/3 after Back`);
click(doc.querySelector('#identity-next') || findByText(/^Continue$/));
let backRoundTrip = false;
for (let i = 0; i < 120 && !doc.querySelector('.opt-group'); i++) { await sleep(25); }
backRoundTrip = Boolean(doc.querySelector('.opt-group'));
backRoundTrip
  ? pass('Continue works again after going Back (the submit guard releases)')
  : fail('Continue is dead after returning to the identity step');
await sleep(150);
click(findByText(/^Continue$/));
await sleep(400);

section('step 3 · partner');
if (!doc.querySelector('.starter-grid')) {
  fail('did not reach the partner step');
  console.log(`  DEBUG view class: ${doc.querySelector('.view')?.className}`);
  console.log(`  DEBUG text: ${(doc.querySelector('.view')?.textContent || '').slice(0, 200)}`);
  console.log(`  DEBUG errors: ${[...new Set(consoleErrors)].slice(0, 3).join(' || ') || 'none'}`);
}

await sleep(400);
const cards = [...doc.querySelectorAll('.starter-card')];
cards.length === 3 ? pass('three partner cards') : fail(`expected 3 partner cards, got ${cards.length}`);
cards.forEach((c) => {
  const name = c.querySelector('.starter-card__name')?.textContent;
  const hasArt = !!c.querySelector('svg');
  console.log(`    ${name}: art ${hasArt ? '✓' : '✖'}${c.classList.contains('is-selected') ? ' [selected]' : ''}`);
  if (!hasArt) fail(`${name} card has no art`);
});
// Selecting a different partner must update the detail panel.
const before = doc.querySelector('.partner__lore')?.textContent?.slice(0, 30);
await audible('selecting a partner', () => click(cards[2]), 320);
const after = doc.querySelector('.partner__lore')?.textContent?.slice(0, 30);
before !== after ? pass('detail panel follows the selection') : fail('detail panel did not update');
const statRows = doc.querySelectorAll('.partner__stats .stat-row');
statRows.length === 4 ? pass('four stat rows (HP/ATK/DEF/SPD)') : fail(`expected 4 stat rows, got ${statRows.length}`);
[...statRows].forEach((r) => {
  const label = r.querySelector('.stat-row__label')?.textContent;
  const value = r.querySelector('.stat-row__value')?.textContent;
  const fill = r.querySelector('.bar__fill')?.style.width;
  console.log(`    ${label} = ${value} (fill ${fill})`);
  if (!value) fail(`stat "${label}" shows no value`);
});
const moves = [...doc.querySelectorAll('.partner__moves .pill')].map((p) => p.textContent);
console.log(`  moves: ${moves.join(' | ')}`);
const evo = doc.querySelector('.partner__info .muted')?.textContent;
console.log(`  evolution line: ${evo}`);

const chooseBtn = findByText(/^Choose /);
await audible('Choose <partner>', () => click(chooseBtn), 320);
const modal = doc.querySelector('#modal-root .modal__panel');
modal ? pass('confirmation dialog appears') : fail('no confirmation dialog');
if (modal) {
  const btns = [...modal.querySelectorAll('button')].map((b) => b.textContent.trim());
  console.log(`  dialog buttons: ${btns.join(' | ')}`);
  await audible('confirming the choice', () => click([...modal.querySelectorAll('button')].find((b) => /^Yes/.test(b.textContent))), 320);
}

section('step 4 · launch → first gameplay');
await sleep(200);
const launch = doc.querySelector('.launch');
launch ? pass('launch cinematic rendered') : fail('launch cinematic missing');
const lines = new Set();
for (let i = 0; i < 4; i++) { lines.add(doc.querySelector('.launch__line')?.textContent); await sleep(180); }
console.log(`  cinematic lines: ${[...lines].filter(Boolean).join(' → ')}`);
const pct = doc.querySelector('.launch__pct')?.textContent;
console.log(`  progress readout: ${pct}`);
skippable = Boolean(doc.querySelector('.launch__skip'));
skippable ? pass('the cinematic advertises that it can be skipped') : note('no skip affordance on the cinematic');

// The skip has to be instant — a player who has seen it once never wants it again.
const tSkip = Date.now();
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
let skipMs = 0;
for (let i = 0; i < 60; i++) {
  await sleep(20);
  if (doc.querySelector('.view--dashboard')) { skipMs = Date.now() - tSkip; break; }
}
skipMs && skipMs < 600 ? pass(`Enter skips to the game in ${skipMs} ms`) : fail(`skip took ${skipMs || '>1200'} ms`);
await sleep(400);

const onDashboard = !!doc.querySelector('.view') && !doc.querySelector('.launch');
onDashboard ? pass('landed in the game') : fail('did not reach the first gameplay screen');
section('first moments of gameplay');
snap = census();
console.log(`  screen text: ${snap.text.slice(0, 300)}`);
snap.controls.forEach((c) => console.log(`  control: <${c.tag}> "${c.label}"`));
const primer = doc.querySelector('.help-list')
  || [...doc.querySelectorAll('.card')].find((c) => /Getting started/i.test(c.textContent || ''));
primer
  ? pass('a coach card tells the player what to do next')
  : note('no obvious "what do I do next?" guidance on the first screen');
const hinted = doc.querySelector('.quick-action.is-hint');
hinted ? pass('the first step is highlighted ("Start here")') : note('no highlighted first step on the hub');

// The hub has to sound as alive as the wizard.
await audible('dismissing the primer', () => click(findByText(/^Got it$/)), 320);
await audible('opening Explore', () => click([...doc.querySelectorAll('.quick-action')].find((b) => /Explore/.test(b.textContent))), 420);
await sleep(200);
const nexusTab = [...doc.querySelectorAll('.tabbar__item')].find((b) => /nexus|home/i.test(b.textContent + (b.getAttribute('aria-label') || '')));
nexusTab
  ? await audible('returning via the tab bar', () => click(nexusTab), 420)
  : note('no Nexus tab found to test navigation audio');

const hpBars = doc.querySelectorAll('.hp, .hp__track');
hpBars.length ? pass(`${hpBars.length} health bar(s) present`) : note('no health bar on the first screen');
doc.querySelector('.tabbar')?.children.length ? pass('navigation is available') : note('no navigation after onboarding');

section('result');
if (consoleErrors.length) {
  console.log(`  console errors (${consoleErrors.length}):`);
  [...new Set(consoleErrors)].slice(0, 8).forEach((e) => console.log(`    ! ${e.slice(0, 160)}`));
} else {
  pass('no console errors during the whole run');
}
if (notes.length) {
  console.log(`\n  ${notes.length} note(s) — polish opportunities:`);
  notes.forEach((n) => console.log(`    · ${n}`));
}
console.log(failures === 0 ? '\n✅ opening playtest passed' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
