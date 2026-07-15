import { z } from 'zod';
import { BadRequestError } from '../lib/errors.js';
import {
  getMemberByUsernameOrThrow,
  buildMemberProfile,
  buildCompare,
} from '../services/views.js';

const compareQuerySchema = z.object({
  a: z.string().min(1, 'a is required'),
  b: z.string().min(1, 'b is required'),
});

export default async function memberRoutes(fastify) {
  // GET /members/compare?a=:username&b=:username
  //
  // Registered BEFORE /:username so the literal path wins the match — Fastify
  // routes both to the same prefix and would otherwise treat "compare" as a
  // username lookup.
  fastify.get('/compare', async (request) => {
    const parsed = compareQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join('; '),
        'VALIDATION_ERROR',
      );
    }
    const { a, b } = parsed.data;
    const [memberA, memberB] = await Promise.all([
      getMemberByUsernameOrThrow(fastify.prisma, a),
      getMemberByUsernameOrThrow(fastify.prisma, b),
    ]);
    return buildCompare(fastify.prisma, { a: memberA, b: memberB });
  });

  // GET /members/:username
  fastify.get('/:username', async (request) => {
    const member = await getMemberByUsernameOrThrow(fastify.prisma, request.params.username);
    return buildMemberProfile(fastify.prisma, member);
  });
}
