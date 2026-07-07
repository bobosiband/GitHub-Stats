import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';
import { serializeCohort, buildMemberProfile } from '../services/views.js';
import { joinCohort } from '../services/join.js';

const zidSchema = z.string().regex(/^z\d{7}$/, 'zid must be "z" followed by exactly 7 digits');
const usernameSchema = z
  .string()
  .regex(
    /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/,
    'invalid GitHub username',
  );
const programRepoSchema = z
  .union([
    z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'programRepo must be "owner/name"'),
    z.object({ owner: z.string().min(1), name: z.string().min(1) }),
  ])
  .transform((v) =>
    typeof v === 'string' ? { owner: v.split('/')[0], name: v.split('/')[1] } : v,
  );

const joinBodySchema = z.object({
  githubUsername: usernameSchema,
  zid: zidSchema,
  displayName: z.string().min(1).max(100).optional(),
  programRepo: programRepoSchema.optional(),
});

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
  fastify.post('/:slug/join', async (request, reply) => {
    const input = joinBodySchema.parse(request.body ?? {});
    const member = await joinCohort({
      prisma,
      verifyGithubUser: fastify.verifyGithubUser,
      slug: request.params.slug,
      input,
    });
    reply.code(201);
    return buildMemberProfile(prisma, member);
  });
}
