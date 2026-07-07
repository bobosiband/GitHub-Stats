import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './testDbUrl.js';

let prisma;

/** Shared PrismaClient bound to the test database. */
export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  }
  return prisma;
}

/** Truncate every table between tests for isolation. */
export async function resetDb() {
  const db = getPrisma();
  await db.$executeRawUnsafe(
    'TRUNCATE "TitleAward","StatSnapshot","ProgramRepo","Membership","Title","Member","Cohort" RESTART IDENTITY CASCADE',
  );
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
      endDate: new Date('2025-12-31T00:00:00Z'),
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

/**
 * Create a StatSnapshot with all required columns defaulted to 0 so a test only
 * has to specify the stats it cares about.
 */
export function makeSnapshot(memberId, cohortId, overrides = {}) {
  return getPrisma().statSnapshot.create({
    data: {
      memberId,
      cohortId,
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
    },
  });
}
