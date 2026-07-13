import { describe, it, expect } from 'vitest';
import { computeXp, levelForXp, xpForLevel, levelProgress, xpSummary } from '../../src/services/xp.js';

/**
 * Zeroed baseline stats — every term contributes 0. Tests mutate one field at
 * a time so each XP component can be inspected in isolation.
 */
const zero = {
  totalCommits: 0,
  totalPRs: 0,
  mergedPRs: 0,
  reviewsGiven: 0,
  issuesOpened: 0,
  totalStars: 0,
  followers: 0,
  contributedRepoCount: 0,
  languageCount: 0,
  currentStreak: 0,
  topLanguages: [],
};

describe('computeXp — per-term inspection', () => {
  it('yields 0 XP for the zeroed baseline', () => {
    expect(computeXp(zero)).toBe(0);
  });

  it('yields 0 XP for a null/undefined stats object (defensive)', () => {
    expect(computeXp(null)).toBe(0);
    expect(computeXp(undefined)).toBe(0);
    expect(computeXp({})).toBe(0);
  });

  it('commits pay 10 XP each (linear, no multiplier at streak=0)', () => {
    expect(computeXp({ ...zero, totalCommits: 1 })).toBe(10);
    expect(computeXp({ ...zero, totalCommits: 50 })).toBe(500);
  });

  it('PRs pay 30 XP each', () => {
    expect(computeXp({ ...zero, totalPRs: 3 })).toBe(90);
  });

  it('reviews pay 40 XP each — the highest per-unit reward', () => {
    expect(computeXp({ ...zero, reviewsGiven: 5 })).toBe(200);
  });

  it('issues pay 15 XP each', () => {
    expect(computeXp({ ...zero, issuesOpened: 4 })).toBe(60);
  });

  it('merged PRs feed collabXP at 8 apiece', () => {
    expect(computeXp({ ...zero, mergedPRs: 10 })).toBe(80);
  });

  it('contributedRepoCount pays 20 XP each', () => {
    expect(computeXp({ ...zero, contributedRepoCount: 4 })).toBe(80);
  });

  it('stars use sqrt curve (25·sqrt) so farming is capped', () => {
    // 100 stars → 25 * 10 = 250 exactly
    expect(computeXp({ ...zero, totalStars: 100 })).toBe(250);
    // 10_000 stars → 25 * 100 = 2500 (10× stars, 10× XP — sqrt shape)
    expect(computeXp({ ...zero, totalStars: 10_000 })).toBe(2500);
  });

  it('followers use sqrt curve (5·sqrt)', () => {
    expect(computeXp({ ...zero, followers: 400 })).toBe(100); // 5 * 20
  });

  it('a single language contributes log2-shaped XP capped at 300', () => {
    // Fill one language with a huge byte count — must still cap at 300.
    const capped = computeXp({
      ...zero,
      languageCount: 1,
      topLanguages: [{ name: 'JS', bytes: 10_000_000_000 }],
    });
    expect(capped).toBe(300);

    // A small repo scales sublinearly. bytes=1000 → 30 * log2(2) = 30.
    const small = computeXp({
      ...zero,
      languageCount: 1,
      topLanguages: [{ name: 'JS', bytes: 1000 }],
    });
    expect(small).toBe(30);
  });

  it('polyglot bonus rewards languageCount above topLanguages.length', () => {
    // 5 languages total, 3 detailed → +50*2 polyglot bonus.
    const stats = {
      ...zero,
      languageCount: 5,
      topLanguages: [
        { name: 'A', bytes: 0 },
        { name: 'B', bytes: 0 },
        { name: 'C', bytes: 0 },
      ],
    };
    // 3 top-langs at bytes=0 → 30*log2(1) = 0 each; polyglot bonus = 100.
    expect(computeXp(stats)).toBe(100);
  });

  it('streak multiplier caps at 1.5× (100+ day streak has no extra effect)', () => {
    const base = { ...zero, totalCommits: 100 }; // 1000 activityXP
    expect(computeXp({ ...base, currentStreak: 0 })).toBe(1000);
    expect(computeXp({ ...base, currentStreak: 50 })).toBe(1500);
    expect(computeXp({ ...base, currentStreak: 100 })).toBe(1500);
    expect(computeXp({ ...base, currentStreak: 500 })).toBe(1500); // capped
  });

  it('streak multiplier only scales activityXP, never socialXP/collabXP/languageXP', () => {
    // A member with only stars — no activity — must gain nothing from a streak.
    const s = { ...zero, totalStars: 100, currentStreak: 100 };
    expect(computeXp(s)).toBe(250);
  });

  it('is monotonic in commits (property test)', () => {
    let prev = -1;
    for (let c = 0; c < 500; c += 7) {
      const xp = computeXp({ ...zero, totalCommits: c });
      expect(xp).toBeGreaterThanOrEqual(prev);
      prev = xp;
    }
  });

  it('is monotonic in reviews (property test)', () => {
    let prev = -1;
    for (let r = 0; r < 100; r += 3) {
      const xp = computeXp({ ...zero, reviewsGiven: r });
      expect(xp).toBeGreaterThanOrEqual(prev);
      prev = xp;
    }
  });

  it('treats negative / NaN numeric inputs as zero', () => {
    expect(computeXp({ ...zero, totalCommits: -5 })).toBe(0);
    expect(computeXp({ ...zero, totalCommits: NaN })).toBe(0);
    expect(computeXp({ ...zero, totalStars: -100 })).toBe(0);
  });
});

