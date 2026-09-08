/**
 * tamerAvatar.js — Procedural Tamer portrait & character creator artwork.
 *
 * The player's own avatar is generated from a small config object
 * (skin, hair style/colour, outfit, accessory). It is used:
 *   • large and animated during character creation,
 *   • as the dashboard hero portrait,
 *   • as a 28px badge in the top bar.
 *
 * Everything is SVG built from primitives with gradient shading, so the
 * creator can offer thousands of combinations with zero image assets and
 * instant live preview.
 *
 * @module ui/tamerAvatar
 */

let avatarCounter = 0;

/** Selectable options for the character creator. */
export const TAMER_OPTIONS = {
  skin: [
    { id: 'porcelain', name: 'Porcelain', hex: '#f7ddcf' },
    { id: 'sand',      name: 'Sand',      hex: '#eec3a3' },
    { id: 'honey',     name: 'Honey',     hex: '#d79a6a' },
    { id: 'umber',     name: 'Umber',     hex: '#a86a41' },
    { id: 'cocoa',     name: 'Cocoa',     hex: '#6f4128' },
    { id: 'espresso',  name: 'Espresso',  hex: '#43281a' },
    { id: 'aqua',      name: 'Refract',   hex: '#8fd9ff' },
    { id: 'lilac',     name: 'Glitch',    hex: '#d3b6ff' },
  ],
  hairStyle: [
    { id: 'spike',    name: 'Spiked' },
    { id: 'bob',      name: 'Bob' },
    { id: 'long',     name: 'Long' },
    { id: 'ponytail', name: 'Ponytail' },
    { id: 'afro',     name: 'Cloud' },
    { id: 'braid',    name: 'Braid' },
    { id: 'crop',     name: 'Crop' },
    { id: 'mohawk',   name: 'Mohawk' },
  ],
  hairColor: [
    { id: 'ink',     name: 'Ink',     hex: '#2b2f3d' },
    { id: 'chestnut',name: 'Chestnut',hex: '#6b3f2a' },
    { id: 'amber',   name: 'Amber',   hex: '#d8a13a' },
    { id: 'ash',     name: 'Ash',     hex: '#c9cfda' },
    { id: 'flame',   name: 'Flame',   hex: '#e2542c' },
    { id: 'tide',    name: 'Tide',    hex: '#2f7fd1' },
    { id: 'virus',   name: 'Virus',   hex: '#c33ea0' },
    { id: 'mint',    name: 'Mint',    hex: '#4fd6a8' },
  ],
  outfit: [
    { id: 'nexus',  name: 'Nexus',  hex: '#5b6cff' },
    { id: 'ember',  name: 'Ember',  hex: '#e2542c' },
    { id: 'moss',   name: 'Moss',   hex: '#3f9c53' },
    { id: 'frost',  name: 'Frost',  hex: '#3aa7d6' },
    { id: 'void',   name: 'Void',   hex: '#2b2f3d' },
    { id: 'solar',  name: 'Solar',  hex: '#e0b32a' },
    { id: 'orchid', name: 'Orchid', hex: '#a34ec9' },
    { id: 'rose',   name: 'Rose',   hex: '#d9557d' },
  ],
  accessory: [
    { id: 'none',    name: 'None' },
    { id: 'visor',   name: 'Visor' },
    { id: 'band',    name: 'Band' },
    { id: 'goggles', name: 'Goggles' },
    { id: 'cans',    name: 'Headset' },
    { id: 'halo',    name: 'Halo' },
  ],
  eyes: [
    { id: 'resolve', name: 'Resolve' },
    { id: 'bright',  name: 'Bright' },
    { id: 'calm',    name: 'Calm' },
    { id: 'glitch',  name: 'Glitch' },
  ],
};

/** Default avatar used until the player customises. */
export const DEFAULT_TAMER = {
  skin: 'sand',
  hairStyle: 'spike',
  hairColor: 'ink',
  outfit: 'nexus',
  accessory: 'visor',
  eyes: 'resolve',
};

/** Look up a palette entry, falling back to the first option. */
function pick(group, id) {
  return TAMER_OPTIONS[group].find((o) => o.id === id) || TAMER_OPTIONS[group][0];
}

/**
 * Render a Tamer portrait as inline SVG.
 *
 * @param {object} [config] Avatar config (see TAMER_OPTIONS).
 * @param {object} [opts]
 * @param {number} [opts.size=140] Rendered size in px.
 * @param {'idle'|'happy'|'determined'|'wink'} [opts.mood]
 * @param {boolean} [opts.animate=true] Blink + float animations.
 * @param {boolean} [opts.frame=false] Draw the circular badge background.
 * @returns {string} SVG markup.
 */
