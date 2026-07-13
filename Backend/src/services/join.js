import { ConflictError, ForbiddenError, UnprocessableError } from '../lib/errors.js';
import { GithubUserNotFoundError } from './github/fetchUserStats.js';
import { getCohortBySlugOrThrow } from './views.js';
import { GLOBAL_COHORT_SLUG } from './global.js';

/**
 * Public self-serve join. Strictly opt-in: creates (or reuses) a Member and adds
 * a Membership to the given cohort. Enforces the identity rules so a zid and a
 * GitHub username can never be silently re-linked between different identities.
 *
 * Cohort semantics for `zid`:
 *   - PROGRAM cohorts (any slug ≠ `global`): the route requires a zid.
 *   - GLOBAL cohort: zid is optional. If omitted, the member row stores
 *     `zid = NULL`. If a member joined without a zid, they can later "claim"
 *     one by joining a PROGRAM cohort with the same GitHub username + a fresh
 *     zid — as long as that zid isn't already linked to a different member.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {Function} params.verifyGithubUser  ({username}) => profile | throws
 * @param {string} params.slug
 * @param {{githubUsername: string, zid?: string|null}} params.input
 * @param {Date} [params.now]
 * @returns {Promise<import('@prisma/client').Member>}
 */
export async function joinCohort({ prisma, verifyGithubUser, slug, input, now = new Date() }) {
  const { githubUsername } = input;
  const zid = input.zid ?? null;

  const cohort = await getCohortBySlugOrThrow(prisma, slug); // 404 for unknown slug
  if (!cohort.isActive) throw new ForbiddenError('This cohort is not open for joining');
  if (cohort.endDate && cohort.endDate.getTime() < now.getTime()) {
    throw new ForbiddenError('This cohort has ended');
  }

  const byUsername = await prisma.member.findUnique({ where: { githubUsername } });
  const byZid = zid ? await prisma.member.findUnique({ where: { zid } }) : null;

  /** @type {import('@prisma/client').Member | null} */
  let member = null;
  let willClaimZid = false;

  if (zid) {
    if (byZid && byUsername && byZid.id === byUsername.id) {
      // Returning member: exact (zid, username) identity match.
      member = byUsername;
    } else if (byZid && byUsername) {
      throw new ConflictError('This zid and GitHub username belong to different members');
    } else if (byZid) {
      throw new ConflictError('This zid is already registered with a different GitHub username');
    } else if (byUsername) {
      // Existing member with this username, but no member has this zid yet.
      // If the existing row is missing a zid, upgrade it (the "claim" flow).
      // If it already has a *different* zid, that's a hard 409 — we never
      // silently re-link.
      if (byUsername.zid === null) {
        member = byUsername;
        willClaimZid = true;
      } else {
        throw new ConflictError('This GitHub username is already registered with a different zid');
      }
    }
    // else: neither exists → create a brand-new member below.
  } else {
    // No zid was supplied (global-cohort join). Any existing row for this
    // username is our returning member — regardless of whether they carry
    // a zid. Never mutate the stored zid when it isn't provided.
    if (byUsername) member = byUsername;
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
      // displayName auto-populates from the GitHub profile's `name`, falling
      // back to the login so we always have something human-readable.
      m = await tx.member.create({
        data: {
          githubUsername,
          zid, // may be null for a global-cohort join
          displayName: profile.displayName ?? profile.login ?? githubUsername,
          avatarUrl: profile.avatarUrl ?? null,
          githubId: profile.githubId ?? null,
          accountCreatedAt: profile.accountCreatedAt ?? null,
        },
      });
    } else if (willClaimZid) {
      // Upgrade the existing member row with the newly-supplied zid. The
      // (memberId, zid) uniqueness constraint at the DB layer guards against
      // a concurrent claim from another request.
      m = await tx.member.update({ where: { id: m.id }, data: { zid } });
    }

    const existing = await tx.membership.findUnique({
      where: { memberId_cohortId: { memberId: m.id, cohortId: cohort.id } },
    });
    if (existing) throw new ConflictError('This member has already joined this cohort');

    await tx.membership.create({
      data: { memberId: m.id, cohortId: cohort.id },
    });

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
