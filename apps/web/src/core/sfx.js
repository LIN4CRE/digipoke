/**
 * sfx.js — Procedural audio engine: sound effects AND adaptive music.
 *
 * Zero assets: every sound is synthesised from oscillators and noise buffers at
 * runtime, which keeps the PWA tiny and fully offline while still giving the
 * game a complete audio identity.
 *
 * Signal graph
 * ------------
 *   osc/noise → envelope → sfxGain ┐
 *                                   ├→ master → destination
 *   pad/arp/bass → musicGain ───────┘
 *
 * Separate SFX and music buses allow independent volume sliders (Settings) and
 * let music duck during a battle without touching effect levels.
 *
 * Autoplay policy: the AudioContext is created lazily on the first user gesture
 * (`unlockAudio()`), and stays suspended until then.
 *
 * @module core/sfx
 */

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;

/** User-controlled levels (0..1), mirrored into Settings. */
const levels = { sfx: 0.7, music: 0.35, muted: false };

/**
 * Timestamp of the last synthesised effect. The app uses this to decide
 * whether an interaction already produced its own sound, so a global
 * "click anything" fallback never double-triggers over a bespoke cue.
 */
let lastSoundAt = 0;
const markSound = () => { lastSoundAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()); };

/** Milliseconds since the last sound effect played. */
export function sinceLastSound() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastSoundAt;
}

/** Create (or return) the audio context and buses. */
function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = levels.muted ? 0 : levels.sfx;
  sfxBus.connect(master);

  musicBus = ctx.createGain();
  musicBus.gain.value = levels.muted ? 0 : levels.music;
  musicBus.connect(master);
  return ctx;
}

