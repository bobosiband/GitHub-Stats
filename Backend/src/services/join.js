import { ConflictError, ForbiddenError, UnprocessableError } from '../lib/errors.js';
import { GithubUserNotFoundError } from './github/fetchUserStats.js';
import { getCohortBySlugOrThrow } from './views.js';
import { GLOBAL_COHORT_SLUG } from './global.js';

/**
 * Public self-serve join. Strictly opt-in: creates (or reuses) a Member and adds
 * a Membership to the given cohort. Enforces the identity rules so a zid and a
 * GitHub username can never be silently re-linked.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {Function} params.verifyGithubUser  ({username}) => profile | throws
 * @param {string} params.slug
 * @param {{githubUsername: string, zid: string, displayName?: string,
 *   programRepo?: {owner: string, name: string}}} params.input
 * @param {Date} [params.now]
 * @returns {Promise<import('@prisma/client').Member>}
 */
export async function joinCohort({ prisma, verifyGithubUser, slug, input, now = new Date() }) {
  const { githubUsername, zid, displayName, programRepo } = input;

  const cohort = await getCohortBySlugOrThrow(prisma, slug); // 404 for unknown slug
  if (!cohort.isActive) throw new ForbiddenError('This cohort is not open for joining');
  if (cohort.endDate && cohort.endDate.getTime() < now.getTime()) {
    throw new ForbiddenError('This cohort has ended');
  }

  const [byZid, byUsername] = await Promise.all([
    prisma.member.findUnique({ where: { zid } }),
    prisma.member.findUnique({ where: { githubUsername } }),
  ]);

  /** @type {import('@prisma/client').Member | null} */
  let member = null;
  if (byZid && byUsername && byZid.id === byUsername.id) {
    member = byZid; // returning member: exact (zid, username) identity
  } else if (byZid && byUsername) {
    throw new ConflictError('This zid and GitHub username belong to different members');
  } else if (byZid) {
    throw new ConflictError('This zid is already registered with a different GitHub username');
  } else if (byUsername) {
    throw new ConflictError('This GitHub username is already registered with a different zid');
  }

  // Only a brand-new member requires a GitHub existence check.
  let profile = null;
  if (!member) {
    try {
      profile = await verifyGithubUser({ username: githubUsername });
    } catch (err) {
      if (err instanceof GithubUserNotFoundError || err?.code === 'GITHUB_USER_NOT_FOUND') {
        throw new UnprocessableError('GitHub user not found');
      }
      throw err;
    }
  }

  return prisma.$transaction(async (tx) => {
    let m = member;
    if (!m) {
      m = await tx.member.create({
        data: {
          githubUsername,
          zid,
          displayName: displayName ?? profile.displayName ?? null,
          avatarUrl: profile.avatarUrl ?? null,
          githubId: profile.githubId ?? null,
          accountCreatedAt: profile.accountCreatedAt ?? null,
        },
      });
    } else if (displayName && !m.displayName) {
      m = await tx.member.update({ where: { id: m.id }, data: { displayName } });
    }

    const existing = await tx.membership.findUnique({
      where: { memberId_cohortId: { memberId: m.id, cohortId: cohort.id } },
    });
    if (existing) throw new ConflictError('This member has already joined this cohort');

    const membership = await tx.membership.create({
      data: { memberId: m.id, cohortId: cohort.id },
    });

    if (programRepo) {
      await tx.programRepo.create({
        data: { membershipId: membership.id, owner: programRepo.owner, name: programRepo.name },
      });
    }

    // Auto-membership: every joiner also lands on the singleton global cohort
    // (unless they're joining IT directly). `upsert` on the (memberId, cohortId)
    // unique constraint makes this a no-op for members already on it.
    if (cohort.slug !== GLOBAL_COHORT_SLUG) {
      const globalCohort = await tx.cohort.findUnique({ where: { slug: GLOBAL_COHORT_SLUG } });
      if (globalCohort) {
        await tx.membership.upsert({
          where: { memberId_cohortId: { memberId: m.id, cohortId: globalCohort.id } },
          update: {},
          create: { memberId: m.id, cohortId: globalCohort.id },
        });
      }
    }

    return m;
  });
}
