import { PrismaClient } from '@prisma/client';
import { summariseCalendar } from '../src/services/streaks.js';
import { ensureTitles, evaluateCohort } from '../src/services/titles/engine.js';
import { computeXp } from '../src/services/xp.js';

const prisma = new PrismaClient();

const COHORT = {
  name: 'DevSoc Training Program 2025',
  slug: 'devsoc-2025',
  startDate: new Date('2025-02-01T00:00:00Z'),
  endDate: null,
  isActive: true,
};
// A fixed "now" so seeded streaks/current-streaks are stable regardless of the date.
const TODAY = new Date('2025-06-01T00:00:00Z');

/** Build a contribution calendar from a per-day count function. */
function genCalendar(start, numDays, fn) {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  const days = [];
  for (let i = 0; i < numDays; i++) {
    const date = new Date(Date.UTC(y, m, d + i));
    days.push({
      date: date.toISOString().slice(0, 10),
      count: Math.max(0, Math.round(fn(i, date))),
    });
  }
  return days;
}

/** Turn a set of tuning knobs into a per-day count function with a distinct shape. */
function personality({ base = 2, gapEvery = 0, spikeEvery = 0, spikeTo = 0, weekendBoost = 0 }) {
  return (i, date) => {
    if (gapEvery && i % gapEvery === 0) return 0;
    if (spikeEvery && i % spikeEvery === 0) return spikeTo;
    let c = base + (i % 3);
    const dow = date.getUTCDay();
    if (weekendBoost && (dow === 0 || dow === 6)) c += weekendBoost;
    return c;
  };
}

const NUM_DAYS = 121; // 2025-02-01 .. 2025-06-01

/** The seeded cohort's members, each with a personality that wins a different title. */
const MEMBERS = [
  {
    githubUsername: 'ada-lovelace',
    zid: 'z5200001',
    displayName: 'Ada Lovelace',
    githubId: 1001,
    accountCreatedAt: new Date('2013-03-01T00:00:00Z'),
    avatarUrl: 'https://avatars.githubusercontent.com/u/1001',
    programRepo: { owner: 'ada-lovelace', name: 'analytical-engine' },
    counts: {
      totalCommits: 480,
      totalPRs: 40,
      mergedPRs: 22,
      reviewsGiven: 9,
      issuesOpened: 14,
      followers: 120,
      totalStars: 60,
      repoCount: 25,
      contributedRepoCount: 30,
      languageCount: 4,
    },
    topLanguages: [
      { name: 'Python', bytes: 900000 },
      { name: 'C', bytes: 400000 },
      { name: 'Assembly', bytes: 120000 },
      { name: 'Shell', bytes: 40000 },
    ],
    nightCommitRatio: 0.3,
    calendarFn: personality({ base: 4, gapEvery: 40, spikeEvery: 30, spikeTo: 18 }),
  },
  {
    githubUsername: 'linus-torvalds',
    zid: 'z5200002',
    displayName: 'Linus Torvalds',
    githubId: 1002,
    accountCreatedAt: new Date('2011-01-05T00:00:00Z'),
    avatarUrl: 'https://avatars.githubusercontent.com/u/1002',
    counts: {
      totalCommits: 300,
      totalPRs: 25,
      mergedPRs: 40,
      reviewsGiven: 30,
      issuesOpened: 10,
      followers: 900,
      totalStars: 1500,
      repoCount: 80,
      contributedRepoCount: 60,
      languageCount: 6,
    },
    topLanguages: [
      { name: 'C', bytes: 5000000 },
      { name: 'Shell', bytes: 300000 },
      { name: 'Assembly', bytes: 200000 },
      { name: 'Perl', bytes: 90000 },
      { name: 'Makefile', bytes: 60000 },
    ],
    nightCommitRatio: null,
    calendarFn: personality({ base: 2, gapEvery: 9, spikeEvery: 25, spikeTo: 10 }),
  },
  {
    githubUsername: 'grace-hopper',
    zid: 'z5200003',
    displayName: 'Grace Hopper',
    githubId: 1003,
    accountCreatedAt: new Date('2015-06-01T00:00:00Z'),
    avatarUrl: 'https://avatars.githubusercontent.com/u/1003',
    counts: {
      totalCommits: 220,
      totalPRs: 30,
      mergedPRs: 12,
      reviewsGiven: 40,
      issuesOpened: 20,
      followers: 200,
      totalStars: 45,
      repoCount: 18,
      contributedRepoCount: 25,
      languageCount: 8,
    },
    // 8 languages — the "+N" reveal on the profile only appears when a
    // member has more than the collapsed cap, so we intentionally seed
    // one member above it so the feature is testable against the seed.
    topLanguages: [
      { name: 'COBOL', bytes: 700000 },
      { name: 'Go', bytes: 500000 },
      { name: 'Rust', bytes: 300000 },
      { name: 'TypeScript', bytes: 200000 },
      { name: 'Python', bytes: 100000 },
      { name: 'Ruby', bytes: 60000 },
      { name: 'Shell', bytes: 20000 },
      { name: 'Makefile', bytes: 8000 },
    ],
    nightCommitRatio: null,
    calendarFn: personality({ base: 3, gapEvery: 12 }),
  },
  {
    githubUsername: 'alan-turing',
    zid: 'z5200004',
    displayName: 'Alan Turing',
    githubId: 1004,
    accountCreatedAt: new Date('2016-09-01T00:00:00Z'),
    avatarUrl: 'https://avatars.githubusercontent.com/u/1004',
    counts: {
      totalCommits: 260,
      totalPRs: 60,
      mergedPRs: 55,
      reviewsGiven: 15,
      issuesOpened: 25,
      followers: 80,
      totalStars: 20,
      repoCount: 22,
      contributedRepoCount: 70,
      languageCount: 5,
    },
    topLanguages: [
      { name: 'Haskell', bytes: 600000 },
      { name: 'Python', bytes: 300000 },
      { name: 'C++', bytes: 250000 },
      { name: 'Lean', bytes: 100000 },
      { name: 'TeX', bytes: 50000 },
    ],
    nightCommitRatio: null,
    calendarFn: personality({ base: 2, gapEvery: 7 }),
  },
  {
    githubUsername: 'margaret-hamilton',
    zid: 'z5200005',
    displayName: 'Margaret Hamilton',
    githubId: 1005,
    accountCreatedAt: new Date('2018-02-01T00:00:00Z'),
    avatarUrl: 'https://avatars.githubusercontent.com/u/1005',
    programRepo: { owner: 'margaret-hamilton', name: 'apollo-guidance' },
    counts: {
      totalCommits: 140,
      totalPRs: 12,
      mergedPRs: 6,
      reviewsGiven: 6,
      issuesOpened: 8,
      followers: 60,
      totalStars: 12,
      repoCount: 10,
      contributedRepoCount: 15,
      languageCount: 3,
    },
    topLanguages: [
      { name: 'Assembly', bytes: 400000 },
      { name: 'C', bytes: 200000 },
      { name: 'Fortran', bytes: 80000 },
    ],
    nightCommitRatio: 0.72,
    calendarFn: personality({ base: 2, gapEvery: 15, weekendBoost: 6 }),
  },
  {
    githubUsername: 'katherine-johnson',
    zid: 'z5200006',
    displayName: 'Katherine Johnson',
    githubId: 1006,
    accountCreatedAt: new Date('2021-11-01T00:00:00Z'),
    avatarUrl: 'https://avatars.githubusercontent.com/u/1006',
    counts: {
      totalCommits: 18,
      totalPRs: 1,
      mergedPRs: 1,
      reviewsGiven: 0,
      issuesOpened: 2,
      followers: 5,
      totalStars: 1,
      repoCount: 3,
      contributedRepoCount: 2,
      languageCount: 2,
    },
    topLanguages: [
      { name: 'Python', bytes: 40000 },
      { name: 'Jupyter Notebook', bytes: 20000 },
    ],
    nightCommitRatio: null,
    calendarFn: personality({ base: 0, gapEvery: 3, spikeEvery: 15, spikeTo: 3 }),
  },
];

