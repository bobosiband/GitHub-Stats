import { describe, it, expect } from 'vitest';

import { badgeProgressFor, topBadgeProgress } from '../../src/services/titles/progress.js';
import { BADGE_RULES } from '../../src/services/titles/badges.js';
import { xpForLevel } from '../../src/services/xp.js';

/** Handy snapshot builder — all threshold-stat fields default to 0 so callers
 * only override what they care about. */
function snap(overrides = {}) {
  return {
    totalCommits: 0,
    totalContributions: 0,
    totalPRs: 0,
    mergedPRs: 0,
    reviewsGiven: 0,
    issuesOpened: 0,
    followers: 0,
    totalStars: 0,
    repoCount: 0,
    contributedRepoCount: 0,
    languageCount: 0,
    longestStreak: 0,
    currentStreak: 0,
    maxCommitsInOneDay: 0,
    weekendCommitRatio: 0,
    nightCommitRatio: null,
    xp: 0,
    ...overrides,
  };
}

describe('badgeProgressFor', () => {
  it('returns an empty array when the member has no snapshots', () => {
    const out = badgeProgressFor({ snapshots: [] });
    expect(out).toEqual([]);
  });

  it('excludes badges the member has already earned', () => {
    const snapshots = [snap({ totalCommits: 500, totalContributions: 100 })];
    const withoutEarned = badgeProgressFor({ snapshots });
    // `first_push` should be present when nothing is earned.
    expect(withoutEarned.some((b) => b.key === 'first_push')).toBe(true);

    const withEarned = badgeProgressFor({
      snapshots,
      earnedKeys: new Set(['first_push', 'century']),
    });
    const keys = withEarned.map((b) => b.key);
    expect(keys).not.toContain('first_push');
    expect(keys).not.toContain('century');
  });

  it('sorts nearest-to-earned first', () => {
    const snapshots = [
      snap({
        totalCommits: 90,       // century: 90/100 → 0.90
        longestStreak: 3,       // streak_7: 3/7 → ~0.43
        mergedPRs: 0,           // first_merge: 0/1 → 0
        reviewsGiven: 4,        // reviewer: 4/5 → 0.80
      }),
    ];
    const out = badgeProgressFor({ snapshots });
    const century = out.find((b) => b.key === 'century');
    const reviewer = out.find((b) => b.key === 'reviewer');
    const streak = out.find((b) => b.key === 'streak_7');
    expect(century.pct).toBeGreaterThan(reviewer.pct);
    expect(reviewer.pct).toBeGreaterThan(streak.pct);

    // First entry is the max-pct badge overall.
    const maxPct = Math.max(...out.map((b) => b.pct));
    expect(out[0].pct).toBe(maxPct);
  });

  it('caps pct at 1 and current/target retain raw values', () => {
    const snapshots = [snap({ totalCommits: 999, totalContributions: 999 })];
    const out = badgeProgressFor({ snapshots });
    for (const b of out) {
      expect(b.pct).toBeGreaterThanOrEqual(0);
      expect(b.pct).toBeLessThanOrEqual(1);
      expect(typeof b.current).toBe('number');
      expect(typeof b.target).toBe('number');
      expect(b.target).toBeGreaterThan(0);
    }
  });

  it('uses the best (max) value across multiple snapshots', () => {
    const snapshots = [
      snap({ totalCommits: 20 }),
      snap({ totalCommits: 80 }),
      snap({ totalCommits: 55 }),
    ];
    const out = badgeProgressFor({ snapshots });
    const century = out.find((b) => b.key === 'century');
    expect(century.current).toBe(80);
    expect(century.pct).toBeCloseTo(0.8, 10);
  });

  it('level badges progress toward the exact XP-for-that-level target', () => {
    const snapshots = [snap({ xp: 500 })];
    const out = badgeProgressFor({ snapshots });
    const level5 = out.find((b) => b.key === 'level_5');
    expect(level5).toBeTruthy();
    expect(level5.current).toBe(500);
    expect(level5.target).toBe(xpForLevel(5));
  });

  it('shape includes the required BadgeProgress fields', () => {
    const snapshots = [snap({ totalCommits: 40 })];
    const [first] = badgeProgressFor({ snapshots });
    expect(first).toEqual(
      expect.objectContaining({
        key: expect.any(String),
        name: expect.any(String),
        description: expect.any(String),
        stat: expect.any(String),
        current: expect.any(Number),
        target: expect.any(Number),
        pct: expect.any(Number),
      }),
    );
    // flavor is optional on badges — must be present (as null if absent).
    expect(first).toHaveProperty('flavor');
  });

  it('covers every badge rule when nothing is earned', () => {
    const snapshots = [snap()];
    const out = badgeProgressFor({ snapshots });
    expect(out).toHaveLength(BADGE_RULES.length);
  });
});

describe('topBadgeProgress', () => {
  it('caps the result to the requested size (default 4)', () => {
    const snapshots = [snap({ totalCommits: 60, longestStreak: 5, mergedPRs: 1 })];
    const out = topBadgeProgress({ snapshots });
    expect(out.length).toBeLessThanOrEqual(4);
  });

  it('respects a custom cap', () => {
    const snapshots = [snap({ totalCommits: 60 })];
    const out = topBadgeProgress({ snapshots }, 2);
    expect(out).toHaveLength(2);
  });

  it('returns an empty array when the member has no snapshots', () => {
    expect(topBadgeProgress({ snapshots: [] })).toEqual([]);
  });
});
