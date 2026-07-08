import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { syncCohort, syncMember, syncAllActive } from '../../src/services/sync.js';
import { evaluateCohort } from '../../src/services/titles/engine.js';
import {
  getPrisma,
  resetDb,
  disconnectDb,
  makeCohort,
  makeMember,
  makeMembership,
} from '../helpers/db.js';

const prisma = getPrisma();
const NOW = new Date('2025-06-01T00:00:00Z');

/** A complete UserStats object with zeroed defaults. */
function stats(overrides = {}) {
  return {
    githubId: 1,
    nodeId: 'NODE',
    login: 'x',
    displayName: 'X',
    avatarUrl: 'https://avatar/x',
    accountCreatedAt: new Date('2018-01-01T00:00:00Z'),
    followers: 0,
    contributedRepoCount: 0,
    mergedPRs: 0,
    repoCount: 0,
    totalStars: 0,
    languageCount: 0,
    topLanguages: [],
    totalCommits: 0,
    totalPRs: 0,
    reviewsGiven: 0,
    issuesOpened: 0,
    totalContributions: 0,
    calendar: [],
    longestStreak: 0,
    currentStreak: 0,
    maxCommitsInOneDay: 0,
    weekendCommitRatio: 0,
    nightCommitRatio: null,
    ...overrides,
  };
}

/** Build a fake fetchUserStats backed by a username → stats table. */
function fakeFetcher(table) {
  return async ({ username }) => {
    const entry = table[username];
    if (entry instanceof Error) throw entry;
    if (!entry) throw new Error(`no fixture for ${username}`);
    return entry;
  };
}

beforeEach(resetDb);
afterAll(disconnectDb);

describe('syncCohort', () => {
  it('creates one snapshot per member and refreshes cached profile fields', async () => {
    const cohort = await makeCohort();
    const alice = await makeMember({
      githubUsername: 'alice',
      zid: 'z1111111',
      githubId: null,
      avatarUrl: null,
      accountCreatedAt: null,
    });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z2222222' });
    await makeMembership(alice.id, cohort.id);
    await makeMembership(bob.id, cohort.id);

    const fetchUserStats = fakeFetcher({
      alice: stats({
        githubId: 111,
        avatarUrl: 'https://avatar/alice',
        totalCommits: 100,
        totalContributions: 120,
      }),
      bob: stats({ githubId: 222, totalCommits: 50, totalContributions: 60 }),
    });

    const summary = await syncCohort({
      prisma,
      fetchUserStats,
      cohortId: cohort.id,
      now: NOW,
      delayMs: 0,
    });

    expect(summary.membersSynced).toBe(2);
    expect(summary.snapshotsCreated).toBe(2);
    expect(summary.errors).toEqual([]);

    const snaps = await prisma.statSnapshot.findMany({ where: { cohortId: cohort.id } });
    expect(snaps).toHaveLength(2);

    const refreshedAlice = await prisma.member.findUnique({ where: { id: alice.id } });
    expect(refreshedAlice.githubId).toBe(111);
    expect(refreshedAlice.avatarUrl).toBe('https://avatar/alice');
    expect(refreshedAlice.accountCreatedAt.toISOString()).toBe('2018-01-01T00:00:00.000Z');
  });

  it('refreshes displayName on sync so GitHub renames propagate', async () => {
    const cohort = await makeCohort();
    const alice = await makeMember({
      githubUsername: 'alice',
      zid: 'z1111111',
      displayName: 'Old Name',
    });
    await makeMembership(alice.id, cohort.id);

    const fetchUserStats = fakeFetcher({
      alice: stats({ displayName: 'Renamed Alice', login: 'alice' }),
    });
    await syncCohort({ prisma, fetchUserStats, cohortId: cohort.id, now: NOW, delayMs: 0 });

    const refreshed = await prisma.member.findUnique({ where: { id: alice.id } });
    expect(refreshed.displayName).toBe('Renamed Alice');
  });

  it('falls back to the GitHub login on sync when the profile has no name', async () => {
    const cohort = await makeCohort();
    const alice = await makeMember({
      githubUsername: 'alice',
      zid: 'z1111111',
      displayName: 'Prior',
    });
    await makeMembership(alice.id, cohort.id);

    const fetchUserStats = fakeFetcher({
      alice: stats({ displayName: null, login: 'alice' }),
    });
    await syncCohort({ prisma, fetchUserStats, cohortId: cohort.id, now: NOW, delayMs: 0 });

    const refreshed = await prisma.member.findUnique({ where: { id: alice.id } });
    expect(refreshed.displayName).toBe('alice');
  });

  it('records per-member errors without aborting the run', async () => {
    const cohort = await makeCohort();
    const good = await makeMember({ githubUsername: 'good', zid: 'z3333333' });
    const bad = await makeMember({ githubUsername: 'bad', zid: 'z4444444' });
    await makeMembership(good.id, cohort.id);
    await makeMembership(bad.id, cohort.id);

    const fetchUserStats = fakeFetcher({
      good: stats({ totalCommits: 10 }),
      bad: new Error('GitHub exploded'),
    });

    const summary = await syncCohort({
      prisma,
      fetchUserStats,
      cohortId: cohort.id,
      now: NOW,
      delayMs: 0,
    });

    expect(summary.membersSynced).toBe(1);
    expect(summary.errors).toEqual([{ username: 'bad', error: 'GitHub exploded' }]);
    expect(await prisma.statSnapshot.count({ where: { cohortId: cohort.id } })).toBe(1);
  });

  it('feeds the title engine: records go to the leader and transfer on improvement', async () => {
    const cohort = await makeCohort();
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1111111' });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z2222222' });
    await makeMembership(alice.id, cohort.id);
    await makeMembership(bob.id, cohort.id);

    // Round 1: Alice leads on commits.
    let fetchUserStats = fakeFetcher({
      alice: stats({ totalCommits: 100 }),
      bob: stats({ totalCommits: 40 }),
    });
    await syncCohort({ prisma, fetchUserStats, cohortId: cohort.id, now: NOW, delayMs: 0 });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    const title = await prisma.title.findUnique({ where: { key: 'most_commits' } });
    let active = await prisma.titleAward.findFirst({
      where: { titleId: title.id, cohortId: cohort.id, revokedAt: null },
    });
    expect(active.memberId).toBe(alice.id);

    // Round 2: Bob overtakes.
    const later = new Date('2025-06-08T00:00:00Z');
    fetchUserStats = fakeFetcher({
      alice: stats({ totalCommits: 105 }),
      bob: stats({ totalCommits: 300 }),
    });
    await syncCohort({ prisma, fetchUserStats, cohortId: cohort.id, now: later, delayMs: 0 });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: later });

    active = await prisma.titleAward.findFirst({
      where: { titleId: title.id, cohortId: cohort.id, revokedAt: null },
    });
    expect(active.memberId).toBe(bob.id);
    expect(active.value).toEqual({ totalCommits: 300 });
  });
});

