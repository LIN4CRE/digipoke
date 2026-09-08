/**
 * zones.js — Exploration zones, encounter tables and rival rosters.
 *
 * Zones are pure data. Each zone defines a level band, an encounter table
 * (weighted species pool) and a roster bias used to procedurally generate
 * rival trainer teams. Zones gate themselves behind a "recommended level"
 * so the world opens up as the player's team grows.
 *
 * @module domain/zones
 */

/**
 * Encounter weights are relative integers; higher = more common.
 * `boss` marks the zone's signature encounter (guaranteed at first clear).
 */
export const ZONES = [
  {
    id: 'pixel_plains',
    name: 'Pixel Plains',
    blurb: 'Tufted lowlands where rookie digi-life grazes on stray packets.',
    minLevel: 3, maxLevel: 7,
    recommended: 0,
    encounters: [
      { id: 'nulkit', w: 30 },
      { id: 'sproutle', w: 25 },
      { id: 'zephyrling', w: 20 },
      { id: 'emberling', w: 15 },
      { id: 'pebblit', w: 10 },
    ],
    rivals: ['Byte Scout', 'Patch Cadet'],
    accent: '#7bd88f',
  },
  {
    id: 'static_springs',
    name: 'Static Springs',
    blurb: 'Mineral pools charged by underground current. Bring grounding.',
    minLevel: 8, maxLevel: 13,
    recommended: 10,
    encounters: [
      { id: 'drizzle', w: 28 },
      { id: 'sparkit', w: 24 },
      { id: 'frostkit', w: 18 },
      { id: 'bitling', w: 18 },
      { id: 'nulkit', w: 12 },
    ],
    rivals: ['Surge Warden', 'Cache Diver'],
    accent: '#7fdcff',
  },
  {
    id: 'ember_ridge',
    name: 'Ember Ridge',
    blurb: 'A volcanic spine still cooling from the last server migration.',
    minLevel: 14, maxLevel: 20,
    recommended: 18,
    encounters: [
      { id: 'emberling', w: 26 },
      { id: 'flarion', w: 16 },
      { id: 'pebblit', w: 20 },
      { id: 'roccolith', w: 14 },
      { id: 'shadling', w: 24 },
    ],
    rivals: ['Cinder Adept', 'Ash Runner'],
    accent: '#ff6b3d',
  },
  {
    id: 'cipher_warrens',
    name: 'Cipher Warrens',
    blurb: 'Abandoned data-ducts. Packets go in; most things do not come out.',
    minLevel: 21, maxLevel: 28,
    recommended: 26,
    encounters: [
      { id: 'bitling', w: 24 },
      { id: 'datamite', w: 18 },
      { id: 'shadling', w: 16 },
      { id: 'venomire', w: 16 },
      { id: 'galewing', w: 14 },
      { id: 'zephyrling', w: 12 },
    ],
    rivals: ['Null Sysop', 'Hex Archivist'],
    accent: '#b48cff',
  },
  {
    id: 'glacier_vault',
    name: 'Glacier Vault',
    blurb: 'Cold storage, literally. Old builds are preserved here perfectly.',
    minLevel: 29, maxLevel: 36,
    recommended: 34,
    encounters: [
      { id: 'frostkit', w: 18 },
      { id: 'glacion', w: 18 },
      { id: 'roccolith', w: 18 },
      { id: 'mountanix', w: 10 },
      { id: 'tidecub', w: 18 },
      { id: 'tempestrix', w: 10 },
    ],
    rivals: ['Frost Curator', 'Vault Sentinel'],
    accent: '#9fe8ff',
  },
  {
    id: 'nexus_core',
    name: 'Nexus Core',
    blurb: 'The beating heart of the network. Everything here is legendary.',
    minLevel: 37, maxLevel: 46,
    recommended: 42,
    encounters: [
      { id: 'datamite', w: 16 },
      { id: 'cipherax', w: 14 },
      { id: 'thunderion', w: 12 },
      { id: 'cryophinx', w: 14 },
      { id: 'aetherion', w: 12 },
      { id: 'mountanix', w: 12 },
      { id: 'oblivionix', w: 10 },
      { id: 'pyrovern', w: 10 },
    ],
    rivals: ['Nexus Architect', 'Root Admin'],
    accent: '#ff5fa2',
  },
];

/** Zone lookup with defensive fallback. */
export function getZone(id) {
  return ZONES.find((z) => z.id === id) || ZONES[0];
}

/** Zones the player has earned access to, given their strongest creature. */
export function unlockedZones(strongestLevel) {
  return ZONES.filter((z) => strongestLevel >= z.recommended - 4);
}

/**
 * Weighted random species pick from a zone's encounter table.
 * @param {object} zone
 * @param {() => number} rand Uniform random function in [0,1).
 * @returns {string} Species id.
 */
export function rollEncounter(zone, rand) {
  const total = zone.encounters.reduce((s, e) => s + e.w, 0);
  let roll = rand() * total;
  for (const e of zone.encounters) {
    roll -= e.w;
    if (roll <= 0) return e.id;
  }
  return zone.encounters[0].id;
}

/**
 * Generate a rival trainer team for a zone, scaled to the player's level.
 * Uses only species that appear in (or below) the zone's band so encounters
 * stay internally consistent.
 *
 * @param {object} zone
 * @param {number} playerLevel Strongest creature level of the player.
 * @param {() => number} rand
 * @returns {{name:string, level:number, members:{speciesId:string, level:number}[]}}
 */
export function rollRival(zone, playerLevel, rand) {
  const pool = zone.encounters.map((e) => e.id);
  const size = Math.min(6, 2 + Math.floor(rand() * 3) + (zone.recommended >= 26 ? 1 : 0));
  const baseLevel = Math.max(zone.minLevel, Math.min(zone.maxLevel, playerLevel + (rand() < 0.5 ? -1 : 1)));
  const members = [];
  for (let i = 0; i < size; i++) {
    const speciesId = pool[Math.floor(rand() * pool.length)];
    members.push({
      speciesId,
      level: Math.max(1, Math.min(50, baseLevel + Math.floor(rand() * 3) - 1)),
    });
  }
  const name = zone.rivals[Math.floor(rand() * zone.rivals.length)];
  return { name, level: baseLevel, members };
}
