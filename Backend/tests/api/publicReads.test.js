import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import {
  getPrisma,
  resetDb,
  disconnectDb,
  makeCohort,
  makeMember,
  makeMembership,
  makeSnapshot,
} from '../helpers/db.js';
import { evaluateCohort } from '../../src/services/titles/engine.js';

const prisma = getPrisma();
let app;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

describe('GET /cohorts', () => {
  it('lists cohorts with member counts', async () => {
    const cohort = await makeCohort({ name: 'Summer 2025', slug: 'summer-2025' });
    const m = await makeMember();
    await makeMembership(m.id, cohort.id);

    const res = await app.inject({ method: 'GET', url: '/cohorts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.cohorts.find((c) => c.slug === 'summer-2025');
    expect(found).toMatchObject({ name: 'Summer 2025', memberCount: 1 });
  });
});

describe('GET /cohorts/:slug', () => {
  it('returns cohort detail', async () => {
    await makeCohort({ slug: 'detail-x', name: 'Detail Cohort' });
    const res = await app.inject({ method: 'GET', url: '/cohorts/detail-x' });
    expect(res.statusCode).toBe(200);
    expect(res.json().cohort).toMatchObject({
      slug: 'detail-x',
      name: 'Detail Cohort',
      memberCount: 0,
    });
  });

  it('404s for an unknown slug with the standard error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/cohorts/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

describe('GET /cohorts/:slug/leaderboard', () => {
  async function seedLeaderboard() {
    const cohort = await makeCohort({ slug: 'lb' });
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1000001' });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z1000002' });
    const carol = await makeMember({ githubUsername: 'carol', zid: 'z1000003' });
    await makeMembership(alice.id, cohort.id);
    await makeMembership(bob.id, cohort.id);
    await makeMembership(carol.id, cohort.id);
    await makeSnapshot(alice.id, cohort.id, { totalCommits: 100, totalStars: 3, longestStreak: 4 });
    await makeSnapshot(bob.id, cohort.id, { totalCommits: 40, totalStars: 50, longestStreak: 12 });
    await makeSnapshot(carol.id, cohort.id, { totalCommits: 70, totalStars: 10, longestStreak: 1 });
    return cohort;
  }

  it('defaults to sorting by commits', async () => {
    await seedLeaderboard();
    const res = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sortField).toBe('totalCommits');
    expect(body.ranking.map((r) => r.member.githubUsername)).toEqual(['alice', 'carol', 'bob']);
    expect(body.ranking[0].rank).toBe(1);
  });

  it('sorts by the requested stat', async () => {
    await seedLeaderboard();
    const res = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard?sort=stars' });
    expect(res.json().ranking.map((r) => r.member.githubUsername)).toEqual([
      'bob',
      'carol',
      'alice',
    ]);

    const streak = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard?sort=streak' });
    expect(streak.json().ranking.map((r) => r.member.githubUsername)).toEqual([
      'bob',
      'alice',
      'carol',
    ]);
  });

  it('rejects an invalid sort value', async () => {
    await seedLeaderboard();
    const res = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard?sort=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('sets an ETag and answers 304 for a matching If-None-Match', async () => {
    await seedLeaderboard();
    const first = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard' });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const conditional = await app.inject({
      method: 'GET',
      url: '/cohorts/lb/leaderboard',
      headers: { 'if-none-match': etag },
    });
    expect(conditional.statusCode).toBe(304);
    expect(conditional.body).toBe('');
    // The 304 must still carry the ETag so the client keeps caching correctly.
    expect(conditional.headers.etag).toBe(etag);
  });

  it('changes ETag (and returns 200) when a newer snapshot lands', async () => {
    const cohort = await seedLeaderboard();
    const first = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard' });
    const etag = first.headers.etag;

    // A newer snapshot bumps `_max.capturedAt` → ETag changes.
    const alice = await prisma.member.findUnique({ where: { githubUsername: 'alice' } });
    await makeSnapshot(alice.id, cohort.id, { totalCommits: 200 });

    const second = await app.inject({
      method: 'GET',
      url: '/cohorts/lb/leaderboard',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(etag);
  });

  it('uses distinct ETags per sort (different sorts are different resources)', async () => {
    await seedLeaderboard();
    const commits = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard?sort=commits' });
    const stars = await app.inject({ method: 'GET', url: '/cohorts/lb/leaderboard?sort=stars' });
    expect(commits.headers.etag).toBeTruthy();
    expect(stars.headers.etag).toBeTruthy();
    expect(commits.headers.etag).not.toBe(stars.headers.etag);
  });

  it('ranks by only the latest snapshot when a member has several', async () => {
    // With DISTINCT ON, only each member's newest capturedAt should feed the
    // ranking — historical snapshots must not sway the order.
    const cohort = await makeCohort({ slug: 'lb-multi' });
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1500001' });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z1500002' });
    await makeMembership(alice.id, cohort.id);
    await makeMembership(bob.id, cohort.id);
    // Alice: three snapshots, the latest is 500 (she now leads).
    await makeSnapshot(alice.id, cohort.id, { totalCommits: 10 });
    await makeSnapshot(alice.id, cohort.id, { totalCommits: 200 });
    await makeSnapshot(alice.id, cohort.id, { totalCommits: 500 });
    // Bob: two snapshots, the latest is 300 (older was higher — must be ignored).
    await makeSnapshot(bob.id, cohort.id, { totalCommits: 999 });
    await makeSnapshot(bob.id, cohort.id, { totalCommits: 300 });

    const res = await app.inject({ method: 'GET', url: '/cohorts/lb-multi/leaderboard' });
    expect(res.statusCode).toBe(200);
    const ranking = res.json().ranking;
    expect(ranking.map((r) => r.member.githubUsername)).toEqual(['alice', 'bob']);
    expect(ranking[0].stats.totalCommits).toBe(500);
    expect(ranking[1].stats.totalCommits).toBe(300);
  });
});

describe('GET /cohorts/:slug/titles', () => {
  it('sets an ETag and answers 304 for a matching If-None-Match', async () => {
    const cohort = await makeCohort({ slug: 'etag-titles' });
    const a = await makeMember({ githubUsername: 'ada2', zid: 'z2100010' });
    await makeMembership(a.id, cohort.id);
    await makeSnapshot(a.id, cohort.id, { totalCommits: 100 });

    const first = await app.inject({ method: 'GET', url: '/cohorts/etag-titles/titles' });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const conditional = await app.inject({
      method: 'GET',
      url: '/cohorts/etag-titles/titles',
      headers: { 'if-none-match': etag },
    });
    expect(conditional.statusCode).toBe(304);
    expect(conditional.headers.etag).toBe(etag);
  });

  it('returns records with holders and badges with earners', async () => {
    const cohort = await makeCohort({ slug: 'titles-x' });
    const a = await makeMember({ githubUsername: 'ada', zid: 'z2000001' });
    await makeMembership(a.id, cohort.id);
    await makeSnapshot(a.id, cohort.id, { totalCommits: 150, totalContributions: 200 });
    await evaluateCohort({ prisma: app.prisma, cohortId: cohort.id });

    const res = await app.inject({ method: 'GET', url: '/cohorts/titles-x/titles' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const machine = body.records.find((r) => r.key === 'most_commits');
    expect(machine.holder.member.githubUsername).toBe('ada');
    const century = body.badges.find((b) => b.key === 'century');
    expect(century.earnedCount).toBe(1);
    expect(century.earners[0].member.githubUsername).toBe('ada');
  });
});

describe('GET /members/:username', () => {
  it('404s for an unknown member', async () => {
    const res = await app.inject({ method: 'GET', url: '/members/ghost' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('includes titles from a past cohort', async () => {
    // Past cohort where the member won a record.
    const past = await makeCohort({ slug: 'past', isActive: false });
    const member = await makeMember({ githubUsername: 'veteran', zid: 'z3000001' });
    await makeMembership(member.id, past.id);
    await makeSnapshot(member.id, past.id, { totalCommits: 500, totalContributions: 600 });
    await evaluateCohort({ prisma: app.prisma, cohortId: past.id });

    // A newer cohort the member also joined.
    const current = await makeCohort({ slug: 'current' });
    await makeMembership(member.id, current.id);

    const res = await app.inject({ method: 'GET', url: '/members/veteran' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.member.githubUsername).toBe('veteran');
    // zid is PII — must never appear on the unauthenticated profile endpoint.
    expect(body.member).not.toHaveProperty('zid');
    expect(body.cohorts.map((c) => c.cohort.slug).sort()).toEqual(['current', 'past']);

    const machine = body.titles.find((t) => t.key === 'most_commits');
    expect(machine).toBeTruthy();
    expect(machine.cohort.slug).toBe('past');
    expect(machine.active).toBe(true);

    expect(body.badges.some((b) => b.key === 'century')).toBe(true);
  });
});
