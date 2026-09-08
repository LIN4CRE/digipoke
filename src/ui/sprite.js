/**
 * sprite.js — Procedural creature renderer ("living concept art", zero assets).
 *
 * Every DigiPoke creature is drawn as inline SVG generated from the `art`
 * descriptor on its species record. This is a deliberate product decision:
 *
 *   • 0 KB of image payload — the whole game ships as text.
 *   • Recolouring (Glitch/shiny variants) is a hue rotation, not new art.
 *   • Sprites animate: breathing, blinking, elemental motes, mood expressions.
 *
 * Rendering pipeline (bottom to top):
 *   ground shadow → elemental aura → back appendages (wings/tail) → body with
 *   gradient shading → belly → pattern → limbs → head → face (eyes/mouth) →
 *   crest/spikes → rim light → mood FX
 *
 * All coordinates live in a 120×120 viewBox. Colours are derived from two
 * inputs (body + accent) via HSL manipulation, so a single palette change
 * re-skins an entire species.
 *
 * @module ui/sprite
 */

/** Monotonic counter: guarantees unique gradient ids across many instances. */
let instanceCounter = 0;

/**
 * Render a creature as an inline SVG string.
 *
 * @param {object} art Species art descriptor.
 * @param {object} [opts]
 * @param {number} [opts.size=96] Rendered size in px.
 * @param {boolean} [opts.shiny] Glitch (shiny) palette + sparkles.
 * @param {'idle'|'happy'|'attack'|'hurt'|'faint'|'reveal'} [opts.mood]
 * @param {'left'|'right'} [opts.flip] Facing direction.
 * @param {boolean} [opts.animate=true] Include idle/blink animations.
 * @returns {string} SVG markup.
 */
export function sprite(art, { size = 96, shiny = false, mood = 'idle', flip = 'right', animate = true } = {}) {
  const a = normaliseArt(art, shiny);
  const id = `sp${++instanceCounter}`;
  const body = renderBody(a, id, mood);
  const flipAttr = flip === 'left' ? ' transform="translate(120,0) scale(-1,1)"' : '';
  const animClass = animate ? ` sp--${mood}` : '';

  return `<svg class="sprite${animClass}" width="${size}" height="${size}" viewBox="0 0 120 120" \
role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">\
${defs(a, id)}\
<ellipse class="sp-shadow" cx="60" cy="110" rx="32" ry="6.5" fill="#04070e" opacity="0.34"/>\
<circle cx="60" cy="62" r="55" fill="url(#aura${id})"/>\
${a.stage === 'mega' || a.stage === 'ultimate' ? motes(a, id) : ''}\
<g${flipAttr}>${body}</g>\
${shiny ? sparkles(a) : ''}\
</svg>`;
}

/* --------------------------------------------------------------- normalise */

/** Apply defaults and the Glitch recolour. */
function normaliseArt(art, shiny) {
  const a = {
    shape: 'blob', body: '#8ea0c8', accent: '#d9e2f2', eye: 2, tail: 0,
    spikes: 0, wings: 0, pattern: 'none', aura: '#9aa7c4', stage: 'rookie',
    ...art,
  };
  if (shiny) {
    a.body = shiftHue(a.body, 165);
    a.accent = shiftHue(a.accent, 165);
    a.aura = shiftHue(a.aura, 165);
    a.glitch = true;
  }
  return a;
}

/* -------------------------------------------------------------------- defs */

function defs(a, id) {
  return `<defs>\
<linearGradient id="body${id}" x1="0.25" y1="0" x2="0.62" y2="1">\
<stop offset="0%" stop-color="${lighten(a.body, 30)}"/>\
<stop offset="45%" stop-color="${a.body}"/>\
<stop offset="100%" stop-color="${darken(a.body, 26)}"/>\
</linearGradient>\
<radialGradient id="belly${id}" cx="0.5" cy="0.34" r="0.72">\
<stop offset="0%" stop-color="${lighten(a.accent, 34)}" stop-opacity="0.96"/>\
<stop offset="70%" stop-color="${a.accent}" stop-opacity="0.55"/>\
<stop offset="100%" stop-color="${darken(a.accent, 12)}" stop-opacity="0.08"/>\
</radialGradient>\
<radialGradient id="aura${id}" cx="0.5" cy="0.5" r="0.5">\
<stop offset="0%" stop-color="${a.aura}" stop-opacity="${a.stage === 'mega' ? 0.5 : 0.34}"/>\
<stop offset="62%" stop-color="${a.aura}" stop-opacity="0.12"/>\
<stop offset="100%" stop-color="${a.aura}" stop-opacity="0"/>\
</radialGradient>\
<linearGradient id="sheen${id}" x1="0" y1="0" x2="0" y2="1">\
<stop offset="0%" stop-color="#ffffff" stop-opacity="0.42"/>\
<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>\
</linearGradient>\
</defs>`;
}

