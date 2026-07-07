import { describe, it, expect } from 'vitest';
import {
  longestStreak,
  currentStreak,
  maxCommitsInOneDay,
  totalContributions,
  activeDays,
  weekendCommitRatio,
  nightCommitRatio,
  summariseCalendar,
} from '../../src/services/streaks.js';

/** Build a contiguous calendar from a start date and an array of daily counts. */
function cal(start, counts) {
  const out = [];
  const [y, m, d] = start.split('-').map(Number);
  for (let i = 0; i < counts.length; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    out.push({ date: date.toISOString().slice(0, 10), count: counts[i] });
  }
  return out;
}

describe('longestStreak', () => {
  it('is 0 for an empty calendar', () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(null)).toBe(0);
    expect(longestStreak(undefined)).toBe(0);
  });

  it('is 1 for a single active day', () => {
    expect(longestStreak([{ date: '2025-03-01', count: 3 }])).toBe(1);
  });

  it('is 0 when the only day is inactive', () => {
    expect(longestStreak([{ date: '2025-03-01', count: 0 }])).toBe(0);
  });

  it('counts a run of consecutive active days', () => {
    expect(longestStreak(cal('2025-03-01', [1, 2, 3, 4]))).toBe(4);
  });

  it('spans across month boundaries', () => {
    // Jan 30, 31, Feb 1, 2 — four consecutive days across the month edge.
    expect(longestStreak(cal('2025-01-30', [1, 1, 1, 1]))).toBe(4);
  });

  it('resets on a single zero day and keeps the longest run', () => {
    // 3-day run, gap, 2-day run → longest is 3.
    expect(longestStreak(cal('2025-03-01', [1, 1, 1, 0, 1, 1]))).toBe(3);
  });

  it('treats a missing calendar day as a break', () => {
    const calendar = [
      { date: '2025-03-01', count: 1 },
      { date: '2025-03-02', count: 1 },
      // 2025-03-03 missing entirely
      { date: '2025-03-04', count: 1 },
    ];
    expect(longestStreak(calendar)).toBe(2);
  });

  it('handles unsorted input', () => {
    const calendar = [
      { date: '2025-03-03', count: 1 },
      { date: '2025-03-01', count: 1 },
      { date: '2025-03-02', count: 1 },
    ];
    expect(longestStreak(calendar)).toBe(3);
  });
});

describe('currentStreak', () => {
  it('is 0 for an empty calendar', () => {
    expect(currentStreak([], '2025-03-10')).toBe(0);
  });

  it('counts consecutive active days ending today', () => {
    const calendar = cal('2025-03-01', [1, 1, 1, 1, 1]); // Mar 1..5
    expect(currentStreak(calendar, '2025-03-05')).toBe(5);
  });

  it('tolerates an inactive today when yesterday was active', () => {
    // Mar 1..4 active, Mar 5 (today) is 0 → streak still 4 from yesterday.
    const calendar = cal('2025-03-01', [1, 1, 1, 1, 0]);
    expect(currentStreak(calendar, '2025-03-05')).toBe(4);
  });

  it('is 0 when both today and yesterday are inactive', () => {
    const calendar = cal('2025-03-01', [1, 1, 1, 0, 0]);
    expect(currentStreak(calendar, '2025-03-05')).toBe(0);
  });

  it('stops at the first inactive day walking back', () => {
    const calendar = cal('2025-03-01', [1, 0, 1, 1, 1]); // gap at Mar 2
    expect(currentStreak(calendar, '2025-03-05')).toBe(3);
  });

  it('accepts a Date object for today', () => {
    const calendar = cal('2025-03-01', [1, 1, 1]);
    expect(currentStreak(calendar, new Date('2025-03-03T12:00:00Z'))).toBe(3);
  });
});

describe('maxCommitsInOneDay', () => {
  it('is 0 for empty', () => {
    expect(maxCommitsInOneDay([])).toBe(0);
  });
  it('returns the peak day', () => {
    expect(maxCommitsInOneDay(cal('2025-03-01', [2, 9, 4, 0, 7]))).toBe(9);
  });
});

describe('totalContributions & activeDays', () => {
  it('sums counts and counts active days', () => {
    const calendar = cal('2025-03-01', [0, 3, 0, 5, 2]);
    expect(totalContributions(calendar)).toBe(10);
    expect(activeDays(calendar)).toBe(3);
  });
});

describe('weekendCommitRatio', () => {
  it('is 0 when there are no contributions (divide-by-zero guard)', () => {
    expect(weekendCommitRatio(cal('2025-03-01', [0, 0, 0]))).toBe(0);
    expect(weekendCommitRatio([])).toBe(0);
  });

  it('computes weekend fraction (2025-03-01 is a Saturday)', () => {
    // Sat=10, Sun=10, Mon=0, ... only weekend has contributions → ratio 1.
    const calendar = [
      { date: '2025-03-01', count: 10 }, // Sat
      { date: '2025-03-02', count: 10 }, // Sun
      { date: '2025-03-03', count: 0 }, // Mon
    ];
    expect(weekendCommitRatio(calendar)).toBe(1);
  });

  it('computes a mixed weekend fraction', () => {
    const calendar = [
      { date: '2025-03-01', count: 5 }, // Sat
      { date: '2025-03-03', count: 15 }, // Mon
    ];
    expect(weekendCommitRatio(calendar)).toBeCloseTo(5 / 20, 10);
  });
});

describe('nightCommitRatio', () => {
  it('is null with no data', () => {
    expect(nightCommitRatio([])).toBeNull();
    expect(nightCommitRatio(null)).toBeNull();
  });

  it('uses the local hour from the timestamp offset', () => {
    const timestamps = [
      '2025-03-01T23:15:00+10:00', // 23 → night
      '2025-03-01T02:00:00+10:00', // 02 → night
      '2025-03-01T14:00:00+10:00', // 14 → day
      '2025-03-01T06:00:00+10:00', // 06 → day (endHour exclusive)
    ];
    expect(nightCommitRatio(timestamps)).toBeCloseTo(2 / 4, 10);
  });

  it('respects a custom window', () => {
    const timestamps = ['2025-03-01T20:00:00Z', '2025-03-01T10:00:00Z'];
    expect(nightCommitRatio(timestamps, { startHour: 20, endHour: 6 })).toBeCloseTo(0.5, 10);
  });
});

describe('summariseCalendar', () => {
  it('rolls up all derived stats', () => {
    const calendar = cal('2025-03-01', [1, 1, 0, 4, 1]);
    const s = summariseCalendar(calendar, '2025-03-05');
    expect(s).toMatchObject({
      longestStreak: 2,
      currentStreak: 2,
      maxCommitsInOneDay: 4,
      totalContributions: 7,
      activeDays: 4,
    });
    expect(s.weekendCommitRatio).toBeGreaterThanOrEqual(0);
  });
});
