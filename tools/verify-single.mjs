/**
 * verify-single.mjs — boot-tests the one-file build.
 *
 *   npm run build:single && npm run verify:single
 *
 * The single-file build loads its modules from `blob:` URLs created at runtime,
 * which jsdom cannot execute. This tool replays the *same* loader logic in
 * Node: identical placeholder substitution, but writing real files and
 * importing them over `file://` URLs instead. If the app boots, the splash
 * renders and the wizard advances, the build is sound.
 *
 * Skips itself (exit 0) when the dev-only dependencies are missing, so it is
 * safe to run on a bare checkout:
 *   npm i -D jsdom fake-indexeddb
 *
 * @module tools/verify-single
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

let JSDOM;
let IDBFactory;
try {
  ({ JSDOM } = await import('jsdom'));
  ({ IDBFactory } = await import('fake-indexeddb'));
} catch {
  console.log('verify-single: skipped (jsdom/fake-indexeddb not installed)');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const html = readFileSync('dist/digipoke.html', 'utf8');
const match = html.match(/<script id="digipoke-modules" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) { console.error('FAIL: payload script not found'); process.exit(1); }
const payload = JSON.parse(match[1].replace(/<\\\//g, '</'));

// --- jsdom environment (same as tests/ui.test.mjs) ---
const shell = readFileSync('apps/web/index.html', 'utf8').replace(/<script type="module"[\s\S]*?<\/script>/, '');
const dom = new JSDOM(shell, { url: 'https://example.test/', pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document, location: window.location, history: window.history,
  Node: window.Node, HTMLElement: window.HTMLElement, Event: window.Event,
  MouseEvent: window.MouseEvent, CustomEvent: window.CustomEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  indexedDB: new IDBFactory(),
});
try { globalThis.navigator = window.navigator; } catch { /* read-only */ }
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- replay the loader ---
const tmp = path.resolve('.verify-single-modules');
rmSync(tmp, { recursive: true, force: true });
const urls = new Map();
for (const mod of payload.modules) {
  let code = mod.code;
  for (const [key, url] of urls) code = code.split(`«${key}»`).join(url);
  if (code.includes('«')) { console.error('FAIL: unresolved placeholder in', mod.key); process.exit(1); }
  const file = path.join(tmp, mod.key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, code);
  urls.set(mod.key, pathToFileURL(file).href);
}

await import(urls.get(payload.entry));
await sleep(1200);

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok  ', msg); };

assert(!!document.querySelector('.view--onboarding'), 'single file boots into the app');
assert(document.querySelector('.splash__title')?.textContent?.trim() === 'DigiPoke', 'splash renders the title');
assert(document.querySelectorAll('.splash__creature').length === 3, 'splash renders three creature sprites');
assert(document.querySelector('.splash__creature svg'), 'creature sprites are real SVG');

const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Press Start'));
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(400);
assert(!!document.querySelector('#tamer-name'), 'Press Start advances to the identity step');
assert(!!document.querySelector('.idcard__frame svg'), 'the Tamer portrait renders live');

const inputs = [...document.querySelectorAll('.view--onboarding input.input')];
assert(inputs.length === 3, 'identity step has name + passphrase + confirm');
const setValue = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
setValue(inputs[0], 'Ada'); setValue(inputs[1], 'correct-horse-1'); setValue(inputs[2], 'correct-horse-1');
[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(900);
assert(document.querySelectorAll('.opt-group').length === 6, 'appearance step renders six option groups');
assert(!!document.querySelector('.stage__avatar svg'), 'avatar renders on the stage');

rmSync(tmp, { recursive: true, force: true });
console.log('\nsingle-file build verified: dist/digipoke.html boots and plays');
process.exit(0);
