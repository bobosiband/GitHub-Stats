/**
 * Mirrors src/services/xp.js on the backend. Kept here so components can format
 * the level ring and "XP to next level" chip even before a `progression` field
 * lands from the API (older snapshots, no-cache page loads, offline demos).
 *
 * Also used by the level-up detector — it computes the level a member is
 * currently on so we can compare against the last cached level in localStorage.
 */

export function xpForLevel(level) {
  if (typeof level !== 'number' || Number.isNaN(level) || level < 0) return 0;
  if (level === 0) return 0;
  return Math.round(100 * Math.pow(level, 1.7));
}

export function levelForXp(xp) {
  if (typeof xp !== 'number' || Number.isNaN(xp) || xp <= 0) return 0;
  const raw = Math.pow(xp / 100, 1 / 1.7);
  const guess = Math.floor(raw);
  if (xpForLevel(guess + 1) <= xp) return guess + 1;
  if (xpForLevel(guess) > xp) return Math.max(0, guess - 1);
  return guess;
}

export function levelProgress(xp) {
  if (typeof xp !== 'number' || Number.isNaN(xp) || xp < 0) return 0;
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const denom = next - base;
  if (denom <= 0) return 0;
  const p = (xp - base) / denom;
  return Math.max(0, Math.min(1, p));
}

/**
 * Prefer the backend's rolled-up progression if present, else compute locally.
 * Returns `null` for cohorts that have **no snapshot yet** — components should
 * treat that as "not synced" and render an empty state, not silently coerce to
 * XP=0/Level=0 (which is what the earlier `?? 0` fallback was hiding).
 *
 * `xp` legitimately being `0` on a real snapshot (brand-new member, all-zero
 * stats) still returns a numeric progression.
 */
export function progressionFrom(cohortEntry) {
  const stats = cohortEntry?.stats;
  const p = cohortEntry?.progression;
  if (p && typeof p.xp === 'number') return p;
  if (!stats || typeof stats.xp !== 'number') return null;
  const xp = stats.xp;
  const level = levelForXp(xp);
  const next = xpForLevel(level + 1);
  return {
    xp,
    level,
    levelProgress: levelProgress(xp),
    xpToNextLevel: Math.max(0, next - xp),
  };
}

/**
 * Per-language XP contribution — mirrors the backend's `computeXp` inner term.
 * Shared so the language-skill rings scale correctly whether or not the API
 * bundles the value on each topLanguages entry.
 */
export function perLanguageXp(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) return 0;
  return Math.min(300, 30 * Math.log2(1 + bytes / 1000));
}
