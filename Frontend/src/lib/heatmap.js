/**
 * Pure heatmap math — extracted from ContributionHeatmap.jsx so the layout
 * (grid + intensity) is testable without a React renderer. The component
 * consumes these directly.
 *
 * Layout invariant: 7 rows (Sun..Sat) × WEEKS columns, anchored to a "last
 * Saturday" derived from the anchor date. The flat output is column-major so
 * it drops straight into a CSS grid with `gridAutoFlow: column`.
 */

export const WEEKS = 53;
export const ROWS = 7;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Quartile-based bucketer. Returns a function `count -> 0..4`.
 * Zero always → 0. Nonzero counts land in the quartile of the member's
 * nonzero-day distribution — so a low-activity member still sees varied green.
 */
export function bucketerFor(nonzeroCounts) {
  if (!nonzeroCounts.length) return (count) => (count > 0 ? 4 : 0);
  const sorted = [...nonzeroCounts].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const q1 = q(0.25);
  const q2 = q(0.5);
  const q3 = q(0.75);
  return (count) => {
    if (count <= 0) return 0;
    if (count <= q1) return 1;
    if (count <= q2) return 2;
    if (count <= q3) return 3;
    return 4;
  };
}

/**
 * Build a column-major matrix of `WEEKS` × 7 cells, anchored to `anchor`.
 * @param {Array<{date:string,count:number}>} calendar
 * @param {Date} anchor
 * @returns {Array<{date:string,count:number,future:boolean,bucket:number}>}
 */
export function buildGrid(calendar, anchor = new Date()) {
  const byDate = new Map();
  for (const entry of calendar ?? []) {
    if (entry?.date) byDate.set(entry.date, Number(entry.count) || 0);
  }

  const anchored = new Date(anchor);
  anchored.setUTCHours(0, 0, 0, 0);
  const dow = anchored.getUTCDay();
  const lastColSat = new Date(anchored);
  lastColSat.setUTCDate(anchored.getUTCDate() + (6 - dow));

  const distribution = [];
  const grid = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const column = [];
    for (let d = 0; d < ROWS; d++) {
      const cur = new Date(lastColSat);
      cur.setUTCDate(lastColSat.getUTCDate() - w * ROWS - (6 - d));
      const isFuture = cur.getTime() > anchored.getTime();
      const key = isoDate(cur);
      const count = byDate.get(key) ?? 0;
      if (count > 0) distribution.push(count);
      column.push({ date: key, count, future: isFuture });
    }
    grid.push(column);
  }

  const bucketFor = bucketerFor(distribution);
  const cells = [];
  for (const column of grid) {
    for (const day of column) {
      cells.push({ ...day, bucket: day.future ? 0 : bucketFor(day.count) });
    }
  }
  return cells;
}