/** Resume a suspended context (call from the first pointer/keydown). */
export function unlockAudio() {
  const c = context();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** Set SFX volume (0..1). */
export function setSfxVolume(v) {
  levels.sfx = Math.max(0, Math.min(1, v));
  if (sfxBus) sfxBus.gain.value = levels.muted ? 0 : levels.sfx;
}

/** Set music volume (0..1). */
export function setMusicVolume(v) {
  levels.music = Math.max(0, Math.min(1, v));
  if (musicBus) musicBus.gain.value = levels.muted ? 0 : levels.music;
}

/** Master mute toggle (also used by the reduced-motion / quiet preference). */
export function setSoundEnabled(next) {
  levels.muted = !next;
  if (sfxBus) sfxBus.gain.value = levels.muted ? 0 : levels.sfx;
  if (musicBus) musicBus.gain.value = levels.muted ? 0 : levels.music;
  if (levels.muted) stopMusic();
}

/* ----------------------------------------------------------------- helpers */

/** Convert a MIDI note number to Hz. */
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Core tone primitive.
 * @param {object} o
 * @param {number} o.freq
 * @param {number} [o.dur]
 * @param {OscillatorType} [o.type]
 * @param {number} [o.slide] Glide target frequency.
 * @param {number} [o.gain]
 * @param {number} [o.delay] Seconds from now.
 * @param {number} [o.attack]
 * @param {AudioNode} [o.bus] Destination bus (defaults to SFX).
 */
function tone({ freq, dur = 0.14, type = 'square', slide = null, gain = 0.5, delay = 0, attack = 0.008, bus = null }) {
  markSound();
  if (levels.muted) return;
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(bus || sfxBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Filtered noise burst for impacts, whooshes and textures. */
function noise({ dur = 0.18, gain = 0.4, delay = 0, freq = 1200, type = 'lowpass', sweep = null } = {}) {
  markSound();
  if (levels.muted) return;
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(env).connect(sfxBus);
  src.start(t0);
}

/** Play a short arpeggio of MIDI notes. */
function arp(notes, { type = 'triangle', step = 0.07, dur = 0.16, gain = 0.34 } = {}) {
  notes.forEach((n, i) => tone({ freq: mtof(n), dur, type, gain, delay: i * step }));
}

/** Haptic feedback where supported (mobile). */
function vibrate(pattern) {
  if (levels.muted) return;
  try { if (typeof navigator !== 'undefined') navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

/* ---------------------------------------------------------- sound library */

/**
 * Named cues. Every interaction in the game maps to one of these — there is no
 * silent button anywhere in DigiPoke.
 */
export const sfx = {
  /* ---- interface ---- */
  hover:    () => tone({ freq: 720, dur: 0.035, type: 'sine', gain: 0.1 }),
  click:    () => { tone({ freq: 560, dur: 0.06, type: 'square', gain: 0.26 }); tone({ freq: 840, dur: 0.05, type: 'sine', gain: 0.16, delay: 0.02 }); },
  select:   () => arp([72, 79], { step: 0.05, dur: 0.1, gain: 0.24 }),
  back:     () => tone({ freq: 400, slide: 260, dur: 0.09, type: 'square', gain: 0.22 }),
  confirm:  () => arp([67, 74, 79], { step: 0.055, dur: 0.14, gain: 0.3 }),
  open:     () => tone({ freq: 320, slide: 640, dur: 0.14, type: 'sine', gain: 0.24 }),
  close:    () => tone({ freq: 640, slide: 300, dur: 0.13, type: 'sine', gain: 0.2 }),
  toggle:   () => tone({ freq: 480, dur: 0.05, type: 'square', gain: 0.2 }),
  tab:      () => tone({ freq: 620, dur: 0.045, type: 'triangle', gain: 0.18 }),
  type:     () => tone({ freq: 900 + Math.random() * 200, dur: 0.02, type: 'square', gain: 0.07 }),
  error:    () => { tone({ freq: 200, dur: 0.11, type: 'square', gain: 0.28 }); tone({ freq: 150, dur: 0.15, type: 'square', gain: 0.26, delay: 0.09 }); vibrate(60); },
  deny:     () => tone({ freq: 180, slide: 120, dur: 0.18, type: 'sawtooth', gain: 0.24 }),

  /* ---- exploration ---- */
  scan:     () => { tone({ freq: 1200, slide: 600, dur: 0.5, type: 'sine', gain: 0.16 }); noise({ dur: 0.4, gain: 0.08, freq: 2400, sweep: 400 }); },
  encounter:() => { tone({ freq: 880, slide: 1320, dur: 0.16, type: 'sawtooth', gain: 0.3 }); tone({ freq: 1320, dur: 0.22, type: 'square', gain: 0.22, delay: 0.14 }); vibrate([30, 40, 30]); },
  appear:   () => { noise({ dur: 0.34, gain: 0.28, freq: 300, sweep: 3600, type: 'bandpass' }); tone({ freq: 180, slide: 900, dur: 0.34, type: 'triangle', gain: 0.24 }); },
  step:     () => noise({ dur: 0.07, gain: 0.1, freq: 700, sweep: 300 }),

  /* ---- battle ---- */
  movePhysical: () => { noise({ dur: 0.16, gain: 0.26, freq: 2600, sweep: 700 }); tone({ freq: 340, slide: 160, dur: 0.13, type: 'sawtooth', gain: 0.2 }); },
  moveSpecial:  () => { tone({ freq: 520, slide: 1240, dur: 0.2, type: 'square', gain: 0.24 }); noise({ dur: 0.22, gain: 0.16, freq: 1400, sweep: 3000 }); },
  moveSupport:  () => arp([64, 69, 72], { type: 'sine', step: 0.06, dur: 0.2, gain: 0.22 }),
  hit:          () => { noise({ dur: 0.13, gain: 0.42, freq: 1500, sweep: 300 }); tone({ freq: 190, slide: 80, dur: 0.14, type: 'square', gain: 0.26 }); vibrate(18); },
  superHit:     () => { noise({ dur: 0.18, gain: 0.52, freq: 2400, sweep: 400 }); tone({ freq: 320, slide: 110, dur: 0.2, type: 'sawtooth', gain: 0.3 }); vibrate([12, 20, 12]); },
  weakHit:      () => { noise({ dur: 0.1, gain: 0.2, freq: 700, sweep: 200 }); tone({ freq: 150, slide: 90, dur: 0.1, type: 'triangle', gain: 0.18 }); },
  crit:         () => { noise({ dur: 0.22, gain: 0.6, freq: 3200, sweep: 500 }); arp([84, 88], { type: 'square', step: 0.05, dur: 0.12, gain: 0.3 }); vibrate([20, 30, 20]); },
  miss:         () => { noise({ dur: 0.2, gain: 0.16, freq: 900, sweep: 2400, type: 'highpass' }); },
  status:       () => { tone({ freq: 300, slide: 200, dur: 0.24, type: 'sawtooth', gain: 0.22 }); noise({ dur: 0.3, gain: 0.12, freq: 500 }); },
  heal:         () => arp([65, 69, 72, 77], { type: 'sine', step: 0.07, dur: 0.26, gain: 0.24 }),
  cure:         () => arp([72, 76, 79], { type: 'sine', step: 0.06, dur: 0.2, gain: 0.2 }),
  statUp:       () => { tone({ freq: 480, slide: 720, dur: 0.18, type: 'triangle', gain: 0.24 }); },
  statDown:     () => { tone({ freq: 480, slide: 300, dur: 0.2, type: 'triangle', gain: 0.22 }); },
  faint:        () => { tone({ freq: 460, slide: 70, dur: 0.55, type: 'sine', gain: 0.34 }); noise({ dur: 0.4, gain: 0.14, freq: 600, sweep: 120 }); vibrate(120); },
  switchIn:     () => { tone({ freq: 300, slide: 620, dur: 0.16, type: 'square', gain: 0.24 }); noise({ dur: 0.14, gain: 0.14, freq: 900, sweep: 2200 }); },

  /* ---- capture ---- */
  ballThrow:    () => { noise({ dur: 0.2, gain: 0.22, freq: 600, sweep: 2600 }); tone({ freq: 700, slide: 300, dur: 0.22, type: 'sine', gain: 0.22 }); },
  ballWobble:   () => { tone({ freq: 240, dur: 0.1, type: 'square', gain: 0.24 }); tone({ freq: 180, dur: 0.1, type: 'square', gain: 0.2, delay: 0.09 }); },
  captureSuccess: () => { arp([72, 76, 79, 84], { type: 'triangle', step: 0.08, dur: 0.3, gain: 0.32 }); noise({ dur: 0.5, gain: 0.12, freq: 1200, sweep: 300 }); vibrate([20, 60, 20, 60, 40]); },
  captureFail:  () => { tone({ freq: 260, slide: 150, dur: 0.28, type: 'sawtooth', gain: 0.26 }); },

  /* ---- progression ---- */
  xp:           () => tone({ freq: 1040, dur: 0.06, type: 'sine', gain: 0.12 }),
  levelUp:      () => arp([67, 71, 74, 79], { type: 'square', step: 0.07, dur: 0.2, gain: 0.28 }),
  learn:        () => arp([72, 79, 84], { type: 'triangle', step: 0.06, dur: 0.18, gain: 0.24 }),
  evolve:       () => {
    arp([60, 64, 67, 72, 76, 79, 84], { type: 'triangle', step: 0.085, dur: 0.4, gain: 0.3 });
    noise({ dur: 1.1, gain: 0.18, freq: 400, sweep: 5200, type: 'bandpass' });
    vibrate([30, 60, 30, 60, 120]);
  },
  victory:      () => { arp([67, 71, 74, 79, 83], { type: 'square', step: 0.11, dur: 0.34, gain: 0.3 }); tone({ freq: 98, dur: 0.9, type: 'triangle', gain: 0.22, delay: 0.05 }); },
  defeat:       () => { arp([67, 63, 60, 55], { type: 'triangle', step: 0.16, dur: 0.4, gain: 0.26 }); },
  flee:         () => { noise({ dur: 0.35, gain: 0.2, freq: 1800, sweep: 300 }); tone({ freq: 520, slide: 200, dur: 0.3, type: 'sine', gain: 0.2 }); },

  /* ---- economy / meta ---- */
  purchase:     () => arp([79, 84], { type: 'square', step: 0.06, dur: 0.14, gain: 0.26 }),
  reward:       () => arp([76, 81, 88], { type: 'triangle', step: 0.07, dur: 0.24, gain: 0.26 }),
  objective:    () => arp([72, 77, 84, 89], { type: 'sine', step: 0.06, dur: 0.26, gain: 0.24 }),
  release:      () => { tone({ freq: 400, slide: 120, dur: 0.4, type: 'sine', gain: 0.24 }); },
  notify:       () => tone({ freq: 880, dur: 0.09, type: 'sine', gain: 0.16 }),
  boot:         () => { arp([60, 67, 72, 79], { type: 'triangle', step: 0.09, dur: 0.4, gain: 0.22 }); },
  digitise:     () => { noise({ dur: 0.8, gain: 0.2, freq: 200, sweep: 6000, type: 'bandpass' }); arp([64, 71, 76, 83], { type: 'sine', step: 0.07, dur: 0.5, gain: 0.22 }); },
};

/* ------------------------------------------------------------------ music */

/**
 * Track definitions. Each has a tempo, a four-bar chord progression (MIDI),
 * an arpeggio pattern, and a bass line derived from the chord roots.
 */
const TRACKS = {
  menu: {
    bpm: 72,
    chords: [[57, 64, 67, 71], [53, 60, 64, 67], [55, 62, 65, 69], [52, 59, 64, 67]],
    arp: [0, 2, 3, 2],
    padType: 'triangle', arpType: 'sine', bass: true, gain: 0.5,
  },
  explore: {
    bpm: 88,
    chords: [[57, 61, 64, 68], [59, 62, 66, 69], [53, 57, 60, 64], [55, 59, 62, 66]],
    arp: [0, 1, 2, 3, 2, 1],
    padType: 'triangle', arpType: 'triangle', bass: true, gain: 0.5,
  },
  lab: {
    bpm: 80,
    chords: [[60, 64, 67, 72], [57, 64, 67, 71], [62, 65, 69, 72], [55, 62, 66, 71]],
    arp: [0, 3, 1, 3],
    padType: 'sine', arpType: 'sine', bass: true, gain: 0.45,
  },
  battle: {
    bpm: 116,
    chords: [[45, 52, 57, 60], [43, 50, 55, 58], [41, 48, 53, 56], [40, 47, 52, 55]],
    arp: [0, 2, 3, 2, 1, 3],
    padType: 'sawtooth', arpType: 'square', bass: true, gain: 0.42,
  },
  victory: {
    bpm: 100,
    chords: [[60, 64, 67, 72], [62, 65, 69, 74], [64, 67, 71, 76], [67, 71, 74, 79]],
    arp: [0, 1, 2, 3],
    padType: 'triangle', arpType: 'triangle', bass: true, gain: 0.45,
  },
};

let music = { name: null, timer: null, step: 0, nextTime: 0 };

/**
 * Start (or switch to) a music track. Safe to call repeatedly with the same
 * name — it will not restart.
 * @param {'menu'|'explore'|'lab'|'battle'|'victory'} name
 */
export function startMusic(name) {
  if (!TRACKS[name]) return;
  if (music.name === name && music.timer) return;
  stopMusic();
  if (levels.muted || levels.music <= 0) { music.name = name; return; }

  const c = context();
  if (!c) return;
  music.name = name;
  music.step = 0;
  music.nextTime = c.currentTime + 0.08;
  music.timer = setInterval(() => scheduleMusic(), 25);
}

/** Stop music immediately. */
export function stopMusic() {
  if (music.timer) clearInterval(music.timer);
  music.timer = null;
}

/** Lookahead scheduler: queue notes slightly ahead of the audio clock. */
function scheduleMusic() {
  const c = ctx;
  const track = TRACKS[music.name];
  if (!c || !track) return;
  const secondsPerStep = 60 / track.bpm / 4; // 16th notes

  while (music.nextTime < c.currentTime + 0.25) {
    playStep(track, music.step, music.nextTime, secondsPerStep);
    music.step += 1;
    music.nextTime += secondsPerStep;
  }
}

/** Render one 16th-note step. */
function playStep(track, step, when, sps) {
  const bar = Math.floor(step / 16) % track.chords.length;
  const inBar = step % 16;
  const chord = track.chords[bar];

  // Pad: sustained chord at the start of each bar.
  if (inBar === 0) {
    for (const note of chord) {
      pad(mtof(note + 12), when, sps * 15, 0.055 * track.gain, track.padType);
    }
    if (track.bass) pad(mtof(chord[0] - 12), when, sps * 8, 0.10 * track.gain, 'sine');
  }

  // Arpeggio: bright counter-melody on off-beats.
  const arpIndex = track.arp[inBar % track.arp.length];
  if (inBar % 2 === 0) {
    const note = chord[arpIndex % chord.length] + 12;
    blip(mtof(note), when, sps * 1.6, 0.05 * track.gain, track.arpType);
  }

  // Battle pulse: a soft percussive tick on the beat.
  if (track.bpm > 110 && inBar % 4 === 0) {
    tick(when, inBar === 0 ? 0.09 : 0.05);
  }
}

/** Long, soft chord voice. */
function pad(freq, when, dur, gain, type) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0.0001, when);
  env.gain.linearRampToValueAtTime(gain, when + 0.35);
  env.gain.linearRampToValueAtTime(0.0001, when + dur);
  osc.connect(filter).connect(env).connect(musicBus);
  osc.start(when);
  osc.stop(when + dur + 0.05);
}

/** Short arpeggio note. */
function blip(freq, when, dur, gain, type) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(env).connect(musicBus);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

/** Percussive tick (battle pulse). */
function tick(when, gain) {
  const frames = Math.floor(ctx.sampleRate * 0.07);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  const env = ctx.createGain();
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(musicBus);
  src.start(when);
}

/** Which track is cued (used by the Settings screen). */
export function currentTrack() { return music.name; }
