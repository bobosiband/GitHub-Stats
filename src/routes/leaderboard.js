import { z } from 'zod';
import { getCohortBySlugOrThrow, buildLeaderboard } from '../services/views.js';

const querySchema = z.object({
  sort: z.enum(['commits', 'contributions', 'streak', 'stars']).default('commits'),
});

export default async function leaderboardRoutes(fastify) {
  // GET /cohorts/:slug/leaderboard?sort=commits|contributions|streak|stars
  fastify.get('/:slug/leaderboard', async (request) => {
    const { sort } = querySchema.parse(request.query ?? {});
    const cohort = await getCohortBySlugOrThrow(fastify.prisma, request.params.slug);
    return buildLeaderboard(fastify.prisma, cohort, sort);
  });
}
