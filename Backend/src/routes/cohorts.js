import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';
import { serializeCohort, buildMemberProfile } from '../services/views.js';
import { joinCohort } from '../services/join.js';
import { GLOBAL_COHORT_SLUG } from '../services/global.js';

// Trim + lowercase before pattern-checking so "Z5312847" and " z5312847 " both
// pass and land in the DB as "z5312847" — no reason to 400 on a stray uppercase.
// Truly invalid formats (missing digits, wrong prefix) still fail.
const zidSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(/^z\d{7}$/, 'zid must be "z" followed by exactly 7 digits'));

// Treat `""` / `null` as "absent" so a global-cohort join can just leave the
// field empty; a stray whitespace-only value shouldn't 400.
const optionalZidSchema = z.preprocess(
  (v) => (v === '' || v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
  zidSchema.optional(),
);
const usernameSchema = z
  .string()
  .regex(/^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/, 'invalid GitHub username');

// Strict: any extra field is rejected with a friendly message so callers
// don't think a silently-ignored `programRepo` or `displayName` did something.
// The zid rule flips based on cohort slug — required for program cohorts,
// optional for the singleton global cohort.
function buildJoinBodySchema(slug) {
  const zidField = slug === GLOBAL_COHORT_SLUG ? optionalZidSchema : zidSchema;
  return z
    .object({
      githubUsername: usernameSchema,
      zid: zidField,
    })
    .passthrough()
    .superRefine((val, ctx) => {
      for (const key of Object.keys(val)) {
        if (key === 'githubUsername' || key === 'zid') continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `unexpected field "${key}" — join only needs githubUsername and zid`,
        });
      }
    });
}

export default async function cohortRoutes(fastify) {
  const { prisma } = fastify;

  // GET /cohorts
  fastify.get('/', async () => {
    const cohorts = await prisma.cohort.findMany({
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { memberships: true } } },
    });
    return {
      cohorts: cohorts.map((c) => serializeCohort(c, { memberCount: c._count.memberships })),
    };
  });

  // GET /cohorts/:slug
  fastify.get('/:slug', async (request) => {
    const cohort = await prisma.cohort.findUnique({
      where: { slug: request.params.slug },
      include: { _count: { select: { memberships: true } } },
    });
    if (!cohort) throw new NotFoundError(`Cohort not found: ${request.params.slug}`);
    return { cohort: serializeCohort(cohort, { memberCount: cohort._count.memberships }) };
  });

  // POST /cohorts/:slug/join — PUBLIC self-serve join
  fastify.post(
    '/:slug/join',
    { config: { rateLimit: fastify.rateLimits.join } },
    async (request, reply) => {
      const schema = buildJoinBodySchema(request.params.slug);
      const input = schema.parse(request.body ?? {});
      const member = await joinCohort({
        prisma,
        verifyGithubUser: fastify.verifyGithubUser,
        slug: request.params.slug,
        input,
      });
      reply.code(201);
      return buildMemberProfile(prisma, member);
    },
  );
}
