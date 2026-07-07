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
    startDate: cohort.startDate,
    endDate: cohort.endDate,
    isActive: cohort.isActive,
    ...extra,
  };
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

/** Build a `Map<memberId, latestSnapshot>` for a cohort. */
async function latestSnapshotByMember(prisma, cohortId) {
  const snaps = await prisma.statSnapshot.findMany({
    where: { cohortId },
    orderBy: { capturedAt: 'desc' },
  });
  const latest = new Map();
  for (const s of snaps) if (!latest.has(s.memberId)) latest.set(s.memberId, s);
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
    member: {
      githubUsername: member.githubUsername,
      zid: member.zid,
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
          ? { member: publicMember(holder.member), value: holder.value, awardedAt: holder.awardedAt }
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
