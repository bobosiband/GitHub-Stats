import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import { getPrisma, resetDb, disconnectDb, makeCohort, makeMember } from '../helpers/db.js';
import { evaluateCohort } from '../../src/services/titles/engine.js';
import { GithubUserNotFoundError } from '../../src/services/github/fetchUserStats.js';

const prisma = getPrisma();
let app;

// Dispatching verifier: 'ghostuser' does not exist on GitHub; everyone else does.
// 'nonameuser' models a GitHub profile with no `name` set so we can prove the
// login fallback works.
const verifyGithubUser = async ({ username }) => {
  if (username === 'ghostuser') throw new GithubUserNotFoundError(username);
  return {
    githubId: 900,
    nodeId: `N-${username}`,
    login: username,
    displayName: username === 'nonameuser' ? null : `The ${username}`,
    avatarUrl: `https://avatar/${username}`,
    accountCreatedAt: new Date('2017-05-05T00:00:00Z'),
  };
};

beforeAll(async () => {
  app = await buildTestApp({ verifyGithubUser });
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

const join = (slug, body) =>
  app.inject({ method: 'POST', url: `/cohorts/${slug}/join`, payload: body });

describe('POST /cohorts/:slug/join', () => {
  it('happy path: exactly two fields; displayName auto-populates from the GitHub profile', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', {
      githubUsername: 'newbie',
      zid: 'z9000001',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.member).toMatchObject({
      githubUsername: 'newbie',
      displayName: 'The newbie',
      avatarUrl: 'https://avatar/newbie',
    });
    // zid must NOT leak on the public profile response (see views.js).
    expect(body.member).not.toHaveProperty('zid');
    // The DB row still carries it.
    const stored = await prisma.member.findUnique({ where: { githubUsername: 'newbie' } });
    expect(stored.zid).toBe('z9000001');
    // Program cohort + auto-added global cohort.
    expect(body.cohorts).toHaveLength(2);
    expect(body.cohorts.map((c) => c.cohort.slug).sort()).toEqual(['global', 'open']);
    // No program repo is set at join time — that is now an admin-only operation.
    for (const c of body.cohorts) expect(c.programRepos).toEqual([]);

    expect(await prisma.member.count()).toBe(1);
    expect(await prisma.membership.count()).toBe(2);
    expect(await prisma.programRepo.count()).toBe(0);
  });

  it('falls back to the GitHub login when the profile has no `name`', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', { githubUsername: 'nonameuser', zid: 'z9000030' });
    expect(res.statusCode).toBe(201);
    expect(res.json().member.displayName).toBe('nonameuser');
  });

  it('rejects a request that carries programRepo with a friendly 400', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', {
      githubUsername: 'newbie',
      zid: 'z9000031',
      programRepo: 'newbie/project',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toContainEqual({
      path: 'programRepo',
      message: 'unexpected field "programRepo" — join only needs githubUsername and zid',
    });
    // Nothing should have been created.
    expect(await prisma.member.count()).toBe(0);
  });

  it('rejects a request that carries displayName with a friendly 400', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', {
      githubUsername: 'newbie',
      zid: 'z9000032',
      displayName: 'Manual Name',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toContainEqual({
      path: 'displayName',
      message: 'unexpected field "displayName" — join only needs githubUsername and zid',
    });
  });

  it('rejects an invalid zid format with 400', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', { githubUsername: 'someone', zid: 'x123' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('normalises uppercase zid to lowercase (Z5312847 → z5312847)', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', { githubUsername: 'capsuser', zid: 'Z5312847' });
    expect(res.statusCode).toBe(201);
    // Fix 1 stripped zid from responses — check the DB row instead.
    const stored = await prisma.member.findUnique({ where: { githubUsername: 'capsuser' } });
    expect(stored.zid).toBe('z5312847');
  });

  it('trims surrounding whitespace on the zid', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', { githubUsername: 'padded', zid: '  z5312848  ' });
    expect(res.statusCode).toBe(201);
    const stored = await prisma.member.findUnique({ where: { githubUsername: 'padded' } });
    expect(stored.zid).toBe('z5312848');
  });

  it('rejects a duplicate zid (different username) with 409', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    await makeMember({ githubUsername: 'original', zid: 'z9000002' });
    const res = await join('open', { githubUsername: 'different', zid: 'z9000002' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate GitHub username (different zid) with 409', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    await makeMember({ githubUsername: 'taken', zid: 'z9000003' });
    const res = await join('open', { githubUsername: 'taken', zid: 'z9000099' });
    expect(res.statusCode).toBe(409);
  });

  it('returns 422 when the GitHub user does not exist', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', { githubUsername: 'ghostuser', zid: 'z9000004' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: { code: 'UNPROCESSABLE_ENTITY', message: 'GitHub user not found' },
    });
  });

  it('returns 403 when the cohort is not active', async () => {
    await makeCohort({ slug: 'closed', isActive: false });
    const res = await join('closed', { githubUsername: 'eager', zid: 'z9000010' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when the cohort has already ended', async () => {
    await makeCohort({ slug: 'ended', isActive: true, endDate: new Date('2020-01-01T00:00:00Z') });
    const res = await join('ended', { githubUsername: 'latecomer', zid: 'z9000012' });
    expect(res.statusCode).toBe(403);
  });

  it('404s when joining an unknown cohort', async () => {
    const res = await join('does-not-exist', { githubUsername: 'x', zid: 'z9000011' });
    expect(res.statusCode).toBe(404);
  });

  it('reuses the Member when a returning member joins a NEW cohort, keeping old titles', async () => {
    const cohortA = await makeCohort({ slug: 'a-cohort', isActive: true });
    const first = await join('a-cohort', { githubUsername: 'returning', zid: 'z9000005' });
    expect(first.statusCode).toBe(201);
    const memberId = (await prisma.member.findUnique({ where: { githubUsername: 'returning' } }))
      .id;

    // Give them a record in cohort A.
    await prisma.statSnapshot.create({
      data: {
        memberId,
        cohortId: cohortA.id,
        totalCommits: 300,
        totalContributions: 320,
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
      },
    });
    await evaluateCohort({ prisma, cohortId: cohortA.id });

    // Same identity joins a new cohort.
    await makeCohort({ slug: 'b-cohort', isActive: true });
    const second = await join('b-cohort', { githubUsername: 'returning', zid: 'z9000005' });
    expect(second.statusCode).toBe(201);

    // Still exactly one member row.
    expect(await prisma.member.count()).toBe(1);

    const body = second.json();
    // Program A + Program B + auto-added global.
    expect(body.cohorts.map((c) => c.cohort.slug).sort()).toEqual([
      'a-cohort',
      'b-cohort',
      'global',
    ]);
    // Old title from cohort A is preserved and still active.
    const machine = body.titles.find((t) => t.key === 'most_commits');
    expect(machine).toBeTruthy();
    expect(machine.cohort.slug).toBe('a-cohort');
  });

  it('does not silently re-link a zid to a different username', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    await makeMember({ githubUsername: 'linka', zid: 'z9000007' });
    const res = await join('open', { githubUsername: 'linkb', zid: 'z9000007' });
    expect(res.statusCode).toBe(409);

    // The original member is untouched.
    const original = await prisma.member.findUnique({ where: { zid: 'z9000007' } });
    expect(original.githubUsername).toBe('linka');
    expect(await prisma.member.findUnique({ where: { githubUsername: 'linkb' } })).toBeNull();
  });

  it('auto-adds the joiner to the global cohort in the same transaction', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    const res = await join('open', { githubUsername: 'joiner', zid: 'z9000020' });
    expect(res.statusCode).toBe(201);

    const member = await prisma.member.findUnique({
      where: { githubUsername: 'joiner' },
      include: { memberships: { include: { cohort: true } } },
    });
    const slugs = member.memberships.map((m) => m.cohort.slug).sort();
    expect(slugs).toEqual(['global', 'open']);
    expect(member.memberships.find((m) => m.cohort.slug === 'global').cohort.kind).toBe('GLOBAL');
  });

  it('joining `global` directly creates exactly one membership (no dupe)', async () => {
    const res = await join('global', { githubUsername: 'globalist', zid: 'z9000021' });
    expect(res.statusCode).toBe(201);
    const member = await prisma.member.findUnique({
      where: { githubUsername: 'globalist' },
      include: { memberships: true },
    });
    expect(member.memberships).toHaveLength(1);
  });

  it('joining `global` then a program cohort does not duplicate global membership', async () => {
    const globalRes = await join('global', { githubUsername: 'twicein', zid: 'z9000022' });
    expect(globalRes.statusCode).toBe(201);

    await makeCohort({ slug: 'later-program', isActive: true });
    const programRes = await join('later-program', {
      githubUsername: 'twicein',
      zid: 'z9000022',
    });
    expect(programRes.statusCode).toBe(201);

    const member = await prisma.member.findUnique({
      where: { githubUsername: 'twicein' },
      include: { memberships: { include: { cohort: true } } },
    });
    const slugs = member.memberships.map((m) => m.cohort.slug).sort();
    expect(slugs).toEqual(['global', 'later-program']);
  });

  describe('global cohort — zid is optional', () => {
    it('accepts a global join without a zid and stores zid=NULL', async () => {
      const res = await join('global', { githubUsername: 'nozid' });
      expect(res.statusCode).toBe(201);
      const stored = await prisma.member.findUnique({ where: { githubUsername: 'nozid' } });
      expect(stored.zid).toBeNull();
      expect(res.json().cohorts.map((c) => c.cohort.slug)).toEqual(['global']);
    });

    it('accepts a global join with an empty-string zid (treated as absent)', async () => {
      const res = await join('global', { githubUsername: 'emptyzid', zid: '' });
      expect(res.statusCode).toBe(201);
      const stored = await prisma.member.findUnique({ where: { githubUsername: 'emptyzid' } });
      expect(stored.zid).toBeNull();
    });

    it('allows multiple different members to join global without a zid', async () => {
      const a = await join('global', { githubUsername: 'nozid-a' });
      const b = await join('global', { githubUsername: 'nozid-b' });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      const rows = await prisma.member.findMany({ where: { zid: null } });
      expect(rows.map((r) => r.githubUsername).sort()).toEqual(['nozid-a', 'nozid-b']);
    });

    it('still validates a zid when one is provided', async () => {
      const res = await join('global', { githubUsername: 'bad', zid: 'not-a-zid' });
      expect(res.statusCode).toBe(400);
    });

    it('still enforces the returning-member zid conflict on global', async () => {
      await makeMember({ githubUsername: 'gclash', zid: 'z9000101' });
      const res = await join('global', { githubUsername: 'gclash', zid: 'z9000102' });
      expect(res.statusCode).toBe(409);
    });

    it('a returning member with a zid can rejoin global WITHOUT supplying zid', async () => {
      const first = await join('global', { githubUsername: 'zidholder', zid: 'z9000103' });
      expect(first.statusCode).toBe(201);
      // Second call omits zid — must not mutate the stored zid.
      const second = await join('global', { githubUsername: 'zidholder' });
      // Membership already exists, so this is a conflict — but the point is
      // the stored row is untouched.
      expect([201, 409]).toContain(second.statusCode);
      const stored = await prisma.member.findUnique({ where: { githubUsername: 'zidholder' } });
      expect(stored.zid).toBe('z9000103');
    });
  });

  describe('program cohorts — zid still required', () => {
    it('rejects a program join without a zid with 400', async () => {
      await makeCohort({ slug: 'prog', isActive: true });
      const res = await join('prog', { githubUsername: 'noziduser' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      // Nothing was created.
      expect(await prisma.member.count()).toBe(0);
    });

    it('rejects a program join with empty-string zid with 400', async () => {
      await makeCohort({ slug: 'prog', isActive: true });
      const res = await join('prog', { githubUsername: 'emptier', zid: '' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('zid claim flow — global then program', () => {
    it('claims a zid onto a previously zid-less member', async () => {
      await makeCohort({ slug: 'devsoc-2025', isActive: true });

      // First: user joins global without a zid.
      const g = await join('global', { githubUsername: 'claimer' });
      expect(g.statusCode).toBe(201);
      const before = await prisma.member.findUnique({ where: { githubUsername: 'claimer' } });
      expect(before.zid).toBeNull();

      // Then: same user joins a program cohort with a zid.
      const p = await join('devsoc-2025', {
        githubUsername: 'claimer',
        zid: 'z9000200',
      });
      expect(p.statusCode).toBe(201);

      const after = await prisma.member.findUnique({ where: { githubUsername: 'claimer' } });
      expect(after.id).toBe(before.id); // same member row
      expect(after.zid).toBe('z9000200'); // now with a zid

      // Only one member row exists.
      expect(await prisma.member.count()).toBe(1);
    });

    it('refuses to claim a zid already linked to a different member', async () => {
      await makeCohort({ slug: 'devsoc-2025', isActive: true });
      await makeMember({ githubUsername: 'incumbent', zid: 'z9000201' });

      await join('global', { githubUsername: 'wannabe' });
      const p = await join('devsoc-2025', {
        githubUsername: 'wannabe',
        zid: 'z9000201',
      });
      expect(p.statusCode).toBe(409);

      // The zid-less row is untouched.
      const wannabe = await prisma.member.findUnique({ where: { githubUsername: 'wannabe' } });
      expect(wannabe.zid).toBeNull();
    });

    it('refuses to overwrite an existing non-null zid with a different one', async () => {
      await makeCohort({ slug: 'devsoc-2025', isActive: true });
      await join('devsoc-2025', { githubUsername: 'locked', zid: 'z9000202' });

      const conflict = await join('devsoc-2025', {
        githubUsername: 'locked',
        zid: 'z9000203',
      });
      expect(conflict.statusCode).toBe(409);
      const stored = await prisma.member.findUnique({ where: { githubUsername: 'locked' } });
      expect(stored.zid).toBe('z9000202');
    });

    it('after claiming, joining another cohort with the same zid still works', async () => {
      await makeCohort({ slug: 'a', isActive: true });
      await makeCohort({ slug: 'b', isActive: true });
      await join('global', { githubUsername: 'multi' });
      const r1 = await join('a', { githubUsername: 'multi', zid: 'z9000204' });
      expect(r1.statusCode).toBe(201);
      const r2 = await join('b', { githubUsername: 'multi', zid: 'z9000204' });
      expect(r2.statusCode).toBe(201);
    });
  });
});
