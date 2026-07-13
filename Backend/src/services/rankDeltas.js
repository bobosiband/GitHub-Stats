/**
 * Rank movement deltas per cohort.
 *
 * Snapshots are append-only, so "the previous ranking" is well-defined: it's
 * the ranking derived from each member's *previous* snapshot (the one right
 * before the latest, per member). Members with no previous snapshot get
 * `rankDelta: null` — they were unranked, we can't score a movement.
 *
 * All the math is done in JS on a small pre-projected result set so the DB
 * only has to ship (memberId, capturedAt, statField) rows. For today's cohort
 * sizes this stays comfortably under the leaderboard latency budget.
 */

/** Names of snapshot columns we're willing to rank by. Keep in sync with
 *  LEADERBOARD_SORTS in `views.js`. */
const RANKABLE_FIELDS = new Set([
  'xp',
  'totalCommits',
  'totalContributions',
  'longestStreak',
  'totalStars',
]);

/**
 * For a given cohort + sort field, build a Map<memberId, rankDelta>.
 * rankDelta > 0 means the member climbed (was ranked lower before), < 0 means
 * they fell, 0 means unchanged, and null means unrankable (no previous snapshot).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} cohortId
 * @param {string} field  snapshot column, e.g. "xp"
 * @param {Map<string, number>} currentRankById
 * @returns {Promise<Map<string, number|null>>}
 */
export async function buildRankDeltas(prisma, cohortId, field, currentRankById) {
  if (!RANKABLE_FIELDS.has(field)) return new Map();

  // Pull the two most-recent snapshots per member, projecting only what we
  // need. DISTINCT ON + ORDER BY on the (cohortId, memberId, capturedAt DESC)
  // index would give us just the latest — we want the *second*-latest too, so
  // use a windowed row_number.
  //
  // We can't parameterise a column name safely in raw SQL, so field is
  // whitelisted above and interpolated as an identifier via $queryRawUnsafe.
  // The whitelist makes this SQL-injection-safe.
  const sql = `
    SELECT "memberId", "capturedAt", "${field}" AS "value", rn
    FROM (
      SELECT
        "memberId",
        "capturedAt",
        "${field}",
        row_number() OVER (PARTITION BY "memberId" ORDER BY "capturedAt" DESC) AS rn
      FROM "StatSnapshot"
      WHERE "cohortId" = $1
    ) s
    WHERE rn <= 2
  `;
  const rows = await prisma.$queryRawUnsafe(sql, cohortId);

  const perMember = new Map();
  for (const r of rows) {
    if (!perMember.has(r.memberId)) perMember.set(r.memberId, {});
    const bucket = perMember.get(r.memberId);
    if (Number(r.rn) === 1) bucket.latestValue = r.value;
    else if (Number(r.rn) === 2) bucket.previousValue = r.value;
  }

  // Only members with a previous snapshot are candidates for a previous
  // ranking. Sort them by that previous value in the same order the
  // leaderboard uses now (desc), and use array index as the previous rank.
  const previousParticipants = [];
  for (const [memberId, bucket] of perMember) {
    if (bucket.previousValue == null) continue;
    previousParticipants.push({ memberId, value: Number(bucket.previousValue) });
  }
  previousParticipants.sort((a, b) => b.value - a.value);

  const previousRankById = new Map();
  previousParticipants.forEach((p, i) => previousRankById.set(p.memberId, i + 1));

  const deltas = new Map();
  for (const [memberId, rank] of currentRankById) {
    if (!previousRankById.has(memberId)) {
      deltas.set(memberId, null);
      continue;
    }
    // rank went from 5 to 3 → delta = +2 (climbed).
    deltas.set(memberId, previousRankById.get(memberId) - rank);
  }
  return deltas;
}