describe('level curve — xpForLevel / levelForXp / levelProgress', () => {
  it('level 0 is 0 XP', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(levelForXp(0)).toBe(0);
  });

  it('sanity anchors from the spec', () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(325);
    expect(xpForLevel(5)).toBeGreaterThanOrEqual(1520);
    expect(xpForLevel(5)).toBeLessThanOrEqual(1560);
    expect(xpForLevel(10)).toBeGreaterThanOrEqual(4990);
    expect(xpForLevel(10)).toBeLessThanOrEqual(5030);
    expect(xpForLevel(20)).toBeGreaterThanOrEqual(16250);
    expect(xpForLevel(20)).toBeLessThanOrEqual(16320);
    expect(xpForLevel(50)).toBeGreaterThanOrEqual(76900);
    expect(xpForLevel(50)).toBeLessThanOrEqual(77400);
  });

  it('levelForXp is the inverse of xpForLevel at bucket boundaries', () => {
    for (let L = 0; L <= 60; L++) {
      const xp = xpForLevel(L);
      expect(levelForXp(xp)).toBe(L);
      if (L > 0) {
        // Just under the boundary → previous level.
        expect(levelForXp(xp - 1)).toBe(L - 1);
      }
    }
  });

  it('levelProgress reports 0 at bucket start and ~1 just before the next bucket', () => {
    const xp = xpForLevel(5);
    expect(levelProgress(xp)).toBe(0);
    const nearNext = xpForLevel(6) - 1;
    expect(levelProgress(nearNext)).toBeGreaterThan(0.9);
    expect(levelProgress(nearNext)).toBeLessThan(1);
  });

  it('levelProgress mid-bucket is roughly halfway', () => {
    const base = xpForLevel(3);
    const next = xpForLevel(4);
    const mid = Math.round((base + next) / 2);
    expect(levelProgress(mid)).toBeGreaterThan(0.45);
    expect(levelProgress(mid)).toBeLessThan(0.55);
  });

  it('throws on negative / NaN inputs', () => {
    expect(() => levelForXp(-1)).toThrow();
    expect(() => levelForXp(NaN)).toThrow();
    expect(() => xpForLevel(-1)).toThrow();
    expect(() => levelProgress(-1)).toThrow();
  });
});

describe('xpSummary — the shape returned on the profile', () => {
  it('rolls up level + progress + xpToNextLevel', () => {
    const s = xpSummary(500);
    expect(s.xp).toBe(500);
    expect(s.level).toBe(levelForXp(500));
    expect(s.xpToNextLevel).toBe(xpForLevel(s.level + 1) - 500);
    expect(s.levelProgress).toBeCloseTo(levelProgress(500));
  });

  it('handles xp=0 gracefully', () => {
    const s = xpSummary(0);
    expect(s).toEqual({ xp: 0, level: 0, levelProgress: 0, xpToNextLevel: 100 });
  });

  it('coerces null/undefined xp to 0', () => {
    expect(xpSummary(null).xp).toBe(0);
    expect(xpSummary(undefined).xp).toBe(0);
  });
});
