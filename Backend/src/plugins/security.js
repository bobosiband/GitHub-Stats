import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';

/**
 * Register CORS and rate limiting. Options let tests inject small limits and
 * skip the sleep-based windows entirely.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} opts
 * @param {string[]} opts.corsOrigins       allowlist for the `Origin` header
 * @param {number}   [opts.globalMax=120]   requests/window/IP for the global default
 * @param {number|string} [opts.globalWindow='1 minute']
 * @param {number}   [opts.joinMax=5]       requests/window/IP for join route
 * @param {number|string} [opts.joinWindow='1 minute']
 */
async function securityPlugin(fastify, opts) {
  const corsOrigins = opts.corsOrigins ?? [];
  await fastify.register(fastifyCors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: false,
  });

  // Rate-limit plugin `throw`s whatever we return here; the app-wide error handler
  // then serialises it into the standard `{ error: { code, message } }` shape.
  const errorResponseBuilder = (_req, context) => ({
    statusCode: 429,
    code: 'RATE_LIMITED',
    message: `Rate limit exceeded, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
  });

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: opts.globalMax ?? 120,
    timeWindow: opts.globalWindow ?? '1 minute',
    errorResponseBuilder,
  });

  // Expose stricter limits so route files can opt in per-route.
  fastify.decorate('rateLimits', {
    join: {
      max: opts.joinMax ?? 5,
      timeWindow: opts.joinWindow ?? '1 minute',
      errorResponseBuilder,
    },
  });
}

export default fp(securityPlugin, { name: 'security', dependencies: ['error-handler'] });
