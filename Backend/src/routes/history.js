import { z } from 'zod';
import {
  getCohortBySlugOrThrow,
  getMemberByUsernameOrThrow,
  publicMember,
  serializeCohort,
} from '../services/views.js';

/**
 * Read-only member history endpoints. Public, unauthenticated — same footing
 * as GET /members/:username. Two shapes:
 *
 *   GET /members/:username/history?cohort=<slug>&days=<n>
 *       Slim time-series (no calendar/topLanguages) for charting progress.
 *
 *   GET /members/:username/calendar?cohort=<slug>
 *       The daily contribution calendar from the latest snapshot for that
 *       (member, cohort) — the shape that feeds a GitHub-style heatmap.
 */

const historyQuerySchema = z.object({
  cohort: z.string().min(1, 'cohort slug is required'),
  days: z.coerce.number().int().min(1).max(365).default(90),
});

const calendarQuerySchema = z.object({
  cohort: z.string().min(1, 'cohort slug is required'),
});

/** Cast an unknown DB value to `[{date, count}]`, dropping malformed entries. */
function normalizeCalendar(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && typeof entry.date === 'string') {
      const count = Number(entry.count);
      out.push({ date: entry.date, count: Number.isFinite(count) ? count : 0 });
    }
  }
  return out;
}

/**
 * Keep only one snapshot per UTC calendar day — the last one captured that
 * day. Assumes input is oldest-first.
 * @param {Array<{capturedAt: Date|string}>} rows
 */
function downsamplePerDay(rows) {
  /** @type {Map<string, any>} */
  const byDay = new Map();
  for (const r of rows) {
    const d = r.capturedAt instanceof Date ? r.capturedAt : new Date(r.capturedAt);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, r); // overwrites → last-of-day wins
  }
  return [...byDay.values()];
}

export default async function historyRoutes(fastify) {
  const { prisma } = fastify;

  // GET /members/:username/history?cohort=<slug>&days=<n>
  fastify.get('/:username/history', async (request) => {
    const { cohort: cohortSlug, days } = historyQuerySchema.parse(request.query ?? {});
    const [member, cohort] = await Promise.all([
      getMemberByUsernameOrThrow(prisma, request.params.username),
      getCohortBySlugOrThrow(prisma, cohortSlug),
    ]);

    const gte = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await prisma.statSnapshot.findMany({
      where: { memberId: member.id, cohortId: cohort.id, capturedAt: { gte } },
      orderBy: { capturedAt: 'asc' },
      select: {
        capturedAt: true,
        xp: true,
        totalCommits: true,
        totalContributions: true,
        mergedPRs: true,
        totalStars: true,
        longestStreak: true,
        currentStreak: true,
        followers: true,
      },
    });

    return {
      member: publicMember(member),
      cohort: serializeCohort(cohort),
      history: downsamplePerDay(rows),
    };
  });

  // GET /members/:username/calendar?cohort=<slug>
  fastify.get('/:username/calendar', async (request) => {
    const { cohort: cohortSlug } = calendarQuerySchema.parse(request.query ?? {});
    const [member, cohort] = await Promise.all([
      getMemberByUsernameOrThrow(prisma, request.params.username),
      getCohortBySlugOrThrow(prisma, cohortSlug),
    ]);

    const latest = await prisma.statSnapshot.findFirst({
      where: { memberId: member.id, cohortId: cohort.id },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true, calendar: true },
    });

    return {
      member: publicMember(member),
      cohort: serializeCohort(cohort),
      capturedAt: latest?.capturedAt ?? null,
      calendar: latest ? normalizeCalendar(latest.calendar) : [],
    };
  });
}
