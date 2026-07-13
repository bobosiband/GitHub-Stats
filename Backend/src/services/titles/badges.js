import { levelForXp } from '../xp.js';

/**
 * BADGE title definitions. Threshold-based, anyone can earn them, and once
 * earned they are **permanent** (never revoked).
 *
 * To add a badge, append one object. No engine change required.
 *
 * @typedef {object} BadgeRule
 * @property {string} key
 * @property {string} name
 * @property {string} description
 * @property {string} [flavor]
 * @property {string} stat  snapshot field the threshold reads (used for the default value)
 * @property {(snapshot: object, member: object) => boolean} qualifies
 * @property {(snapshot: object, member: object) => object} [toValue]
 */

/** @type {BadgeRule[]} */
export const BADGE_RULES = [
  {
    key: 'first_push',
    name: 'First Push',
    description: 'Made at least one contribution.',
    flavor: 'Welcome aboard.',
    stat: 'totalContributions',
    qualifies: (s) => s.totalContributions >= 1,
  },
  {
    key: 'century',
    name: 'Century',
    description: 'Reached 100 commits in the cohort window.',
    flavor: '100 not out.',
    stat: 'totalCommits',
    qualifies: (s) => s.totalCommits >= 100,
  },
  {
    key: 'streak_7',
    name: 'Week Streak',
    description: 'A streak of at least 7 consecutive days.',
    flavor: 'Seven days strong.',
    stat: 'longestStreak',
    qualifies: (s) => s.longestStreak >= 7,
  },
  {
    key: 'streak_30',
    name: 'Month Streak',
    description: 'A streak of at least 30 consecutive days.',
    flavor: 'A whole month. Respect.',
    stat: 'longestStreak',
    qualifies: (s) => s.longestStreak >= 30,
  },
  {
    key: 'first_merge',
    name: 'First Merge',
    description: 'Had at least one pull request merged.',
    flavor: 'It counts now.',
    stat: 'mergedPRs',
    qualifies: (s) => s.mergedPRs >= 1,
  },
  {
    key: 'reviewer',
    name: 'Reviewer',
    description: 'Gave at least 5 pull-request reviews.',
    flavor: 'Looks good to me.',
    stat: 'reviewsGiven',
    qualifies: (s) => s.reviewsGiven >= 5,
  },
  {
    key: 'five_languages',
    name: 'Five Languages',
    description: 'Used at least 5 distinct languages.',
    flavor: 'Speaking in tongues.',
    stat: 'languageCount',
    qualifies: (s) => s.languageCount >= 5,
  },
  {
    key: 'starred',
    name: 'Starred',
    description: 'Collected at least 10 stars across owned repos.',
    flavor: 'People noticed.',
    stat: 'totalStars',
    qualifies: (s) => s.totalStars >= 10,
  },
  // XP-based level badges. Threshold rules go through the same engine as every
  // other badge — no parallel awards path. `level` is derived from `xp` via the
  // same curve used elsewhere so a member earning e.g. Level 10 in the UI has
  // the corresponding badge in the DB.
  {
    key: 'level_5',
    name: 'Level 5',
    description: 'Reached Level 5 (~1,500 XP).',
    flavor: 'Warming up.',
    stat: 'xp',
    qualifies: (s) => levelForXp(s.xp ?? 0) >= 5,
    toValue: (s) => ({ level: levelForXp(s.xp ?? 0), xp: s.xp ?? 0 }),
  },
  {
    key: 'level_10',
    name: 'Level 10',
    description: 'Reached Level 10 (~5,000 XP).',
    flavor: 'Two digits.',
    stat: 'xp',
    qualifies: (s) => levelForXp(s.xp ?? 0) >= 10,
    toValue: (s) => ({ level: levelForXp(s.xp ?? 0), xp: s.xp ?? 0 }),
  },
  {
    key: 'level_20',
    name: 'Level 20',
    description: 'Reached Level 20 (~16,300 XP).',
    flavor: 'Now we are shipping.',
    stat: 'xp',
    qualifies: (s) => levelForXp(s.xp ?? 0) >= 20,
    toValue: (s) => ({ level: levelForXp(s.xp ?? 0), xp: s.xp ?? 0 }),
  },
];
