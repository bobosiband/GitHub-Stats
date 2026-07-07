import { RECORD_RULES } from './records.js';
import { BADGE_RULES } from './badges.js';

export { RECORD_RULES, BADGE_RULES };

/** All title definitions with a `kind` tag, in one list (used to seed the Title table). */
export const ALL_TITLE_DEFS = [
  ...RECORD_RULES.map((r) => ({ ...r, kind: 'RECORD' })),
  ...BADGE_RULES.map((b) => ({ ...b, kind: 'BADGE' })),
];

/** Deterministic, key-sorted stringify so value comparisons ignore key ordering. */
function stableStringify(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Upsert every title definition into the Title table. Idempotent — safe to call
 * on every boot / evaluation.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function ensureTitles(prisma) {
  for (const def of ALL_TITLE_DEFS) {
    await prisma.title.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        kind: def.kind,
        flavor: def.flavor ?? null,
      },
      update: {
        name: def.name,
        description: def.description,
        kind: def.kind,
        flavor: def.flavor ?? null,
      },
    });
  }
}

/** Build Map<memberId, { snapshot, member }> from the latest snapshot per member. */
async function loadLatestSnapshots(prisma, cohortId) {
  const snaps = await prisma.statSnapshot.findMany({
    where: { cohortId },
    orderBy: { capturedAt: 'desc' },
    include: { member: true },
  });
  const latest = new Map();
  for (const s of snaps) {
    if (!latest.has(s.memberId)) latest.set(s.memberId, { snapshot: s, member: s.member });
  }
  return latest;
}

/** Evaluate a single RECORD rule inside a transaction. */
async function evaluateRecord(tx, { title, rule, cohortId, latest, now }) {
  const higher = rule.higherIsBetter !== false;

  const candidates = [];
  for (const { snapshot, member } of latest.values()) {
    if (rule.qualifies && !rule.qualifies(snapshot, member)) continue;
    const metric = rule.getValue(snapshot, member);
    if (metric == null || Number.isNaN(metric)) continue;
    candidates.push({ memberId: member.id, member, snapshot, metric });
  }

  const current = await tx.titleAward.findFirst({
    where: { titleId: title.id, cohortId, revokedAt: null },
  });

  if (candidates.length === 0) {
    if (current)
      await tx.titleAward.update({ where: { id: current.id }, data: { revokedAt: now } });
    return;
  }

  const bestMetric = candidates.reduce(
    (best, c) => (higher ? Math.max(best, c.metric) : Math.min(best, c.metric)),
    candidates[0].metric,
  );
  const tied = candidates.filter((c) => c.metric === bestMetric);

  // Ties keep the incumbent; otherwise pick the lowest memberId for determinism.
  let winner;
  if (current && tied.some((c) => c.memberId === current.memberId)) {
    winner = tied.find((c) => c.memberId === current.memberId);
  } else {
    winner = [...tied].sort((a, b) => (a.memberId < b.memberId ? -1 : 1))[0];
  }

  const value = rule.toValue
    ? rule.toValue(winner.snapshot, winner.member, winner.metric)
    : { [rule.stat]: winner.metric };

  if (!current) {
    await tx.titleAward.create({
      data: { titleId: title.id, memberId: winner.memberId, cohortId, value, awardedAt: now },
    });
  } else if (current.memberId === winner.memberId) {
    // Holder unchanged — refresh the stored value only if it actually changed.
    if (stableStringify(current.value) !== stableStringify(value)) {
      await tx.titleAward.update({ where: { id: current.id }, data: { value } });
    }
  } else {
    // Strictly-better challenger (or the incumbent became ineligible): transfer.
    await tx.titleAward.update({ where: { id: current.id }, data: { revokedAt: now } });
    await tx.titleAward.create({
      data: { titleId: title.id, memberId: winner.memberId, cohortId, value, awardedAt: now },
    });
  }
}

/** Evaluate a single BADGE rule inside a transaction. Badges are additive & permanent. */
async function evaluateBadge(tx, { title, rule, cohortId, latest, now }) {
  for (const { snapshot, member } of latest.values()) {
    if (!rule.qualifies(snapshot, member)) continue;
    const existing = await tx.titleAward.findFirst({
      where: { titleId: title.id, memberId: member.id, cohortId, revokedAt: null },
    });
    if (existing) continue;
    const value = rule.toValue
      ? rule.toValue(snapshot, member)
      : { [rule.stat]: snapshot[rule.stat] };
    await tx.titleAward.create({
      data: { titleId: title.id, memberId: member.id, cohortId, value, awardedAt: now },
    });
  }
}

/**
 * Evaluate every record and badge for a cohort against the latest snapshots.
 * Idempotent: running twice with the same data produces identical DB state.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.cohortId
 * @param {Date} [params.now]
 * @returns {Promise<{records: number, badges: number, members: number}>}
 */
export async function evaluateCohort({ prisma, cohortId, now = new Date() }) {
  await ensureTitles(prisma);

  const titles = await prisma.title.findMany();
  const titleByKey = new Map(titles.map((t) => [t.key, t]));
  const latest = await loadLatestSnapshots(prisma, cohortId);

  await prisma.$transaction(async (tx) => {
    for (const rule of RECORD_RULES) {
      const title = titleByKey.get(rule.key);
      if (title) await evaluateRecord(tx, { title, rule, cohortId, latest, now });
    }
    for (const rule of BADGE_RULES) {
      const title = titleByKey.get(rule.key);
      if (title) await evaluateBadge(tx, { title, rule, cohortId, latest, now });
    }
  });

  return { records: RECORD_RULES.length, badges: BADGE_RULES.length, members: latest.size };
}