/** Orbiting elemental motes for evolved forms. */
function motes(a, id) {
  const count = a.stage === 'mega' ? 6 : 3;
  let out = '';
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const cx = 60 + Math.cos(angle) * 42;
    const cy = 60 + Math.sin(angle) * 38;
    out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${a.stage === 'mega' ? 2.6 : 1.9}" fill="${a.aura}" opacity="0.75">\
<animate attributeName="opacity" values="0.2;0.9;0.2" dur="${(2.4 + i * 0.35).toFixed(2)}s" repeatCount="indefinite" begin="${(i * 0.28).toFixed(2)}s"/>\
<animateTransform attributeName="transform" type="rotate" from="${(angle * 57).toFixed(0)} 60 60" to="${(angle * 57 + 360).toFixed(0)} 60 60" dur="${14 + i}s" repeatCount="indefinite"/>\
</circle>`;
  }
  return `<g class="sp-motes">${out}</g>`;
}

/** Glitch-variant sparkles. */
function sparkles(a) {
  const pts = [[26, 34], [94, 44], [40, 92], [88, 86]];
  return `<g class="sp-sparkles">${pts.map(([x, y], i) => `<path d="M${x} ${y - 5} L${x + 1.6} ${y} L${x + 5} ${y + 1.6} L${x + 1.6} ${y + 3.2} L${x} ${y + 8} L${x - 1.6} ${y + 3.2} L${x - 5} ${y + 1.6} L${x - 1.6} ${y} Z" fill="#fff" opacity="0.85">\
<animate attributeName="opacity" values="0;0.95;0" dur="2.2s" begin="${(i * 0.55).toFixed(2)}s" repeatCount="indefinite"/>\
</path>`).join('')}</g>`;
}

/* ------------------------------------------------------------------- faces */

/**
 * Big, expressive eyes — the single biggest driver of "cuteness".
 * Sclera + iris + pupil + two highlights + eyelid + brow.
 */
function eyes(a, cx, cy, r, mood, count = 2) {
  const n = Math.max(1, Math.min(6, count || 2));
  const spread = n === 1 ? 0 : (n <= 2 ? r * 2.05 : r * 1.7);
  const startX = cx - (spread * (n - 1)) / 2;
  const irisColor = a.eyeColor || darken(a.accent, 26);

  // Fainted: X X. Hurt: > <. Happy: ^ ^.
  if (mood === 'faint') {
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = startX + i * spread;
      out += `<g stroke="#2a2f3d" stroke-width="2.6" stroke-linecap="round">\
<line x1="${x - r * 0.7}" y1="${cy - r * 0.7}" x2="${x + r * 0.7}" y2="${cy + r * 0.7}"/>\
<line x1="${x + r * 0.7}" y1="${cy - r * 0.7}" x2="${x - r * 0.7}" y2="${cy + r * 0.7}"/>\
</g>`;
    }
    return out;
  }
  if (mood === 'happy') {
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = startX + i * spread;
      out += `<path d="M${x - r} ${cy + r * 0.35} Q${x} ${cy - r * 0.95} ${x + r} ${cy + r * 0.35}" fill="none" stroke="#2a2f3d" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    return out;
  }

  let out = '<g class="sp-eyes">';
  for (let i = 0; i < n; i++) {
    const x = startX + i * spread;
    const er = n > 3 ? r * 0.82 : r;
    out += `<ellipse cx="${x.toFixed(1)}" cy="${cy}" rx="${er}" ry="${(er * 1.1).toFixed(1)}" fill="#ffffff" stroke="${darken(a.body, 46)}" stroke-width="1.4"/>\
<ellipse cx="${(x + er * 0.12).toFixed(1)}" cy="${(cy + er * 0.08).toFixed(1)}" rx="${(er * 0.62).toFixed(1)}" ry="${(er * 0.72).toFixed(1)}" fill="${irisColor}"/>\
<ellipse cx="${(x + er * 0.12).toFixed(1)}" cy="${(cy + er * 0.05).toFixed(1)}" rx="${(er * 0.3).toFixed(1)}" ry="${(er * 0.4).toFixed(1)}" fill="#141821"/>\
<circle cx="${(x - er * 0.24).toFixed(1)}" cy="${(cy - er * 0.3).toFixed(1)}" r="${(er * 0.3).toFixed(1)}" fill="#fff" opacity="0.95"/>\
<circle cx="${(x + er * 0.42).toFixed(1)}" cy="${(cy + er * 0.34).toFixed(1)}" r="${(er * 0.15).toFixed(1)}" fill="#fff" opacity="0.7"/>`;
    if (mood === 'attack' || mood === 'hurt') {
      // Angled brow for aggression / pain.
      const dir = mood === 'attack' ? -1 : 1;
      out += `<path d="M${x - er * 0.95} ${cy - er * (1.05 + dir * 0.12)} L${x + er * 0.95} ${cy - er * (1.45 + dir * 0.12)}" stroke="${darken(a.body, 52)}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
  }
  out += '</g>';
  return out;
}

