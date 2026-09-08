#!/usr/bin/env node
/**
 * playtest-live.mjs — walk the opening flow of a *deployed* build.
 *
 * `tools/playtest.mjs` runs the source tree; this one runs the artefact the
 * player actually gets. It downloads the single-file build from a live URL,
 * replays its module payload in jsdom (the bundle loads from `blob:` URLs that
 * jsdom cannot execute, so the loader is replayed over `file://` — the same
 * technique as verify-single), and plays the opening exactly as a new player
 * would.
 *
 * It finishes by crawling every module the deployed multi-file app imports, so
 * a missing or mis-pathed file cannot ship unnoticed.
 *
 * Usage: node tools/playtest-live.mjs [baseUrl]
 *
 * @module tools/playtest-live
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
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
  console.log('playtest-live: skipped (jsdom/fake-indexeddb not installed — npm ci)');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);

const BASE = (process.argv[2] || 'https://lin4cre.github.io/digipoke/').replace(/\/?$/, '/');
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`ok   ${msg}`); else { failures += 1; console.log(`FAIL ${msg}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`DigiPoke — live opening playtest against ${BASE}\n`);

/* ------------------------------------------------- fetch the deployed bundle */

const singleHtml = await (await fetch(`${BASE}single.html`)).text();
ok(singleHtml.length > 300_000, `single.html downloaded (${singleHtml.length} bytes)`);

