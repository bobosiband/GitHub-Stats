import { getMemberByUsernameOrThrow, buildMemberProfile } from '../services/views.js';

export default async function memberRoutes(fastify) {
  // GET /members/:username
  fastify.get('/:username', async (request) => {
    const member = await getMemberByUsernameOrThrow(fastify.prisma, request.params.username);
    return buildMemberProfile(fastify.prisma, member);
  });
}
