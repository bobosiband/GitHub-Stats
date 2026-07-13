import { NotFoundError } from '../lib/errors.js';
import { xpSummary, perLanguageXp, PER_LANGUAGE_XP_CAP } from './xp.js';
import { buildRankDeltas } from './rankDeltas.js';

/** Map leaderboard `sort` param → snapshot column. */
export const LEADERBOARD_SORTS = {
  xp: 'xp',
  commits: 'totalCommits',
  contributions: 'totalContributions',
  streak: 'longestStreak',
  stars: 'totalStars',
};

/** Default sort for the leaderboard when the client doesn't specify one. */
export const DEFAULT_LEADERBOARD_SORT = 'xp';

/** Public-facing subset of a Member. */
export function publicMember(member) {
  return {
    githubUsername: member.githubUsername,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    githubId: member.githubId,
  };
}

/**
 * Serialise a StatSnapshot for the API. Drops ids and (by default) the bulky
 * calendar. Pass `{ includeCalendar: true }` to include it — the profile route
 * needs it for the heatmap, the leaderboard row does not.
 *
 * Each `topLanguages` entry is annotated with an `xp` field — the per-language
 * XP contribution capped at PER_LANGUAGE_XP_CAP. This is the single source of
 * truth the language-skill rings in the frontend key off, so the ring fullness
 * always matches the scoring rules (no client-side re-derivation).
 */
export function serializeSnapshot(s, { includeCalendar = false } = {}) {
  if (!s) return null;
  const out = {
    capturedAt: s.capturedAt,
    // The `xp` column is NOT NULL DEFAULT 0 (see migration), so this branch
    // only fires for rows written before the column existed. Backfill is safe
    // to re-run; the reason we don't silently coerce here is so the frontend
    // can distinguish "no snapshot yet" (whole object null) from "xp=0".
    xp: typeof s.xp === 'number' ? s.xp : 0,
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
    topLanguages: annotateTopLanguages(s.topLanguages),
    longestStreak: s.longestStreak,
    currentStreak: s.currentStreak,
    maxCommitsInOneDay: s.maxCommitsInOneDay,
    weekendCommitRatio: s.weekendCommitRatio,
    nightCommitRatio: s.nightCommitRatio,
  };
  if (includeCalendar) out.calendar = s.calendar ?? [];
  return out;
}

/** Attach `xp` + `xpCap` to each language so the UI can render the ring math directly. */
function annotateTopLanguages(langs) {
  if (!Array.isArray(langs)) return [];
  return langs.map((lang) => {
    const bytes = Number(lang?.bytes) || 0;
    return {
      name: lang?.name ?? '',
      bytes,
      xp: Math.round(perLanguageXp(bytes)),
      xpCap: PER_LANGUAGE_XP_CAP,
    };
  });
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
      "memberId", "cohortId", "capturedAt", "xp",
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
 * Deterministic tie-breaker chain for the leaderboard:
 *   1. Primary sort field (desc)
 *   2. totalContributions (desc)
 *   3. accountCreatedAt (asc) — older accounts sort ahead
 *   4. memberId (asc) — deterministic final fallback
 */
function compareLeaderboardRows(field) {
  return (a, b) => {
    const av = a.snapshot?.[field] ?? -1;
    const bv = b.snapshot?.[field] ?? -1;
    if (bv !== av) return bv - av;

    const ac = a.snapshot?.totalContributions ?? -1;
    const bc = b.snapshot?.totalContributions ?? -1;
    if (bc !== ac) return bc - ac;

    const at = a.member.accountCreatedAt?.getTime?.() ?? Infinity;
    const bt = b.member.accountCreatedAt?.getTime?.() ?? Infinity;
    if (at !== bt) return at - bt;

    return a.member.id < b.member.id ? -1 : 1;
  };
}

/**
 * Ranked leaderboard for a cohort. Members are ranked by the chosen stat
 * (descending); members without a snapshot yet sort to the bottom. Each entry
 * also carries `rankDelta` — the change in rank since the immediately-previous
 * snapshot set (see `services/rankDeltas.js`).
 */
export async function buildLeaderboard(prisma, cohort, sort = DEFAULT_LEADERBOARD_SORT) {
  const field = LEADERBOARD_SORTS[sort] ?? LEADERBOARD_SORTS[DEFAULT_LEADERBOARD_SORT];
  const memberships = await prisma.membership.findMany({
    where: { cohortId: cohort.id },
    include: { member: true },
  });
  const latest = await latestSnapshotByMember(prisma, cohort.id);

  const rows = memberships.map((ms) => ({
    member: ms.member,
    snapshot: latest.get(ms.memberId) ?? null,
  }));
  rows.sort(compareLeaderboardRows(field));

  const currentRankById = new Map();
  rows.forEach((r, i) => currentRankById.set(r.member.id, i + 1));

  const deltasById = await buildRankDeltas(prisma, cohort.id, field, currentRankById);

  return {
    cohort: serializeCohort(cohort),
    sort,
    sortField: field,
    ranking: rows.map((r, i) => ({
      rank: i + 1,
      rankDelta: deltasById.get(r.member.id) ?? null,
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
    // Profile carries the calendar for the heatmap; xp/level/progress roll up
    // for the ring around the avatar and the level badge. `progression` is
    // deliberately `null` when there is no snapshot yet — the frontend keys
    // off that to show a "first sync pending" state instead of a fake Level 0.
    const stats = serializeSnapshot(snapshot, { includeCalendar: true });
    const progression =
      snapshot && typeof snapshot.xp === 'number' ? xpSummary(snapshot.xp) : null;
    cohorts.push({
      cohort: serializeCohort(ms.cohort),
      role: ms.role,
      joinedAt: ms.joinedAt,
      programRepos: ms.programRepos.map((r) => ({ owner: r.owner, name: r.name })),
      stats,
      progression,
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