const payloadMatch = singleHtml.match(/<script id="digipoke-modules" type="application\/json">([\s\S]*?)<\/script>/);
if (!payloadMatch) { console.error('FAIL: deployed bundle has no module payload'); process.exit(1); }
const payload = JSON.parse(payloadMatch[1].replace(/<\\\//g, '</'));
ok(payload.modules.length >= 28, `bundle carries ${payload.modules.length} modules`);

/* ---------------------------------------------------------------- environment */

const shell = readFileSync('apps/web/index.html', 'utf8').replace(/<script type="module"[\s\S]*?<\/script>/, '');
const dom = new JSDOM(shell, { url: BASE, pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document, location: window.location, history: window.history,
  navigator: window.navigator, Node: window.Node, HTMLElement: window.HTMLElement,
  Event: window.Event, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
  CustomEvent: window.CustomEvent,
  requestAnimationFrame: (cb) => window.setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia ? window.matchMedia.bind(window) : () => ({ matches: false, addEventListener() {} }),
  indexedDB: new IDBFactory(),
});
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

// jsdom has no layout, so the app's scroll calls are no-ops here.
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

const doc = window.document;
/** Portrait markup embeds a fresh gradient id per render; strip them so a
 *  comparison reflects what a player would actually see. */
const artSignature = (el) => (el?.innerHTML || '')
  .replace(/id="[^"]*"/g, '')
  .replace(/url\(#[^)]*\)/g, 'url(#)');
const click = (el) => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (sel, value) => {
  const el = doc.querySelector(sel);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const byText = (re) => [...doc.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));

/* ------------------------------------------------------- replay the modules */

const tmp = path.resolve('.playtest-live-modules');
rmSync(tmp, { recursive: true, force: true });
const urls = new Map();
for (const mod of payload.modules) {
  let code = mod.code;
  for (const [key, url] of urls) code = code.split(`«${key}»`).join(url);
  if (code.includes('«')) { console.error(`FAIL: unresolved placeholder in ${mod.key}`); process.exit(1); }
  const file = path.join(tmp, mod.key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, code);
  urls.set(mod.key, pathToFileURL(file).href);
}
await import(urls.get(payload.entry));
await sleep(900);

/* ------------------------------------------------------------------- 0 splash */

ok(!!doc.querySelector('.splash'), 'splash renders');
ok(doc.querySelectorAll('.splash__creature svg').length === 3, 'three starters on the title screen');
ok(doc.querySelectorAll('.splash__creature-name').length === 3, 'starters are named');
click(byText(/press start/i));
await sleep(600);

/* ----------------------------------------------------------------- 1 identity */

ok(!!doc.querySelector('#tamer-name'), 'Press Start reaches the identity step');
const continueBtn = () => doc.querySelector('#identity-next');
ok(continueBtn()?.disabled === true, 'Continue starts disabled');
type('#tamer-name', 'Ada');
await sleep(120);
ok(/Ada/.test(doc.querySelector('.idcard__name')?.textContent || ''), 'ID card tracks the name live');
ok(/^DP-/.test(doc.querySelector('.idcard__id-value')?.textContent || ''), 'a Tamer ID is generated from the name');
type('#tamer-pass', 'correct-horse-1');
type('#tamer-pass2', 'correct-horse-1');
await sleep(200);
ok(continueBtn()?.disabled === false, 'Continue enables once the rules are met');
ok(doc.querySelectorAll('.checklist__item.is-done').length === 3, 'the checklist is fully ticked');

const tVault = Date.now();
click(continueBtn());
await sleep(40);
ok(!!doc.querySelector('[aria-busy="true"]'), 'the click shows a busy state immediately');
for (let i = 0; i < 200 && !doc.querySelector('.opt-group'); i++) await sleep(25);
ok(!!doc.querySelector('.opt-group'), `vault created and the editor opened (${Date.now() - tVault} ms)`);

/* --------------------------------------------------------------- 2 appearance */

const groups = doc.querySelectorAll('.opt-group');
ok(groups.length === 6, 'six option groups');
const artBefore = artSignature(doc.querySelector('.stage__avatar'));
const opts = [...groups[1].querySelectorAll('.opt')];
// Preview an option that is NOT already selected — previewing the current one
// correctly changes nothing, which would be a false failure here.
const previewOpt = opts.find((o) => !o.classList.contains('is-active')) || opts[opts.length - 1];
previewOpt?.dispatchEvent(new window.MouseEvent('pointerenter'));
await sleep(120);
const artPreview = artSignature(doc.querySelector('.stage__avatar'));
ok(artPreview !== artBefore, 'hovering an option previews it');
previewOpt?.dispatchEvent(new window.MouseEvent('pointerleave'));
await sleep(120);
ok(artSignature(doc.querySelector('.stage__avatar')) === artBefore, 'the preview reverts on leave');
click(opts[opts.length - 1]);
await sleep(250);
ok(doc.activeElement?.classList?.contains('opt'), 'focus stays on the option after the re-render');

/* ------------------------------------------------------------------ 3 partner */

click(byText(/^Continue$/));
await sleep(400);
const cards = [...doc.querySelectorAll('.starter-card')];
ok(cards.length === 3, 'three partner cards');
const tags = cards.map((c) => c.querySelector('.starter-card__tag')?.textContent);
ok(new Set(tags).size > 1, `each starter has its own playstyle tag (${tags.join(', ')})`);
click(cards[2]);
await sleep(300);
ok(doc.querySelectorAll('.partner__stats .stat-row').length === 4, 'the dossier shows four stats');
ok(!!doc.querySelector('.stat-row__potential'), 'stats show the level 50 ceiling');
ok(doc.querySelectorAll('.partner__moves .pill').length >= 2, 'starting and upcoming moves are listed');

/* ------------------------------------------------------------------- 4 launch */

click(byText(/^Choose /));
await sleep(300);
ok(!!doc.querySelector('.modal__panel'), 'the confirmation dialog opens');
click([...doc.querySelectorAll('.modal__actions button')].find((b) => /^Yes/.test(b.textContent)));
for (let i = 0; i < 80 && !doc.querySelector('.launch'); i++) await sleep(25);
ok(!!doc.querySelector('.launch'), 'the launch cinematic plays');
await sleep(500);
ok(!!doc.querySelector('.launch__pct'), 'the cinematic shows a progress readout');
const tSkip = Date.now();
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
let skipMs = 0;
for (let i = 0; i < 60; i++) {
  await sleep(20);
  if (doc.querySelector('.view--dashboard')) { skipMs = Date.now() - tSkip; break; }
}
ok(skipMs > 0 && skipMs < 800, `Enter skips to the game in ${skipMs || '>1200'} ms`);

/* ----------------------------------------------------------------- 5 nexus */

ok(!!doc.querySelector('.hero__name'), 'the Nexus renders the profile');
ok(!!doc.querySelector('.help-list'), 'a primer tells the player what to do next');
ok(!!doc.querySelector('.quick-action.is-hint'), 'the first step is highlighted');
ok(doc.querySelectorAll('.objective').length === 0, 'objectives wait until the primer is dismissed');
click(byText(/^Got it$/));
await sleep(350);
ok(doc.querySelectorAll('.objective').length === 3, 'objectives appear after the primer');

rmSync(tmp, { recursive: true, force: true });

/* ------------------------------------------------- crawl the deployed app tree */

const seen = new Set();
let missing = 0;
async function crawl(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const res = await fetch(BASE + rel);
  if (!res.ok) { missing += 1; console.log(`FAIL ${rel} → ${res.status}`); return; }
  const src = await res.text();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,200}?from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const next = new URL(spec, new URL(rel, BASE)).pathname.replace(/^\/digipoke\//, '');
    if (next.endsWith('.css')) {
      const r = await fetch(BASE + next);
      if (!r.ok) { missing += 1; console.log(`FAIL ${next} → ${r.status}`); }
      seen.add(next);
      continue;
    }
    await crawl(next);
  }
}
await crawl('src/main.js');
ok(missing === 0, `every module the app imports is live (${seen.size} files crawled)`);

const swText = await (await fetch(`${BASE}sw.js`)).text();
const precache = [...swText.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const badAssets = [];
for (const asset of precache) {
  const r = await fetch(BASE + asset);
  if (!r.ok) badAssets.push(`${asset}:${r.status}`);
}
ok(badAssets.length === 0, `all ${precache.length} precached assets resolve${badAssets.length ? ` (missing: ${badAssets.join(', ')})` : ''}`);

console.log(failures === 0 ? '\n✅ LIVE BUILD VERIFIED' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
