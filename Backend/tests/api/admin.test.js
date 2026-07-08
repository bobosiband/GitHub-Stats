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

describe('POST /admin/sync-all', () => {
  it('requires a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/sync-all' });
    expect(res.statusCode).toBe(401);
  });

  it('runs the sync runner across every active cohort and returns its summary', async () => {
    const cohort = await makeCohort({ slug: 'multi' });
    const alice = await makeMember({ githubUsername: 'alice', zid: 'z1000001' });
    await makeMembership(alice.id, cohort.id);
    statsByUser = { alice: { totalCommits: 42 } };

    const res = await app.inject({
      method: 'POST',
      url: '/admin/sync-all',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skipped).toBe(false);
    // The custom cohort + the always-on global cohort are both syncable.
    const slugs = body.summaries.map((s) => s.cohortSlug).sort();
    expect(slugs).toContain('multi');
    expect(slugs).toContain('global');

    expect(await prisma.statSnapshot.count({ where: { cohortId: cohort.id } })).toBe(1);
  });

  it('returns { skipped: true } with 200 when a run is already in progress', async () => {
    // Build a fresh app with a slow fake fetcher so we can catch the in-progress
    // state via a second concurrent call.
    let release;
    const gate = new Promise((r) => (release = r));

    const slowFetch = async ({ username }) => {
      await gate;
      return { ...zero, login: username };
    };

    const local = await buildTestApp({ fetchUserStats: slowFetch });
    try {
      const cohort = await makeCohort({ slug: 'slow' });
      const m = await makeMember({ githubUsername: 'slowuser', zid: 'z1300001' });
      await makeMembership(m.id, cohort.id);

      const first = local.inject({
        method: 'POST',
        url: '/admin/sync-all',
        headers: adminHeaders,
      });

      // Small wait to let the first request enter the runner and set `running = true`.
      await new Promise((r) => setImmediate(r));

      const second = await local.inject({
        method: 'POST',
        url: '/admin/sync-all',
        headers: adminHeaders,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ skipped: true });

      release();
      const firstRes = await first;
      expect(firstRes.statusCode).toBe(200);
      expect(firstRes.json().skipped).toBe(false);
    } finally {
      await local.close();
    }
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

describe('PUT /admin/members/:username/program-repo', () => {
  it('registers a program repo for the member+cohort membership', async () => {
    const cohort = await makeCohort({ slug: 'pr-cohort' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z2000001' });
    await makeMembership(m.id, cohort.id);

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/members/ada/program-repo',
      headers: adminHeaders,
      payload: { cohortSlug: 'pr-cohort', repo: 'ada/analytical-engine' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      programRepo: {
        cohortSlug: 'pr-cohort',
        username: 'ada',
        owner: 'ada',
        name: 'analytical-engine',
      },
    });

    const rows = await prisma.programRepo.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: 'ada', name: 'analytical-engine' });
  });

  it('accepts the { owner, name } object shape', async () => {
    const cohort = await makeCohort({ slug: 'pr-obj' });
    const m = await makeMember({ githubUsername: 'grace', zid: 'z2000002' });
    await makeMembership(m.id, cohort.id);

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/members/grace/program-repo',
      headers: adminHeaders,
      payload: { cohortSlug: 'pr-obj', repo: { owner: 'grace', name: 'compiler' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().programRepo).toMatchObject({ owner: 'grace', name: 'compiler' });
  });

  it('replaces an existing program repo on re-submission (one per membership)', async () => {
    const cohort = await makeCohort({ slug: 'pr-replace' });
    const m = await makeMember({ githubUsername: 'linus', zid: 'z2000003' });
    const membership = await makeMembership(m.id, cohort.id);
    // Seed two rows to prove replace-on-exists also cleans historical duplicates.
    await prisma.programRepo.createMany({
      data: [
        { membershipId: membership.id, owner: 'linus', name: 'old-one' },
        { membershipId: membership.id, owner: 'linus', name: 'old-two' },
      ],
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/members/linus/program-repo',
      headers: adminHeaders,
      payload: { cohortSlug: 'pr-replace', repo: 'linus/kernel' },
    });
    expect(res.statusCode).toBe(200);
    const rows = await prisma.programRepo.findMany({ where: { membershipId: membership.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: 'linus', name: 'kernel' });
  });

  it('rejects an invalid repo format with 400', async () => {
    const cohort = await makeCohort({ slug: 'pr-bad' });
    const m = await makeMember({ githubUsername: 'alan', zid: 'z2000004' });
    await makeMembership(m.id, cohort.id);

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/members/alan/program-repo',
      headers: adminHeaders,
      payload: { cohortSlug: 'pr-bad', repo: 'not-a-valid-repo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('404s for an unknown member', async () => {
    await makeCohort({ slug: 'pr-cohort' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/members/ghost/program-repo',
      headers: adminHeaders,
      payload: { cohortSlug: 'pr-cohort', repo: 'ghost/repo' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown cohort', async () => {
    const m = await makeMember({ githubUsername: 'ada', zid: 'z2000005' });
    // No cohort with this slug.
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/members/${m.githubUsername}/program-repo`,
      headers: adminHeaders,
      payload: { cohortSlug: 'no-such-cohort', repo: 'ada/x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the member is not a member of the cohort', async () => {
    await makeCohort({ slug: 'has-no-ada' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z2000006' });
    // Deliberately no makeMembership.
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/members/${m.githubUsername}/program-repo`,
      headers: adminHeaders,
      payload: { cohortSlug: 'has-no-ada', repo: 'ada/x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires a token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/members/ada/program-repo',
      payload: { cohortSlug: 'anything', repo: 'ada/x' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /admin/members/:username/program-repo', () => {
  it('removes the program repo for that membership', async () => {
    const cohort = await makeCohort({ slug: 'del-pr' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z2100001' });
    const membership = await makeMembership(m.id, cohort.id);
    await prisma.programRepo.create({
      data: { membershipId: membership.id, owner: 'ada', name: 'engine' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/members/ada/program-repo?cohortSlug=del-pr',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 1 });
    expect(await prisma.programRepo.count()).toBe(0);
  });

  it('returns { deleted: 0 } when no program repo is registered', async () => {
    const cohort = await makeCohort({ slug: 'empty-pr' });
    const m = await makeMember({ githubUsername: 'grace', zid: 'z2100002' });
    await makeMembership(m.id, cohort.id);

    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/members/grace/program-repo?cohortSlug=empty-pr',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 0 });
  });

  it('404s for an unknown member', async () => {
    await makeCohort({ slug: 'del-pr' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/members/ghost/program-repo?cohortSlug=del-pr',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the member is not a member of the cohort', async () => {
    await makeCohort({ slug: 'del-pr' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z2100003' });
    // No membership.
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/members/${m.githubUsername}/program-repo?cohortSlug=del-pr`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a missing cohortSlug with 400', async () => {
    const m = await makeMember({ githubUsername: 'ada', zid: 'z2100004' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/members/${m.githubUsername}/program-repo`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires a token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/members/ada/program-repo?cohortSlug=whatever',
    });
    expect(res.statusCode).toBe(401);
  });
});
