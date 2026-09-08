/**
 * explore.js — Zone selection, scanning and encounter generation.
 *
 * Scanning is the core "gacha-free" loop: each scan burns one step, accrues
 * objective progress, and rolls for an encounter using the profile's seeded
 * RNG. Encounters hand off to the battle screen via the router, which keeps
 * the (large) battle UI out of memory until it is actually needed.
 *
 * @module ui/screens/explore
 */

import { h, renderInto } from '../dom.js';
import { card, sectionHead, spriteEl, badge, toast, emptyState, typeRow } from '../components.js';
import * as state from '../../core/state.js';
import { createRng } from '../../core/rng.js';
import { sfx, startMusic } from '../../core/sfx.js';
import { navigate } from '../../core/router.js';
import { ZONES, getZone, rollEncounter, rollRival, unlockedZones } from '../../domain/zones.js';
import { getSpecies } from '../../domain/species.js';
import { createCreature } from '../../domain/creature.js';
import { setPendingRival } from './battle.js';

/** Per-profile RNG, seeded from the save file so runs are reproducible. */
let rng = null;
function worldRng() {
  if (!rng) rng = createRng(state.getState().profile.seed ^ Date.now());
  return rng;
}

/** Scanning guard so a double-tap cannot spawn two battles. */
let scanning = false;

/**
 * Render the Explore screen.
 * @param {HTMLElement} root
 */
export function render(root) {
  const s = state.getState();
  const zone = getZone(s.progress.zoneId);
  startMusic('explore');

  const view = h('div.view.view--explore', [
    card(null,
      sectionHead('Explore', h('span.pill', `${s.profile.stats.steps} scans`)),
      h('p.muted', 'Choose a zone, then scan it to stir up wild digi-life. Stronger zones unlock as your team levels up.'),
    ),
    h('div.zone-grid', ZONES.map((z) => zoneCard(z))),
    zonePanel(zone),
  ]);

  renderInto(root, view);
}

/* ------------------------------------------------------------------- zones */

/**
 * A zone is playable when the team is strong enough. We derive this from the
 * level rather than trusting `progress.unlocked`, so a save that missed an
 * unlock tick (or an imported file) never gets permanently stuck.
 */
function isUnlocked(zone, strongest) {
  return unlockedZones(strongest).some((z) => z.id === zone.id);
}

function zoneCard(zone) {
  const s = state.getState();
  const strongest = state.strongestLevel();
  const unlocked = isUnlocked(zone, strongest);
  const selected = s.progress.zoneId === zone.id;

  return h(`button.zone-card${selected ? '.is-selected' : ''}${unlocked ? '' : '.is-locked'}`, {
    type: 'button',
    disabled: !unlocked,
    style: { '--zone': zone.accent },
    onclick: () => {
      if (!unlocked) return;
      sfx.select();
      state.mutate((st) => { st.progress.zoneId = zone.id; });
      navigate('/explore');
    },
  }, [
    h('div.zone-card__head', [
      h('span.zone-card__name', zone.name),
      unlocked ? badge(`Lv ${zone.minLevel}–${zone.maxLevel}`, { kind: 'neutral' }) : badge('Locked', { kind: 'muted' }),
    ]),
    h('p.zone-card__blurb', unlocked ? zone.blurb : `Reach level ${Math.max(0, zone.recommended - 4)} to unlock (you: ${strongest}).`),
    h('div.zone-card__pool', unlocked
      ? zone.encounters.map((e) => spriteEl(e.id, { size: 40 }))
      : [h('span.zone-card__lock', '🔒')]),
  ]);
}

function zonePanel(zone) {
  const s = state.getState();
  return card(null,
    sectionHead(zone.name,
      h('span.pill', { style: { color: zone.accent } }, `Lv ${zone.minLevel}–${zone.maxLevel}`)),
    h('p.muted', zone.blurb),
    h('div.row.row--wrap', [
      h('button.btn.btn--primary.btn--lg', {
        type: 'button',
        onclick: () => scan(zone),
      }, `Scan area (1 step)`),
      h('button.btn.btn--ghost.btn--lg', {
        type: 'button',
        onclick: () => challengeTrainer(zone),
      }, 'Challenge a trainer'),
    ]),
    h('p.muted.muted--sm', [
      'Trainers appear once you have scanned a few steps and pay 1.5× XP plus bonus Data Shards. ',
      `Defeated here: ${s.progress.defeatedTrainers.length}`,
    ]),
    h('h4.detail__sub', 'Likely encounters'),
    h('div.encounter-list', zone.encounters.map((e) => {
      const species = getSpecies(e.id);
      return h('div.encounter-row', [
        spriteEl(e.id, { size: 44 }),
        h('div', [
          h('div.encounter-row__name', species.name),
          typeRow(species.types, { small: true }),
        ]),
        h('span.encounter-row__weight', `${Math.round((e.w / zone.encounters.reduce((a, b) => a + b.w, 0)) * 100)}%`),
      ]);
    })),
  );
}

/* ------------------------------------------------------------------ actions */

/** Perform one scan step, rolling for an encounter. */
async function scan(zone) {
  if (scanning) return;
  const team = state.teamCreatures().filter((c) => c.hp > 0);
  if (!team.length) {
    sfx.error();
    toast('Your team is knocked out. Heal at the Ranch or Nexus first.', 'error');
    return;
  }

  scanning = true;
  sfx.scan();
  const scanBtn = document.querySelector('.view--explore .btn--primary');
  if (scanBtn) { scanBtn.classList.add('is-scanning'); scanBtn.disabled = true; }
  state.recordSteps(1);

  // Encounter probability rises with consecutive scans since the last battle.
  const r = worldRng();
  const chance = 0.42;
  await wait(420);

  if (r.next() < chance) {
    const speciesId = rollEncounter(zone, () => r.next());
    const level = r.int(zone.minLevel, zone.maxLevel);
    const wild = createCreature({
      speciesId, level, rand: r,
      origin: { zone: zone.id, wild: true },
    });
    sfx.encounter();
    const flash = document.querySelector('.view--explore');
    if (flash) { flash.classList.add('is-encounter'); setTimeout(() => flash.classList.remove('is-encounter'), 700); }
    state.mutate((s) => { s.profile.stats.steps = s.profile.stats.steps; });
    navigate(`/battle?wild=1&zone=${zone.id}&species=${speciesId}&level=${level}`);
  } else {
    sfx.select();
    toast('Nothing but stray data… try another scan.', 'info');
  }
  scanning = false;
  const scanBtn2 = document.querySelector('.view--explore .btn--primary');
  if (scanBtn2) { scanBtn2.classList.remove('is-scanning'); scanBtn2.disabled = false; }
}

/** Generate and start a trainer battle. */
function challengeTrainer(zone) {
  const team = state.teamCreatures().filter((c) => c.hp > 0);
  if (!team.length) {
    sfx.error();
    toast('Your team is knocked out. Heal first.', 'error');
    return;
  }
  sfx.confirm();
  const r = worldRng();
  const rival = rollRival(zone, state.strongestLevel(), () => r.next());
  setPendingRival({ name: rival.name, members: rival.members, zoneId: zone.id });
  navigate(`/battle?trainer=1&zone=${zone.id}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const meta = { title: 'Explore' };
