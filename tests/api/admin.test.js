import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { buildTestApp, adminHeaders } from '../helpers/app.js';
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

// Per-username stat overrides the sync route will "fetch".
let statsByUser = {};
const zero = {
  githubId: 1,
  nodeId: 'N',
  login: 'x',
  displayName: 'X',
  avatarUrl: null,
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
};
const fetchUserStats = async ({ username }) => ({
  ...zero,
  login: username,
  ...(statsByUser[username] ?? {}),
});

beforeAll(async () => {
  app = await buildTestApp({ fetchUserStats });
});
beforeEach(async () => {
  statsByUser = {};
  await resetDb();
});
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

describe('admin auth', () => {
  it('rejects admin routes without a bearer token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/cohorts',
      payload: { name: 'X', slug: 'x', startDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong bearer token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/cohorts',
      headers: { authorization: 'Bearer wrong' },
      payload: { name: 'X', slug: 'x', startDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /admin/cohorts', () => {
  it('creates a cohort with a valid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/cohorts',
      headers: adminHeaders,
      payload: { name: 'Winter 2025', slug: 'winter-2025', startDate: '2025-06-01' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cohort).toMatchObject({
      slug: 'winter-2025',
      name: 'Winter 2025',
      isActive: true,
    });
  });

  it('rejects a duplicate slug with 409', async () => {
    await makeCohort({ slug: 'dupe' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/cohorts',
      headers: adminHeaders,
      payload: { name: 'Dupe', slug: 'dupe', startDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('validates the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/cohorts',
      headers: adminHeaders,
      payload: { name: '', slug: 'Not Kebab', startDate: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /admin/sync/:slug', () => {
  it('syncs members and evaluates titles', async () => {
    const cohort = await makeCohort({ slug: 'sync-me' });
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1000001' });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z1000002' });
    await makeMembership(alice.id, cohort.id);
    await makeMembership(bob.id, cohort.id);
    statsByUser = {
      alice: { totalCommits: 120, totalContributions: 130 },
      bob: { totalCommits: 20 },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/admin/sync/sync-me',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sync.membersSynced).toBe(2);
    expect(body.evaluation.members).toBe(2);

    expect(await prisma.statSnapshot.count({ where: { cohortId: cohort.id } })).toBe(2);

    const titlesRes = await app.inject({ method: 'GET', url: '/cohorts/sync-me/titles' });
    const machine = titlesRes.json().records.find((r) => r.key === 'most_commits');
    expect(machine.holder.member.githubUsername).toBe('alice');
  });

  it('requires a token', async () => {
    await makeCohort({ slug: 'sync-me' });
    const res = await app.inject({ method: 'POST', url: '/admin/sync/sync-me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /admin/members/:username', () => {
  it('cascades deletion and transfers a vacated record to the runner-up', async () => {
    const cohort = await makeCohort({ slug: 'del' });
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1000001' });
    const bob = await makeMember({ githubUsername: 'bob', zid: 'z1000002' });
    await makeMembership(alice.id, cohort.id);
    await makeMembership(bob.id, cohort.id);
    await makeSnapshot(alice.id, cohort.id, { totalCommits: 100, totalContributions: 110 });
    await makeSnapshot(bob.id, cohort.id, { totalCommits: 50, totalContributions: 60 });
    await evaluateCohort({ prisma, cohortId: cohort.id });

    // Alice holds the record before deletion.
    let titlesRes = await app.inject({ method: 'GET', url: '/cohorts/del/titles' });
    expect(
      titlesRes.json().records.find((r) => r.key === 'most_commits').holder.member.githubUsername,
    ).toBe('alice');

    const del = await app.inject({
      method: 'DELETE',
      url: '/admin/members/alice',
      headers: adminHeaders,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ deleted: 'alice', reevaluatedCohorts: 1 });

    // Alice's data is gone.
    expect(await prisma.member.findUnique({ where: { githubUsername: 'alice' } })).toBeNull();
    expect(await prisma.statSnapshot.count({ where: { memberId: alice.id } })).toBe(0);

    // The record transferred to Bob.
    titlesRes = await app.inject({ method: 'GET', url: '/cohorts/del/titles' });
    expect(
      titlesRes.json().records.find((r) => r.key === 'most_commits').holder.member.githubUsername,
    ).toBe('bob');
  });

  it('404s for an unknown member', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/members/ghost',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires a token', async () => {
    const m = await makeMember({ githubUsername: 'protected', zid: 'z1000009' });
    const res = await app.inject({ method: 'DELETE', url: `/admin/members/${m.githubUsername}` });
    expect(res.statusCode).toBe(401);
  });

  it('re-evaluates the global cohort when a joined member is deleted', async () => {
    // Two members on the global cohort with a snapshot each; Alice leads.
    const globalCohort = await prisma.cohort.findUnique({ where: { slug: 'global' } });
    const alice = await makeMember({ githubUsername: 'ga', zid: 'z1200001' });
    const bob = await makeMember({ githubUsername: 'gb', zid: 'z1200002' });
    await makeMembership(alice.id, globalCohort.id);
    await makeMembership(bob.id, globalCohort.id);
    await makeSnapshot(alice.id, globalCohort.id, { totalCommits: 200, totalContributions: 250 });
    await makeSnapshot(bob.id, globalCohort.id, { totalCommits: 60, totalContributions: 80 });
    await evaluateCohort({ prisma, cohortId: globalCohort.id });

    let titlesRes = await app.inject({ method: 'GET', url: '/cohorts/global/titles' });
    expect(
      titlesRes.json().records.find((r) => r.key === 'most_commits').holder.member.githubUsername,
    ).toBe('ga');

    const del = await app.inject({
      method: 'DELETE',
      url: '/admin/members/ga',
      headers: adminHeaders,
    });
    expect(del.statusCode).toBe(200);

    titlesRes = await app.inject({ method: 'GET', url: '/cohorts/global/titles' });
    expect(
      titlesRes.json().records.find((r) => r.key === 'most_commits').holder.member.githubUsername,
    ).toBe('gb');
  });
});
