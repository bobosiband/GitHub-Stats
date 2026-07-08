import { describe, it, expect } from 'vitest';
import {
  describeCadence,
  estimateHourlyPoints,
  estimateRunsPerHour,
  POINTS_PER_MEMBER,
  ticksToSkip,
} from '../../src/lib/budget.js';

describe('estimateRunsPerHour', () => {
  it('parses common shapes and returns a safe fallback for anything unusual', () => {
    expect(estimateRunsPerHour('* * * * *')).toBe(60);
    expect(estimateRunsPerHour('*/5 * * * *')).toBe(12);
    expect(estimateRunsPerHour('*/15 * * * *')).toBe(4);
    expect(estimateRunsPerHour('*/30 * * * *')).toBe(2);
    expect(estimateRunsPerHour('0 * * * *')).toBe(1);
    expect(estimateRunsPerHour('0 */3 * * *')).toBe(1);
    expect(estimateRunsPerHour('bogus')).toBe(1);
    expect(estimateRunsPerHour('')).toBe(1);
    expect(estimateRunsPerHour(null)).toBe(1);
  });
});

describe('estimateHourlyPoints', () => {
  it('multiplies member count × POINTS_PER_MEMBER × runs/hour', () => {
    expect(estimateHourlyPoints(50, '*/5 * * * *')).toBe(50 * POINTS_PER_MEMBER * 12);
    expect(estimateHourlyPoints(0, '*/5 * * * *')).toBe(0);
    expect(estimateHourlyPoints(-3, '*/5 * * * *')).toBe(0); // negative floor
  });
});

describe('ticksToSkip', () => {
  it('returns 0 when the raw cadence fits inside the budget', () => {
    // 25 members × 5 pts × 12 runs = 1500, well under 4000
    expect(ticksToSkip(25, 4000, '*/5 * * * *')).toBe(0);
  });

  it('stretches the interval when the raw cadence overflows', () => {
    // 200 members × 5 × 12 = 12000, budget 4000 → ratio 3 → skip 2 (1 run in 3)
    expect(ticksToSkip(200, 4000, '*/5 * * * *')).toBe(2);
  });

  it('handles borderline: raw exactly equals budget → no skip', () => {
    // 66 × 5 × 12 = 3960 < 4000 → 0
    expect(ticksToSkip(66, 4000, '*/5 * * * *')).toBe(0);
    // 67 × 5 × 12 = 4020 > 4000 → skip 1 (1 in 2)
    expect(ticksToSkip(67, 4000, '*/5 * * * *')).toBe(1);
  });

  it('returns 0 for an invalid or zero budget rather than crashing the runner', () => {
    expect(ticksToSkip(500, 0, '*/5 * * * *')).toBe(0);
    expect(ticksToSkip(500, -1, '*/5 * * * *')).toBe(0);
  });
});

describe('describeCadence — printable summary', () => {
  it('reports the effective runs-per-hour after skipping', () => {
    const at50 = describeCadence(50, 4000, '*/5 * * * *');
    expect(at50).toMatchObject({ runsPerHour: 12, skip: 0, effectiveRunsPerHour: 12 });

    const at200 = describeCadence(200, 4000, '*/5 * * * *');
    // 12 runs / (skip 2 + 1) = 4 effective
    expect(at200.runsPerHour).toBe(12);
    expect(at200.skip).toBe(2);
    expect(at200.effectiveRunsPerHour).toBe(4);
    expect(at200.estimatedPointsPerHour).toBe(4 * 200 * POINTS_PER_MEMBER);
  });
});
