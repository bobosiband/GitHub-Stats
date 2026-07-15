import { BADGE_RULES } from './badges.js';
import { levelForXp, xpForLevel } from '../xp.js';

/**
 * Progress for a single unearned badge.
 *
 * @typedef {object} BadgeProgress
 * @property {string} key
 * @property {string} name
 * @property {string} description
 * @property {string|null} flavor
 * @property {string} stat
 * @property {number} current  member's best value for `stat` across the input snapshots
 * @property {number} target   rule's threshold (or the XP-for-next-level for level badges)
 * @property {number} pct      0..1 progress toward `target`
 */

const LEVEL_BADGE_KEYS = new Set(['level_5', 'level_10', 'level_20']);

/**
 * Best (max) value of `stat` across a set of snapshots — used so a member
 * whose stats dipped since their peak still sees the closest-to-earning
 * badges surfaced. Ignores null/undefined.
 */
function bestStatAcross(snapshots, stat) {
  let best = 0;
  let seen = false;
  for (const snap of snapshots) {
    const v = snap?.[stat];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    if (!seen || v > best) best = v;
    seen = true;
  }
  return seen ? best : 0;
}

/**
 * Compute progress toward every UNEARNED badge for a member. Pure — takes
 * data, returns data.
 *
 * @param {object} args
 * @param {object[]} args.snapshots  cohort snapshots to derive `current` from
 * @param {Set<string>|string[]} [args.earnedKeys]  badge keys the member has already earned
 * @param {import('./badges.js').BadgeRule[]} [args.rules]
 * @returns {BadgeProgress[]}
 */
export function badgeProgressFor({ snapshots = [], earnedKeys, rules = BADGE_RULES } = {}) {
  if (!snapshots.length) return [];
  const earned = earnedKeys instanceof Set ? earnedKeys : new Set(earnedKeys ?? []);
  const out = [];

  for (const rule of rules) {
    if (earned.has(rule.key)) continue;

    // Level badges use a derived target — the exact XP required for that
    // level — so the bar reads as "1,200 / 1,500 XP" instead of comparing
    // against the raw threshold-at-min-level, which is the same number.
    let target;
    let current;
    if (LEVEL_BADGE_KEYS.has(rule.key) && rule.stat === 'xp') {
      // Reverse the key format `level_N` → number. Falls back to the stored
      // threshold if the shape ever changes.
      const requiredLevel = Number(rule.key.split('_')[1]) || levelForXp(rule.threshold);
      target = xpForLevel(requiredLevel);
      current = bestStatAcross(snapshots, 'xp');
    } else {
      target = rule.threshold;
      current = bestStatAcross(snapshots, rule.stat);
    }

    if (!Number.isFinite(target) || target <= 0) continue;

    const pct = Math.max(0, Math.min(1, current / target));
    out.push({
      key: rule.key,
      name: rule.name,
      description: rule.description,
      flavor: rule.flavor ?? null,
      stat: rule.stat,
      current,
      target,
      pct,
    });
  }

  // Nearest-to-earned first, then by name for a stable secondary order.
  out.sort((a, b) => (b.pct - a.pct) || a.name.localeCompare(b.name));
  return out;
}

/**
 * Convenience: apply the standard cap used by the profile "Next up" section.
 * Kept as a separate helper so callers that want the full list can still get it.
 */
export function topBadgeProgress(args, cap = 4) {
  return badgeProgressFor(args).slice(0, cap);
}
