#!/usr/bin/env node
/**
 * One-off XP backfill.
 *
 * Recomputes `xp` for every StatSnapshot from the same columns the sync path
 * reads. Idempotent — running it twice produces the same values. Rows land in
 * batches so the tx never balloons; a stray malformed row is logged and skipped
 * so one bad snapshot can't halt the whole backfill.
 *
 *   npm run db:backfill-xp
 */
import { PrismaClient } from '@prisma/client';
import { computeXp } from '../src/services/xp.js';

const BATCH = 500;

async function main() {
  const prisma = new PrismaClient();
  let updated = 0;
  let skipped = 0;
  let cursor = null;

  console.log(`Backfilling xp on StatSnapshot in batches of ${BATCH}…`);

  for (;;) {
    /** @type {any[]} */
    const rows = await prisma.statSnapshot.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) break;

    for (const r of rows) {
      try {
        const xp = computeXp({
          totalCommits: r.totalCommits,
          totalPRs: r.totalPRs,
          mergedPRs: r.mergedPRs,
          reviewsGiven: r.reviewsGiven,
          issuesOpened: r.issuesOpened,
          totalStars: r.totalStars,
          followers: r.followers,
          contributedRepoCount: r.contributedRepoCount,
          languageCount: r.languageCount,
          currentStreak: r.currentStreak,
          topLanguages: r.topLanguages ?? [],
        });
        if (xp !== r.xp) {
          await prisma.statSnapshot.update({ where: { id: r.id }, data: { xp } });
          updated++;
        }
      } catch (err) {
        skipped++;
        console.warn(`skipped snapshot ${r.id}: ${err.message}`);
      }
    }

    cursor = rows[rows.length - 1].id;
    console.log(`… ${updated} updated, ${skipped} skipped so far`);
  }

  await prisma.$disconnect();
  console.log(`Done. ${updated} snapshot rows updated, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
