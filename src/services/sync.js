import { NotFoundError } from '../lib/errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Map a {@link import('./github/fetchUserStats.js').UserStats} to the append-only
 * StatSnapshot columns.
 */
function statsToSnapshot(stats, { memberId, cohortId, capturedAt }) {
  return {
    memberId,
    cohortId,
    capturedAt,
    totalCommits: stats.totalCommits,
    totalContributions: stats.totalContributions,
    totalPRs: stats.totalPRs,
    mergedPRs: stats.mergedPRs,
    reviewsGiven: stats.reviewsGiven,
    issuesOpened: stats.issuesOpened,
    followers: stats.followers,
    totalStars: stats.totalStars,
    repoCount: stats.repoCount,
    contributedRepoCount: stats.contributedRepoCount,
    languageCount: stats.languageCount,
    topLanguages: stats.topLanguages,
    longestStreak: stats.longestStreak,
    currentStreak: stats.currentStreak,
    maxCommitsInOneDay: stats.maxCommitsInOneDay,
    weekendCommitRatio: stats.weekendCommitRatio,
    nightCommitRatio: stats.nightCommitRatio,
    calendar: stats.calendar,
  };
}

/** The effective end of a cohort's contribution window at time `now`. */
function windowEnd(cohort, now) {
  return cohort.endDate && cohort.endDate < now ? cohort.endDate : now;
}

/**
 * Fetch + snapshot one membership (already loaded with member, cohort, repos).
 * Also refreshes the member's cached profile fields (githubId, avatar, account age).
 * @returns {Promise<import('@prisma/client').StatSnapshot>}
 */
async function snapshotMembership({ prisma, fetchUserStats, membership, now }) {
  const { member, cohort, programRepos } = membership;

  const stats = await fetchUserStats({
    username: member.githubUsername,
    programRepos: programRepos.map((r) => ({ owner: r.owner, name: r.name })),
    since: cohort.startDate,
    until: windowEnd(cohort, now),
    today: now,
  });

  await prisma.member.update({
    where: { id: member.id },
    data: {
      githubId: stats.githubId ?? member.githubId,
      avatarUrl: stats.avatarUrl ?? member.avatarUrl,
      displayName: member.displayName ?? stats.displayName,
      accountCreatedAt: stats.accountCreatedAt ?? member.accountCreatedAt,
    },
  });

  return prisma.statSnapshot.create({
    data: statsToSnapshot(stats, { memberId: member.id, cohortId: cohort.id, capturedAt: now }),
  });
}

/**
 * Sync a single member within a cohort and store a snapshot.
 * @returns {Promise<import('@prisma/client').StatSnapshot>}
 */
export async function syncMember({ prisma, fetchUserStats, memberId, cohortId, now = new Date() }) {
  const membership = await prisma.membership.findUnique({
    where: { memberId_cohortId: { memberId, cohortId } },
    include: { member: true, cohort: true, programRepos: true },
  });
  if (!membership) {
    throw new NotFoundError('Membership not found for this member and cohort');
  }
  return snapshotMembership({ prisma, fetchUserStats, membership, now });
}

/**
 * Sync every member of a cohort **sequentially** (with a small delay to stay
 * polite to the GitHub API). One member failing does not abort the run.
 *
 * @returns {Promise<{cohortId: string, cohortSlug: string, membersSynced: number,
 *   snapshotsCreated: number, errors: {username: string, error: string}[]}>}
 */
export async function syncCohort({
  prisma,
  fetchUserStats,
  cohortId,
  now = new Date(),
  delayMs = 250,
  logger,
}) {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      memberships: { include: { member: true, programRepos: true } },
    },
  });
  if (!cohort) throw new NotFoundError('Cohort not found');

  const summary = {
    cohortId: cohort.id,
    cohortSlug: cohort.slug,
    membersSynced: 0,
    snapshotsCreated: 0,
    errors: [],
  };

  for (let i = 0; i < cohort.memberships.length; i++) {
    const membership = { ...cohort.memberships[i], cohort };
    try {
      await snapshotMembership({ prisma, fetchUserStats, membership, now });
      summary.membersSynced += 1;
      summary.snapshotsCreated += 1;
    } catch (err) {
      logger?.warn?.({ err, username: membership.member.githubUsername }, 'member sync failed');
      summary.errors.push({
        username: membership.member.githubUsername,
        error: err.message,
      });
    }
    if (delayMs > 0 && i < cohort.memberships.length - 1) await sleep(delayMs);
  }

  return summary;
}

/**
 * Sync all active cohorts. Returns one summary per cohort.
 * @returns {Promise<Array>}
 */
export async function syncAllActive({ prisma, fetchUserStats, now = new Date(), delayMs = 250, logger }) {
  const cohorts = await prisma.cohort.findMany({ where: { isActive: true }, select: { id: true } });
  const summaries = [];
  for (const { id } of cohorts) {
    summaries.push(await syncCohort({ prisma, fetchUserStats, cohortId: id, now, delayMs, logger }));
  }
  return summaries;
}
