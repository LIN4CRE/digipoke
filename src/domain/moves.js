/**
 * moves.js — Move (technique) catalogue.
 *
 * A move is a pure data record consumed by the battle engine in `battle.js`.
 * No behaviour is defined here: the engine interprets `effect` descriptors,
 * which keeps the catalogue editable by non-engineers (balance/design).
 *
 * Effect descriptor shapes:
 *   { kind: 'status', status, chance }   — inflict a non-volatile status
 *   { kind: 'heal',   pct }              — restore % of max HP to the user
 *   { kind: 'stat',   stat, stages }     — raise/lower a combat stage
 *   { kind: 'recoil', pct }              — user takes % of damage dealt
 *   { kind: 'drain',  pct }              — user heals % of damage dealt
 *
 * @module domain/moves
 */

/** @typedef {'burn'|'poison'|'paralyze'|'freeze'|'sleep'} StatusId */

/** Persistent (non-volatile) status registry: name, colour, tick behaviour. */
export const STATUSES = {
  burn:     { name: 'Burned',   color: '#ff6b3d', dot: 1 / 16, atkMult: 0.5, note: 'Attack halved, chips HP each turn.' },
  poison:   { name: 'Poisoned', color: '#a45cff', dot: 1 / 8,  atkMult: 1.0, note: 'Loses HP each turn.' },
  paralyze: { name: 'Paralysed',color: '#ffd93d', dot: 0,      atkMult: 1.0, spdMult: 0.5, skipChance: 0.25, note: 'Speed halved, may lose a turn.' },
  freeze:   { name: 'Frozen',   color: '#7fdcff', dot: 0,      atkMult: 1.0, thawChance: 0.2, note: 'Cannot act; may thaw each turn.' },
  sleep:    { name: 'Asleep',   color: '#8ea0c8', dot: 0,      atkMult: 1.0, turns: [1, 3], note: 'Cannot act for 1–3 turns.' },
};

/**
 * Move catalogue keyed by stable id. Ids are permanent save-data references:
 * never rename or remove an id, only deprecate it.
 */
