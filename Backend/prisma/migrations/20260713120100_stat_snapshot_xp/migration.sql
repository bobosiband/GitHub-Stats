-- Denormalise XP onto every StatSnapshot for cheap ORDER BY on the leaderboard.
-- New snapshots get their real XP written by the sync path; existing rows land
-- at 0 and are backfilled via `npm run db:backfill-xp`.
ALTER TABLE "StatSnapshot" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;

-- Serves the default `sort=xp` leaderboard as a single index-order read.
CREATE INDEX "StatSnapshot_cohortId_xp_idx" ON "StatSnapshot"("cohortId", "xp" DESC);
