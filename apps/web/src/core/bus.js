/**
 * bus.js — Minimal synchronous event bus.
 *
 * Used for cross-module notifications that must not create import cycles
 * (state → UI, sync → UI, persistence → settings). Handlers are invoked with a
 * single payload object; errors are isolated so one bad listener cannot break
 * the app.
 *
 * @module core/bus
 */

const listeners = new Map();

/**
 * Subscribe to an event.
 * @param {string} event
 * @param {(payload:any) => void} handler
 * @returns {() => void} Unsubscribe function.
 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

/** Subscribe once. */
export function once(event, handler) {
  const wrapped = (payload) => { off(event, wrapped); handler(payload); };
  return on(event, wrapped);
}

/** Unsubscribe. */
export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

/**
 * Emit an event. Listener exceptions are caught and logged so a failing
 * listener never aborts the emitting workflow.
 * @param {string} event
 * @param {any} [payload]
 */
export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[bus] listener for "${event}" threw:`, err);
    }
  }
}

/** Remove every listener (used by tests and full teardown). */
export function clearBus() {
  listeners.clear();
}

/** Canonical event names, to avoid typos across modules. */
export const EVENTS = {
  STATE_CHANGED: 'state:changed',
  STATE_PERSISTED: 'state:persisted',
  TOAST: 'ui:toast',
  NAVIGATE: 'ui:navigate',
  BATTLE_START: 'battle:start',
  BATTLE_END: 'battle:end',
  CREATURE_CAUGHT: 'creature:caught',
  EVOLVED: 'creature:evolved',
  LEVEL_UP: 'creature:levelup',
  SYNC_STATUS: 'sync:status',
};
