/**
 * Tiny in-process SSE broadcaster.
 *
 * Design constraints:
 * - Single-process only. This deploy target is one Node instance; anything
 *   distributed (Redis pub/sub, MQTT) is out of scope. If we ever move to
 *   multi-process, replace the module-level Set with a fan-out driven by a
 *   shared bus — the surface stays the same.
 * - Zero dependencies. Everything is plain Node streams.
 * - Writes to dead sockets are swallowed. `subscribe` returns a cleanup
 *   function so callers can remove themselves on `close`.
 */

/** @type {Set<import('node:stream').Writable>} */
const subscribers = new Set();

/**
 * Register a writable stream to receive broadcasts. Returns an `unsubscribe`
 * function; the caller MUST invoke it on `close` (usually via `req.raw.on('close', unsubscribe)`).
 *
 * @param {import('node:stream').Writable} stream
 * @returns {() => void}
 */
export function subscribe(stream) {
  subscribers.add(stream);
  return () => subscribers.delete(stream);
}

/** Test-only helper: current subscriber count. */
export function subscriberCount() {
  return subscribers.size;
}

/** Test/shutdown helper: drop every subscriber without touching sockets. */
export function reset() {
  subscribers.clear();
}

/**
 * Push one SSE event to every live subscriber. Never throws; per-socket write
 * failures just kick that socket out of the set (the connection is already
 * dead by the time we notice).
 *
 * @param {string} event
 * @param {any}    payload  JSON-serialisable
 */
export function broadcast(event, payload) {
  if (subscribers.size === 0) return;
  const data = JSON.stringify(payload ?? {});
  const frame = `event: ${event}\ndata: ${data}\n\n`;
  for (const stream of subscribers) {
    try {
      stream.write(frame);
    } catch {
      subscribers.delete(stream);
    }
  }
}
