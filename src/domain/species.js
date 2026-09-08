/**
 * species.js — Creature species catalogue (the "Dex").
 *
 * 34 species across 10 evolution lines (3 stages each) plus 4 Mega forms.
 * Each record is pure data:
 *
 *   id       – permanent save-data key (never rename/remove)
 *   name     – display name
 *   stage    – rookie | champion | ultimate | mega  (drives evolution UI)
 *   types    – 1–2 element ids
 *   base     – base stats { hp, atk, def, spd }
 *   moves    – learnset pool, indexed against LEARN_LEVELS
 *   evolve   – { to, level, bond? } or null
 *   capture  – capture difficulty 0–255 (higher = easier)
 *   xp       – base XP yielded when defeated
 *   art      – procedural sprite descriptor (see ui/sprite.js)
 *   lore     – in-world flavour text
 *
 * @module domain/species
 */

/** Learnset levels applied positionally to each species' `moves` array. */
export const LEARN_LEVELS = [1, 8, 16, 26, 36, 46];

/** @type {Record<string, object>} */
export const SPECIES = {
  /* ============================================================ FLAME LINE */
  emberling: {
    id: 'emberling', name: 'Emberling', stage: 'rookie', types: ['flame'],
    base: { hp: 50, atk: 42, def: 32, spd: 40 },
    moves: ['strike', 'cinderLash', 'focus', 'flameVeil'],
    evolve: { to: 'flarion', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'quad', body: '#ff7a45', accent: '#ffd166', eye: 2, tail: 1, spikes: 0, wings: 0, pattern: 'stripe', aura: '#ff6b3d' },
    lore: 'A coal-fed hatchling. Its tail flame gutters when it sulks.',
  },
  flarion: {
    id: 'flarion', name: 'Flarion', stage: 'champion', types: ['flame'],
    base: { hp: 72, atk: 66, def: 50, spd: 58 },
    moves: ['rend', 'cinderLash', 'pyroFang', 'focus'],
    evolve: { to: 'pyrovern', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'quad', body: '#f2612c', accent: '#ffcf5c', eye: 2, tail: 1, spikes: 2, wings: 0, pattern: 'stripe', aura: '#ff6b3d' },
    lore: 'Its mane burns hot enough to anneal steel; it sleeps in ash beds.',
  },
  pyrovern: {
    id: 'pyrovern', name: 'Pyrovern', stage: 'ultimate', types: ['flame', 'aero'],
    base: { hp: 92, atk: 92, def: 68, spd: 82 },
    moves: ['rend', 'pyroFang', 'novaBurst', 'cycloneWing'],
    evolve: { to: 'solarion', level: 46, bond: 80 },
    capture: 45, xp: 236,
    art: { shape: 'winged', body: '#e04a1f', accent: '#ffd15c', eye: 2, tail: 1, spikes: 2, wings: 2, pattern: 'stripe', aura: '#ff6b3d' },
    lore: 'A solar furnace with wings. Villages time their harvests by its migration.',
  },
  solarion: {
    id: 'solarion', name: 'Solarion', stage: 'mega', types: ['flame', 'aero'],
    base: { hp: 108, atk: 115, def: 84, spd: 96 },
    moves: ['novaBurst', 'pyroFang', 'cycloneWing', 'focus'],
    evolve: null, capture: 20, xp: 320,
    art: { shape: 'winged', body: '#ff8a1f', accent: '#fff2a8', eye: 2, tail: 2, spikes: 3, wings: 2, pattern: 'circuit', aura: '#ffb03d' },
    lore: 'Mega form. It carries a captured star in its chest core.',
  },

  /* ============================================================= AQUA LINE */
  drizzle: {
    id: 'drizzle', name: 'Drizzle', stage: 'rookie', types: ['aqua'],
    base: { hp: 54, atk: 38, def: 38, spd: 36 },
    moves: ['strike', 'aquaJet', 'barrier', 'coolMist'],
    evolve: { to: 'tidecub', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'aquatic', body: '#3fa9f5', accent: '#a8e6ff', eye: 2, tail: 1, spikes: 0, wings: 0, pattern: 'spot', aura: '#3db4ff' },
    lore: 'Stores rainwater in its cheeks and sprays it when startled.',
  },
  tidecub: {
    id: 'tidecub', name: 'Tidecub', stage: 'champion', types: ['aqua'],
    base: { hp: 78, atk: 60, def: 60, spd: 52 },
    moves: ['rend', 'aquaJet', 'tideSlam', 'coolMist'],
    evolve: { to: 'leviaroc', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'aquatic', body: '#2b86d6', accent: '#7fdcff', eye: 2, tail: 1, spikes: 1, wings: 0, pattern: 'spot', aura: '#3db4ff' },
    lore: 'Surfs tidal bores for sport; fishers read its wake to predict storms.',
  },
  leviaroc: {
    id: 'leviaroc', name: 'Leviaroc', stage: 'ultimate', types: ['aqua', 'terra'],
    base: { hp: 100, atk: 88, def: 84, spd: 66 },
    moves: ['tideSlam', 'seismicSlam', 'maelstrom', 'barrier'],
    evolve: { to: 'abyssalord', level: 46, bond: 80 },
    capture: 45, xp: 236,
    art: { shape: 'serpent', body: '#1f6cb0', accent: '#9fe8ff', eye: 2, tail: 2, spikes: 3, wings: 0, pattern: 'spot', aura: '#3db4ff' },
    lore: 'Older than the continental shelf it coils around.',
  },
  abyssalord: {
    id: 'abyssalord', name: 'Abyssalord', stage: 'mega', types: ['aqua', 'terra'],
    base: { hp: 118, atk: 104, def: 102, spd: 78 },
    moves: ['maelstrom', 'tideSlam', 'seismicSlam', 'coolMist'],
    evolve: null, capture: 20, xp: 320,
    art: { shape: 'serpent', body: '#124f8a', accent: '#d6f4ff', eye: 4, tail: 3, spikes: 4, wings: 0, pattern: 'circuit', aura: '#3db4ff' },
    lore: 'Mega form. Pressure at its depth would crush diamond to dust.',
  },

  /* =========================================================== VERDANT LINE */
  sproutle: {
    id: 'sproutle', name: 'Sproutle', stage: 'rookie', types: ['verdant'],
    base: { hp: 56, atk: 36, def: 44, spd: 30 },
    moves: ['strike', 'vineWhip', 'rootGuard', 'restProtocol'],
    evolve: { to: 'thornox', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'blob', body: '#5ac46a', accent: '#2f8f4e', eye: 2, tail: 0, spikes: 1, wings: 0, pattern: 'leaf', aura: '#4fd67c' },
    lore: 'Photosynthesises while asleep. Grows visibly after rain.',
  },
  thornox: {
    id: 'thornox', name: 'Thornox', stage: 'champion', types: ['verdant', 'terra'],
    base: { hp: 82, atk: 62, def: 70, spd: 42 },
    moves: ['rend', 'vineWhip', 'thornBarrage', 'rootGuard'],
    evolve: { to: 'verdantross', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'quad', body: '#3f9c53', accent: '#7bd88f', eye: 2, tail: 1, spikes: 3, wings: 0, pattern: 'leaf', aura: '#4fd67c' },
    lore: 'Its thorn plates are harvested, carefully, by hedge-witches.',
  },
  verdantross: {
    id: 'verdantross', name: 'Verdantross', stage: 'ultimate', types: ['verdant', 'terra'],
    base: { hp: 104, atk: 84, def: 96, spd: 54 },
    moves: ['thornBarrage', 'bloomNova', 'seismicSlam', 'restProtocol'],
    evolve: null, capture: 45, xp: 236,
    art: { shape: 'quad', body: '#2e7d46', accent: '#a6f0b6', eye: 2, tail: 1, spikes: 4, wings: 0, pattern: 'leaf', aura: '#4fd67c' },
    lore: 'A walking grove. Entire ecosystems nest in its canopy.',
  },

  /* ============================================================== VOLT LINE */
  sparkit: {
    id: 'sparkit', name: 'Sparkit', stage: 'rookie', types: ['volt'],
    base: { hp: 46, atk: 40, def: 30, spd: 52 },
    moves: ['strike', 'staticNip', 'quickStep', 'overcharge'],
    evolve: { to: 'voltusk', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'quad', body: '#f2c53d', accent: '#3a2f10', eye: 2, tail: 1, spikes: 1, wings: 0, pattern: 'bolt', aura: '#ffd93d' },
    lore: 'Charges itself by rolling down hills. Occasionally overdoes it.',
  },
  voltusk: {
    id: 'voltusk', name: 'Voltusk', stage: 'champion', types: ['volt'],
    base: { hp: 70, atk: 70, def: 48, spd: 74 },
    moves: ['rend', 'staticNip', 'voltFang', 'overcharge'],
    evolve: { to: 'thunderion', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'quad', body: '#e0a92a', accent: '#2b2409', eye: 2, tail: 2, spikes: 2, wings: 0, pattern: 'bolt', aura: '#ffd93d' },
    lore: 'Its tusks arc continuously; the air tastes of ozone nearby.',
  },
  thunderion: {
    id: 'thunderion', name: 'Thunderion', stage: 'ultimate', types: ['volt', 'aero'],
    base: { hp: 88, atk: 96, def: 62, spd: 96 },
    moves: ['voltFang', 'thunderLance', 'cycloneWing', 'overcharge'],
    evolve: { to: 'raijinix', level: 46, bond: 80 },
    capture: 45, xp: 236,
    art: { shape: 'winged', body: '#d99a14', accent: '#fff3b0', eye: 2, tail: 2, spikes: 3, wings: 2, pattern: 'bolt', aura: '#ffd93d' },
    lore: 'Lives inside thunderheads; only descends to challenge rivals.',
  },
  raijinix: {
    id: 'raijinix', name: 'Raijinix', stage: 'mega', types: ['volt', 'aero'],
    base: { hp: 100, atk: 118, def: 76, spd: 116 },
    moves: ['thunderLance', 'voltFang', 'tempestHowl', 'overcharge'],
    evolve: null, capture: 20, xp: 320,
    art: { shape: 'winged', body: '#ffd93d', accent: '#ffffff', eye: 2, tail: 3, spikes: 4, wings: 2, pattern: 'circuit', aura: '#ffd93d' },
    lore: 'Mega form. It arrives before its own thunder.',
  },

  /* ============================================================= TERRA LINE */
  pebblit: {
    id: 'pebblit', name: 'Pebblit', stage: 'rookie', types: ['terra'],
    base: { hp: 60, atk: 40, def: 48, spd: 22 },
    moves: ['strike', 'rockThrow', 'barrier', 'restProtocol'],
    evolve: { to: 'roccolith', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'blob', body: '#a8834f', accent: '#6b4f2a', eye: 2, tail: 0, spikes: 1, wings: 0, pattern: 'stone', aura: '#c98a4b' },
    lore: 'Moss grows on whichever side it forgets to turn.',
  },
  roccolith: {
    id: 'roccolith', name: 'Roccolith', stage: 'champion', types: ['terra'],
    base: { hp: 86, atk: 66, def: 78, spd: 34 },
    moves: ['rend', 'rockThrow', 'seismicSlam', 'barrier'],
    evolve: { to: 'mountanix', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'quad', body: '#8c6a3c', accent: '#5c421f', eye: 2, tail: 1, spikes: 3, wings: 0, pattern: 'stone', aura: '#c98a4b' },
    lore: 'Used as a landmark by cartographers; it resents being climbed.',
  },
  mountanix: {
    id: 'mountanix', name: 'Mountanix', stage: 'ultimate', types: ['terra', 'byte'],
    base: { hp: 110, atk: 86, def: 104, spd: 44 },
    moves: ['seismicSlam', 'tectonicRage', 'byteSnap', 'firewall'],
    evolve: null, capture: 45, xp: 236,
    art: { shape: 'mech', body: '#6f5530', accent: '#b48cff', eye: 2, tail: 1, spikes: 4, wings: 0, pattern: 'circuit', aura: '#c98a4b' },
    lore: 'Sediment layers record ten thousand years in its back plates.',
  },

  /* ============================================================== AERO LINE */
  zephyrling: {
    id: 'zephyrling', name: 'Zephyrling', stage: 'rookie', types: ['aero'],
    base: { hp: 48, atk: 38, def: 30, spd: 56 },
    moves: ['strike', 'gust', 'quickStep', 'tailwind'],
    evolve: { to: 'galewing', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'blob', body: '#bfe9ff', accent: '#5fa8d3', eye: 2, tail: 0, spikes: 0, wings: 1, pattern: 'none', aura: '#9fe8ff' },
    lore: 'Weighs less than the air it displaces. Hates closed windows.',
  },
  galewing: {
    id: 'galewing', name: 'Galewing', stage: 'champion', types: ['aero', 'frost'],
    base: { hp: 72, atk: 64, def: 48, spd: 80 },
    moves: ['rend', 'gust', 'cycloneWing', 'frostNip'],
    evolve: { to: 'tempestrix', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'winged', body: '#9ad4f5', accent: '#e8faff', eye: 2, tail: 1, spikes: 1, wings: 2, pattern: 'stripe', aura: '#9fe8ff' },
    lore: 'Rides thermal columns for weeks without landing.',
  },
  tempestrix: {
    id: 'tempestrix', name: 'Tempestrix', stage: 'ultimate', types: ['aero', 'frost'],
    base: { hp: 90, atk: 90, def: 66, spd: 100 },
    moves: ['cycloneWing', 'tempestHowl', 'glacierSpear', 'tailwind'],
    evolve: null, capture: 45, xp: 236,
    art: { shape: 'winged', body: '#7cc3ec', accent: '#ffffff', eye: 2, tail: 2, spikes: 2, wings: 2, pattern: 'stripe', aura: '#9fe8ff' },
    lore: 'Storm fronts follow it like a retinue.',
  },

  /* ============================================================= FROST LINE */
  frostkit: {
    id: 'frostkit', name: 'Frostkit', stage: 'rookie', types: ['frost'],
    base: { hp: 52, atk: 40, def: 38, spd: 38 },
    moves: ['strike', 'frostNip', 'barrier', 'restProtocol'],
    evolve: { to: 'glacion', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'quad', body: '#bfefff', accent: '#4aa3c9', eye: 2, tail: 1, spikes: 1, wings: 0, pattern: 'crystal', aura: '#7fdcff' },
    lore: 'Leaves perfect little paw-prints that melt by noon.',
  },
  glacion: {
    id: 'glacion', name: 'Glacion', stage: 'champion', types: ['frost'],
    base: { hp: 76, atk: 68, def: 60, spd: 56 },
    moves: ['rend', 'frostNip', 'glacierSpear', 'barrier'],
    evolve: { to: 'cryophinx', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'quad', body: '#86d7f2', accent: '#2f7f9e', eye: 2, tail: 1, spikes: 3, wings: 0, pattern: 'crystal', aura: '#7fdcff' },
    lore: 'Builds elaborate ice lairs, then abandons them out of boredom.',
  },
  cryophinx: {
    id: 'cryophinx', name: 'Cryophinx', stage: 'ultimate', types: ['frost', 'byte'],
    base: { hp: 96, atk: 90, def: 78, spd: 72 },
    moves: ['glacierSpear', 'absoluteZero', 'overclockBeam', 'firewall'],
    evolve: null, capture: 45, xp: 236,
    art: { shape: 'serpent', body: '#63bfe0', accent: '#b48cff', eye: 2, tail: 2, spikes: 3, wings: 0, pattern: 'circuit', aura: '#7fdcff' },
    lore: 'Poses riddles in a language of cracking ice. Nobody has answered.',
  },

  /* ============================================================== BYTE LINE */
  bitling: {
    id: 'bitling', name: 'Bitling', stage: 'rookie', types: ['byte'],
    base: { hp: 50, atk: 44, def: 36, spd: 42 },
    moves: ['strike', 'byteSnap', 'focus', 'firewall'],
    evolve: { to: 'datamite', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'mech', body: '#9c86d8', accent: '#d9ccff', eye: 1, tail: 0, spikes: 1, wings: 0, pattern: 'circuit', aura: '#b48cff' },
    lore: 'A fragment of a larger program, happily unaware of that fact.',
  },
  datamite: {
    id: 'datamite', name: 'Datamite', stage: 'champion', types: ['byte', 'virus'],
    base: { hp: 74, atk: 72, def: 54, spd: 62 },
    moves: ['rend', 'byteSnap', 'dataLeech', 'venomBite'],
    evolve: { to: 'cipherax', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'mech', body: '#7f63c9', accent: '#ff5fa2', eye: 2, tail: 1, spikes: 2, wings: 0, pattern: 'circuit', aura: '#b48cff' },
    lore: 'Compiles itself mid-fight, adding features as needed.',
  },
  cipherax: {
    id: 'cipherax', name: 'Cipherax', stage: 'ultimate', types: ['byte', 'virus'],
    base: { hp: 92, atk: 98, def: 70, spd: 84 },
    moves: ['overclockBeam', 'dataLeech', 'corruptRay', 'firewall'],
    evolve: null, capture: 45, xp: 236,
    art: { shape: 'mech', body: '#5b3fa0', accent: '#7dffe4', eye: 3, tail: 2, spikes: 4, wings: 0, pattern: 'circuit', aura: '#b48cff' },
    lore: 'Speaks only in encrypted packets. It is being polite.',
  },

  /* ============================================================= VIRUS LINE */
  shadling: {
    id: 'shadling', name: 'Shadling', stage: 'rookie', types: ['virus'],
    base: { hp: 48, atk: 46, def: 32, spd: 44 },
    moves: ['strike', 'venomBite', 'focus', 'glitchStep'],
    evolve: { to: 'venomire', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'blob', body: '#5d3b5c', accent: '#ff5fa2', eye: 2, tail: 1, spikes: 0, wings: 0, pattern: 'none', aura: '#ff5fa2' },
    lore: 'Hides in the shadow of larger creatures and mimics their gait.',
  },
  venomire: {
    id: 'venomire', name: 'Venomire', stage: 'champion', types: ['virus'],
    base: { hp: 72, atk: 76, def: 50, spd: 68 },
    moves: ['rend', 'venomBite', 'corruptRay', 'glitchStep'],
    evolve: { to: 'oblivionix', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'serpent', body: '#432a48', accent: '#ff87bd', eye: 2, tail: 2, spikes: 2, wings: 0, pattern: 'spot', aura: '#ff5fa2' },
    lore: 'Its bite installs a polite, persistent advertisement.',
  },
  oblivionix: {
    id: 'oblivionix', name: 'Oblivionix', stage: 'ultimate', types: ['virus', 'null'],
    base: { hp: 94, atk: 100, def: 68, spd: 80 },
    moves: ['corruptRay', 'oblivionWave', 'lastResort', 'focus'],
    evolve: { to: 'voidmaw', level: 46, bond: 80 },
    capture: 45, xp: 236,
    art: { shape: 'serpent', body: '#2a1730', accent: '#ff5fa2', eye: 4, tail: 3, spikes: 4, wings: 0, pattern: 'circuit', aura: '#ff5fa2' },
    lore: 'Things deleted by it are remembered by nobody, including it.',
  },
  voidmaw: {
    id: 'voidmaw', name: 'Voidmaw', stage: 'mega', types: ['virus', 'null'],
    base: { hp: 106, atk: 124, def: 80, spd: 92 },
    moves: ['oblivionWave', 'corruptRay', 'lastResort', 'glitchStep'],
    evolve: null, capture: 20, xp: 320,
    art: { shape: 'serpent', body: '#160a1c', accent: '#ff2d8f', eye: 6, tail: 4, spikes: 5, wings: 2, pattern: 'circuit', aura: '#ff5fa2' },
    lore: 'Mega form. An absence with an appetite.',
  },

  /* ============================================================== NULL LINE */
  nulkit: {
    id: 'nulkit', name: 'Nulkit', stage: 'rookie', types: ['null'],
    base: { hp: 54, atk: 38, def: 38, spd: 40 },
    moves: ['strike', 'quickStep', 'barrier', 'restProtocol'],
    evolve: { to: 'driftling', level: 16 },
    capture: 190, xp: 62,
    art: { shape: 'blob', body: '#cdd4e4', accent: '#8b96b0', eye: 2, tail: 1, spikes: 0, wings: 0, pattern: 'none', aura: '#c8cfe0' },
    lore: 'Perfectly average in every measurable way. Thriving.',
  },
  driftling: {
    id: 'driftling', name: 'Driftling', stage: 'champion', types: ['null', 'aero'],
    base: { hp: 76, atk: 62, def: 58, spd: 70 },
    moves: ['rend', 'gust', 'barrier', 'restProtocol'],
    evolve: { to: 'aetherion', level: 34 },
    capture: 90, xp: 142,
    art: { shape: 'winged', body: '#b6c0d8', accent: '#ffffff', eye: 2, tail: 1, spikes: 1, wings: 1, pattern: 'none', aura: '#c8cfe0' },
    lore: 'Drifts between zones, belonging to neither.',
  },
  aetherion: {
    id: 'aetherion', name: 'Aetherion', stage: 'ultimate', types: ['null'],
    base: { hp: 98, atk: 86, def: 82, spd: 88 },
    moves: ['lastResort', 'restProtocol', 'focus', 'quickStep'],
    evolve: null, capture: 45, xp: 236,
    art: { shape: 'biped', body: '#dfe6f5', accent: '#9aa7c4', eye: 2, tail: 1, spikes: 2, wings: 2, pattern: 'none', aura: '#c8cfe0' },
    lore: 'Neutral in all things, including the type chart. It finds that restful.',
  },
};

/** Dex ordering for the Ranch / Lab / Dex listings. */
export const SPECIES_IDS = Object.keys(SPECIES);

/** The three creatures offered during onboarding. */
export const STARTER_IDS = ['emberling', 'drizzle', 'sproutle'];

/** Human-readable stage ordering, used for sorting and evolution checks. */
export const STAGE_ORDER = ['rookie', 'champion', 'ultimate', 'mega'];

/**
 * Safe species lookup that survives corrupted or outdated save data.
 * @param {string} id
 * @returns {object} Species record (falls back to `nulkit`).
 */
export function getSpecies(id) {
  return SPECIES[id] || SPECIES.nulkit;
}

/**
 * Build the level-keyed learnset for a species.
 * @param {string} id Species id.
 * @returns {{level:number, move:string}[]} Sorted by level.
 */
export function learnsetFor(id) {
  const s = getSpecies(id);
  return s.moves.map((move, i) => ({ level: LEARN_LEVELS[i] ?? 99, move }));
}

/** Total base stat value (used for sorting and "potential" displays). */
export function baseStatTotal(id) {
  const b = getSpecies(id).base;
  return b.hp + b.atk + b.def + b.spd;
}
