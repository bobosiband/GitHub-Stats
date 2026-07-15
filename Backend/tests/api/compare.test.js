import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import {
  getPrisma,
  resetDb,
  disconnectDb,
  makeMember,
  makeMembership,
  makeSnapshot,
} from '../helpers/db.js';
import { GLOBAL_COHORT_SLUG } from '../../src/services/global.js';
import { COMPARE_STATS } from '../../src/services/views.js';

const prisma = getPrisma();
let app;

async function globalCohort() {
  return prisma.cohort.findUnique({ where: { slug: GLOBAL_COHORT_SLUG } });
}

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

describe('GET /members/compare', () => {
  it('returns both profiles, snapshots, per-stat verdicts and a score', async () => {
    const global = await globalCohort();
    const alice = await makeMember({ githubUsername: 'alice-cmp', zid: 'z2000001' });
    const bob = await makeMember({ githubUsername: 'bob-cmp', zid: 'z2000002' });
    await makeMembership(alice.id, global.id);
    await makeMembership(bob.id, global.id);
    await makeSnapshot(alice.id, global.id, {
      totalCommits: 200,
      totalContributions: 400,
      mergedPRs: 15,
      reviewsGiven: 20,
      issuesOpened: 5,
      longestStreak: 30,
      totalStars: 100,
      followers: 50,
      languageCount: 6,
    });
    await makeSnapshot(bob.id, global.id, {
      totalCommits: 100,
      totalContributions: 800, // beats Alice
      mergedPRs: 15,           // tie
      reviewsGiven: 5,
      issuesOpened: 12,        // beats Alice
      longestStreak: 20,
      totalStars: 300,         // beats Alice
      followers: 40,
      languageCount: 6,        // tie
    });

    const res = await app.inject({
      method: 'GET',
      url: '/members/compare?a=alice-cmp&b=bob-cmp',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.a.profile.member.githubUsername).toBe('alice-cmp');
    expect(body.b.profile.member.githubUsername).toBe('bob-cmp');
    expect(body.a.snapshot).toMatchObject({ totalCommits: 200 });
    expect(body.b.snapshot).toMatchObject({ totalCommits: 100 });

    // Every stat in COMPARE_STATS shows up in order.
    expect(body.stats.map((s) => s.stat)).toEqual(COMPARE_STATS);

    const byStat = Object.fromEntries(body.stats.map((s) => [s.stat, s]));
    expect(byStat.totalCommits).toMatchObject({ a: 200, b: 100, winner: 'a' });
    expect(byStat.totalContributions).toMatchObject({ a: 400, b: 800, winner: 'b' });
    expect(byStat.mergedPRs.winner).toBe('tie');
    expect(byStat.reviewsGiven.winner).toBe('a');
    expect(byStat.issuesOpened.winner).toBe('b');
    expect(byStat.longestStreak.winner).toBe('a');
    expect(byStat.totalStars.winner).toBe('b');
    expect(byStat.followers.winner).toBe('a');
    expect(byStat.languageCount.winner).toBe('tie');

    expect(body.score).toEqual({ a: 4, b: 3, ties: 2 });
  });

  it('404s with the standard error shape when either member is unknown', async () => {
    const global = await globalCohort();
    const alice = await makeMember({ githubUsername: 'alice-only', zid: 'z2000010' });
    await makeMembership(alice.id, global.id);

    const missingA = await app.inject({
      method: 'GET',
      url: '/members/compare?a=ghost&b=alice-only',
    });
    expect(missingA.statusCode).toBe(404);
    expect(missingA.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });

    const missingB = await app.inject({
      method: 'GET',
      url: '/members/compare?a=alice-only&b=ghost',
    });
    expect(missingB.statusCode).toBe(404);
  });

  it('handles members with no snapshot yet — missing stats treated as 0', async () => {
    const global = await globalCohort();
    const fresh = await makeMember({ githubUsername: 'freshie', zid: 'z2000020' });
    const seasoned = await makeMember({ githubUsername: 'seasoned', zid: 'z2000021' });
    await makeMembership(fresh.id, global.id);
    await makeMembership(seasoned.id, global.id);
    await makeSnapshot(seasoned.id, global.id, {
      totalCommits: 50,
      totalContributions: 60,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/members/compare?a=freshie&b=seasoned',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a.snapshot).toBeNull();
    expect(body.b.snapshot).toMatchObject({ totalCommits: 50 });
    const byStat = Object.fromEntries(body.stats.map((s) => [s.stat, s]));
    // fresh member's stats read as 0 → seasoned wins any positive stat.
    expect(byStat.totalCommits).toMatchObject({ a: 0, b: 50, winner: 'b' });
    // Both zero on a stat the seasoned member didn't touch → tie.
    expect(byStat.mergedPRs).toMatchObject({ a: 0, b: 0, winner: 'tie' });
  });

  it('all-zero vs all-zero snapshots produce all-tie verdicts', async () => {
    const global = await globalCohort();
    const zeroA = await makeMember({ githubUsername: 'zero-a', zid: 'z2000030' });
    const zeroB = await makeMember({ githubUsername: 'zero-b', zid: 'z2000031' });
    await makeMembership(zeroA.id, global.id);
    await makeMembership(zeroB.id, global.id);
    await makeSnapshot(zeroA.id, global.id, {});
    await makeSnapshot(zeroB.id, global.id, {});

    const res = await app.inject({
      method: 'GET',
      url: '/members/compare?a=zero-a&b=zero-b',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const s of body.stats) expect(s.winner).toBe('tie');
    expect(body.score).toEqual({ a: 0, b: 0, ties: COMPARE_STATS.length });
  });

  it('rejects a request missing the a/b query params', async () => {
    const res = await app.inject({ method: 'GET', url: '/members/compare?a=onlyone' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
