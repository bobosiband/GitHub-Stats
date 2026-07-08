import { subscribe } from '../services/events.js';

/**
 * GET /events — Server-Sent Events stream.
 *
 * Broadcast events currently emitted:
 *   sync.completed  { cohorts: [{ slug, snapshotsCreated }], finishedAt }
 *   titles.changed  { slug, changes }
 *   cohort.updated  { slug, previousSlug?, dateChanged }
 *   cohort.deleted  { slug }
 *
 * Implementation notes:
 * - `reply.hijack()` releases the request from Fastify so we can hold the socket
 *   open indefinitely without a per-request timeout tripping.
 * - We echo CORS headers ourselves because @fastify/cors doesn't add them to
 *   hijacked replies (it runs on the fastify preHandler pipeline, which we
 *   short-circuit). The allowlist comes from `fastify.config.CORS_ORIGIN`.
 * - Heartbeat every 25 s so intermediate proxies (Cloudflare et al.) don't
 *   silently close idle connections.
 */

const HEARTBEAT_MS = 25_000;

export default async function eventRoutes(fastify) {
  const allowedOrigins = fastify.config?.CORS_ORIGIN ?? [];

  // The /events endpoint holds a long-lived connection; the global rate limit
  // (120 req/min) treats each connection as one request, which is fine.
  fastify.get('/events', async (request, reply) => {
    // reply.hijack() detaches from Fastify's response pipeline — reply.header()
    // won't be flushed after that, so we write the headers directly on the raw
    // socket via writeHead(). This also lets us echo CORS ourselves for
    // hijacked responses that @fastify/cors doesn't touch.
    reply.hijack();
    const raw = reply.raw;

    const headers = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable buffering on proxies that respect this hint.
      'x-accel-buffering': 'no',
    };
    const origin = request.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers.vary = 'Origin';
    }
    raw.writeHead(200, headers);

    // Reconnect hint + one initial comment so the browser gets `open` immediately.
    raw.write('retry: 5000\n\n');
    raw.write(': connected\n\n');

    const unsubscribe = subscribe(raw);

    const heartbeat = setInterval(() => {
      try { raw.write(':hb\n\n'); } catch { /* dead socket — will be cleaned up */ }
    }, HEARTBEAT_MS);
    // Don't hold the process open just for a heartbeat.
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      try { raw.end(); } catch { /* already closed */ }
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
