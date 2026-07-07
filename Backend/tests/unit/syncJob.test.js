import { describe, it, expect } from 'vitest';
import { createSyncRunner } from '../../src/jobs/syncJob.js';

describe('createSyncRunner in-process lock', () => {
  it('skips a run while another is in progress', async () => {
    let release;
    const gate = new Promise((r) => (release = r));

    // syncAllActive calls prisma.cohort.findMany first; block it on the gate.
    const prisma = {
      cohort: {
        findMany: async () => {
          await gate;
          return [];
        },
      },
    };
    const runner = createSyncRunner({
      prisma,
      fetchUserStats: async () => ({}),
      logger: {},
      delayMs: 0,
    });

    const first = runner.run(); // starts, blocks on the gate → running = true
    const second = await runner.run(); // sees the lock
    expect(second).toEqual({ skipped: true });
    expect(runner.isRunning()).toBe(true);

    release();
    const firstResult = await first;
    expect(firstResult.skipped).toBe(false);
    expect(firstResult.summaries).toEqual([]);
    expect(runner.isRunning()).toBe(false);
  });

  it('runs again after the previous run finished', async () => {
    const prisma = { cohort: { findMany: async () => [] } };
    const runner = createSyncRunner({
      prisma,
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
