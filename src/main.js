/**
 * main.js — Application bootstrap.
 *
 * Boot order is deliberate:
 *   1. Open IndexedDB and hydrate state (never block the first paint on network).
 *   2. Wire UI infrastructure (toasts, chrome, routes).
 *   3. Start the router — it owns which screen is mounted.
 *   4. Register the service worker so the *next* visit is offline-capable.
 *   5. Install lifecycle hooks (autosave on hide, install prompt, connectivity).
 *
 * @module main
 */

import { qs, h } from './ui/dom.js';
import { initUi, renderTopbar, renderTabbar, toast } from './ui/components.js';
import * as state from './core/state.js';
import { on, EVENTS } from './core/bus.js';
import * as routerModule from './core/router.js';
import { sfx, setSoundEnabled, setSfxVolume, setMusicVolume, startMusic, unlockAudio, sinceLastSound } from './core/sfx.js';
import { applyTheme } from './ui/screens/settings.js';

import * as onboarding from './ui/screens/onboarding.js';
import * as dashboard from './ui/screens/dashboard.js';
import * as ranch from './ui/screens/ranch.js';
import * as explore from './ui/screens/explore.js';
import * as battle from './ui/screens/battle.js';
import * as lab from './ui/screens/lab.js';
import * as settings from './ui/screens/settings.js';

// Destructured after import for readability at call sites.
const { route, startRouter, activePath, navigate } = routerModule;

/** Deferred PWA install prompt. */
let installEvent = null;

/** DOM handles, resolved once at boot. */
let view = null;
let topbar = null;
let tabbar = null;

/**
 * Mount a screen: update the chrome, then render into the view container.
 * @param {(root:HTMLElement, ctx?:object) => void} screen
 * @param {object} [ctx]
 */
function mount(screen, ctx = { query: new URLSearchParams() }) {
  const path = activePath();
  const bare = path === '/onboarding';
  document.body.classList.toggle('is-bare', bare);
  if (!bare) {
    renderTopbar(topbar);
    renderTabbar(tabbar);
  }
  screen.render(view, ctx);
  window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
}

/** Register every route with its guard. */
function registerRoutes() {
  const requiresProfile = () => (state.hasProfile() ? true : '/onboarding');
  // Allow the wizard's final "ready" step to render for a brand-new profile;
  // any other visit to /onboarding with a save file goes to the dashboard.
  const requiresNoProfile = () => {
    if (!state.hasProfile()) return true;
    return onboarding.currentStep() >= 4 ? true : '/';
  };

  route('/onboarding', (ctx) => mount(onboarding, ctx), { title: 'Welcome', guard: requiresNoProfile });
  route('/', (ctx) => mount(dashboard, ctx), { title: 'Nexus', guard: requiresProfile });
  route('/ranch', (ctx) => mount(ranch, ctx), { title: 'Ranch', guard: requiresProfile });
  route('/explore', (ctx) => mount(explore, ctx), { title: 'Explore', guard: requiresProfile });
  route('/battle', (ctx) => mount(battle, ctx), { title: 'Battle', guard: requiresProfile });
  route('/lab', (ctx) => mount(lab, ctx), { title: 'Lab', guard: requiresProfile });
  route('/settings', (ctx) => mount(settings, ctx), { title: 'Settings', guard: requiresProfile });
}

/** Re-render the current screen (skipped for stateful screens). */
function refreshCurrent() {
  const path = activePath();
  // The battle screen owns an animation loop and must not be re-rendered
  // underneath itself; settings owns focused inputs.
  if (path === '/battle' || path === '/settings' || path === '/onboarding') {
    if (path !== '/onboarding') renderTopbar(topbar);
    return;
  }
  if (topbar) renderTopbar(topbar);
  const { refresh } = routerModule;
  refresh();
}

/** Imported router functions used by refreshCurrent. */
/** Register the service worker (progressive enhancement). */
async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!secure) {
    console.info('[pwa] service worker requires HTTPS or localhost; skipping.');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('DigiPoke updated — reload to get the new version.', 'info', 6000);
        }
      });
    });
  } catch (err) {
    console.warn('[pwa] service worker registration failed:', err);
  }
}