export const MOVES = {
  /* ---------------------------------------------------------------- Null */
  strike:      { name: 'Strike',        type: 'null',    power: 40,  acc: 100, pp: 35, desc: 'A plain shoulder charge.' },
  rend:        { name: 'Rend',          type: 'null',    power: 60,  acc: 95,  pp: 25, desc: 'Claws tear through the target.' },
  quickStep:   { name: 'Quick Step',    type: 'null',    power: 0,   acc: 100, pp: 20, effect: { kind: 'stat', stat: 'spd', stages: 1 }, desc: 'Sharply raises Speed.' },
  focus:       { name: 'Focus',         type: 'null',    power: 0,   acc: 100, pp: 20, effect: { kind: 'stat', stat: 'atk', stages: 1 }, desc: 'Sharply raises Attack.' },
  barrier:     { name: 'Barrier',       type: 'null',    power: 0,   acc: 100, pp: 20, effect: { kind: 'stat', stat: 'def', stages: 1 }, desc: 'Sharply raises Defence.' },
  restProtocol:{ name: 'Rest Protocol', type: 'null',    power: 0,   acc: 100, pp: 10, effect: { kind: 'heal', pct: 0.5 }, desc: 'Recovers half of max HP.' },
  lastResort:  { name: 'Last Resort',   type: 'null',    power: 90,  acc: 90,  pp: 10, effect: { kind: 'recoil', pct: 0.25 }, desc: 'Heavy hit with recoil damage.' },

  /* --------------------------------------------------------------- Flame */
  cinderLash:  { name: 'Cinder Lash',   type: 'flame',   power: 45,  acc: 100, pp: 30, effect: { kind: 'status', status: 'burn', chance: 0.15 }, desc: 'A whip of flame that may burn.' },
  pyroFang:    { name: 'Pyro Fang',     type: 'flame',   power: 75,  acc: 95,  pp: 20, effect: { kind: 'status', status: 'burn', chance: 0.2 }, desc: 'Searing bite; often burns.' },
  novaBurst:   { name: 'Nova Burst',    type: 'flame',   power: 110, acc: 90,  pp: 8,  desc: 'Detonates a miniature star.' },
  flameVeil:   { name: 'Flame Veil',    type: 'flame',   power: 0,   acc: 100, pp: 15, effect: { kind: 'stat', stat: 'def', stages: 1 }, desc: 'A veil of heat bolsters defence.' },

  /* ---------------------------------------------------------------- Aqua */
  aquaJet:     { name: 'Aqua Jet',      type: 'aqua',    power: 45,  acc: 100, pp: 30, desc: 'Fires a lance of pressurised water.' },
  tideSlam:    { name: 'Tide Slam',     type: 'aqua',    power: 75,  acc: 95,  pp: 20, desc: 'A crushing wave slams the target.' },
  maelstrom:   { name: 'Maelstrom',     type: 'aqua',    power: 110, acc: 85,  pp: 8,  desc: 'Summons a churning vortex.' },
  coolMist:    { name: 'Cool Mist',     type: 'aqua',    power: 0,   acc: 100, pp: 15, effect: { kind: 'heal', pct: 0.4 }, desc: 'Soothing mist restores HP.' },

  /* -------------------------------------------------------------- Verdant */
  vineWhip:    { name: 'Vine Whip',     type: 'verdant', power: 45,  acc: 100, pp: 30, desc: 'Lashing vines strike the foe.' },
  thornBarrage:{ name: 'Thorn Barrage', type: 'verdant', power: 75,  acc: 95,  pp: 20, effect: { kind: 'drain', pct: 0.4 }, desc: 'Drains HP from the target.' },
  bloomNova:   { name: 'Bloom Nova',    type: 'verdant', power: 105, acc: 90,  pp: 8,  effect: { kind: 'heal', pct: 0.3 }, desc: 'A blossoming burst that heals the user.' },
  rootGuard:   { name: 'Root Guard',    type: 'verdant', power: 0,   acc: 100, pp: 15, effect: { kind: 'stat', stat: 'def', stages: 1 }, desc: 'Roots anchor and protect.' },

  /* ----------------------------------------------------------------- Volt */
  staticNip:   { name: 'Static Nip',    type: 'volt',    power: 45,  acc: 100, pp: 30, effect: { kind: 'status', status: 'paralyze', chance: 0.2 }, desc: 'A static shock that may paralyse.' },
  voltFang:    { name: 'Volt Fang',     type: 'volt',    power: 75,  acc: 95,  pp: 20, effect: { kind: 'status', status: 'paralyze', chance: 0.25 }, desc: 'An electrified bite.' },
  thunderLance:{ name: 'Thunder Lance', type: 'volt',    power: 110, acc: 85,  pp: 8,  desc: 'Calls down a lance of lightning.' },
  overcharge:  { name: 'Overcharge',    type: 'volt',    power: 0,   acc: 100, pp: 15, effect: { kind: 'stat', stat: 'spd', stages: 2 }, desc: 'Massively raises Speed.' },

  /* ---------------------------------------------------------------- Terra */
  rockThrow:   { name: 'Rock Throw',    type: 'terra',   power: 50,  acc: 90,  pp: 25, desc: 'Hurls a jagged stone.' },
  seismicSlam: { name: 'Seismic Slam',  type: 'terra',   power: 85,  acc: 90,  pp: 15, desc: 'Slams the ground to shake the foe.' },
  tectonicRage:{ name: 'Tectonic Rage', type: 'terra',   power: 115, acc: 80,  pp: 6,  desc: 'Splits the floor beneath the target.' },

  /* ----------------------------------------------------------------- Aero */
  gust:        { name: 'Gust',          type: 'aero',    power: 45,  acc: 100, pp: 30, desc: 'A blade of compressed air.' },
  cycloneWing: { name: 'Cyclone Wing',  type: 'aero',    power: 75,  acc: 95,  pp: 20, desc: 'Wings whip up a cutting cyclone.' },
  tempestHowl: { name: 'Tempest Howl',  type: 'aero',    power: 105, acc: 90,  pp: 8,  desc: 'A howling storm batters the foe.' },
  tailwind:    { name: 'Tailwind',      type: 'aero',    power: 0,   acc: 100, pp: 15, effect: { kind: 'stat', stat: 'spd', stages: 2 }, desc: 'Greatly raises Speed.' },

  /* ---------------------------------------------------------------- Frost */
  frostNip:    { name: 'Frost Nip',     type: 'frost',   power: 45,  acc: 100, pp: 30, effect: { kind: 'status', status: 'freeze', chance: 0.15 }, desc: 'A freezing bite.' },
  glacierSpear:{ name: 'Glacier Spear', type: 'frost',   power: 75,  acc: 95,  pp: 20, effect: { kind: 'status', status: 'freeze', chance: 0.15 }, desc: 'Impales with sharpened ice.' },
  absoluteZero:{ name: 'Absolute Zero', type: 'frost',   power: 110, acc: 85,  pp: 6,  effect: { kind: 'status', status: 'freeze', chance: 0.2 }, desc: 'Drops the field to absolute zero.' },

  /* ----------------------------------------------------------------- Byte */
  byteSnap:    { name: 'Byte Snap',     type: 'byte',    power: 50,  acc: 100, pp: 30, desc: 'Corrupts target bytes directly.' },
  dataLeech:   { name: 'Data Leech',    type: 'byte',    power: 70,  acc: 100, pp: 20, effect: { kind: 'drain', pct: 0.5 }, desc: 'Siphons data to restore HP.' },
  overclockBeam:{name: 'Overclock Beam',type: 'byte',    power: 110, acc: 90,  pp: 8,  desc: 'An unstable, over-volted beam.' },
  firewall:    { name: 'Firewall',      type: 'byte',    power: 0,   acc: 100, pp: 15, effect: { kind: 'stat', stat: 'def', stages: 2 }, desc: 'Greatly raises Defence.' },

  /* ---------------------------------------------------------------- Virus */
  venomBite:   { name: 'Venom Bite',    type: 'virus',   power: 45,  acc: 100, pp: 30, effect: { kind: 'status', status: 'poison', chance: 0.3 }, desc: 'A bite that injects corrupt code.' },
  corruptRay:  { name: 'Corrupt Ray',   type: 'virus',   power: 75,  acc: 95,  pp: 20, effect: { kind: 'status', status: 'poison', chance: 0.25 }, desc: 'A ray of malicious data.' },
  oblivionWave:{ name: 'Oblivion Wave', type: 'virus',   power: 110, acc: 85,  pp: 6,  desc: 'Erases the target’s integrity.' },
  glitchStep:  { name: 'Glitch Step',   type: 'virus',   power: 0,   acc: 100, pp: 15, effect: { kind: 'stat', stat: 'spd', stages: 1 }, desc: 'Desyncs the user forward in time.' },
};

/** Stable ordering for UI pickers. */
export const MOVE_IDS = Object.keys(MOVES);

/**
 * Safe accessor that never throws on unknown ids (guards corrupt save data).
 * @param {string} id
 * @returns {object} Move record, or a defensive fallback.
 */
export function getMove(id) {
  return MOVES[id] || { name: 'Struggle', type: 'null', power: 50, acc: 100, pp: 99, desc: 'A desperate last-ditch strike.' };
}