/** Mouth: varies by mood. */
function mouth(cx, cy, mood, w = 9) {
  if (mood === 'faint') {
    return `<ellipse cx="${cx}" cy="${cy + 2}" rx="${w * 0.55}" ry="${w * 0.62}" fill="#3a2f38" opacity="0.85"/>`;
  }
  if (mood === 'hurt') {
    return `<path d="M${cx - w * 0.6} ${cy + 3} Q${cx} ${cy - 3} ${cx + w * 0.6} ${cy + 3}" fill="none" stroke="#3a2f38" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  if (mood === 'attack') {
    return `<path d="M${cx - w * 0.7} ${cy} L${cx} ${cy + w * 0.5} L${cx + w * 0.7} ${cy} Z" fill="#3a2f38"/>`;
  }
  return `<path d="M${cx - w * 0.55} ${cy} Q${cx} ${cy + w * 0.62} ${cx + w * 0.55} ${cy}" fill="none" stroke="#3a2f38" stroke-width="2.2" stroke-linecap="round"/>`;
}

/** Soft blush patches — instant appeal on cute creatures. */
function blush(cx, cy, spread, color = '#ff7d9c', o = 0.4) {
  return `<ellipse cx="${cx - spread}" cy="${cy}" rx="6" ry="3.6" fill="${color}" opacity="${o}"/>\
<ellipse cx="${cx + spread}" cy="${cy}" rx="6" ry="3.6" fill="${color}" opacity="${o}"/>`;
}

/* -------------------------------------------------------------- body parts */

/** Rounded limb with a paw/claw tip. */
function limb(x, y, w, h, color, { rx = null, claw = false, vertical = true } = {}) {
  const r = rx ?? w / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}" stroke="${darken(color, 34)}" stroke-width="1.6"/>\
${claw ? `<circle cx="${x + w / 2}" cy="${vertical ? y + h - 1.5 : y + h / 2}" r="${w * 0.42}" fill="${lighten(color, 16)}" stroke="${darken(color, 34)}" stroke-width="1.2"/>` : ''}`;
}

/** Dorsal spikes / crest. */
function spikes(a, cx, cy, count, scale = 1) {
  const n = Math.max(0, Math.min(6, count || 0));
  if (!n) return '';
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = cx - 22 + t * 44;
    const y = cy - Math.sin(t * Math.PI) * 6;
    const h = (12 + Math.sin(t * Math.PI) * 8) * scale;
    out += `<path d="M${x - 6 * scale} ${y} L${x} ${y - h} L${x + 6 * scale} ${y} Z" fill="${a.accent}" stroke="${darken(a.body, 40)}" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  return out;
}

/** Wing pair (behind the body). */
function wings(a, left = true, right = true, y = 56) {
  let out = '';
  if (left) {
    out += `<path class="sp-wing sp-wing--l" d="M44 ${y} C18 ${y - 26} 6 ${y - 6} 12 ${y + 16} C22 ${y + 22} 36 ${y + 16} 44 ${y + 10} Z" fill="${a.accent}" opacity="0.94" stroke="${darken(a.body, 38)}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  if (right) {
    out += `<path class="sp-wing sp-wing--r" d="M76 ${y} C102 ${y - 26} 114 ${y - 6} 108 ${y + 16} C98 ${y + 22} 84 ${y + 16} 76 ${y + 10} Z" fill="${a.accent}" opacity="0.94" stroke="${darken(a.body, 38)}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  return out;
}

/** Tapered tail behind the body. */
function tail(a, x, y, dx = 26, dy = -18) {
  return `<path class="sp-tail" d="M${x} ${y} q${dx * 0.6} ${dy * 0.2} ${dx} ${dy}" fill="none" stroke="${a.body}" stroke-width="9" stroke-linecap="round"/>\
<path d="M${x} ${y} q${dx * 0.6} ${dy * 0.2} ${dx} ${dy}" fill="none" stroke="${a.accent}" stroke-width="4" stroke-linecap="round" opacity="0.55"/>`;
}

/** Skin pattern overlay, clipped to a circle around (cx, cy). */
function pattern(a, cx, cy, r, id) {
  const clip = `clip${id}`;
  const open = `<g clip-path="url(#${clip})">`;
  const close = '</g>';
  const def = `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`;
  let inner = '';
  switch (a.pattern) {
    case 'stripe':
      inner = `<path d="M${cx - r} ${cy + 6} q${r} -12 ${r * 2} 2" stroke="${a.accent}" stroke-width="4.5" fill="none" opacity="0.8" stroke-linecap="round"/>
               <path d="M${cx - r} ${cy + 18} q${r} -12 ${r * 2} 2" stroke="${a.accent}" stroke-width="4" fill="none" opacity="0.6" stroke-linecap="round"/>`;
      break;
    case 'spot':
      inner = `<circle cx="${cx - r * 0.42}" cy="${cy + r * 0.1}" r="${r * 0.24}" fill="${a.accent}" opacity="0.85"/>
               <circle cx="${cx + r * 0.36}" cy="${cy - r * 0.18}" r="${r * 0.17}" fill="${a.accent}" opacity="0.75"/>
               <circle cx="${cx + r * 0.08}" cy="${cy + r * 0.46}" r="${r * 0.14}" fill="${a.accent}" opacity="0.65"/>`;
      break;
    case 'leaf':
      inner = `<path d="M${cx} ${cy - r * 0.5} q${r * 0.7} -${r * 0.55} ${r * 0.2} ${r * 0.85} q${-r * 0.62} ${r * 0.05} -${r * 0.2} -${r * 0.85}z" fill="${a.accent}" opacity="0.85"/>
               <path d="M${cx} ${cy - r * 0.2} l${r * 0.4} ${r * 0.42}" stroke="${darken(a.accent, 30)}" stroke-width="1.6" fill="none" opacity="0.6"/>`;
      break;
    case 'bolt':
      inner = `<path d="M${cx + 3} ${cy - r * 0.6} l-${r * 0.42} ${r * 0.6} h${r * 0.28} l-${r * 0.2} ${r * 0.62} l${r * 0.48} -${r * 0.66} h-${r * 0.3} z" fill="${a.accent}" opacity="0.92"/>`;
      break;
    case 'crystal':
      inner = `<path d="M${cx - r * 0.5} ${cy + r * 0.34} l${r * 0.44} -${r * 0.86} l${r * 0.46} ${r * 0.86} z" fill="${a.accent}" opacity="0.8"/>
               <path d="M${cx - r * 0.06} ${cy - r * 0.52} l${r * 0.28} ${r * 0.86}" stroke="#fff" stroke-width="1.4" opacity="0.5" fill="none"/>`;
      break;
    case 'stone':
      inner = `<path d="M${cx - r * 0.62} ${cy + r * 0.24} l${r * 0.34} -${r * 0.5} l${r * 0.5} ${r * 0.12} l${r * 0.16} ${r * 0.42} z" fill="${darken(a.accent, 10)}" opacity="0.5"/>`;
      break;
    case 'circuit':
      inner = `<g stroke="${a.accent}" stroke-width="1.9" fill="none" opacity="0.9">
                 <path d="M${cx - r * 0.66} ${cy - r * 0.24} h${r * 1.3}"/>
                 <path d="M${cx - r * 0.44} ${cy + r * 0.16} h${r}"/>
                 <path d="M${cx + r * 0.26} ${cy - r * 0.24} v${r * 0.62}"/>
               </g>
               <circle cx="${cx - r * 0.66}" cy="${cy + r * 0.16}" r="2.6" fill="${a.accent}"/>
               <circle cx="${cx + r * 0.56}" cy="${cy + r * 0.16}" r="2.2" fill="${a.accent}"/>`;
      break;
    default:
      inner = '';
  }
  return inner ? def + open + inner + close : '';
}

/** Top-left glossy highlight that makes the body read as 3D. */
function gloss(cx, cy, rx, ry, id) {
  return `<ellipse cx="${cx - rx * 0.34}" cy="${cy - ry * 0.42}" rx="${rx * 0.42}" ry="${ry * 0.26}" fill="url(#sheen${id})" transform="rotate(-24 ${cx - rx * 0.34} ${cy - ry * 0.42})"/>`;
}

/* ------------------------------------------------------------------ shapes */

function renderBody(a, id, mood) {
  const builders = {
    blob: buildBlob, quad: buildQuad, biped: buildBiped, serpent: buildSerpent,
    winged: buildWinged, aquatic: buildAquatic, mech: buildMech,
  };
  return (builders[a.shape] || buildBlob)(a, id, mood);
}

/** Cute round creature: big head-body, tiny limbs. */
function buildBlob(a, id, mood) {
  const stroke = darken(a.body, 44);
  return `<g class="sp-body">\
${a.wings ? wings(a, true, true, 58) : ''}\
${a.tail ? tail(a, 82, 82, 24, -16) : ''}\
${limb(28, 88, 15, 16, darken(a.body, 12), { claw: true })}\
${limb(76, 88, 15, 16, darken(a.body, 12), { claw: true })}\
<ellipse cx="60" cy="66" rx="38" ry="35" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${pattern(a, 60, 70, 34, id)}\
<ellipse cx="60" cy="80" rx="21" ry="17" fill="url(#belly${id})"/>\
${gloss(60, 66, 38, 35, id)}\
${limb(20, 70, 13, 12, darken(a.body, 8), { claw: true })}\
${limb(87, 70, 13, 12, darken(a.body, 8), { claw: true })}\
${spikes(a, 60, 40, a.spikes, 0.9)}\
${eyes(a, 60, 60, 9.5, mood, a.eye)}\
${blush(60, 74, 20, '#ff7d9c', mood === 'faint' ? 0.15 : 0.42)}\
${mouth(60, 74, mood, 10)}\
</g>`;
}

/** Quadruped: beast with a raised head, four legs and a tail. */
function buildQuad(a, id, mood) {
  const stroke = darken(a.body, 44);
  return `<g class="sp-body">\
${a.wings ? wings(a, true, true, 56) : ''}\
${a.tail ? tail(a, 86, 70, 26, -22) : ''}\
${limb(34, 84, 14, 24, darken(a.body, 14), { claw: true })}\
${limb(50, 86, 14, 22, darken(a.body, 20), { claw: true })}\
${limb(68, 86, 14, 22, darken(a.body, 20), { claw: true })}\
${limb(82, 84, 14, 24, darken(a.body, 14), { claw: true })}\
<ellipse cx="56" cy="70" rx="36" ry="24" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${pattern(a, 50, 74, 30, id)}\
<ellipse cx="58" cy="82" rx="24" ry="12" fill="url(#belly${id})"/>\
${gloss(56, 70, 36, 24, id)}\
<ellipse cx="86" cy="50" rx="21" ry="19" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${spikes(a, 52, 48, a.spikes, 0.95)}\
<path d="M74 62 q11 9 22 3" stroke="${stroke}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.65"/>\
${eyes(a, 90, 46, 8, mood, a.eye)}\
${mouth(94, 60, mood, 9)}\
</g>`;
}

/** Upright humanoid creature. */
function buildBiped(a, id, mood) {
  const stroke = darken(a.body, 44);
  return `<g class="sp-body">\
${a.wings ? wings(a, true, true, 52) : ''}\
${a.tail ? tail(a, 40, 76, -26, -14) : ''}\
${limb(42, 88, 15, 22, darken(a.body, 16), { claw: true })}\
${limb(64, 88, 15, 22, darken(a.body, 16), { claw: true })}\
<path d="M40 58 q20 -10 40 0 l4 34 q-24 8 -48 0 z" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${pattern(a, 60, 74, 22, id)}\
<ellipse cx="60" cy="80" rx="15" ry="12" fill="url(#belly${id})"/>\
${gloss(60, 72, 22, 20, id)}\
${limb(26, 60, 13, 26, darken(a.body, 6), { claw: true, rx: 6 })}\
${limb(82, 60, 13, 26, darken(a.body, 6), { claw: true, rx: 6 })}\
<circle cx="60" cy="38" r="23" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${spikes(a, 60, 20, a.spikes, 0.85)}\
${eyes(a, 60, 36, 8.5, mood, a.eye)}\
${blush(60, 48, 13, '#ff7d9c', 0.3)}\
${mouth(60, 50, mood, 9)}\
</g>`;
}

/** Coiled serpentine body with a large head. */
function buildSerpent(a, id, mood) {
  const stroke = darken(a.body, 44);
  return `<g class="sp-body">\
${a.wings ? wings(a, true, true, 54) : ''}\
<path d="M22 96 q16 -10 26 -26 q10 -18 30 -18 q20 0 18 18" fill="none" stroke="${darken(a.body, 18)}" stroke-width="19" stroke-linecap="round"/>\
<path d="M22 96 q16 -10 26 -26 q10 -18 30 -18 q20 0 18 18" fill="none" stroke="url(#body${id})" stroke-width="14" stroke-linecap="round"/>\
<path d="M22 96 q16 -10 26 -26 q10 -18 30 -18 q20 0 18 18" fill="none" stroke="${a.accent}" stroke-width="4.6" stroke-linecap="round" opacity="0.5"/>\
${spikes(a, 60, 44, a.spikes, 0.9)}\
<ellipse cx="88" cy="46" rx="24" ry="21" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${pattern(a, 92, 50, 20, id)}\
${gloss(88, 46, 24, 21, id)}\
${eyes(a, 94, 42, 8, mood, a.eye)}\
${mouth(100, 56, mood, 10)}\
</g>`;
}

/** Winged creature (body + big wing pair + crest). */
function buildWinged(a, id, mood) {
  const stroke = darken(a.body, 44);
  return `<g class="sp-body">\
${wings(a, true, true, 54)}\
${a.tail ? tail(a, 44, 84, -24, -12) : ''}\
${limb(44, 88, 14, 18, darken(a.body, 14), { claw: true })}\
${limb(62, 88, 14, 18, darken(a.body, 14), { claw: true })}\
<ellipse cx="60" cy="70" rx="27" ry="30" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${pattern(a, 60, 74, 26, id)}\
<ellipse cx="60" cy="80" rx="16" ry="19" fill="url(#belly${id})"/>\
${gloss(60, 70, 27, 30, id)}\
<circle cx="60" cy="38" r="20" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${spikes(a, 60, 20, a.spikes, 0.8)}\
<path d="M46 34 l-12 -10 l14 2 z" fill="${a.accent}" stroke="${stroke}" stroke-width="1.6"/>
<path d="M74 34 l12 -10 l-14 2 z" fill="${a.accent}" stroke="${stroke}" stroke-width="1.6"/>\
${eyes(a, 60, 36, 8.5, mood, a.eye)}\
${mouth(60, 50, mood, 9)}\
</g>`;
}

/** Aquatic creature with fins and a fluke. */
function buildAquatic(a, id, mood) {
  const stroke = darken(a.body, 44);
  return `<g class="sp-body">\
${a.wings ? wings(a, true, true, 58) : ''}\
<path d="M92 66 q-30 -34 -60 0 q30 34 60 0z" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
${pattern(a, 66, 68, 24, id)}\
<path d="M32 66 l-16 -14 v28 z" fill="${a.accent}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>\
<path d="M62 40 q-6 -18 10 -22 q2 12 -4 20 z" fill="${a.accent}" stroke="${stroke}" stroke-width="1.8"/>\
${spikes(a, 66, 44, a.spikes, 0.8)}\
<ellipse cx="60" cy="76" rx="24" ry="10" fill="url(#belly${id})"/>\
${gloss(66, 62, 28, 20, id)}\
${eyes(a, 84, 58, 8.5, mood, a.eye)}\
${blush(84, 72, 18, '#ff7d9c', 0.28)}\
${mouth(90, 72, mood, 9)}\
</g>`;
}

/** Mechanical / data creature with a glowing visor. */
function buildMech(a, id, mood) {
  const stroke = darken(a.body, 46);
  return `<g class="sp-body">\
${a.wings ? wings(a, true, true, 52) : ''}\
${a.tail ? tail(a, 40, 78, -26, -12) : ''}\
<rect x="36" y="86" width="15" height="16" rx="5" fill="${darken(a.body, 24)}" stroke="${stroke}" stroke-width="2"/>
<rect x="69" y="86" width="15" height="16" rx="5" fill="${darken(a.body, 24)}" stroke="${stroke}" stroke-width="2"/>\
<rect x="34" y="52" width="52" height="40" rx="12" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
<rect x="34" y="52" width="52" height="11" rx="6" fill="${a.accent}" opacity="0.7"/>\
${pattern(a, 60, 74, 24, id)}\
${gloss(60, 70, 26, 20, id)}\
<rect x="26" y="58" width="12" height="20" rx="6" fill="${darken(a.body, 10)}" stroke="${stroke}" stroke-width="2"/>
<rect x="82" y="58" width="12" height="20" rx="6" fill="${darken(a.body, 10)}" stroke="${stroke}" stroke-width="2"/>\
<rect x="38" y="20" width="44" height="32" rx="11" fill="url(#body${id})" stroke="${stroke}" stroke-width="2.6"/>\
<line x1="60" y1="20" x2="60" y2="9" stroke="${a.accent}" stroke-width="2.6"/>
<circle cx="60" cy="7" r="4" fill="${a.accent}"/>\
<rect x="45" y="30" width="30" height="12" rx="6" fill="#0a0f1c" opacity="0.92"/>\
${eyes(a, 60, 36, 5.6, mood === 'faint' ? 'faint' : 'idle', Math.max(1, Math.min(3, a.eye)))}\
${spikes(a, 60, 18, a.spikes, 0.8)}\
</g>`;
}

/* ------------------------------------------------------------ colour utils */

/** Blend toward white. */
export function lighten(hex, amount) { return mix(hex, '#ffffff', amount / 100); }

/** Blend toward black. */
export function darken(hex, amount) { return mix(hex, '#000000', amount / 100); }

function mix(hex, target, ratio) {
  const a = parseHex(hex);
  const b = parseHex(target);
  const r = Math.round(a[0] + (b[0] - a[0]) * ratio);
  const g = Math.round(a[1] + (b[1] - a[1]) * ratio);
  const bl = Math.round(a[2] + (b[2] - a[2]) * ratio);
  return `#${[r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Rotate hue by degrees. */
export function shiftHue(hex, deg) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return hex;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hDeg = 0;
  if (max === r) hDeg = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) hDeg = ((b - r) / d + 2) * 60;
  else hDeg = ((r - g) / d + 4) * 60;
  return hslToHex((hDeg + deg + 360) % 360, s, l);
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg].map((v) => Math.round((v + m) * 255));
  return `#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex) {
  const s = String(hex).replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/* ---------------------------------------------------------- presentation */

/**
 * Build a standalone "portrait" card for a species — used by the starter
 * showcase. Larger, with a platform, aura ring and species name plate.
 *
 * @param {object} art
 * @param {object} [opts] Same options as `sprite()` plus `platform`.
 */
export function portrait(art, { size = 220, shiny = false, mood = 'idle', flip = 'right', platform = true } = {}) {
  const inner = sprite(art, { size, shiny, mood, flip });
  if (!platform) return inner;
  return `<div class="portrait" style="--aura:${art.aura || '#7c5cff'}">
    <div class="portrait__ring"></div>
    <div class="portrait__platform"></div>
    <div class="portrait__art">${inner}</div>
  </div>`;
}