/** Persist pending writes when the tab is hidden or closed. */
function installLifecycleHooks() {
  window.addEventListener('pagehide', () => { state.flush().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') state.flush().catch(() => {});
  });

  // First gesture unlocks the WebAudio context (browser autoplay policy).
  const unlock = () => {
    unlockAudio();
    const st = state.isReady() ? state.getState() : null;
    if (st?.settings) {
      setSoundEnabled(st.settings.sound !== false);
      setSfxVolume(st.settings.sfxVolume ?? 0.7);
      setMusicVolume(st.settings.musicVolume ?? 0.35);
      if (st.settings.music !== false && !document.body.classList.contains('in-onboarding')) startMusic('menu');
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  window.addEventListener('online', () => toast('Back online. Sync is available in Settings.', 'success'));
  window.addEventListener('offline', () => toast('Offline — DigiPoke keeps working locally.', 'warn'));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    installEvent = null;
    hideInstallButton();
    toast('DigiPoke installed. It now works fully offline.', 'success');
  });

  window.addEventListener('error', (e) => console.error('[app] uncaught error:', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[app] unhandled rejection:', e.reason));

  installAmbientSound();
}

/**
 * Global interaction audio.
 *
 * Screens cue their own bespoke sounds; this safety net guarantees that no
 * control is ever silent. Both handlers run in the bubble phase, after the
 * element's own handler, so `sinceLastSound()` tells us whether a specific cue
 * already fired — if it did, we stay out of the way instead of doubling up.
 */
function installAmbientSound() {
  const HOVER_MS = 90;
  const CLICK_MS = 60;
  let lastHover = null;

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('button, .is-clickable, .list-row, .tabbar__item, input[type="checkbox"]');
    if (!el || el.disabled) return;
    if (sinceLastSound() > CLICK_MS) sfx.click();
  });

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('button, .is-clickable, .list-row, .tabbar__item');
    if (!el || el.disabled || el === lastHover) return;
    lastHover = el;
    if (sinceLastSound() > HOVER_MS) sfx.hover();
  });

  document.addEventListener('pointerout', (e) => {
    if (e.target === lastHover) lastHover = null;
  });
}

/** Offer the native install prompt when the browser supports it. */
function showInstallButton() {
  if (document.getElementById('install-btn')) return;
  const bar = topbar;
  if (!bar) return;
  bar.appendChild(h('button#install-btn.icon-btn', {
    type: 'button', title: 'Install DigiPoke', 'aria-label': 'Install DigiPoke',
    onclick: async () => {
      if (!installEvent) return;
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === 'accepted') toast('Installing…', 'success');
      installEvent = null;
      hideInstallButton();
    },
  }, '⤓'));
}

function hideInstallButton() {
  document.getElementById('install-btn')?.remove();
}

/**
 * Boot the application.
 * @returns {Promise<void>}
 */
export async function boot() {
  view = qs('#view');
  topbar = qs('#topbar');
  tabbar = qs('#tabbar');

  initUi();

  try {
    await state.init();
  } catch (err) {
    console.error('[boot] failed to load save:', err);
    toast('Could not open local storage. Private browsing may be blocking IndexedDB.', 'error', 8000);
  }

  registerRoutes();

  // Keep chrome and screens in sync with state changes.
  on(EVENTS.STATE_CHANGED, () => {
    if (!state.hasProfile()) {
      // e.g. after "delete all data": never render a screen against a null save.
      if (activePath() !== '/onboarding') navigate('/onboarding');
      return;
    }
    applyTheme(state.getState().settings.theme);
    refreshCurrent();
  });

  if (state.hasProfile()) {
    applyTheme(state.getState().settings.theme);
    setSoundEnabled(state.getState().settings.sound);
  }

  startRouter();
  installLifecycleHooks();
  await registerServiceWorker();

  console.info('%cDigiPoke ready', 'color:#7c5cff;font-weight:bold', '— local-first, offline-capable.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
