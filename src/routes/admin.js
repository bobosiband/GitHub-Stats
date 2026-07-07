import { z } from 'zod';
import { syncCohort } from '../services/sync.js';
import { evaluateCohort } from '../services/titles/engine.js';
import { getCohortBySlugOrThrow, getMemberByUsernameOrThrow, serializeCohort } from '../services/views.js';

const createCohortSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  isActive: z.boolean().default(true),
});

export default async function adminRoutes(fastify) {
  const { prisma } = fastify;

  // Guard every admin route with the static bearer token.
  fastify.addHook('preHandler', fastify.requireAdmin);

  // POST /admin/cohorts
  fastify.post('/cohorts', async (request, reply) => {
    const data = createCohortSchema.parse(request.body ?? {});
    const cohort = await prisma.cohort.create({ data }); // duplicate slug → P2002 → 409
    reply.code(201);
    return { cohort: serializeCohort(cohort) };
  });

  // DELETE /admin/members/:username — cascade delete, then re-evaluate affected cohorts
  fastify.delete('/members/:username', async (request) => {
    const member = await getMemberByUsernameOrThrow(prisma, request.params.username);
    const memberships = await prisma.membership.findMany({
      where: { memberId: member.id },
      select: { cohortId: true },
    });
    const cohortIds = [...new Set(memberships.map((m) => m.cohortId))];

    await prisma.member.delete({ where: { id: member.id } }); // cascades snapshots + awards

    for (const cohortId of cohortIds) {
      await evaluateCohort({ prisma, cohortId });
    }

    return { deleted: member.githubUsername, reevaluatedCohorts: cohortIds.length };
  });

  // POST /admin/sync/:slug — manual sync + title evaluation
  fastify.post('/sync/:slug', async (request) => {
    const cohort = await getCohortBySlugOrThrow(prisma, request.params.slug);
    const sync = await syncCohort({
      prisma,
      fetchUserStats: fastify.fetchUserStats,
      cohortId: cohort.id,
      delayMs: 0,
      logger: fastify.log,
    });
    const evaluation = await evaluateCohort({ prisma, cohortId: cohort.id });
    return { sync, evaluation };
  });
}
