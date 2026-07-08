import { NotFoundError } from '../lib/errors.js';

/** Map leaderboard `sort` param → snapshot column. */
export const LEADERBOARD_SORTS = {
  commits: 'totalCommits',
  contributions: 'totalContributions',
  streak: 'longestStreak',
  stars: 'totalStars',
};

/** Public-facing subset of a Member. */
export function publicMember(member) {
  return {
    githubUsername: member.githubUsername,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    githubId: member.githubId,
  };
}

/** Serialise a StatSnapshot for the API (drops ids and the bulky calendar). */
export function serializeSnapshot(s) {
  if (!s) return null;
  return {
    capturedAt: s.capturedAt,
    totalCommits: s.totalCommits,
    totalContributions: s.totalContributions,
    totalPRs: s.totalPRs,
    mergedPRs: s.mergedPRs,
    reviewsGiven: s.reviewsGiven,
    issuesOpened: s.issuesOpened,
    followers: s.followers,
    totalStars: s.totalStars,
    repoCount: s.repoCount,
    contributedRepoCount: s.contributedRepoCount,
    languageCount: s.languageCount,
    topLanguages: s.topLanguages,
    longestStreak: s.longestStreak,
    currentStreak: s.currentStreak,
    maxCommitsInOneDay: s.maxCommitsInOneDay,
    weekendCommitRatio: s.weekendCommitRatio,
    nightCommitRatio: s.nightCommitRatio,
  };
}

export function serializeCohort(cohort, extra = {}) {
  return {
    slug: cohort.slug,
    name: cohort.name,
    kind: cohort.kind,
    startDate: cohort.startDate,
    endDate: cohort.endDate,
    isActive: cohort.isActive,
    ...extra,
  };
}

/**
 * Cheap freshness fingerprint for a cohort's hot reads (leaderboard, titles).
 * Two DB round-trips, both aggregates — never loads rows.
 *
 *   - Latest snapshot `capturedAt` for the cohort (aggregate `_max`).
 *   - Membership count for the cohort.
 *
 * The returned ETag string changes whenever *any* member joins/leaves the
 * cohort or a fresh snapshot lands — the two triggers for stale UI.
 *
 * @returns {Promise<string>}
 */
export async function cohortReadEtag(prisma, cohort, prefix) {
  const [aggr, memberCount] = await Promise.all([
    prisma.statSnapshot.aggregate({
      where: { cohortId: cohort.id },
      _max: { capturedAt: true },
    }),
    prisma.membership.count({ where: { cohortId: cohort.id } }),
  ]);
  const at = aggr._max.capturedAt ? aggr._max.capturedAt.getTime() : 0;
  return `"${prefix}-${cohort.slug}-${at}-${memberCount}"`;
}

export async function getCohortBySlugOrThrow(prisma, slug) {
  const cohort = await prisma.cohort.findUnique({ where: { slug } });
  if (!cohort) throw new NotFoundError(`Cohort not found: ${slug}`);
  return cohort;
}

export async function getMemberByUsernameOrThrow(prisma, githubUsername) {
  const member = await prisma.member.findUnique({ where: { githubUsername } });
  if (!member) throw new NotFoundError(`Member not found: ${githubUsername}`);
  return member;
}

/**
 * Build a `Map<memberId, latestSnapshot>` for a cohort.
 *
 * Uses Postgres `DISTINCT ON` so the DB returns exactly one row per member
 * (the latest by `capturedAt`) instead of shipping every historical snapshot
 * across the wire and reducing in JS. `calendar` is excluded from the select
 * list — nothing downstream of the leaderboard reads it (`serializeSnapshot`
 * drops it), and it's the biggest JSONB column on the table by a wide margin.
 * `topLanguages` stays because the API does return it.
 *
 * Rows come back with quoted-camelCase column names as-is (Prisma raw doesn't
 * remap them), JSONB parsed, timestamps as `Date` — so no conversion needed
 * before passing to `serializeSnapshot`.
 */