async function main() {
  console.log('Seeding GitRank…');

  const cohort = await prisma.cohort.upsert({
    where: { slug: COHORT.slug },
    create: COHORT,
    update: { name: COHORT.name, isActive: COHORT.isActive },
  });

  // Fresh snapshots + awards each run for a clean, deterministic demo.
  await prisma.titleAward.deleteMany({ where: { cohortId: cohort.id } });
  await prisma.statSnapshot.deleteMany({ where: { cohortId: cohort.id } });

  for (const spec of MEMBERS) {
    const member = await prisma.member.upsert({
      where: { zid: spec.zid },
      create: {
        githubUsername: spec.githubUsername,
        zid: spec.zid,
        displayName: spec.displayName,
        githubId: spec.githubId,
        avatarUrl: spec.avatarUrl,
        accountCreatedAt: spec.accountCreatedAt,
      },
      update: {
        githubUsername: spec.githubUsername,
        displayName: spec.displayName,
        githubId: spec.githubId,
        avatarUrl: spec.avatarUrl,
        accountCreatedAt: spec.accountCreatedAt,
      },
    });

    const membership = await prisma.membership.upsert({
      where: { memberId_cohortId: { memberId: member.id, cohortId: cohort.id } },
      create: { memberId: member.id, cohortId: cohort.id },
      update: {},
    });

    if (spec.programRepo) {
      await prisma.programRepo.upsert({
        where: {
          membershipId_owner_name: {
            membershipId: membership.id,
            owner: spec.programRepo.owner,
            name: spec.programRepo.name,
          },
        },
        create: { membershipId: membership.id, ...spec.programRepo },
        update: {},
      });
    }

    const calendar = genCalendar(COHORT.startDate, NUM_DAYS, spec.calendarFn);
    const derived = summariseCalendar(calendar, TODAY);
    // Build the shape computeXp expects (the sync path assembles the same fields
    // from `UserStats`); seeding directly means we have to mirror it here.
    const snapshotStats = {
      ...spec.counts,
      totalContributions: derived.totalContributions,
      topLanguages: spec.topLanguages,
      longestStreak: derived.longestStreak,
      currentStreak: derived.currentStreak,
      maxCommitsInOneDay: derived.maxCommitsInOneDay,
      weekendCommitRatio: derived.weekendCommitRatio,
      nightCommitRatio: spec.nightCommitRatio,
    };

    await prisma.statSnapshot.create({
      data: {
        memberId: member.id,
        cohortId: cohort.id,
        capturedAt: TODAY,
        ...snapshotStats,
        calendar,
        xp: computeXp(snapshotStats),
      },
    });
  }

  await ensureTitles(prisma);
  const result = await evaluateCohort({ prisma, cohortId: cohort.id, now: TODAY });

  console.log(
    `Seeded cohort "${cohort.slug}" with ${MEMBERS.length} members; ` +
      `evaluated ${result.records} records and ${result.badges} badges.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
