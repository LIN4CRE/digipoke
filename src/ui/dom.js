/**
 * dom.js — Tiny hyperscript helpers.
 *
 * We deliberately avoid a framework: the app is a small set of screens with
 * coarse re-render boundaries, so a 90-line DOM helper keeps the bundle at
 * ~0 dependencies while staying readable.
 *
 *   h('div.card', { onclick }, [ h('h3', 'Hello'), ' world' ])
 *
 * Tag strings support `tag.class.class#id` shorthand. Text children are always
 * escaped (we never assign innerHTML from user data — see security doc).
 *
 * @module ui/dom
 */

/**
 * Create an element.
 * @param {string} tagLike 'div.card.card--pad#main'
 * @param {object|string|null} [props] Attributes, event handlers (`on*`), dataset, style, class.
 * @param {...any} children Strings, nodes, arrays or null/false (ignored).
 * @returns {HTMLElement}
 */
export function h(tagLike, props, ...children) {
  const [tagAndClasses, id] = tagLike.split('#');
  const parts = tagAndClasses.split('.');
  const tag = parts.shift() || 'div';
  const el = document.createElement(tag);
  if (parts.length) el.classList.add(...parts.filter(Boolean));
  if (id) el.id = id;

  if (props && typeof props === 'object' && !Array.isArray(props) && !(props instanceof Node)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') {
        el.classList.add(...String(value).split(/\s+/).filter(Boolean));
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key === 'html') {
        // Trusted markup only (our own sprite generator). Never pass user data.
        el.innerHTML = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in el && key !== 'list' && typeof value !== 'object') {
        el[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  } else if (props !== null && props !== undefined) {
    // h('p', 'text') form
    children.unshift(props);
  }

  append(el, children);
  return el;
}

/** Append nested children (arrays flattened, null/false skipped). */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Remove all children. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Replace the entire contents of a container. */
export function renderInto(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Shorthand query selector. */
export function qs(sel, root = document) { return root.querySelector(sel); }

/** Create a DocumentFragment from children (for batch insertion). */
export function fragment(...children) {
  const frag = document.createDocumentFragment();
  append(frag, children);
  return frag;
}

/**
 * Format a number with thousands separators (locale-stable).
 * @param {number} n
 */
export function num(n) {
  return Number(n ?? 0).toLocaleString('en-GB');
}

/** Percentage helper for bars. */
export function pct(value, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
