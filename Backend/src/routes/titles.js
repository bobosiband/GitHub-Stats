import { getCohortBySlugOrThrow, buildCohortTitles } from '../services/views.js';

export default async function titleRoutes(fastify) {
  // GET /cohorts/:slug/titles
  fastify.get('/:slug/titles', async (request) => {
    const cohort = await getCohortBySlugOrThrow(fastify.prisma, request.params.slug);
    return buildCohortTitles(fastify.prisma, cohort);
  });
}
