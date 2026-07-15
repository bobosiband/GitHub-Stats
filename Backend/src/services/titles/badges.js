import { levelForXp, xpForLevel } from '../xp.js';

/**
 * BADGE title definitions. Threshold-based, anyone can earn them, and once
 * earned they are **permanent** (never revoked).
 *
 * To add a badge, append one object. No engine change required.
 *
 * Every rule declares an explicit `threshold`. The default `qualifies` is
 * `(s) => (s[stat] ?? 0) >= threshold`, so simple stat-vs-threshold badges
 * omit the function entirely. Custom `qualifies` overrides it (e.g. the XP
 * level badges compare a derived level, not the raw XP).
 *
 * @typedef {object} BadgeRule
 * @property {string} key
 * @property {string} name
 * @property {string} description
 * @property {string} [flavor]
 * @property {string} stat  snapshot field the threshold reads
 * @property {number} threshold  numeric target for the default qualifies + progress meter
 * @property {(snapshot: object, member: object) => boolean} [qualifies]
 * @property {(snapshot: object, member: object) => object} [toValue]
 */

/** @type {BadgeRule[]} */
const RAW_BADGE_RULES = [
  {
    key: 'first_push',
    name: 'First Push',
    description: 'Made at least one contribution.',
    flavor: 'Welcome aboard.',
    stat: 'totalContributions',
    threshold: 1,
  },
  {
    key: 'century',
    name: 'Century',
    description: 'Reached 100 commits in the cohort window.',
    flavor: '100 not out.',
    stat: 'totalCommits',
    threshold: 100,
  },
  {
    key: 'streak_7',
    name: 'Week Streak',
    description: 'A streak of at least 7 consecutive days.',
    flavor: 'Seven days strong.',
    stat: 'longestStreak',
    threshold: 7,
  },
  {
    key: 'streak_30',
    name: 'Month Streak',
    description: 'A streak of at least 30 consecutive days.',
    flavor: 'A whole month. Respect.',
    stat: 'longestStreak',
    threshold: 30,
  },
  {
    key: 'first_merge',
    name: 'First Merge',
    description: 'Had at least one pull request merged.',
    flavor: 'It counts now.',
    stat: 'mergedPRs',
    threshold: 1,
  },
  {
    key: 'reviewer',
    name: 'Reviewer',
    description: 'Gave at least 5 pull-request reviews.',
    flavor: 'Looks good to me.',
    stat: 'reviewsGiven',
    threshold: 5,
  },
  {
    key: 'five_languages',
    name: 'Five Languages',
    description: 'Used at least 5 distinct languages.',
    flavor: 'Speaking in tongues.',
    stat: 'languageCount',
    threshold: 5,
  },
  {
    key: 'starred',
    name: 'Starred',
    description: 'Collected at least 10 stars across owned repos.',
    flavor: 'People noticed.',
    stat: 'totalStars',
    threshold: 10,
  },
  // XP-based level badges. Threshold rules go through the same engine as every
  // other badge — no parallel awards path. `level` is derived from `xp` via the
  // same curve used elsewhere. `threshold` is the XP required for that level,
  // so the "Next up" progress bar shows XP-toward-level-N directly.
  {
    key: 'level_5',
    name: 'Level 5',
    description: 'Reached Level 5 (~1,500 XP).',
    flavor: 'Warming up.',
    stat: 'xp',
    threshold: xpForLevel(5),
    qualifies: (s) => levelForXp(s.xp ?? 0) >= 5,
    toValue: (s) => ({ level: levelForXp(s.xp ?? 0), xp: s.xp ?? 0 }),
  },
  {
    key: 'level_10',
    name: 'Level 10',
    description: 'Reached Level 10 (~5,000 XP).',
    flavor: 'Two digits.',
    stat: 'xp',
    threshold: xpForLevel(10),
    qualifies: (s) => levelForXp(s.xp ?? 0) >= 10,
    toValue: (s) => ({ level: levelForXp(s.xp ?? 0), xp: s.xp ?? 0 }),
  },
  {
    key: 'level_20',
    name: 'Level 20',
    description: 'Reached Level 20 (~16,300 XP).',
    flavor: 'Now we are shipping.',
    stat: 'xp',
    threshold: xpForLevel(20),
    qualifies: (s) => levelForXp(s.xp ?? 0) >= 20,
    toValue: (s) => ({ level: levelForXp(s.xp ?? 0), xp: s.xp ?? 0 }),
  },
];

// Fill in the default `qualifies` for any rule that only declared `threshold`,
// so the engine can call `rule.qualifies` unconditionally.
export const BADGE_RULES = RAW_BADGE_RULES.map((rule) => ({
  ...rule,
  qualifies: rule.qualifies ?? ((s) => (s?.[rule.stat] ?? 0) >= rule.threshold),
}));
