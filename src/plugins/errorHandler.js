import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';

/**
 * Central error handler. Normalises every failure to `{ error: { code, message } }`.
 * - AppError            → its own statusCode/code
 * - ZodError            → 400 VALIDATION_ERROR (with field details)
 * - Prisma P2002        → 409 CONFLICT (unique constraint)
 * - Prisma P2025        → 404 NOT_FOUND (record not found)
 * - Fastify validation  → 400 VALIDATION_ERROR
 * - anything else        → 500 INTERNAL_ERROR (message hidden)
 */
async function errorHandlerPlugin(fastify) {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : 'field';
        return reply.code(409).send({
          error: { code: 'CONFLICT', message: `A record with this ${target} already exists` },
        });
      }
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      }
    }

    // Fastify's built-in schema validation errors.
    if (error.validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      });
    }

    // Respect explicit 4xx statusCodes set elsewhere.
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: { code: error.code ?? 'BAD_REQUEST', message: error.message },
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  // Consistent 404 shape for unmatched routes.
  fastify.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send({
        error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
      });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
