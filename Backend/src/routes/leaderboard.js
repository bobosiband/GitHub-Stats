import { z } from 'zod';
import {
  buildLeaderboard,
  cohortReadEtag,
  getCohortBySlugOrThrow,
  DEFAULT_LEADERBOARD_SORT,
} from '../services/views.js';

const querySchema = z.object({
  sort: z
    .enum(['xp', 'commits', 'contributions', 'streak', 'stars'])
    .default(DEFAULT_LEADERBOARD_SORT),
});

export default async function leaderboardRoutes(fastify) {
  // GET /cohorts/:slug/leaderboard?sort=xp|commits|contributions|streak|stars
  //
  // Default sort is `xp` — the primary progression metric. Every entry also
  // carries `rankDelta` (positive = climbed, negative = fell, 0 = same, null =
  // no previous rank / brand-new member).
  //
  // ETag: derived from the cohort's latest snapshot `capturedAt` + membership
  // count. Two cheap aggregates, no row loading — so a conditional GET with
  // matching If-None-Match answers 304 in a few ms without touching JSON at all.
  fastify.get('/:slug/leaderboard', async (request, reply) => {
    const { sort } = querySchema.parse(request.query ?? {});
    const cohort = await getCohortBySlugOrThrow(fastify.prisma, request.params.slug);
    const etag = await cohortReadEtag(fastify.prisma, cohort, `lb-${sort}`);
    reply.header('etag', etag);
    reply.header('cache-control', 'no-cache'); // "revalidate before use"

    if (request.headers['if-none-match'] === etag) {
      reply.code(304).send();
      return reply;
    }

    return buildLeaderboard(fastify.prisma, cohort, sort);
  });
}
