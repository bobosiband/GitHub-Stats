import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { evaluateCohort } from '../../src/services/titles/engine.js';
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
const NOW = new Date('2025-06-01T00:00:00Z');

/** Create a member + membership + one snapshot in a cohort. */
async function addMember(cohortId, { snapshot = {}, member = {} } = {}) {
  const m = await makeMember(member);
  await makeMembership(m.id, cohortId);
  await makeSnapshot(m.id, cohortId, snapshot);
  return m;
}

async function activeAward(key, cohortId) {
  const title = await prisma.title.findUnique({ where: { key } });
  return prisma.titleAward.findFirst({
    where: { titleId: title.id, cohortId, revokedAt: null },
    include: { member: true },
  });
}

beforeEach(resetDb);
afterAll(disconnectDb);

describe('title engine — records', () => {
  it('awards a record to the top member', async () => {
    const cohort = await makeCohort();
    const top = await addMember(cohort.id, { snapshot: { totalCommits: 100 } });
    await addMember(cohort.id, { snapshot: { totalCommits: 50 } });

    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    const award = await activeAward('most_commits', cohort.id);
    expect(award.memberId).toBe(top.id);
    expect(award.value).toEqual({ totalCommits: 100 });
  });

  it('transfers a record when beaten by a strictly greater value', async () => {
    const cohort = await makeCohort();
    const a = await addMember(cohort.id, { snapshot: { totalCommits: 100 } });
    const b = await addMember(cohort.id, { snapshot: { totalCommits: 50 } });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    // B posts a new, higher snapshot.
    await makeSnapshot(b.id, cohort.id, {
      totalCommits: 200,
      capturedAt: new Date('2025-06-02T00:00:00Z'),
    });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: new Date('2025-06-02T01:00:00Z') });

    const award = await activeAward('most_commits', cohort.id);
    expect(award.memberId).toBe(b.id);
    expect(award.value).toEqual({ totalCommits: 200 });

    const title = await prisma.title.findUnique({ where: { key: 'most_commits' } });
    const revoked = await prisma.titleAward.findMany({
      where: { titleId: title.id, memberId: a.id, revokedAt: { not: null } },
    });
    expect(revoked).toHaveLength(1);
  });

  it('keeps the incumbent on a tie (strictly greater required to steal)', async () => {
    const cohort = await makeCohort();
    const a = await addMember(cohort.id, { snapshot: { totalCommits: 100 } });
    const b = await addMember(cohort.id, { snapshot: { totalCommits: 50 } });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });
    expect((await activeAward('most_commits', cohort.id)).memberId).toBe(a.id);

    // B ties A exactly — incumbent should keep it.
    await makeSnapshot(b.id, cohort.id, {
      totalCommits: 100,
      capturedAt: new Date('2025-06-02T00:00:00Z'),
    });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: new Date('2025-06-02T01:00:00Z') });

    expect((await activeAward('most_commits', cohort.id)).memberId).toBe(a.id);
  });

  it('oldest_account uses the minimum account age, not the maximum', async () => {
    const cohort = await makeCohort();
    const ancient = await addMember(cohort.id, {
      member: { accountCreatedAt: new Date('2012-03-01T00:00:00Z') },
      snapshot: { totalCommits: 1 },
    });
    await addMember(cohort.id, {
      member: { accountCreatedAt: new Date('2021-09-01T00:00:00Z') },
      snapshot: { totalCommits: 1 },
    });

    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    const award = await activeAward('oldest_account', cohort.id);
    expect(award.memberId).toBe(ancient.id);
    expect(award.value).toEqual({ accountCreatedAt: '2012-03-01T00:00:00.000Z' });
  });

  it('respects the weekend_warrior qualification gate (min 20 contributions)', async () => {
    const cohort = await makeCohort();
    // Higher ratio but too few contributions → ineligible.
    await addMember(cohort.id, {
      snapshot: { weekendCommitRatio: 0.95, totalContributions: 10 },
    });
    // Lower ratio but qualifies.
    const qualified = await addMember(cohort.id, {
      snapshot: { weekendCommitRatio: 0.5, totalContributions: 40 },
    });

    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    const award = await activeAward('weekend_warrior', cohort.id);
    expect(award.memberId).toBe(qualified.id);
  });

  it('leaves night_owl unawarded when nobody has commit-time data', async () => {
    const cohort = await makeCohort();
    await addMember(cohort.id, { snapshot: { nightCommitRatio: null } });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });
    expect(await activeAward('night_owl', cohort.id)).toBeNull();
  });
});

describe('title engine — badges', () => {
  it('awards a badge at the threshold and never re-awards it', async () => {
    const cohort = await makeCohort();
    const m = await addMember(cohort.id, { snapshot: { totalCommits: 120 } });

    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: new Date('2025-06-05T00:00:00Z') });

    const century = await prisma.title.findUnique({ where: { key: 'century' } });
    const awards = await prisma.titleAward.findMany({
      where: { titleId: century.id, memberId: m.id, cohortId: cohort.id },
    });
    expect(awards).toHaveLength(1);
    expect(awards[0].revokedAt).toBeNull();
    expect(awards[0].value).toEqual({ totalCommits: 120 });
  });

  it('never revokes a badge even if later stats drop below the threshold', async () => {
    const cohort = await makeCohort();
    const m = await addMember(cohort.id, { snapshot: { totalCommits: 120 } });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    // A later, lower snapshot.
    await makeSnapshot(m.id, cohort.id, {
      totalCommits: 5,
      capturedAt: new Date('2025-07-01T00:00:00Z'),
    });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: new Date('2025-07-01T01:00:00Z') });

    const century = await prisma.title.findUnique({ where: { key: 'century' } });
    const active = await prisma.titleAward.findFirst({
      where: { titleId: century.id, memberId: m.id, cohortId: cohort.id, revokedAt: null },
    });
    expect(active).not.toBeNull();
  });

  it('does not award a badge below the threshold', async () => {
    const cohort = await makeCohort();
    await addMember(cohort.id, { snapshot: { totalCommits: 99 } });
    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });

    const century = await prisma.title.findUnique({ where: { key: 'century' } });
    const awards = await prisma.titleAward.findMany({ where: { titleId: century.id } });
    expect(awards).toHaveLength(0);
  });
});

describe('title engine — idempotency', () => {
  it('produces identical DB state when evaluated twice', async () => {
    const cohort = await makeCohort();
    await addMember(cohort.id, {
      member: { accountCreatedAt: new Date('2014-01-01T00:00:00Z') },
      snapshot: {
        totalCommits: 150,
        longestStreak: 8,
        mergedPRs: 3,
        reviewsGiven: 6,
        totalStars: 20,
        totalContributions: 30,
      },
    });
    await addMember(cohort.id, {
      member: { accountCreatedAt: new Date('2019-01-01T00:00:00Z') },
      snapshot: {
        totalCommits: 40,
        longestStreak: 2,
        totalContributions: 25,
        weekendCommitRatio: 0.6,
      },
    });

    await evaluateCohort({ prisma, cohortId: cohort.id, now: NOW });
    const snapshot1 = await prisma.titleAward.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        titleId: true,
        memberId: true,
        revokedAt: true,
        value: true,
        awardedAt: true,
      },
    });

    await evaluateCohort({ prisma, cohortId: cohort.id, now: new Date('2025-06-10T00:00:00Z') });
    const snapshot2 = await prisma.titleAward.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        titleId: true,
        memberId: true,
        revokedAt: true,
        value: true,
        awardedAt: true,
      },
    });

    expect(snapshot2).toEqual(snapshot1);
  });
});