export function tamerAvatar(config = DEFAULT_TAMER, { size = 140, mood = 'idle', animate = true, frame = true } = {}) {
  const skin = pick('skin', config.skin).hex;
  const hair = pick('hairColor', config.hairColor).hex;
  const outfit = pick('outfit', config.outfit).hex;
  const style = pick('hairStyle', config.hairStyle).id;
  const accessory = pick('accessory', config.accessory).id;
  const eyes = pick('eyes', config.eyes).id;

  const id = `av${++avatarCounter}`;
  const skinDark = shade(skin, -18);
  const hairDark = shade(hair, -22);
  const hairLight = shade(hair, 22);
  const outfitDark = shade(outfit, -26);
  const outfitLight = shade(outfit, 26);

  // Eye colour by personality.
  const eyeColors = {
    resolve: '#2f6fd0', bright: '#3fa97a', calm: '#7a6bd6', glitch: '#d63ea0',
  };
  const iris = eyeColors[eyes] || eyeColors.resolve;

  return `<svg class="avatar${animate ? ' avatar--anim' : ''}" width="${size}" height="${size}" viewBox="0 0 120 120" \
role="img" aria-label="Tamer portrait" xmlns="http://www.w3.org/2000/svg">\
<defs>\
<linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1">\
<stop offset="0%" stop-color="${shade(outfit, 34)}"/>\
<stop offset="100%" stop-color="${shade(outfit, -34)}"/>\
</linearGradient>\
<linearGradient id="skin${id}" x1="0.3" y1="0" x2="0.7" y2="1">\
<stop offset="0%" stop-color="${shade(skin, 14)}"/>\
<stop offset="70%" stop-color="${skin}"/>\
<stop offset="100%" stop-color="${skinDark}"/>\
</linearGradient>\
<linearGradient id="hair${id}" x1="0.2" y1="0" x2="0.8" y2="1">\
<stop offset="0%" stop-color="${hairLight}"/>\
<stop offset="60%" stop-color="${hair}"/>\
<stop offset="100%" stop-color="${hairDark}"/>\
</linearGradient>\
<linearGradient id="cloth${id}" x1="0" y1="0" x2="0.6" y2="1">\
<stop offset="0%" stop-color="${outfitLight}"/>\
<stop offset="55%" stop-color="${outfit}"/>\
<stop offset="100%" stop-color="${outfitDark}"/>\
</linearGradient>\
<clipPath id="clip${id}"><circle cx="60" cy="60" r="58"/></clipPath>\
</defs>\
<g clip-path="url(#clip${id})">\
${frame ? `<circle cx="60" cy="60" r="58" fill="url(#bg${id})"/>` : ''}\
${frame ? `<circle cx="60" cy="60" r="58" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="6"/>` : ''}\
${frame ? `<circle cx="42" cy="34" r="30" fill="#fff" opacity="0.10"/>` : ''}\
<g class="avatar__body">\
${hairBack(style, hair, hairDark, id)}\
<path d="M14 120 q6 -30 46 -30 q40 0 46 30 z" fill="url(#cloth${id})"/>\
<path d="M46 90 l14 16 l14 -16 l-6 -4 h-16 z" fill="${shade(skin, 6)}"/>\
<path d="M40 92 q20 16 40 0 l6 6 q-26 20 -52 0 z" fill="${outfitLight}" opacity="0.85"/>\
<rect x="52" y="86" width="16" height="12" rx="5" fill="url(#skin${id})"/>\
<ellipse cx="60" cy="60" rx="26" ry="29" fill="url(#skin${id})"/>\
<ellipse cx="38" cy="62" rx="5" ry="7" fill="${skinDark}"/>\
<ellipse cx="82" cy="62" rx="5" ry="7" fill="${skinDark}"/>\
${hairFront(style, hair, hairLight, hairDark, id)}\
${eyesGroup(iris, mood, eyes)}\
<path d="M54 70 q6 4 12 0" stroke="${shade(skin, -40)}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.7"/>\
${mouth(mood)}\
<ellipse cx="45" cy="70" rx="6" ry="3.4" fill="#ff7d9c" opacity="0.35"/>\
<ellipse cx="75" cy="70" rx="6" ry="3.4" fill="#ff7d9c" opacity="0.35"/>\
${accessoryLayer(accessory, outfit, outfitLight)}\
</g>\
</g>\
</svg>`;
}

