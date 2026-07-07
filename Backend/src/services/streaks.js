/**
 * Pure streak / activity math derived from a GitHub contribution calendar.
 * No I/O — every function takes plain data and returns a value, which is what
 * makes them the most heavily unit-tested part of the codebase.
 *
 * @typedef {{ date: string, count: number }} CalendarDay
 *   `date` is an ISO `YYYY-MM-DD` string; `count` is that day's contribution total.
 */

const DAY_MS = 86_400_000;

/**
 * Normalise arbitrary calendar input into a clean, ascending array of days.
 * Tolerates missing/garbage entries so the math functions never throw.
 * @param {CalendarDay[]} calendar
 * @returns {CalendarDay[]}
 */
function normalise(calendar) {
  if (!Array.isArray(calendar)) return [];
  return calendar
    .filter((d) => d && typeof d.date === 'string')
    .map((d) => ({ date: d.date.slice(0, 10), count: Number(d.count) || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Format a Date (or ms) as a UTC `YYYY-MM-DD` string. */
function ymd(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` string to UTC-midnight milliseconds. */
function toUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Add `delta` days to a `YYYY-MM-DD` string, returning a `YYYY-MM-DD` string. */
function addDays(dateStr, delta) {
  return ymd(new Date(toUtcMs(dateStr) + delta * DAY_MS));
}

/** Whole-day difference `b - a` between two `YYYY-MM-DD` strings. */
function dayDiff(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/**
 * Longest run of consecutive calendar days with `count > 0`. Days are treated
 * as consecutive only when their dates are exactly one day apart, so a zero day
 * or a gap in the data breaks the streak.
 * @param {CalendarDay[]} calendar
 * @returns {number}
 */
export function longestStreak(calendar) {
  const days = normalise(calendar);
  let best = 0;
  let run = 0;
  let prevActive = null;
  for (const { date, count } of days) {
    if (count > 0) {
      run = prevActive !== null && dayDiff(prevActive, date) === 1 ? run + 1 : 1;
      prevActive = date;
      if (run > best) best = run;
    }
    // count === 0 → leave prevActive; the next active day's date gap resets the run.
  }
  return best;
}

/**
 * Current streak ending at `today`. If today has no contributions the streak is
 * measured from yesterday instead (an active streak "survives" an as-yet-empty
 * today); if neither today nor yesterday is active, the streak is 0.
 * @param {CalendarDay[]} calendar
 * @param {Date|string} [today]
 * @returns {number}
 */
export function currentStreak(calendar, today = new Date()) {
  const days = normalise(calendar);
  if (days.length === 0) return 0;
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const todayStr = ymd(today);

  let cursor;
  if ((counts.get(todayStr) ?? 0) > 0) {
    cursor = todayStr;
  } else {
    const yesterday = addDays(todayStr, -1);
    if ((counts.get(yesterday) ?? 0) > 0) cursor = yesterday;
    else return 0;
  }

  let streak = 0;
  while ((counts.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Highest single-day contribution count.
 * @param {CalendarDay[]} calendar
 * @returns {number}
 */
export function maxCommitsInOneDay(calendar) {
  const days = normalise(calendar);
  let max = 0;
  for (const { count } of days) if (count > max) max = count;
  return max;
}

/**
 * Sum of every day's contributions.
 * @param {CalendarDay[]} calendar
 * @returns {number}
 */
export function totalContributions(calendar) {
  return normalise(calendar).reduce((sum, d) => sum + d.count, 0);
}

/**
 * Number of days with at least one contribution.
 * @param {CalendarDay[]} calendar
 * @returns {number}
 */
export function activeDays(calendar) {
  return normalise(calendar).filter((d) => d.count > 0).length;
}

/**
 * Fraction of contributions made on Saturday/Sunday (UTC). Returns 0 when there
 * are no contributions at all (divide-by-zero guard).
 * @param {CalendarDay[]} calendar
 * @returns {number} 0..1
 */
export function weekendCommitRatio(calendar) {
  const days = normalise(calendar);
  let total = 0;
  let weekend = 0;
  for (const { date, count } of days) {
    total += count;
    const dow = new Date(toUtcMs(date)).getUTCDay(); // 0=Sun … 6=Sat
    if (dow === 0 || dow === 6) weekend += count;
  }
  return total === 0 ? 0 : weekend / total;
}

/**
 * Extract the local hour (0-23) from a Git timestamp. GraphQL `GitTimestamp`
 * values keep the author's original timezone offset, so the hour field in the
 * ISO string is already the author's *local* hour — exactly what we want.
 * @param {string|Date} ts
 * @returns {number|null}
 */
function localHour(ts) {
  if (typeof ts === 'string') {
    const m = ts.match(/T(\d{2}):/);
    return m ? Number(m[1]) : null;
  }
  if (ts instanceof Date) return ts.getUTCHours();
  return null;
}

/**
 * Fraction of commit timestamps that fall in the "night" window (22:00–06:00
 * local by default). Returns `null` when there is no timestamp data, so the
 * Night Owl title simply can't be won by members without a registered repo.
 * @param {(string|Date)[]} timestamps
 * @param {{ startHour?: number, endHour?: number }} [opts]
 * @returns {number|null} 0..1 or null
 */
export function nightCommitRatio(timestamps, { startHour = 22, endHour = 6 } = {}) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return null;
  let total = 0;
  let night = 0;
  for (const ts of timestamps) {
    const hour = localHour(ts);
    if (hour === null) continue;
    total += 1;
    if (hour >= startHour || hour < endHour) night += 1;
  }
  return total === 0 ? null : night / total;
}

/**
 * Convenience roll-up used by the stats fetcher.
 * @param {CalendarDay[]} calendar
 * @param {Date|string} [today]
 */
export function summariseCalendar(calendar, today = new Date()) {
  return {
    longestStreak: longestStreak(calendar),
    currentStreak: currentStreak(calendar, today),
    maxCommitsInOneDay: maxCommitsInOneDay(calendar),
    weekendCommitRatio: weekendCommitRatio(calendar),
    totalContributions: totalContributions(calendar),
    activeDays: activeDays(calendar),
  };
}