async function latestSnapshotByMember(prisma, cohortId) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON ("memberId")
      "memberId", "cohortId", "capturedAt",
      "totalCommits", "totalContributions", "totalPRs", "mergedPRs",
      "reviewsGiven", "issuesOpened", "followers", "totalStars",
      "repoCount", "contributedRepoCount", "languageCount", "topLanguages",
      "longestStreak", "currentStreak", "maxCommitsInOneDay",
      "weekendCommitRatio", "nightCommitRatio"
    FROM "StatSnapshot"
    WHERE "cohortId" = ${cohortId}
    ORDER BY "memberId", "capturedAt" DESC
  `;
  const latest = new Map();
  for (const s of rows) latest.set(s.memberId, s);
  return latest;
}

/**
 * Ranked leaderboard for a cohort. Members are ranked by the chosen stat
 * (descending); members without a snapshot yet sort to the bottom.
 */
export async function buildLeaderboard(prisma, cohort, sort = 'commits') {
  const field = LEADERBOARD_SORTS[sort] ?? LEADERBOARD_SORTS.commits;
  const memberships = await prisma.membership.findMany({
    where: { cohortId: cohort.id },
    include: { member: true },
  });
  const latest = await latestSnapshotByMember(prisma, cohort.id);

  const rows = memberships.map((ms) => ({
    member: ms.member,
    snapshot: latest.get(ms.memberId) ?? null,
  }));
  rows.sort((a, b) => (b.snapshot?.[field] ?? -1) - (a.snapshot?.[field] ?? -1));

  return {
    cohort: serializeCohort(cohort),
    sort,
    sortField: field,
    ranking: rows.map((r, i) => ({
      rank: i + 1,
      member: publicMember(r.member),
      stats: serializeSnapshot(r.snapshot),
    })),
  };
}

function serializeAward(award) {
  return {
    key: award.title.key,
    name: award.title.name,
    kind: award.title.kind,
    flavor: award.title.flavor,
    cohort: { slug: award.cohort.slug, name: award.cohort.name },
    value: award.value,
    awardedAt: award.awardedAt,
    revokedAt: award.revokedAt,
    active: award.revokedAt === null,
  };
}

/**
 * Full member profile: latest stats per cohort, record titles held (including
 * past/revoked ones with their cohort), and badges earned.
 */
export async function buildMemberProfile(prisma, member) {
  const memberships = await prisma.membership.findMany({
    where: { memberId: member.id },
    include: { cohort: true, programRepos: true },
    orderBy: { joinedAt: 'asc' },
  });

  const cohorts = [];
  for (const ms of memberships) {
    const snapshot = await prisma.statSnapshot.findFirst({
      where: { memberId: member.id, cohortId: ms.cohortId },
      orderBy: { capturedAt: 'desc' },
    });
    cohorts.push({
      cohort: serializeCohort(ms.cohort),
      role: ms.role,
      joinedAt: ms.joinedAt,
      programRepos: ms.programRepos.map((r) => ({ owner: r.owner, name: r.name })),
      stats: serializeSnapshot(snapshot),
    });
  }

  const awards = await prisma.titleAward.findMany({
    where: { memberId: member.id },
    include: { title: true, cohort: true },
    orderBy: { awardedAt: 'desc' },
  });
  const serialized = awards.map(serializeAward);

  return {
    // NB: `zid` is deliberately omitted here — it is PII and the profile route
    // is unauthenticated. The DB still stores it and admin/identity paths use
    // it internally; it just never crosses the wire.
    member: {
      githubUsername: member.githubUsername,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      githubId: member.githubId,
      accountCreatedAt: member.accountCreatedAt,
      createdAt: member.createdAt,
    },
    cohorts,
    titles: serialized.filter((a) => a.kind === 'RECORD'),
    badges: serialized.filter((a) => a.kind === 'BADGE'),
  };
}

/** All titles for a cohort with their current holders (records) / earners (badges). */
export async function buildCohortTitles(prisma, cohort) {
  const titles = await prisma.title.findMany({ orderBy: { key: 'asc' } });
  const awards = await prisma.titleAward.findMany({
    where: { cohortId: cohort.id, revokedAt: null },
    include: { member: true, title: true },
  });

  const byTitle = new Map();
  for (const a of awards) {
    if (!byTitle.has(a.titleId)) byTitle.set(a.titleId, []);
    byTitle.get(a.titleId).push(a);
  }

  const records = [];
  const badges = [];
  for (const t of titles) {
    const holders = byTitle.get(t.id) ?? [];
    const base = { key: t.key, name: t.name, description: t.description, flavor: t.flavor };
    if (t.kind === 'RECORD') {
      const holder = holders[0];
      records.push({
        ...base,
        holder: holder
          ? {
              member: publicMember(holder.member),
              value: holder.value,
              awardedAt: holder.awardedAt,
            }
          : null,
      });
    } else {
      badges.push({
        ...base,
        earnedCount: holders.length,
        earners: holders.map((h) => ({
          member: publicMember(h.member),
          value: h.value,
          awardedAt: h.awardedAt,
        })),
      });
    }
  }

  return { cohort: serializeCohort(cohort), records, badges };
}
