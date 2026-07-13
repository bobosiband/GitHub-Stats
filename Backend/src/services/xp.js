/**
 * GitRank XP system — deterministic, pure, denormalised onto every StatSnapshot
 * so the leaderboard can sort by a single indexed column.
 *
 * Design principles (kept intentionally Duolingo-shaped):
 *   1. Linear rewards for effort the member controls: commits, PRs, reviews,
 *      issues. Reviews carry the highest per-unit XP because reviewing is the
 *      "hard exercise" — Duolingo pays more for the tough drills, so do we.
 *   2. Diminishing returns on things you can't control directly (stars,
 *      followers) via `sqrt`, and on repo scale (language bytes) via `log2` —
 *      farming a single huge repo can't outweigh consistent effort.
 *   3. A streak multiplier that rewards consistency without ever letting one
 *      100-day streak dwarf actual output — hard cap of 1.5×.
 *   4. Per-language XP is capped at 300 apiece, so one giant repo in one
 *      language behaves like one maxed-out "skill" (Duolingo cap), and a
 *      polyglot bonus rewards breadth of `languageCount` beyond the top slice.
 *
 * XP on the global cohort follows a rolling 365-day window, so it CAN
 * decrease as old work falls out of the sync window — that is intentional and
 * documented in the README.
 */

/** @typedef {{
 *   totalCommits: number,
 *   totalPRs: number,
 *   mergedPRs: number,
 *   reviewsGiven: number,
 *   issuesOpened: number,
 *   totalStars: number,
 *   followers: number,
 *   contributedRepoCount: number,
 *   languageCount: number,
 *   currentStreak: number,
 *   topLanguages: Array<{name: string, bytes: number}>,
 * }} StatsForXp */

/** Clamp small numeric inputs to safe non-negative numbers. */
function nn(v) {
  if (typeof v !== 'number' || Number.isNaN(v) || v < 0) return 0;
  return v;
}

/**
 * Compute total XP for a snapshot's stats. Pure — same input always yields
 * the same integer output. Missing / negative inputs are treated as zero so
 * partial or pre-migration snapshots don't crash the sync pipeline.
 *
 * @param {StatsForXp} stats
 * @returns {number} non-negative integer
 */
export function computeXp(stats) {
  if (!stats || typeof stats !== 'object') return 0;

  const commits = nn(stats.totalCommits);
  const prs = nn(stats.totalPRs);
  const reviews = nn(stats.reviewsGiven);
  const issues = nn(stats.issuesOpened);
  const merged = nn(stats.mergedPRs);
  const stars = nn(stats.totalStars);
  const followers = nn(stats.followers);
  const contributedRepos = nn(stats.contributedRepoCount);
  const languages = nn(stats.languageCount);
  const streak = nn(stats.currentStreak);
  const topLanguages = Array.isArray(stats.topLanguages) ? stats.topLanguages : [];

  const activityXP = 10 * commits + 30 * prs + 40 * reviews + 15 * issues;

  // Streak multiplier — capped so a 100-day streak sits at exactly 1.5×.
  const streakMult = 1 + Math.min(0.5, 0.01 * streak);

  // Diminishing returns on social + reach.
  const socialXP = 25 * Math.sqrt(stars) + 5 * Math.sqrt(followers);

  const collabXP = 20 * contributedRepos + 8 * merged;

  // Language XP: log-shaped per language, capped at 300 each (one maxed
  // "skill"). Polyglot bonus for languages beyond the top slice we know bytes
  // for — encourages breadth without paying for tiny sliver files.
  let languageXP = 0;
  for (const lang of topLanguages) {
    languageXP += perLanguageXp(lang?.bytes);
  }
  const polyglotBonus = 50 * Math.max(0, languages - topLanguages.length);
  languageXP += polyglotBonus;

  const total = activityXP * streakMult + socialXP + collabXP + languageXP;
  return Math.max(0, Math.round(total));
}

/**
 * XP contribution from a single language's byte total. Same shape used inside
 * `computeXp`; exported so serializers can annotate each `topLanguages` entry
 * (and the frontend can render partial skill rings without duplicating the
 * formula). Caps at 300 per language — one maxed "skill" in Duolingo terms.
 *
 * @param {number} bytes
 * @returns {number}
 */
export function perLanguageXp(bytes) {
  const b = nn(bytes);
  if (b <= 0) return 0;
  return Math.min(300, 30 * Math.log2(1 + b / 1000));
}

/** Cap per language. Exported so callers can drive UI (progress fraction, glow at cap). */
export const PER_LANGUAGE_XP_CAP = 300;

/**
 * Superlinear level curve — Duolingo levels feel tight at the start and
 * long-tailed at the top. `xpForLevel(L)` is the cumulative XP required to
 * REACH level `L` (level 0 = 0 XP).
 *
 *   xpForLevel(L) = round(100 · L^1.7)
 *
 * Anchors: L1=100, L2≈325, L5≈1540, L10≈5012, L20≈16302, L50≈76965.
 *
 * @param {number} level  non-negative integer
 * @returns {number}
 */
export function xpForLevel(level) {
  if (typeof level !== 'number' || Number.isNaN(level) || level < 0) {
    throw new RangeError(`xpForLevel expects a non-negative number, got ${level}`);
  }
  if (level === 0) return 0;
  return Math.round(100 * Math.pow(level, 1.7));
}

/**
 * Inverse of `xpForLevel`. Given a total XP, return the current level (the
 * highest L with `xpForLevel(L) <= xp`).
 *
 * @param {number} xp
 * @returns {number}
 */
export function levelForXp(xp) {
  if (typeof xp !== 'number' || Number.isNaN(xp)) {
    throw new RangeError(`levelForXp expects a number, got ${xp}`);
  }
  if (xp < 0) throw new RangeError(`levelForXp: xp must be non-negative, got ${xp}`);
  if (xp === 0) return 0;
  const raw = Math.pow(xp / 100, 1 / 1.7);
  const guess = Math.floor(raw);
  // Rounding on xpForLevel can produce a tiny mismatch at bucket boundaries;
  // step up if the next bucket is actually reachable, and step down if the
  // floor overshoots.
  if (xpForLevel(guess + 1) <= xp) return guess + 1;
  if (xpForLevel(guess) > xp) return Math.max(0, guess - 1);
  return guess;
}

/**
 * Progress into the current level as a fraction in [0, 1]. Used by the UI to
 * draw the ring around the avatar.
 *
 * @param {number} xp
 * @returns {number}
 */
export function levelProgress(xp) {
  if (typeof xp !== 'number' || Number.isNaN(xp) || xp < 0) {
    throw new RangeError(`levelProgress expects a non-negative number, got ${xp}`);
  }
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const denom = next - base;
  if (denom <= 0) return 0;
  const p = (xp - base) / denom;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

/**
 * Convenience bundle used by the profile response.
 *
 * @param {number} xp
 * @returns {{xp: number, level: number, levelProgress: number, xpToNextLevel: number}}
 */
export function xpSummary(xp) {
  const safeXp = Math.max(0, Math.round(xp ?? 0));
  const level = levelForXp(safeXp);
  const next = xpForLevel(level + 1);
  return {
    xp: safeXp,
    level,
    levelProgress: levelProgress(safeXp),
    xpToNextLevel: Math.max(0, next - safeXp),
  };
}
