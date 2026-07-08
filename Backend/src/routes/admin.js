import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';
import { syncCohort } from '../services/sync.js';
import { evaluateCohort } from '../services/titles/engine.js';
import {
  getCohortBySlugOrThrow,
  getMemberByUsernameOrThrow,
  serializeCohort,
} from '../services/views.js';

const createCohortSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  isActive: z.boolean().default(true),
});

const repoSchema = z
  .union([
    z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be "owner/name"'),
    z.object({ owner: z.string().min(1), name: z.string().min(1) }),
  ])
  .transform((v) =>
    typeof v === 'string' ? { owner: v.split('/')[0], name: v.split('/')[1] } : v,
  );

const programRepoBodySchema = z.object({
  cohortSlug: z.string().min(1),
  repo: repoSchema,
});

const programRepoQuerySchema = z.object({
  cohortSlug: z.string().min(1),
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

  // PUT /admin/members/:username/program-repo — organiser-managed program repo.
  // One repo per (member, cohort) membership — replace-on-exists so re-submitting
  // overwrites the previous entry and cleans up any historical duplicates.
  fastify.put('/members/:username/program-repo', async (request, reply) => {
    const { cohortSlug, repo } = programRepoBodySchema.parse(request.body ?? {});
    const [member, cohort] = await Promise.all([
      getMemberByUsernameOrThrow(prisma, request.params.username),
      getCohortBySlugOrThrow(prisma, cohortSlug),
    ]);
    const membership = await prisma.membership.findUnique({
      where: { memberId_cohortId: { memberId: member.id, cohortId: cohort.id } },
    });
    if (!membership) {
      throw new NotFoundError(
        `Membership not found for ${member.githubUsername} in cohort ${cohort.slug}`,
      );
    }

    const programRepo = await prisma.$transaction(async (tx) => {
      await tx.programRepo.deleteMany({ where: { membershipId: membership.id } });
      return tx.programRepo.create({
        data: { membershipId: membership.id, owner: repo.owner, name: repo.name },
      });
    });

    reply.code(200);
    return {
      programRepo: {
        cohortSlug: cohort.slug,
        username: member.githubUsername,
        owner: programRepo.owner,
        name: programRepo.name,
      },
    };
  });

  // DELETE /admin/members/:username/program-repo?cohortSlug=...
  fastify.delete('/members/:username/program-repo', async (request) => {
    const { cohortSlug } = programRepoQuerySchema.parse(request.query ?? {});
    const [member, cohort] = await Promise.all([
      getMemberByUsernameOrThrow(prisma, request.params.username),
      getCohortBySlugOrThrow(prisma, cohortSlug),
    ]);
    const membership = await prisma.membership.findUnique({
      where: { memberId_cohortId: { memberId: member.id, cohortId: cohort.id } },
    });
    if (!membership) {
      throw new NotFoundError(
        `Membership not found for ${member.githubUsername} in cohort ${cohort.slug}`,
      );
    }

    const { count } = await prisma.programRepo.deleteMany({
      where: { membershipId: membership.id },
    });
    return { deleted: count };
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

  // POST /admin/sync-all — external cron trigger for free-tier hosts. Runs the
  // same runner as node-cron; shares the in-process lock, so a concurrent tick
  // safely returns `{ skipped: true }` instead of double-syncing.
  fastify.post('/sync-all', async () => {
    return fastify.syncRunner.run();
  });
}
