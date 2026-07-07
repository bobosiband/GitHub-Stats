import fp from 'fastify-plugin';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * Decorates the instance with `requireAdmin`, a preHandler enforcing a static
 * bearer token (`Authorization: Bearer <ADMIN_TOKEN>`). The expected token is
 * read from `opts.adminToken`.
 */
async function authPlugin(fastify, opts) {
  const adminToken = opts.adminToken;

  fastify.decorate('requireAdmin', async function requireAdmin(request) {
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token || token !== adminToken) {
      throw new UnauthorizedError('Missing or invalid admin bearer token');
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