/* ------------------------------------------------------------------- parts */

function hairBack(style, hair, hairDark, id) {
  const fill = `url(#hair${id})`;
  switch (style) {
    case 'long':
      return `<path d="M28 66 q-6 34 8 54 h48 q14 -20 8 -54 z" fill="${fill}"/>`;
    case 'ponytail':
      return `<path d="M84 44 q22 6 18 34 q-4 22 -20 20 q10 -22 2 -54 z" fill="${fill}"/>
              <circle cx="86" cy="46" r="7" fill="${hairDark}"/>`;
    case 'afro':
      return `<circle cx="60" cy="46" r="34" fill="${fill}"/>`;
    case 'braid':
      return `<path d="M40 58 q-10 30 4 62 h14 q-10 -32 0 -62 z" fill="${fill}"/>`;
    default:
      return '';
  }
}

function hairFront(style, hair, hairLight, hairDark, id) {
  const fill = `url(#hair${id})`;
  switch (style) {
    case 'spike':
      return `<path d="M32 52 q4 -34 28 -34 q26 0 28 34 q-8 -14 -18 -8 q-4 -12 -12 -4 q-8 -10 -14 4 q-8 -6 -12 8 z" fill="${fill}"/>
              <path d="M40 40 l4 -16 l8 12 z" fill="${hairLight}" opacity="0.75"/>`;
    case 'bob':
      return `<path d="M30 54 q0 -36 30 -36 q30 0 30 36 q-6 -10 -14 -12 l-4 22 q-12 8 -24 0 l-4 -22 q-10 2 -14 12 z" fill="${fill}"/>`;
    case 'long':
      return `<path d="M30 54 q2 -36 30 -36 q28 0 30 36 q-10 -14 -16 -14 l-4 26 q-10 8 -20 0 l-4 -26 q-8 0 -16 14 z" fill="${fill}"/>`;
    case 'ponytail':
      return `<path d="M32 52 q6 -34 28 -34 q24 0 26 32 q-12 -12 -20 -8 q-10 -10 -18 2 q-10 -4 -16 8 z" fill="${fill}"/>`;
    case 'afro':
      return `<circle cx="60" cy="46" r="30" fill="${fill}"/>
              <circle cx="46" cy="34" r="9" fill="${hairLight}" opacity="0.5"/>
              <circle cx="72" cy="38" r="7" fill="${hairLight}" opacity="0.35"/>`;
    case 'braid':
      return `<path d="M32 52 q4 -32 28 -32 q24 0 26 32 q-12 -12 -22 -10 q-8 -8 -16 2 q-10 -2 -16 8 z" fill="${fill}"/>
              <path d="M34 54 q-6 10 -2 20" stroke="${hairDark}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'crop':
      return `<path d="M33 50 q3 -28 27 -28 q24 0 27 28 q-14 -8 -27 -8 q-13 0 -27 8 z" fill="${fill}"/>`;
    case 'mohawk':
      return `<path d="M46 44 q14 -34 28 0 q-6 -6 -14 -6 q-8 0 -14 6 z" fill="${fill}"/>
              <path d="M36 52 q2 -22 8 -26" stroke="${hairDark}" stroke-width="5" fill="none" stroke-linecap="round"/>
              <path d="M84 52 q-2 -22 -8 -26" stroke="${hairDark}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M32 52 q4 -32 28 -32 q24 0 28 32 q-14 -10 -28 -10 q-14 0 -28 10 z" fill="${fill}"/>`;
  }
}

function eyesGroup(iris, mood, personality) {
  const wink = mood === 'wink';
  const left = wink
    ? `<path d="M44 58 q6 -6 12 0" stroke="#2b2f3d" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    : eye(48, 58, iris, 5.6, personality);
  const right = eye(72, 58, iris, 5.6, personality);
  const browY = mood === 'determined' ? 44 : 47;
  const tilt = mood === 'determined' ? 3 : 0;
  return `<g class="avatar__eyes">
    ${left}${right}
    <path d="M41 ${browY + tilt} q7 -3 13 0" stroke="#2b2f3d" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.8"/>
    <path d="M66 ${browY} q7 -3 13 ${tilt}" stroke="#2b2f3d" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.8"/>
  </g>`;
}

function eye(cx, cy, iris, r, personality) {
  const glitch = personality === 'glitch';
  return `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.15}" fill="#fff"/>
  <circle cx="${cx + 0.6}" cy="${cy + 0.4}" r="${r * 0.62}" fill="${iris}"/>
  <circle cx="${cx + 0.6}" cy="${cy + 0.2}" r="${r * 0.3}" fill="#10131c"/>
  <circle cx="${cx - 1.6}" cy="${cy - 1.8}" r="${r * 0.26}" fill="#fff" opacity="0.95"/>
  ${glitch ? `<rect x="${cx - r}" y="${cy - r * 0.2}" width="${r * 2}" height="1.6" fill="#fff" opacity="0.6"/>` : ''}`;
}

function mouth(mood) {
  switch (mood) {
    case 'happy':
      return `<path d="M50 76 q10 10 20 0 q-10 5 -20 0 z" fill="#8c3a4a"/>
              <path d="M50 76 q10 10 20 0" stroke="#6d2b39" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    case 'determined':
      return `<path d="M52 78 q8 4 16 -2" stroke="#7d3543" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    case 'wink':
      return `<path d="M50 76 q10 9 20 -2" stroke="#7d3543" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M52 77 q8 6 16 0" stroke="#7d3543" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  }
}

function accessoryLayer(accessory, outfit, outfitLight) {
  switch (accessory) {
    case 'visor':
      return `<path d="M34 52 h52 v13 h-52 z" rx="6" fill="#0e1424" opacity="0.9"/>
              <path d="M36 55 h48 v4 h-48 z" fill="${outfitLight}" opacity="0.85"/>
              <circle cx="38" cy="52" r="4" fill="${outfit}"/>
              <circle cx="82" cy="52" r="4" fill="${outfit}"/>`;
    case 'band':
      return `<path d="M31 50 q29 -12 58 0 v9 q-29 -10 -58 0 z" fill="${outfit}"/>
              <path d="M31 50 q29 -12 58 0" stroke="${outfitLight}" stroke-width="2" fill="none"/>`;
    case 'goggles':
      return `<circle cx="48" cy="56" r="10" fill="none" stroke="${outfitLight}" stroke-width="3.4"/>
              <circle cx="72" cy="56" r="10" fill="none" stroke="${outfitLight}" stroke-width="3.4"/>
              <circle cx="48" cy="56" r="7.4" fill="#7fdcff" opacity="0.45"/>
              <circle cx="72" cy="56" r="7.4" fill="#7fdcff" opacity="0.45"/>
              <path d="M58 56 h4" stroke="${outfitLight}" stroke-width="3"/>`;
    case 'cans':
      return `<path d="M28 56 q0 -30 32 -30 q32 0 32 30" fill="none" stroke="${outfit}" stroke-width="6" stroke-linecap="round"/>
              <rect x="24" y="50" width="12" height="18" rx="6" fill="${outfitLight}"/>
              <rect x="84" y="50" width="12" height="18" rx="6" fill="${outfitLight}"/>
              <path d="M92 62 q8 4 6 12" stroke="${outfitLight}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
              <circle cx="99" cy="77" r="3.4" fill="${outfitLight}"/>`;
    case 'halo':
      return `<ellipse cx="60" cy="24" rx="20" ry="6" fill="none" stroke="#ffe27a" stroke-width="3.4" opacity="0.95"/>
              <ellipse cx="60" cy="24" rx="20" ry="6" fill="none" stroke="#fff6c9" stroke-width="1.2" opacity="0.8"/>`;
    default:
      return '';
  }
}

/* ------------------------------------------------------------------ utils */

/** Shade a hex colour by amount (-100…100). */
function shade(hex, amount) {
  const s = String(hex).replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount) / 100;
  const rgb = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16);
    return Math.round(v + (target - v) * ratio);
  });
  return `#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Deterministic random avatar (used for the "Surprise me" button).
 * @param {() => number} rand
 */
export function randomTamer(rand = Math.random) {
  const pickOne = (arr) => arr[Math.floor(rand() * arr.length)].id;
  return {
    skin: pickOne(TAMER_OPTIONS.skin),
    hairStyle: pickOne(TAMER_OPTIONS.hairStyle),
    hairColor: pickOne(TAMER_OPTIONS.hairColor),
    outfit: pickOne(TAMER_OPTIONS.outfit),
    accessory: pickOne(TAMER_OPTIONS.accessory),
    eyes: pickOne(TAMER_OPTIONS.eyes),
  };
}

/** Count of possible combinations (shown in the creator UI). */
export function combinationCount() {
  return Object.values(TAMER_OPTIONS).reduce((n, group) => n * group.length, 1);
}
