import { describe, it, expect, vi } from 'vitest';
import { syncWindowForCohort } from '../../src/services/sync.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

describe('syncWindowForCohort', () => {
  it('PROGRAM cohort in-flight → [startDate, now]', () => {
    const cohort = {
      kind: 'PROGRAM',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: null,
      slug: 'trimester-2',
    };
    const { from, to, clamped } = syncWindowForCohort(cohort, NOW);
    expect(from).toEqual(cohort.startDate);
    expect(to).toEqual(NOW);
    expect(clamped).toBeUndefined();
  });

  it('PROGRAM cohort already ended → [startDate, endDate]', () => {
    const cohort = {
      kind: 'PROGRAM',
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: new Date('2025-06-01T00:00:00Z'),
      slug: 'past',
    };
    const { from, to } = syncWindowForCohort(cohort, NOW);
    expect(from).toEqual(cohort.startDate);
    expect(to).toEqual(cohort.endDate);
  });

  it('PROGRAM cohort future endDate is ignored (uses now)', () => {
    const cohort = {
      kind: 'PROGRAM',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-01-01T00:00:00Z'),
      slug: 'future-ends',
    };
    const { to } = syncWindowForCohort(cohort, NOW);
    expect(to).toEqual(NOW);
  });

  it('PROGRAM cohort spanning more than a year clamps to the most recent 365 days and warns', () => {
    const cohort = {
      kind: 'PROGRAM',
      startDate: new Date('2023-01-01T00:00:00Z'), // ~3.5y before NOW
      endDate: null,
      slug: 'long-program',
    };
    const logger = { warn: vi.fn() };
    const { from, to, clamped } = syncWindowForCohort(cohort, NOW, { logger });
    expect(clamped).toBe(true);
    expect(to).toEqual(NOW);
    expect(to.getTime() - from.getTime()).toBe(YEAR);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ cohortSlug: 'long-program' });
  });

  it('GLOBAL cohort → trailing 365 days ending now', () => {
    const cohort = {
      kind: 'GLOBAL',
      startDate: new Date('2020-01-01T00:00:00Z'),
      endDate: null,
      slug: 'global',
    };
    const { from, to } = syncWindowForCohort(cohort, NOW);
    expect(to).toEqual(NOW);
    expect(to.getTime() - from.getTime()).toBe(YEAR);
    // Not clamped — it's the natural GLOBAL window, not a truncation.
    expect(syncWindowForCohort(cohort, NOW).clamped).toBeUndefined();
  });

  it('GLOBAL cohort ignores its startDate/endDate for the query window', () => {
    const cohort = {
      kind: 'GLOBAL',
      startDate: new Date('1970-01-01T00:00:00Z'),
      endDate: new Date('2000-01-01T00:00:00Z'),
      slug: 'global',
    };
    const { from, to } = syncWindowForCohort(cohort, NOW);
    expect(to).toEqual(NOW);
    expect(to.getTime() - from.getTime()).toBe(YEAR);
  });
});
