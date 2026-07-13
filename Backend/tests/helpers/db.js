import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './testDbUrl.js';
import { ensureGlobalCohort } from '../../src/services/global.js';
import { computeXp } from '../../src/services/xp.js';

let prisma;

/** Shared PrismaClient bound to the test database. */
export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  }
  return prisma;
}

/**
 * Truncate every table between tests for isolation, then re-create the global
 * cohort so `joinCohort`'s auto-membership can always find it.
 */
export async function resetDb() {
  const db = getPrisma();
  await db.$executeRawUnsafe(
    'TRUNCATE "TitleAward","StatSnapshot","ProgramRepo","Membership","Title","Member","Cohort" RESTART IDENTITY CASCADE',
  );
  await ensureGlobalCohort(db);
}

export async function disconnectDb() {
  if (prisma) await prisma.$disconnect();
}

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}`;

/** @param {object} [overrides] */
export function makeCohort(overrides = {}) {
  const n = uniq();
  return getPrisma().cohort.create({
    data: {
      name: `Cohort ${n}`,
      slug: `cohort-${n}`,
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: null, // ongoing by default; override for ended-cohort scenarios
      isActive: true,
      ...overrides,
    },
  });
}

/** @param {object} [overrides] */
export function makeMember(overrides = {}) {
  const n = uniq();
  const zidNum = String(1000000 + (seq % 9000000)).padStart(7, '0');
  return getPrisma().member.create({
    data: {
      githubUsername: `user-${n}`,
      zid: `z${zidNum}`,
      displayName: `User ${n}`,
      githubId: 100000 + seq,
      accountCreatedAt: new Date('2020-01-01T00:00:00Z'),
      ...overrides,
    },
  });
}

export function makeMembership(memberId, cohortId, overrides = {}) {
  return getPrisma().membership.create({
    data: { memberId, cohortId, role: 'PARTICIPANT', ...overrides },
  });
}

// Monotonic capturedAt so a snapshot created later in a test is always "newer"
// than earlier ones for the same member (the engine picks the latest per member).
let snapshotSeq = 0;
const BASE_CAPTURED_AT = Date.UTC(2025, 0, 1);

/**
 * Create a StatSnapshot with all required columns defaulted to 0 so a test only
 * has to specify the stats it cares about. `capturedAt` defaults to a
 * monotonically increasing time; pass an explicit one to control ordering.
 */
export function makeSnapshot(memberId, cohortId, overrides = {}) {
  const data = {
    memberId,
    cohortId,
    capturedAt: new Date(BASE_CAPTURED_AT + snapshotSeq++ * 60_000),
    totalCommits: 0,
    totalContributions: 0,
    totalPRs: 0,
    mergedPRs: 0,
    reviewsGiven: 0,
    issuesOpened: 0,
    followers: 0,
    totalStars: 0,
    repoCount: 0,
    contributedRepoCount: 0,
    languageCount: 0,
    topLanguages: [],
    longestStreak: 0,
    currentStreak: 0,
    maxCommitsInOneDay: 0,
    weekendCommitRatio: 0,
    nightCommitRatio: null,
    calendar: [],
    ...overrides,
  };
  // Mirror the sync path — derive `xp` from the same fields so leaderboard
  // tests written against arbitrary stat overrides get a coherent xp value
  // without every caller having to pass one. Explicit overrides still win.
  if (overrides.xp === undefined) data.xp = computeXp(data);
  return getPrisma().statSnapshot.create({ data });
}