describe('global cohort sync', () => {
  it('awards global titles independently from program titles for the same member', async () => {
    const NOW = new Date('2026-06-01T00:00:00Z');
    // Keep the program window shorter than a year so it doesn't clamp into the
    // same trailing-year window the global cohort uses.
    const program = await makeCohort({
      slug: 'prog-A',
      isActive: true,
      startDate: new Date('2026-03-01T00:00:00Z'),
    });
    const global = await prisma.cohort.findUnique({ where: { slug: 'global' } });
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1111111' });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z2222222' });
    await makeMembership(alice.id, program.id);
    await makeMembership(bob.id, program.id);
    // Alice + Bob are on the global cohort too. Alice leads program on commits;
    // Bob is the global leader (his trailing-year total is higher, e.g. work on
    // repos outside the program). We fake distinct stats per (cohort, user) via
    // the `since` window value → cohort mapping in the fetcher.
    await makeMembership(alice.id, global.id);
    await makeMembership(bob.id, global.id);

    const fetchUserStats = async ({ username, since }) => {
      // GLOBAL uses a rolling 365d window (since = now - 1y); PROGRAM uses cohort dates.
      const isGlobal = since.getTime() === NOW.getTime() - 365 * 24 * 60 * 60 * 1000;
      if (isGlobal) {
        // Global: Bob wins on commits (rolling year totals).
        return stats({
          totalCommits: username === 'bob' ? 900 : 250,
          totalContributions: username === 'bob' ? 1100 : 300,
        });
      }
      // Program: Alice wins on commits.
      return stats({
        totalCommits: username === 'alice' ? 400 : 40,
        totalContributions: username === 'alice' ? 450 : 50,
      });
    };

    await syncCohort({ prisma, fetchUserStats, cohortId: program.id, now: NOW, delayMs: 0 });
    await syncCohort({ prisma, fetchUserStats, cohortId: global.id, now: NOW, delayMs: 0 });
    await evaluateCohort({ prisma, cohortId: program.id, now: NOW });
    await evaluateCohort({ prisma, cohortId: global.id, now: NOW });

    const title = await prisma.title.findUnique({ where: { key: 'most_commits' } });

    const programHolder = await prisma.titleAward.findFirst({
      where: { titleId: title.id, cohortId: program.id, revokedAt: null },
    });
    expect(programHolder.memberId).toBe(alice.id);

    const globalHolder = await prisma.titleAward.findFirst({
      where: { titleId: title.id, cohortId: global.id, revokedAt: null },
    });
    expect(globalHolder.memberId).toBe(bob.id);
  });
});

describe('syncMember & syncAllActive', () => {
  it('syncs a single member', async () => {
    const cohort = await makeCohort();
    const m = await makeMember({ githubUsername: 'solo', zid: 'z5555555' });
    await makeMembership(m.id, cohort.id);
    const fetchUserStats = fakeFetcher({ solo: stats({ totalCommits: 7 }) });

    const snap = await syncMember({
      prisma,
      fetchUserStats,
      memberId: m.id,
      cohortId: cohort.id,
      now: NOW,
    });
    expect(snap.totalCommits).toBe(7);
  });

  it('only syncs active cohorts', async () => {
    const active = await makeCohort({ isActive: true, slug: 'active-x' });
    const inactive = await makeCohort({ isActive: false, slug: 'inactive-x' });
    const m1 = await makeMember({ githubUsername: 'a1', zid: 'z6666666' });
    const m2 = await makeMember({ githubUsername: 'a2', zid: 'z7777777' });
    await makeMembership(m1.id, active.id);
    await makeMembership(m2.id, inactive.id);

    const fetchUserStats = fakeFetcher({
      a1: stats({ totalCommits: 1 }),
      a2: stats({ totalCommits: 1 }),
    });
    const summaries = await syncAllActive({ prisma, fetchUserStats, now: NOW, delayMs: 0 });

    // The always-on global cohort is also active but has zero members here, so it
    // contributes a zero-work summary alongside the real one.
    const nonGlobal = summaries.filter((s) => s.cohortSlug !== 'global');
    expect(nonGlobal).toHaveLength(1);
    expect(nonGlobal[0].cohortId).toBe(active.id);
    expect(await prisma.statSnapshot.count({ where: { cohortId: inactive.id } })).toBe(0);
  });
});
