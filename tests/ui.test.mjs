/**
 * ui.test.mjs — Headless browser integration tests.
 *
 * Boots the REAL application (main.js + every screen) inside jsdom with a
 * fake IndexedDB, then drives it the way a player would: onboarding, choosing a
 * starter, navigating to each screen, and running a battle through the engine
 * into persisted state.
 *
 * These tests exist because the PWA's risk is concentrated in the wiring —
 * module imports, DOM ids, router guards and persistence — none of which the
 * pure domain tests can catch.
 *
 * Requires dev-only dependencies:
 *   npm i -D jsdom fake-indexeddb
 * The suite skips itself (rather than failing) when they are not installed, so
 * `npm test` works on a bare checkout.
 *
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..', 'apps', 'web');

let JSDOM;
let IDBFactory;
let available = true;
try {
  ({ JSDOM } = await import('jsdom'));
  ({ IDBFactory } = await import('fake-indexeddb'));
} catch {
  available = false;
}

/* ------------------------------------------------------------------ helpers */

/** Wait until `predicate()` is truthy, or fail after `timeout` ms. */
async function waitFor(predicate, { timeout = 4000, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    let value;
    try { value = predicate(); } catch { value = false; }
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Click an element, tolerating async handlers. */
function click(el) {
  assert.ok(el, 'click target missing');
  el.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Set an input's value and fire the events the app listens for. */
function setValue(el, value, eventName = 'input') {
  el.value = value;
  el.dispatchEvent(new globalThis.window.Event(eventName, { bubbles: true }));
}

/** Find a button by its visible text. */
function buttonWithText(text, root = globalThis.document) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().includes(text.toLowerCase()));
}

/* --------------------------------------------------------------- DOM setup */

let dom;

/** Install a jsdom environment with the browser globals the app expects. */
function setupDom() {
  const html = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8')
    // Strip the module script: we import main.js ourselves so we control boot
    // ordering relative to the fake globals.
    .replace(/<script type="module"[\s\S]*?<\/script>/, '');

  dom = new JSDOM(html, {
    url: 'http://localhost:8080/index.html',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.history = window.history;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.indexedDB = new IDBFactory();
  // jsdom's navigator lacks storage/serviceWorker; that is fine (all guarded).
  try { globalThis.navigator = window.navigator; } catch { /* read-only in newer runtimes */ }
  // Node's WebCrypto is complete; jsdom's is not (no subtle).
  if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;
  try { window.crypto = globalThis.crypto; } catch { /* read-only in some runtimes */ }
  return window;
}

/** Navigate by hash and wait for the router to render. */
async function goto(hash) {
  globalThis.location.hash = hash;
  await waitFor(() => globalThis.document.querySelector('.view > *'), { label: `render of ${hash}` });
  await new Promise((r) => setTimeout(r, 30));
}

/* ------------------------------------------------------------------- tests */

test('app: boots and renders the onboarding wizard', { skip: !available }, async () => {
  setupDom();
  await import('../apps/web/src/main.js');
  await waitFor(() => document.querySelector('.view--onboarding'), { label: 'onboarding view' });

  const title = document.querySelector('.splash__title')?.textContent?.trim();
  assert.equal(title, 'DigiPoke');
  assert.ok(buttonWithText('Press Start'), 'splash should offer a start button');
  assert.ok(document.querySelectorAll('.splash__creature').length === 3, 'splash should parade the starters');
});

test('onboarding: creates a vault, picks a starter and enters the Nexus', { skip: !available }, async () => {
  // Step 0 → 1 — splash into identity.
  click(buttonWithText('Press Start'));
  await waitFor(() => document.querySelector('#tamer-name'), { label: 'identity step' });

  // Step 1 — identity (name + passphrase + confirm).
  const inputs = [...document.querySelectorAll('.view--onboarding input.input')];
  assert.equal(inputs.length, 3, 'expected name + passphrase + confirm inputs');
  setValue(inputs[0], 'Ada');
  setValue(inputs[1], 'correct-horse-1');
  setValue(inputs[2], 'correct-horse-1');

  click(buttonWithText('Continue'));
  // (Identity derives the vault key, so this step lands asynchronously.)
  await waitFor(() => document.querySelectorAll('.opt-group').length === 6, { label: 'appearance step', timeout: 8000 });

  // Step 2 — appearance. The portrait is generated from the selected options.
  const optionGroups = document.querySelectorAll('.opt-group');
  assert.equal(optionGroups.length, 6, 'expected six appearance groups');
  const swatch = document.querySelector('.opt--color:not(.is-active)');
  assert.ok(swatch, 'expected colour swatches');
  const beforePortrait = document.querySelector('.stage__avatar svg').outerHTML;
  click(swatch);
  await waitFor(() => document.querySelector('.stage__avatar svg').outerHTML !== beforePortrait, { label: 'portrait to change' });

  click(buttonWithText('Continue'));
  await waitFor(() => document.querySelector('.starter-grid'), { label: 'starter step', timeout: 8000 });

  // Step 3 — starter.
  const starters = [...document.querySelectorAll('.starter-card')];
  assert.equal(starters.length, 3);
  click(starters[0]);
  await waitFor(() => document.querySelector('.starter-card.is-selected') && document.querySelector('.partner__lore'), { label: 'partner dossier' });
  assert.ok(document.querySelectorAll('.partner__stats .stat-row').length >= 4, 'dossier should show stats');
  click(buttonWithText('Choose '));

  // Confirmation dialog stands between the choice and the save file.
  await waitFor(() => document.querySelector('.modal__panel'), { label: 'confirmation dialog' });
  const confirm = [...document.querySelectorAll('.modal__actions button')]
    .find((b) => /^yes/i.test(b.textContent.trim()));
  assert.ok(confirm, 'expected a confirm button in the dialog');
  click(confirm);

  // Step 4 — launch cinematic, which hands off to the Nexus on its own.
  await waitFor(() => document.querySelector('.launch'), { label: 'launch cinematic', timeout: 8000 });
  assert.ok(document.querySelector('.launch__avatar svg'), 'the cinematic should show the Tamer');
  await waitFor(() => document.querySelector('.view--dashboard'), { label: 'dashboard', timeout: 12000 });

  // The profile is real: the name and the stat grid are rendered, and the
  // first-run primer is what greets a new player.
  const hero = document.querySelector('.hero__name')?.textContent?.trim();
  assert.equal(hero, 'Ada');
  assert.ok(document.querySelectorAll('.stat-box').length >= 6, 'expected the stat grid');
  assert.ok(document.querySelector('.help-list'), 'a new player should get a "what next" primer');
  assert.equal(document.querySelectorAll('.objective').length, 0, 'objectives stay out of the way until the primer is dismissed');

  // Dismissing the primer is what reveals the rest of the hub.
  click(buttonWithText('Got it'));
  await waitFor(() => document.querySelectorAll('.objective').length === 3, { label: 'daily objectives' });
  assert.equal(document.querySelectorAll('.objective').length, 3, 'expected three daily objectives');
});

test('screens: every primary route renders without error', { skip: !available }, async () => {
  const expectations = [
    ['#/ranch', '.view--ranch', /creature|empty/i],
    ['#/explore', '.view--explore', /zone/i],
    ['#/lab', '.view--lab', /lab/i],
    ['#/settings', '.view--settings', /profile/i],
    ['#/', '.view--dashboard', /nexus|daily/i],
  ];

  for (const [hash, selector, text] of expectations) {
    await goto(hash);
    const view = document.querySelector(selector);
    assert.ok(view, `route ${hash} did not render ${selector}`);
    assert.match(document.body.textContent, text, `route ${hash} content looks wrong`);
  }
});

test('explore: scanning is possible and the zone list respects unlocks', { skip: !available }, async () => {
  await goto('#/explore');
  const zones = [...document.querySelectorAll('.zone-card')];
  assert.equal(zones.length, 6, 'six zones are configured');
  const locked = zones.filter((z) => z.classList.contains('is-locked'));
  assert.ok(locked.length >= 4, 'later zones should start locked', { locked: locked.length });
  assert.ok(buttonWithText('Scan area'), 'expected a scan button');
  assert.ok(buttonWithText('Challenge a trainer'), 'expected a trainer button');
});

test('battle: a full battle resolves and writes XP back into the save', { skip: !available }, async () => {
  const state = await import('../apps/web/src/core/state.js');
  const { Battle, SIDE } = await import('../apps/web/src/domain/battle.js');
  const { createRng } = await import('../apps/web/src/core/rng.js');
  const { createCreature } = await import('../apps/web/src/domain/creature.js');

  const profileState = state.getState();
  assert.ok(profileState, 'a profile should exist from onboarding');
  const team = state.teamCreatures();
  assert.equal(team.length, 1, 'the starter should be on the team');

  const starter = team[0];
  const beforeLevel = starter.level;

  const rng = createRng(1234);
  const foe = createCreature({ speciesId: 'nulkit', level: 2, rand: rng });
  const battle = new Battle({
    allyTeam: [starter], foeTeam: [foe], kind: 'wild', rng,
    inventory: profileState.inventory,
  });

  let guard = 0;
  while (!battle.over && guard++ < 100) {
    battle.submit({ type: 'move', moveId: battle.active(SIDE.ALLY).moves[0] });
  }

  assert.equal(battle.outcome, 'win', 'a level-5 starter should beat a level-2 Nulkit');
  const after = state.getCreature(starter.uid);
  assert.ok(after.level > beforeLevel || after.xp > 0, 'the creature must have gained XP');

  // Results flow through the state layer into the save file.
  state.recordBattleResult({ outcome: 'win', isTrainer: false, zoneId: 'pixel_plains' });
  assert.ok(state.getState().profile.stats.battlesWon >= 1);
  await state.flush();

  // And they survive a reload from IndexedDB.
  const reloaded = await state.init();
  assert.equal(reloaded.profile.displayName, 'Ada');
  assert.ok(Object.keys(reloaded.creatures).length >= 1);
});

test('battle: the UI shows chip damage and floating numbers', { skip: !available }, async () => {
  // A wild battle driven through the real screen, not just the engine, so the
  // feedback layer (ghost HP bar, damage floaters, impact states) is exercised.
  const state = await import('../apps/web/src/core/state.js');
  state.healAllCreatures();
  await goto('#/battle?wild=1&zone=pixel_plains&species=nulkit&level=2');
  await waitFor(() => document.querySelector('.view--battle'), { label: 'battle screen' });

  const foeCard = () => document.querySelector('.arena__foe .combat-card');
  assert.ok(foeCard(), 'the foe combat card should render');
  assert.ok(document.querySelector('.arena__foe .hp__track'), 'the foe should have an HP bar');
  assert.ok(document.querySelector('.arena__ally .hp__track'), 'the ally should have an HP bar');

  const before = document.querySelector('.arena__foe .hp__fill')?.style.width;
  assert.ok(before && before !== '0%', 'the foe should start at full HP');

  // Fire the first move and let the animation queue run.
  const move = document.querySelector('.move-btn');
  assert.ok(move, 'the move menu should offer moves');
  click(move);

  // The chip bar holds the pre-hit value momentarily before collapsing.
  await waitFor(() => document.querySelector('.arena__foe .hp__ghost'), { label: 'chip damage bar', timeout: 6000 });
  const ghostWidth = document.querySelector('.arena__foe .hp__ghost').style.width;
  assert.ok(ghostWidth.endsWith('%'), 'the chip bar should be sized');

  // And a floating damage number is spawned on the target card.
  const floater = document.querySelector('.arena__foe .floater');
  assert.ok(floater, 'a floating damage number should be shown');
  assert.match(floater.textContent, /-?\d|MISS/, 'the floater should carry a number or MISS');

  // The bar itself actually moved.
  await waitFor(() => document.querySelector('.arena__foe .hp__fill').style.width !== before,
    { label: 'HP bar to change', timeout: 6000 });

  // Leave the battle cleanly so later suites start from a known state.
  await goto('#/');
  await waitFor(() => document.querySelector('.view--dashboard'), { label: 'back at the dashboard' });
});

test('persistence: the save file round-trips through export and import', { skip: !available }, async () => {
  const state = await import('../apps/web/src/core/state.js');
  const exported = state.exportPayload();
  const serialised = JSON.parse(JSON.stringify(exported));

  assert.equal(serialised.schema, 4);
  assert.equal(serialised.profile.displayName, 'Ada');
  assert.ok(serialised.profile.tamer, 'the tamer avatar should be part of the save file');
  assert.ok(serialised.creatures && Object.keys(serialised.creatures).length >= 1);

  await state.replaceState(exported);
  assert.equal(state.getState().profile.displayName, 'Ada');
});

test('crypto: vault encryption round-trips and rejects the wrong passphrase', { skip: !available }, async () => {
  const { deriveVaultKey, encryptJson, decryptJson, makeVerifier, verifyPassphrase, newSalt } =
    await import('../apps/web/src/core/crypto.js');

  const salt = newSalt();
  const key = await deriveVaultKey('correct-horse-1', salt);
  const envelope = await encryptJson(key, { creatures: { a: 1 }, secret: 'data' });

  assert.equal(envelope.alg, 'AES-GCM-256');
  assert.ok(envelope.iv && envelope.ct);
  assert.deepEqual(await decryptJson(key, envelope), { creatures: { a: 1 }, secret: 'data' });

  // A different passphrase derives a different key and cannot decrypt.
  const wrongKey = await deriveVaultKey('wrong-passphrase-1', salt);
  await assert.rejects(() => decryptJson(wrongKey, envelope), 'wrong key must not decrypt');

  // Verifier semantics used by onboarding and Settings.
  const verifier = await makeVerifier(key);
  assert.equal(await verifyPassphrase('correct-horse-1', salt, verifier), true);
  assert.equal(await verifyPassphrase('nope-nope-1', salt, verifier), false);
});

test('sprites: every species renders valid SVG markup', { skip: !available }, async () => {
  const { sprite } = await import('../apps/web/src/ui/sprite.js');
  const { SPECIES_IDS, getSpecies } = await import('../apps/web/src/domain/species.js');

  for (const id of SPECIES_IDS) {
    const svg = sprite(getSpecies(id).art, { size: 96, shiny: false }).trim();
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${id} did not produce an SVG root`);
    assert.ok(!svg.includes('NaN'), `${id} produced a NaN coordinate`);
    assert.ok(!svg.includes('undefined'), `${id} produced an undefined value`);

    const shiny = sprite(getSpecies(id).art, { size: 96, shiny: true });
    assert.ok(shiny.length > 100, `${id} shiny variant is empty`);
  }
  assert.ok(SPECIES_IDS.length >= 30, 'expected the full dex');
});

test('router: guards redirect to onboarding when no profile exists', { skip: !available }, async () => {
  const state = await import('../apps/web/src/core/state.js');
  const router = await import('../apps/web/src/core/router.js');

  const before = state.getState().profile.displayName;
  await state.wipe();

  await goto('#/ranch');
  await waitFor(() => document.querySelector('.view--onboarding'), { label: 'redirect to onboarding' });

  // Restore a profile so later suites (and manual runs) are unaffected.
  await state.createProfile({ displayName: before || 'Ada', starterId: 'emberling' });
  await state.flush();
  assert.ok(router.activePath());
});
