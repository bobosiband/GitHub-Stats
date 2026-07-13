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

/** Prefer the backend's rolled-up progression if present, else compute locally. */
export function progressionFrom(cohortEntry) {
  const stats = cohortEntry?.stats;
  const p = cohortEntry?.progression;
  if (p && typeof p.xp === 'number') return p;
  const xp = stats?.xp ?? 0;
  const level = levelForXp(xp);
  const next = xpForLevel(level + 1);
  return {
    xp,
    level,
    levelProgress: levelProgress(xp),
    xpToNextLevel: Math.max(0, next - xp),
  };
}
