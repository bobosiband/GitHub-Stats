import cron from 'node-cron';
import { syncAllActive } from '../services/sync.js';
import { evaluateCohort } from '../services/titles/engine.js';
import { broadcast } from '../services/events.js';
import { describeCadence, ticksToSkip } from '../lib/budget.js';

/**
 * Create the sync runner.
 *
 * The runner respects two independent guards:
 *   1. Estimated budget — before each *tick*, we compute the hourly point spend
 *      for the current active-member count at the configured cadence. If it
 *      exceeds `pointsBudget`, we skip the appropriate number of ticks so the
 *      effective rate fits. Warning is logged once per boot.
 *   2. Live remaining budget — if the GitHub client can query `rateLimit`, and
 *      it reports `remaining < minRemaining` at run start, the whole tick
 *      short-circuits into `{ skipped: true, reason: 'rate_limit', … }`.
 *
 * An in-process lock prevents overlapping runs (a slow sync + a fast cron =
 * queue-of-doom otherwise); overlapping calls return `{ skipped: true, reason: 'in_progress' }`.
 *
 * On successful completion the runner emits SSE events:
 *   - `sync.completed`  once, with per-cohort snapshot counts
 *   - `titles.changed`  per cohort whose evaluation changed any award
 *
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {Function} deps.fetchUserStats
 * @param {Function} [deps.fetchRateLimit]   optional GraphQL rate-limit probe
 * @param {object} [deps.logger]
 * @param {number} [deps.delayMs=250]
 * @param {string} [deps.cronExpr]           passed only so the runner can size the budget
 * @param {number} [deps.pointsBudget]       safe hourly points; default 4000
 * @param {number} [deps.minRemaining]       skip run if remaining < this; default 500
 */
export function createSyncRunner({
  prisma,
  fetchUserStats,
  fetchRateLimit,
  logger,
  delayMs = 250,
  cronExpr = '*/5 * * * *',
  pointsBudget = 4000,
  minRemaining = 500,
}) {
  let running = false;
  let tickCounter = 0;
  let cadenceWarned = false;

  async function run() {
    if (running) {
      logger?.info?.('sync already in progress — skipping this tick');
      return { skipped: true, reason: 'in_progress' };
    }
    // Claim the mutex synchronously — the budget/rate-limit checks below both
    // await DB / GraphQL, so a second concurrent call must see `running = true`
    // even during those preflight steps. On any early-return path we release
    // it before returning; the try/finally below handles the syncAll path.
    running = true;

    try {
      // Estimated-budget guard. `activeMemberCount` costs one small COUNT query;
      // cheap enough to run every tick.
      const activeMemberCount = await countActiveMembers(prisma);
      const cadence = describeCadence(activeMemberCount, pointsBudget, cronExpr);
      if (cadence.skip > 0 && !cadenceWarned) {
        logger?.warn?.(
          {
            activeMemberCount,
            cronExpr,
            pointsBudget,
            rawPointsPerHour: cadence.runsPerHour * activeMemberCount * 5,
            effectiveRunsPerHour: cadence.effectiveRunsPerHour,
            skipsPerRealRun: cadence.skip,
          },
          'sync cadence stretched to fit the GraphQL point budget',
        );
        cadenceWarned = true;
      }
      if (cadence.skip > 0 && tickCounter % (cadence.skip + 1) !== 0) {
        tickCounter += 1;
        running = false;
        return { skipped: true, reason: 'budget', tick: tickCounter, skipsPerRealRun: cadence.skip };
      }
      tickCounter += 1;

      // Live rate-limit guard. If the probe is missing or errors, we fall back
      // to the estimated budget above.
      if (fetchRateLimit) {
        const rl = await fetchRateLimit();
        if (rl && typeof rl.remaining === 'number' && rl.remaining < minRemaining) {
          logger?.warn?.(
            { remaining: rl.remaining, resetAt: rl.resetAt, minRemaining },
            'GitHub rate limit low — skipping this sync tick',
          );
          running = false;
          return {
            skipped: true,
            reason: 'rate_limit',
            remaining: rl.remaining,
            resetAt: rl.resetAt,
          };
        }
      }
    } catch (err) {
      // A DB error during preflight shouldn't leave the lock stuck.
      running = false;
      throw err;
    }

    const startedAt = new Date();
    try {
      const summaries = await syncAllActive({ prisma, fetchUserStats, logger, delayMs });
      const titleResults = [];
      for (const summary of summaries) {
        const result = await evaluateCohort({ prisma, cohortId: summary.cohortId });
        titleResults.push({ cohortSlug: summary.cohortSlug, result });
      }
      const finishedAt = new Date();
      logger?.info?.(
        { cohorts: summaries.length, ms: finishedAt - startedAt },
        'scheduled sync + evaluation complete',
      );

      // SSE — one high-level completion event + per-cohort title events for any
      // cohort whose evaluation moved awards.
      broadcast('sync.completed', {
        cohorts: summaries.map((s) => ({
          slug: s.cohortSlug,
          snapshotsCreated: s.snapshotsCreated,
        })),
        finishedAt: finishedAt.toISOString(),
      });
      for (const t of titleResults) {
        const changes = t.result?.awardsChanged ?? 0;
        if (changes > 0) {
          broadcast('titles.changed', { slug: t.cohortSlug, changes });
        }
      }

      return { skipped: false, startedAt, finishedAt, summaries };
    } catch (err) {
      logger?.error?.({ err }, 'scheduled sync failed');
      throw err;
    } finally {
      running = false;
    }
  }

  return {
    run,
    isRunning: () => running,
    // Test hook so we can reset the tick counter between cases.
    _resetTickCounterForTests: () => { tickCounter = 0; cadenceWarned = false; },
  };
}

/**
 * Count members who are on at least one active cohort. Used to size the budget.
 * Distinct because the same member is usually on `global` + a program cohort.
 */
async function countActiveMembers(prisma) {
  const rows = await prisma.membership.findMany({
    where: { cohort: { isActive: true } },
    select: { memberId: true },
    distinct: ['memberId'],
  });
  return rows.length;
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

// Re-export for tests + the wrap-up summary so callers don't have to reach
// into src/lib/budget.js directly if they only care about the cadence math.
export { describeCadence, ticksToSkip };
