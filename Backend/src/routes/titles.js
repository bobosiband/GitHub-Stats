import { buildCohortTitles, cohortReadEtag, getCohortBySlugOrThrow } from '../services/views.js';

export default async function titleRoutes(fastify) {
  // GET /cohorts/:slug/titles
  //
  // ETag: same freshness fingerprint the leaderboard route uses — a title only
  // changes because a snapshot moved a record, so `capturedAt + memberCount`
  // is a sufficient signal for stale/fresh.
  fastify.get('/:slug/titles', async (request, reply) => {
    const cohort = await getCohortBySlugOrThrow(fastify.prisma, request.params.slug);
    const etag = await cohortReadEtag(fastify.prisma, cohort, 'titles');
    reply.header('etag', etag);
    reply.header('cache-control', 'no-cache');

    if (request.headers['if-none-match'] === etag) {
      reply.code(304).send();
      return reply;
    }

    return buildCohortTitles(fastify.prisma, cohort);
  });
}
