import cron from 'node-cron';
import { syncAllActive } from '../services/sync.js';
import { evaluateCohort } from '../services/titles/engine.js';

/**
 * Create the sync runner: fetch all active cohorts, then evaluate titles for each.
 * A simple in-process lock makes overlapping runs no-op (returns `{ skipped: true }`).
 *
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {Function} deps.fetchUserStats
 * @param {object} [deps.logger]
 * @param {number} [deps.delayMs]
 */
export function createSyncRunner({ prisma, fetchUserStats, logger, delayMs = 250 }) {
  let running = false;

  async function run() {
    if (running) {
      logger?.info?.('sync already in progress — skipping this tick');
      return { skipped: true };
    }
    running = true;
    const startedAt = new Date();
    try {
      const summaries = await syncAllActive({ prisma, fetchUserStats, logger, delayMs });
      for (const summary of summaries) {
        await evaluateCohort({ prisma, cohortId: summary.cohortId });
      }
      const finishedAt = new Date();
      logger?.info?.(
        { cohorts: summaries.length, ms: finishedAt - startedAt },
        'scheduled sync + evaluation complete',
      );
      return { skipped: false, startedAt, finishedAt, summaries };
    } catch (err) {
      logger?.error?.({ err }, 'scheduled sync failed');
      throw err;
    } finally {
      running = false;
    }
  }

  return { run, isRunning: () => running };
}

/**
 * Schedule the sync runner with node-cron. Takes an existing runner so the same
 * in-process lock is shared between the scheduler and the admin endpoint.
 *
 * @param {object} params
 * @param {ReturnType<typeof createSyncRunner>} params.runner
 * @param {string} params.cronExpr
 * @param {object} [params.logger]
 */
export function registerSyncJob({ runner, cronExpr, logger }) {
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid SYNC_CRON expression: "${cronExpr}"`);
  }
  const task = cron.schedule(cronExpr, () => {
    runner.run().catch((err) => logger?.error?.({ err }, 'sync tick error'));
  });
  return { runner, task };
}
