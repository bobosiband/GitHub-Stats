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

/** Setup: 3 members, 2 rounds of snapshots — rank order shifts round-to-round. */
async function seedTwoRounds({ round1, round2 }) {
  const cohort = await makeCohort({ slug: 'delta' });
  const a = await makeMember({ githubUsername: 'a', zid: 'z8000001' });
  const b = await makeMember({ githubUsername: 'b', zid: 'z8000002' });
  const c = await makeMember({ githubUsername: 'c', zid: 'z8000003' });
  await makeMembership(a.id, cohort.id);
  await makeMembership(b.id, cohort.id);
  await makeMembership(c.id, cohort.id);

  // Round 1
  await makeSnapshot(a.id, cohort.id, { totalCommits: round1.a });
  await makeSnapshot(b.id, cohort.id, { totalCommits: round1.b });
  await makeSnapshot(c.id, cohort.id, { totalCommits: round1.c });
  // Round 2 — must have a strictly-later capturedAt (makeSnapshot handles that).
  await makeSnapshot(a.id, cohort.id, { totalCommits: round2.a });
  await makeSnapshot(b.id, cohort.id, { totalCommits: round2.b });
  await makeSnapshot(c.id, cohort.id, { totalCommits: round2.c });

  return { cohort, a, b, c };
}

describe('leaderboard rankDelta', () => {
  it('is null for every member on the first-ever sync (no previous snapshot)', async () => {
    const cohort = await makeCohort({ slug: 'first' });
    const a = await makeMember({ githubUsername: 'first-a', zid: 'z8100001' });
    await makeMembership(a.id, cohort.id);
    await makeSnapshot(a.id, cohort.id, { totalCommits: 10 });

    const res = await app.inject({ method: 'GET', url: '/cohorts/first/leaderboard?sort=commits' });
    expect(res.statusCode).toBe(200);
    for (const row of res.json().ranking) expect(row.rankDelta).toBeNull();
  });

  it('reports positive delta for climbers and negative for fallers', async () => {
    // Round 1 order (by commits desc): a, b, c
    // Round 2 order:                    c, a, b   → c climbed +2, a fell -1, b fell -1
    await seedTwoRounds({
      round1: { a: 100, b: 50, c: 10 },
      round2: { a: 100, b: 50, c: 500 },
    });

    const res = await app.inject({ method: 'GET', url: '/cohorts/delta/leaderboard?sort=commits' });
    const byUser = Object.fromEntries(
      res.json().ranking.map((r) => [r.member.githubUsername, r]),
    );
    expect(byUser.c.rank).toBe(1);
    expect(byUser.c.rankDelta).toBe(2);
    expect(byUser.a.rank).toBe(2);
    expect(byUser.a.rankDelta).toBe(-1);
    expect(byUser.b.rank).toBe(3);
    expect(byUser.b.rankDelta).toBe(-1);
  });

  it('reports zero when a member holds their position', async () => {
    await seedTwoRounds({
      round1: { a: 100, b: 50, c: 10 },
      round2: { a: 110, b: 60, c: 20 }, // same order, everyone stationary
    });
    const res = await app.inject({ method: 'GET', url: '/cohorts/delta/leaderboard?sort=commits' });
    for (const row of res.json().ranking) expect(row.rankDelta).toBe(0);
  });

  it('is null for a member with only one snapshot even when others have two', async () => {
    const cohort = await makeCohort({ slug: 'mixed' });
    const veteran = await makeMember({ githubUsername: 'vet', zid: 'z8200001' });
    const rookie = await makeMember({ githubUsername: 'rook', zid: 'z8200002' });
    await makeMembership(veteran.id, cohort.id);
    await makeMembership(rookie.id, cohort.id);

    await makeSnapshot(veteran.id, cohort.id, { totalCommits: 100 });
    await makeSnapshot(veteran.id, cohort.id, { totalCommits: 150 });
    await makeSnapshot(rookie.id, cohort.id, { totalCommits: 200 });

    const res = await app.inject({ method: 'GET', url: '/cohorts/mixed/leaderboard?sort=commits' });
    const byUser = Object.fromEntries(
      res.json().ranking.map((r) => [r.member.githubUsername, r]),
    );
    expect(byUser.rook.rank).toBe(1);
    expect(byUser.rook.rankDelta).toBeNull(); // no previous ranking
    expect(byUser.vet.rank).toBe(2);
    expect(byUser.vet.rankDelta).toBe(-1); // was rank 1, now rank 2
  });
});
