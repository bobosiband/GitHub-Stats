import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';

/**
 * Decorates the Fastify instance with a shared PrismaClient as `fastify.prisma`
 * and disconnects it on shutdown. Wrapped with fastify-plugin so the decorator
 * is visible to every route plugin (not encapsulated).
 *
 * An existing client can be injected via `opts.prisma` (used by tests).
 */
async function prismaPlugin(fastify, opts) {
  const prisma = opts.prisma ?? new PrismaClient();
  const owns = !opts.prisma;

  if (owns) {
    await prisma.$connect();
  }

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async (instance) => {
    // Only disconnect clients we created; injected ones are the caller's to manage.
    if (owns) {
      await instance.prisma.$disconnect();
    }
  });
}

export default fp(prismaPlugin, { name: 'prisma' });
