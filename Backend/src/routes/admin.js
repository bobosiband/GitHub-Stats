import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { syncCohort } from '../services/sync.js';
import { evaluateCohort } from '../services/titles/engine.js';
import {
  getCohortBySlugOrThrow,
  getMemberByUsernameOrThrow,
  serializeCohort,
} from '../services/views.js';
import { GLOBAL_COHORT_SLUG } from '../services/global.js';
import { broadcast } from '../services/events.js';

// Shared zod fragments so create + patch stay in sync.
const nameField = z.string().min(1);
const slugField = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case');
const dateField = z.coerce.date();

const createCohortSchema = z.object({
  name: nameField,
  slug: slugField,
  startDate: dateField,
  endDate: dateField.optional(),
  isActive: z.boolean().default(true),
});

// Patch body: every field optional, strict (reject unknown keys), and at least
// one field must be present — an empty body isn't a meaningful request.
const updateCohortSchema = z
  .object({
    name: nameField.optional(),
    slug: slugField.optional(),
    startDate: dateField.optional(),
    endDate: dateField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field is required',
  });

const GLOBAL_EDITABLE = new Set(['name']);

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

  // PATCH /admin/cohorts/:slug — update a cohort's mutable fields.
  // Rules (in order): 404 unknown → 403 if editing global's non-name fields →
  // merged-date validation → apply. Rename conflicts surface as 409 via the
  // existing P2002 handler in errorHandler.js. `kind` is not editable and is
  // absent from the schema — invalid keys are rejected by `.strict()`.
  //
  // Date changes invalidate the window used by prior snapshots, so we kick off
  // a re-sync + re-eval in the background (fire-and-forget) and set
  // `resyncTriggered: true` on the response.
  fastify.patch('/cohorts/:slug', async (request) => {
    const patch = updateCohortSchema.parse(request.body ?? {});
    const cohort = await getCohortBySlugOrThrow(prisma, request.params.slug);

    if (cohort.slug === GLOBAL_COHORT_SLUG) {
      const forbidden = Object.keys(patch).filter((k) => !GLOBAL_EDITABLE.has(k));
      if (forbidden.length) {
        throw new ForbiddenError(
          "The global cohort's slug, window, and active status are fixed — only `name` may be changed.",
        );
      }
    }

    // Merge against the current row before validating date ordering so a patch
    // that only touches endDate is still checked against the stored startDate.
    const merged = {
      startDate: patch.startDate ?? cohort.startDate,
      endDate: 'endDate' in patch ? patch.endDate : cohort.endDate,
    };
    if (merged.endDate && merged.startDate && merged.endDate.getTime() <= merged.startDate.getTime()) {
      throw new BadRequestError('endDate must be strictly after startDate', 'VALIDATION_ERROR');
    }

    const dateChanged =
      ('startDate' in patch && patch.startDate?.getTime() !== cohort.startDate.getTime()) ||
      ('endDate' in patch && (patch.endDate?.getTime() ?? null) !== (cohort.endDate?.getTime() ?? null));

    const updated = await prisma.cohort.update({
      where: { id: cohort.id },
      data: patch, // P2002 on `slug` → 409 via the shared error handler
    });

    broadcast('cohort.updated', {
      slug: updated.slug,
      previousSlug: cohort.slug !== updated.slug ? cohort.slug : undefined,
      dateChanged,
    });

    // Fire-and-forget resync when the window changed — old snapshots reflect a
    // stale window and titles derived from them are now suspect. Uses the same
    // per-cohort code path as POST /admin/sync/:slug.
    if (dateChanged) {
      backgroundResync({
        prisma,
        fetchUserStats: fastify.fetchUserStats,
        cohortId: updated.id,
        slug: updated.slug,
        logger: fastify.log,
      });
    }

    return { cohort: serializeCohort(updated), resyncTriggered: dateChanged };
  });

  // DELETE /admin/cohorts/:slug — remove a cohort and its scoped data.
  // Members themselves survive (they stay on `global` + any other cohorts).
  // FK cascades on the schema handle memberships, snapshots, and awards; we
  // just count them first for the response summary.
  fastify.delete('/cohorts/:slug', async (request) => {
    const cohort = await getCohortBySlugOrThrow(prisma, request.params.slug);
    if (cohort.slug === GLOBAL_COHORT_SLUG) {
      throw new ForbiddenError(
        'The global cohort cannot be deleted — the join flow depends on it.',
      );
    }

    // Count in one transaction so the numbers reflect the exact state we're
    // about to delete, even if a concurrent sync inserts more snapshots.
    const summary = await prisma.$transaction(async (tx) => {
      const [memberships, snapshots, awards] = await Promise.all([
        tx.membership.count({ where: { cohortId: cohort.id } }),
        tx.statSnapshot.count({ where: { cohortId: cohort.id } }),
        tx.titleAward.count({ where: { cohortId: cohort.id } }),
      ]);
      await tx.cohort.delete({ where: { id: cohort.id } }); // FKs cascade the rest
      return { memberships, snapshots, awards, titles: 0 };
    });

    broadcast('cohort.deleted', { slug: cohort.slug });

    return {
      deleted: true,
      cohort: { slug: cohort.slug, name: cohort.name },
      counts: summary,
    };
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

/**
 * Fire the same code path as POST /admin/sync/:slug, but detached from the
 * request. Any failure is logged and swallowed — we already returned 200 to
 * the caller because the DB update itself succeeded.
 */
function backgroundResync({ prisma, fetchUserStats, cohortId, slug, logger }) {
  Promise.resolve()
    .then(async () => {
      const sync = await syncCohort({
        prisma,
        fetchUserStats,
        cohortId,
        delayMs: 0,
        logger,
      });
      const evaluation = await evaluateCohort({ prisma, cohortId });
      logger?.info?.({ slug, sync, evaluation }, 'background resync after cohort update complete');
      broadcast('sync.completed', {
        cohorts: [{ slug, snapshotsCreated: sync.snapshotsCreated }],
        finishedAt: new Date().toISOString(),
      });
      broadcast('titles.changed', { slug, changes: evaluation.awardsChanged ?? 0 });
    })
    .catch((err) => logger?.error?.({ err, slug }, 'background resync after cohort update failed'));
}
