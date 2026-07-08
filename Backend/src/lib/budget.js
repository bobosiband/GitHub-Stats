/**
 * Pure helpers for the sync runner's GraphQL-budget guard. Kept dependency-free
 * and side-effect-free so they can be unit-tested without the DB or the client.
 *
 * The budget assumption: every member costs ~5 GraphQL points per sync (one
 * USER_STATS + up to a handful of REPO_COMMITS pages). We estimate the worst
 * case hourly draw and, if it exceeds our safety budget (default 4000, well
 * under GitHub's 5000-point limit), tell the runner to skip N-1 out of every
 * N ticks so the effective cadence fits.
 */

/** Points assumed per member per sync. Conservative — real usage is often less. */
export const POINTS_PER_MEMBER = 5;

/**
 * How many times an hour a node-cron expression fires. We only need to handle
 * the shapes SYNC_CRON is actually written in:
 *   - `*` (every minute → 60)
 *   - the `star-slash-N` step form on the minute field, e.g. every 5 minutes → 12
 *   - everything else — assumed hourly-or-slower → 1
 * Pure — safe to test in isolation.
 *
 * @param {string} cronExpr
 * @returns {number}
 */
export function estimateRunsPerHour(cronExpr) {
  if (typeof cronExpr !== 'string') return 1;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return 1;
  const [minute] = parts;
  if (minute === '*') return 60;
  const stepMatch = /^\*\/(\d+)$/.exec(minute);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (Number.isFinite(step) && step > 0) return Math.max(1, Math.floor(60 / step));
  }
  // Anything more complex (comma lists, hour-restricted expressions) — assume
  // at most one run per hour. Under-counting means we might occasionally NOT
  // skip when we could; over-counting would be dangerous, this way is safe.
  return 1;
}

/**
 * Estimated hourly point spend for a full sync of `memberCount` members at
 * the given cadence. Rounded up so we skip early rather than late.
 *
 * @param {number} memberCount
 * @param {string} cronExpr
 * @returns {number}
 */
export function estimateHourlyPoints(memberCount, cronExpr) {
  const runs = estimateRunsPerHour(cronExpr);
  return Math.ceil(Math.max(0, memberCount) * POINTS_PER_MEMBER * runs);
}

/**
 * How many consecutive ticks the runner should skip between actual runs so
 * `points/hour ≤ budget`. Returns 0 when the raw cadence already fits, or
 * `k` such that we run 1 tick, skip `k`, run 1 tick, skip `k`, …
 *
 * @param {number} memberCount
 * @param {number} budget       Safe hourly point budget (must be > 0)
 * @param {string} cronExpr
 * @returns {number}
 */
export function ticksToSkip(memberCount, budget, cronExpr) {
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  const raw = estimateHourlyPoints(memberCount, cronExpr);
  if (raw <= budget) return 0;
  // Ratio of over-consumption tells us how much to stretch. If we spend 3× the
  // budget, we need to run 1 in 3 ticks → skip 2.
  const ratio = raw / budget;
  return Math.max(0, Math.ceil(ratio) - 1);
}

/**
 * Convenience: describe the safe effective cadence for a (memberCount, budget,
 * cronExpr) triple. Used by the CLI-style startup log and the wrap-up summary.
 *
 * @returns {{ runsPerHour: number, skip: number, effectiveRunsPerHour: number, estimatedPointsPerHour: number }}
 */
export function describeCadence(memberCount, budget, cronExpr) {
  const runsPerHour = estimateRunsPerHour(cronExpr);
  const skip = ticksToSkip(memberCount, budget, cronExpr);
  const effectiveRunsPerHour = Math.max(1, Math.floor(runsPerHour / (skip + 1)));
  return {
    runsPerHour,
    skip,
    effectiveRunsPerHour,
    estimatedPointsPerHour: effectiveRunsPerHour * memberCount * POINTS_PER_MEMBER,
  };
}
