#!/usr/bin/env node
/**
 * banner.mjs — generate the repository's header artwork.
 *
 * Produces two files from the game's own renderers, so the banner can never
 * drift away from the art that ships in the app:
 *
 *   .github/assets/banner.svg   1280x640 vector (used as the README hero)
 *   .github/assets/banner.png   1280x640 raster (used as GitHub's social
 *                               preview image, which requires PNG or JPG)
 *
 * The creature art on the right is the real `portrait()` output for the three
 * starters — no exported bitmaps, no manual touch-ups.
 *
 * Rasterisation, in order of preference:
 *   1. `npm i --no-save @resvg/resvg-js` — best SVG fidelity (optional, not a
 *      project dependency, because the game itself never needs it)
 *   2. ImageMagick (`magick` / `convert`) — usually available in CI images
 *   3. Skipped, with instructions
 *
 * Deliberate constraint: the SVG uses only shapes, gradients and opacity — no
 * filters and no `<pattern>` — so it rasterises correctly even under
 * ImageMagick's internal MSVG renderer.
 *
 * USAGE
 *   node tools/banner.mjs [--url https://you.github.io/digipoke/]
 *
 * @module tools/banner
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STARTER_IDS, getSpecies } from '../apps/web/src/domain/species.js';
import { TYPE_IDS, TYPES } from '../apps/web/src/domain/types.js';
import { portrait } from '../apps/web/src/ui/sprite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', '.github', 'assets');

const W = 1280;
const H = 640;
const OWNER = process.env.BANNER_OWNER || 'LIN4CRE';
const REPO = process.env.BANNER_REPO || 'digipoke';

const urlArg = process.argv.indexOf('--url');
const SITE_URL = urlArg > -1 ? process.argv[urlArg + 1] : '';

/* ------------------------------------------------------------------ atoms */

/** A creature portrait placed with its centre at (cx, baselineY). */
function creature(id, cx, baseY, size) {
  const species = getSpecies(id);
  const svg = portrait(species.art, { size, mood: 'idle', flip: 'left', platform: true });
  // portrait() returns a complete, self-contained <svg> with its own width,
  // height and viewBox. It is positioned with a transform rather than by
  // injecting x/y/width/height, which would duplicate those attributes and
  // produce invalid XML (ImageMagick's MSVG renderer rejects it outright).
  return `
    <g>
      <ellipse cx="${cx}" cy="${baseY + 6}" rx="${size * 0.42}" ry="${size * 0.055}" fill="#05070f" opacity="0.55"/>
      <g transform="translate(${cx - size / 2} ${baseY - size})">${svg}</g>
    </g>`;
}

/** Feature pill: rounded chip with a coloured dot and a label. */
function pill(x, y, label, colour) {
  const width = label.length * 11.6 + 40;
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${width}" height="44" rx="22" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.14"/>
      <circle cx="20" cy="22" r="6" fill="${colour}"/>
      <text x="36" y="28" fill="#c7d3ee" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="18">${label}</text>
    </g>`;
}

/* ------------------------------------------------------------------ banner */

const FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace";

const pills = [
  ['34 species', TYPES.flame.color],
  ['10 elements', TYPES.byte.color],
  ['Offline-first PWA', TYPES.aqua.color],
  ['Zero runtime deps', TYPES.verdant.color],
  ['Encrypted sync', TYPES.null.color],
];

let pillX = 72;
const pillMarkup = pills
  .map(([label, colour]) => {
    const width = label.length * 11.6 + 40;
    const out = pill(pillX, 392, label, colour);
    pillX += width + 14;
    return out;
  })
  .join('');

// Faint grid — drawn as explicit lines so no renderer-specific features are needed.
const gridLines = [];
for (let x = 0; x <= W; x += 64) gridLines.push(`M${x} 0V${H}`);
for (let y = 0; y <= H; y += 64) gridLines.push(`M0 ${y}H${W}`);
const grid = `<path d="${gridLines.join(' ')}" stroke="#7cf6ff" stroke-opacity="0.05" stroke-width="1" fill="none"/>`;

// Element strip along the bottom edge, one segment per type.
const seg = W / TYPE_IDS.length;
const strip = TYPE_IDS.map((id, i) => `<rect x="${i * seg}" y="${H - 10}" width="${seg + 1}" height="10" fill="${TYPES[id].color}" opacity="0.85"/>`).join('');

const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="DigiPoke — a local-first creature-collecting battler PWA">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#0a0e1c"/>
      <stop offset="55%" stop-color="#101833"/>
      <stop offset="100%" stop-color="#1b1030"/>
    </linearGradient>
    <radialGradient id="haze" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#7cf6ff" stop-opacity="0.20"/>
      <stop offset="60%" stop-color="#b48cff" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#b48cff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7cf6ff"/>
      <stop offset="48%" stop-color="#b48cff"/>
      <stop offset="100%" stop-color="#ff6b9d"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7cf6ff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#7cf6ff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- backdrop -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${grid}
  <ellipse cx="1010" cy="300" rx="430" ry="330" fill="url(#haze)"/>
  <circle cx="1010" cy="300" r="250" fill="#0b1226" opacity="0.45"/>

  <!-- wordmark -->
  <text x="72" y="266" font-family="${FONT}" font-size="118" font-weight="700" letter-spacing="-3" fill="url(#title)">DigiPoke</text>
  <rect x="74" y="304" width="300" height="4" fill="url(#rule)"/>
  <text x="72" y="356" font-family="${FONT}" font-size="27" fill="#9fb0d0">A local-first creature battler — offline, installable, zero dependencies.</text>

  ${pillMarkup}

  <text x="72" y="512" font-family="${MONO}" font-size="21" fill="#6f83a8">github.com/${OWNER}/${REPO}</text>
  ${SITE_URL ? `<text x="72" y="546" font-family="${MONO}" font-size="21" fill="#6f83a8">play: ${SITE_URL}</text>` : ''}

  <!-- the three starters, straight from the shipped renderer -->
  ${creature(STARTER_IDS[0], 830, 430, 210)}
  ${creature(STARTER_IDS[1], 1010, 452, 244)}
  ${creature(STARTER_IDS[2], 1185, 430, 210)}

  ${strip}
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'banner.svg'), banner, 'utf8');
console.log(`wrote .github/assets/banner.svg (${W}x${H})`);

/* ------------------------------------------------------------- rasteriser */

async function rasterise(svgPath, pngPath) {
  // 1. resvg — accurate, and handles everything sprite.js emits.
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(svgPath ? (await import('node:fs')).readFileSync(svgPath) : banner, {
      fitTo: { mode: 'width', value: W },
    });
    writeFileSync(pngPath, resvg.render().asPng());
    return 'resvg';
  } catch {
    /* not installed — fall through */
  }

  // 2. ImageMagick.
  for (const bin of ['magick', 'convert']) {
    try {
      execFileSync(bin, [svgPath, '-strip', pngPath], { stdio: 'ignore' });
      return bin;
    } catch {
      /* try the next binary */
    }
  }
  return null;
}

const pngPath = resolve(OUT_DIR, 'banner.png');
const engine = await rasterise(resolve(OUT_DIR, 'banner.svg'), pngPath);
if (engine) {
  console.log(`wrote .github/assets/banner.png (via ${engine})`);
} else {
  console.log('! no rasteriser available — install one and re-run:');
  console.log('    npm i --no-save @resvg/resvg-js   # or: sudo apt-get install imagemagick');
}
