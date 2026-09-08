/**
 * gallery.mjs — Art contact sheet generator.
 *
 * The sprite and avatar renderers are pure functions (module → SVG string), so
 * they can be executed outside the browser. This tool renders every creature
 * and a spread of Tamer avatars into two standalone files:
 *
 *   previews/gallery.html     browsable gallery (open in any browser)
 *   previews/contactsheet.svg single flat SVG, handy for diffing art changes
 *
 * It exists so art regressions are visible: run it after touching sprite.js or
 * tamerAvatar.js and eyeball the result (or diff the SVG in git).
 *
 * Usage: node tools/gallery.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPECIES_IDS, getSpecies } from '../apps/web/src/domain/species.js';
import { sprite, portrait } from '../apps/web/src/ui/sprite.js';
import { tamerAvatar, randomTamer, combinationCount } from '../apps/web/src/ui/tamerAvatar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'previews');
mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ dex */

const CELL = 168;
const COLS = 6;

/** One gallery cell: portrait art, name, types. */
function dexCell(id, index) {
  const species = getSpecies(id);
  const art = sprite(species.art, { size: 128, mood: 'idle' })
    .replace('<svg', `<svg class="art"`);
  const shiny = sprite(species.art, { size: 44, shiny: true, mood: 'happy' });
  const x = (index % COLS) * CELL;
  const y = Math.floor(index / COLS) * CELL;

  return `
    <div class="cell" style="left:${x}px;top:${y}px">
      <div class="art">${art}</div>
      <div class="name">${species.name}</div>
      <div class="types">${species.types.join(' · ')}</div>
      <div class="shiny" title="shiny">${shiny}</div>
    </div>`;
}

const rows = Math.ceil(SPECIES_IDS.length / COLS);
const dexHtml = SPECIES_IDS.map(dexCell).join('');

/* --------------------------------------------------------------- tamers */

/** Deterministic pseudo-random so the gallery is stable between runs. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = seeded(20260907);
const tamers = Array.from({ length: 12 }, () => randomTamer(rand));
const tamerHtml = tamers
  .map((t) => `<div class="tamer">${tamerAvatar(t, { size: 120, mood: 'happy' })}</div>`)
  .join('');

/* --------------------------------------------------------------- moods */

const moodHtml = ['idle', 'happy', 'attack', 'hurt', 'faint']
  .map((mood) => `
    <div class="mood">
      ${sprite(getSpecies('emberling').art, { size: 110, mood })}
      <span>${mood}</span>
    </div>`)
  .join('');

const portraits = ['emberling', 'aquafin', 'verdling']
  .filter((id) => SPECIES_IDS.includes(id))
  .map((id) => `<div class="portrait-cell">${portrait(getSpecies(id).art, { size: 220, mood: 'happy' })}</div>`)
  .join('');

/* ----------------------------------------------------------------- html */

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DigiPoke — art contact sheet</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 32px;
    background: #070b12; color: #e7eefb;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 36px 0 12px; text-transform: uppercase; letter-spacing: .12em; color: #7f9ac4; }
  p.sub { margin: 0 0 8px; color: #8ea6c8; }
  .dex { position: relative; height: ${rows * CELL}px; }
  .cell {
    position: absolute; width: ${CELL - 8}px; height: ${CELL - 8}px;
    display: grid; place-items: center; align-content: center; gap: 2px;
    border: 1px solid #16233a; border-radius: 14px;
    background: linear-gradient(180deg, #0d1626, #0a1220);
  }
  .cell .art { display: grid; place-items: center; height: 132px; }
  .name { font-weight: 700; }
  .types { font-size: 11px; color: #7f9ac4; text-transform: uppercase; letter-spacing: .06em; }
  .shiny { position: absolute; right: 6px; bottom: 6px; opacity: .9; }
  .tamers, .moods, .portraits { display: flex; flex-wrap: wrap; gap: 14px; }
  .tamer, .mood {
    display: grid; place-items: center; gap: 6px;
    padding: 10px; border: 1px solid #16233a; border-radius: 14px;
    background: linear-gradient(180deg, #0d1626, #0a1220);
  }
  .mood span { font-size: 11px; color: #7f9ac4; text-transform: uppercase; letter-spacing: .08em; }
</style>
</head>
<body>
  <h1>DigiPoke art contact sheet</h1>
  <p class="sub">${SPECIES_IDS.length} creatures · ${combinationCount().toLocaleString('en-GB')} Tamer combinations · every byte of this art is generated from code at runtime.</p>

  <h2>Creature sprites</h2>
  <div class="dex">${dexHtml}</div>

  <h2>Portraits (starter showcase)</h2>
  <div class="portraits">${portraits}</div>

  <h2>Expressions</h2>
  <div class="moods">${moodHtml}</div>

  <h2>Tamer avatars</h2>
  <div class="tamers">${tamerHtml}</div>
</body>
</html>`;

/* ------------------------------------------------------------------ svg */

const SHEET_COLS = 8;
const SHEET_CELL = 140;
const sheetRows = Math.ceil(SPECIES_IDS.length / SHEET_COLS);
const sheetCells = SPECIES_IDS.map((id, i) => {
  const x = (i % SHEET_COLS) * SHEET_CELL;
  const y = Math.floor(i / SHEET_COLS) * SHEET_CELL;
  const inner = sprite(getSpecies(id).art, { size: 120 })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  return `<g transform="translate(${x},${y})">${inner}<text x="70" y="132" fill="#7f9ac4" font-family="system-ui" font-size="10" text-anchor="middle">${getSpecies(id).name}</text></g>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_COLS * SHEET_CELL}" height="${sheetRows * SHEET_CELL}" viewBox="0 0 ${SHEET_COLS * SHEET_CELL} ${sheetRows * SHEET_CELL}">
<rect width="100%" height="100%" fill="#070b12"/>
${sheetCells}
</svg>`;

writeFileSync(resolve(OUT_DIR, 'gallery.html'), html);
writeFileSync(resolve(OUT_DIR, 'contactsheet.svg'), svg);

console.log(`wrote previews/gallery.html (${SPECIES_IDS.length} creatures, 12 tamers)`);
console.log(`wrote previews/contactsheet.svg (${SHEET_COLS}x${sheetRows} grid)`);
