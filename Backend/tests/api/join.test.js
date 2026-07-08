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
      zid: 'z9000001',
      displayName: 'The newbie',
      avatarUrl: 'https://avatar/newbie',
    });
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
});
