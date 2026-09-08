/**
 * router.js — Hash-based client router.
 *
 * Hash routing is deliberate: the PWA is served as static files from any
 * origin (including `file://` and a sub-path of a CDN), so we cannot rely on
 * server-side rewrites. Routes are declared as patterns like `#/ranch/:uid`.
 *
 * @module core/router
 */

const routes = [];
let currentHandler = null;
let currentMatch = null;
let notFoundHandler = null;

/**
 * Register a route.
 * @param {string} pattern Hash path, e.g. '/ranch' or '/creature/:uid'.
 * @param {(ctx:{params:object, query:URLSearchParams, path:string}) => void} handler
 * @param {{title?:string, guard?:() => boolean|string}} [opts]
 *   `guard`: return true to allow, false to block, or a path to redirect to.
 */
export function route(pattern, handler, opts = {}) {
  const { regex, keys } = compile(pattern);
  routes.push({ pattern, handler, regex, keys, ...opts });
}

/** Handler used when nothing matches. */
export function setNotFound(handler) { notFoundHandler = handler; }

/** Turn '/a/:b' into a regex plus ordered param names. */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${source || '\\/'}\\/?$`), keys };
}

/** Read the current hash path (defaults to '/'). */
export function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return '/';
  const [path] = raw.split('?');
  return path || '/';
}

/** Match a path against registered routes, extracting named params. */
function match(path) {
  for (const r of routes) {
    const found = r.regex.exec(path);
    if (!found) continue;
    const params = {};
    r.keys.forEach((key, i) => { params[key] = decodeURIComponent(found[i + 1]); });
    return { route: r, params };
  }
  return null;
}

/**
 * Navigate to a path.
 * @param {string} path
 * @param {{replace?:boolean}} [opts]
 */
export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === target) { resolve(); return; }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) resolve();
}

/** Replace the current URL without triggering navigation (e.g. to strip query). */
export function replacePath(path) {
  history.replaceState(null, '', `#${path}`);
}

/** Resolve the current hash: run guards, then the handler. */
export function resolve() {
  const path = currentPath();
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const found = match(path);

  if (!found) {
    if (notFoundHandler) notFoundHandler({ path, query, params: {} });
    return;
  }

  const { route: r, params } = found;
  if (r.guard) {
    const verdict = r.guard();
    if (verdict === false) return;
    if (typeof verdict === 'string') { navigate(verdict, { replace: true }); return; }
  }

  currentHandler = r.handler;
  currentMatch = { path, params, query };
  if (r.title) document.title = `${r.title} · DigiPoke`;
  r.handler({ params, query, path });
}

/** Re-render the active route (called after state changes that affect the view). */
export function refresh() {
  if (currentHandler && currentMatch) currentHandler(currentMatch);
}

/** Begin listening to hash changes. */
export function startRouter() {
  window.addEventListener('hashchange', resolve);
  if (!location.hash) history.replaceState(null, '', '#/');
  resolve();
}

/** Currently matched path (useful for nav highlighting). */
export function activePath() { return currentPath(); }
