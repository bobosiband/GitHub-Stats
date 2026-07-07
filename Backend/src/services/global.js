/**
 * Global-cohort helpers.
 *
 * Every member who joins any cohort is automatically also on a single
 * always-on GLOBAL cohort. That cohort reuses the normal sync + snapshot +
 * title machinery, so `/cohorts/global/leaderboard` and `/cohorts/global/titles`
 * work with no dedicated endpoints.
 */

/** Slug for the singleton global cohort. */
export const GLOBAL_COHORT_SLUG = 'global';

/**
 * Fixed epoch for the global cohort's `startDate`. Real ranking uses a rolling
 * 365-day window (see {@link ../services/sync.js}); the column value only exists
 * to satisfy the non-null schema and to give operators a stable "began at" date.
 */
export const GLOBAL_COHORT_EPOCH = new Date('2020-01-01T00:00:00Z');

/**
 * Upsert the singleton global cohort. Idempotent: safe to call on every boot
 * and inside test setup. Enforces "exactly one GLOBAL cohort" by keying on the
 * fixed `global` slug — the schema's unique-slug constraint does the rest.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<import('@prisma/client').Cohort>}
 */
export async function ensureGlobalCohort(prisma) {
  return prisma.cohort.upsert({
    where: { slug: GLOBAL_COHORT_SLUG },
    update: {
      kind: 'GLOBAL',
      isActive: true,
      endDate: null,
      name: 'Global Leaderboard',
    },
    create: {
      slug: GLOBAL_COHORT_SLUG,
      name: 'Global Leaderboard',
      kind: 'GLOBAL',
      isActive: true,
      startDate: GLOBAL_COHORT_EPOCH,
      endDate: null,
    },
  });
}
