import { NotFoundError } from '../lib/errors.js';
import { computeXp } from './xp.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GitHub's contributionsCollection window is capped at ~one year. */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Compute the GitHub contribution window to query for a given cohort.
 *
 * - GLOBAL: rolling trailing 365 days ending `now` — the leaderboard stays
 *   contestable forever, and titles awarded to the global cohort are rolling
 *   records (see the "Global Leaderboard" section of the README).
 * - PROGRAM (or legacy no-`kind`): `[startDate, min(endDate, now)]`, clamped to
 *   the most recent 365 days if the requested window would exceed GitHub's cap.
 *
 * Pure. Accepts a mocked `now`. Callers pass in a lightweight cohort shape
 * `{ kind, startDate, endDate }`.
 *
 * @param {{kind?: 'PROGRAM'|'GLOBAL', startDate: Date, endDate?: Date|null, slug?: string}} cohort
 * @param {Date} now
 * @param {object} [opts]
 * @param {{warn: Function}} [opts.logger]
 * @returns {{from: Date, to: Date, clamped?: boolean}}
 */
export function syncWindowForCohort(cohort, now, opts = {}) {
  if (cohort.kind === 'GLOBAL') {
    return { from: new Date(now.getTime() - ONE_YEAR_MS), to: new Date(now.getTime()) };
  }

  const endCandidate =
    cohort.endDate && cohort.endDate.getTime() < now.getTime() ? cohort.endDate : now;
  const to = new Date(endCandidate.getTime());
  const from = new Date(cohort.startDate.getTime());

  if (to.getTime() - from.getTime() > ONE_YEAR_MS) {
    const clampedFrom = new Date(to.getTime() - ONE_YEAR_MS);
    opts.logger?.warn?.(
      { cohortSlug: cohort.slug, originalFrom: from, clampedFrom, to },
      'cohort window exceeds one year — clamping to the most recent 365 days',
    );
    return { from: clampedFrom, to, clamped: true };
  }

  return { from, to };
}

/**
 * Map a {@link import('./github/fetchUserStats.js').UserStats} to the append-only
 * StatSnapshot columns.
 */
export function statsToSnapshot(stats, { memberId, cohortId, capturedAt }) {
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
    // XP is denormalised here so the leaderboard can ORDER BY a single indexed
    // column without a JS-side reduce. Recomputed every snapshot — on the
    // global cohort's rolling window this means XP CAN decrease as old work
    // falls off the trailing 365-day window; that's intentional.
    xp: computeXp(stats),
  };
}

/**
 * Fetch + snapshot one membership (already loaded with member, cohort, repos).
 * Also refreshes the member's cached profile fields (githubId, avatar, account age).
 * @returns {Promise<import('@prisma/client').StatSnapshot>}
 */
async function snapshotMembership({ prisma, fetchUserStats, membership, now, logger }) {
  const { member, cohort, programRepos } = membership;

  const { from, to } = syncWindowForCohort(cohort, now, { logger });
  const stats = await fetchUserStats({
    username: member.githubUsername,
    programRepos: programRepos.map((r) => ({ owner: r.owner, name: r.name })),
    since: from,
    until: to,
    today: now,
  });

  // Refresh cached profile fields from the freshly-fetched stats so GitHub
  // renames/avatar changes propagate. Only fall back to the stored value if
  // GitHub returned nothing.
  await prisma.member.update({
    where: { id: member.id },
    data: {
      githubId: stats.githubId ?? member.githubId,
      avatarUrl: stats.avatarUrl ?? member.avatarUrl,
      displayName: stats.displayName ?? stats.login ?? member.displayName,
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
export async function syncMember({
  prisma,
  fetchUserStats,
  memberId,
  cohortId,
  now = new Date(),
  logger,
}) {
  const membership = await prisma.membership.findUnique({
    where: { memberId_cohortId: { memberId, cohortId } },
    include: { member: true, cohort: true, programRepos: true },
  });
  if (!membership) {
    throw new NotFoundError('Membership not found for this member and cohort');
  }
  return snapshotMembership({ prisma, fetchUserStats, membership, now, logger });
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
      await snapshotMembership({ prisma, fetchUserStats, membership, now, logger });
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
export async function syncAllActive({
  prisma,
  fetchUserStats,
  now = new Date(),
  delayMs = 250,
  logger,
}) {
  const cohorts = await prisma.cohort.findMany({ where: { isActive: true }, select: { id: true } });
  const summaries = [];
  for (const { id } of cohorts) {
    summaries.push(
      await syncCohort({ prisma, fetchUserStats, cohortId: id, now, delayMs, logger }),
    );
  }
  return summaries;
}
