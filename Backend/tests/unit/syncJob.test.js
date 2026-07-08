import { afterEach, describe, it, expect } from 'vitest';
import { createSyncRunner } from '../../src/jobs/syncJob.js';
import { reset as resetEvents } from '../../src/services/events.js';

afterEach(() => resetEvents());

/**
 * Build a minimal Prisma stub for the runner:
 * - `membership.findMany` powers `countActiveMembers`
 * - `cohort.findMany` powers `syncAllActive`; you can gate it to simulate an
 *   in-progress run.
 */
function stubPrisma({ activeMembers = 0, cohortFindMany } = {}) {
  return {
    membership: {
      findMany: async () => Array.from({ length: activeMembers }, (_, i) => ({ memberId: `m${i}` })),
    },
    cohort: { findMany: cohortFindMany ?? (async () => []) },
  };
}

describe('createSyncRunner in-process lock', () => {
  it('skips a run while another is in progress', async () => {
    let release;
    const gate = new Promise((r) => (release = r));

    const prisma = stubPrisma({
      cohortFindMany: async () => {
        await gate;
        return [];
      },
    });
    const runner = createSyncRunner({
      prisma,
      fetchUserStats: async () => ({}),
      logger: {},
      delayMs: 0,
    });

    const first = runner.run(); // starts, blocks on the gate → running = true
    await new Promise((r) => setImmediate(r));
    const second = await runner.run(); // sees the lock
    expect(second).toMatchObject({ skipped: true, reason: 'in_progress' });
    expect(runner.isRunning()).toBe(true);

    release();
    const firstResult = await first;
    expect(firstResult.skipped).toBe(false);
    expect(firstResult.summaries).toEqual([]);
    expect(runner.isRunning()).toBe(false);
  });

  it('runs again after the previous run finished', async () => {
    const runner = createSyncRunner({
      prisma: stubPrisma(),
      fetchUserStats: async () => ({}),
      logger: {},
      delayMs: 0,
    });
    const a = await runner.run();
    const b = await runner.run();
    expect(a.skipped).toBe(false);
    expect(b.skipped).toBe(false);
  });
});

describe('createSyncRunner budget guard', () => {
  it('skips ticks when the estimated cadence would overrun the point budget', async () => {
    const runner = createSyncRunner({
      prisma: stubPrisma({ activeMembers: 200 }),
      fetchUserStats: async () => ({}),
      logger: {},
      delayMs: 0,
      cronExpr: '*/5 * * * *',
      pointsBudget: 4000,
    });
    // 200 × 5 × 12 = 12000 → skip = 2 → 1 real run in every 3 ticks.
    const a = await runner.run(); // real
    const b = await runner.run(); // skipped (budget)
    const c = await runner.run(); // skipped (budget)
    const d = await runner.run(); // real
    expect(a.skipped).toBe(false);
    expect(b).toMatchObject({ skipped: true, reason: 'budget' });
    expect(c).toMatchObject({ skipped: true, reason: 'budget' });
    expect(d.skipped).toBe(false);
  });

  it('does NOT skip when member count is small enough', async () => {
    const runner = createSyncRunner({
      prisma: stubPrisma({ activeMembers: 25 }),
      fetchUserStats: async () => ({}),
      logger: {},
      delayMs: 0,
      cronExpr: '*/5 * * * *',
      pointsBudget: 4000,
    });
    for (let i = 0; i < 3; i++) {
      const r = await runner.run();
      expect(r.skipped).toBe(false);
    }
  });
});

describe('createSyncRunner live rate-limit guard', () => {
  it('skips a run when the fetched remaining budget is below the floor', async () => {
    const runner = createSyncRunner({
      prisma: stubPrisma({ activeMembers: 5 }),
      fetchUserStats: async () => ({}),
      fetchRateLimit: async () => ({ remaining: 100, resetAt: new Date('2027-01-01') }),
      logger: {},
      delayMs: 0,
      minRemaining: 500,
    });
    const r = await runner.run();
    expect(r).toMatchObject({ skipped: true, reason: 'rate_limit', remaining: 100 });
  });

  it('runs normally when remaining is above the floor', async () => {
    const runner = createSyncRunner({
      prisma: stubPrisma({ activeMembers: 5 }),
      fetchUserStats: async () => ({}),
      fetchRateLimit: async () => ({ remaining: 4900, resetAt: null }),
      logger: {},
      delayMs: 0,
      minRemaining: 500,
    });
    const r = await runner.run();
    expect(r.skipped).toBe(false);
  });

  it('falls back to the estimated guard if the rate-limit probe returns null', async () => {
    const runner = createSyncRunner({
      prisma: stubPrisma({ activeMembers: 5 }),
      fetchUserStats: async () => ({}),
      fetchRateLimit: async () => null, // simulates a probe failure
      logger: {},
      delayMs: 0,
      minRemaining: 500,
    });
    const r = await runner.run();
    expect(r.skipped).toBe(false);
  });
});
