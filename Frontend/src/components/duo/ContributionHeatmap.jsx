import { useMemo, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * GitHub-style 52-week contribution heatmap.
 *
 * Renders whatever daily `{date, count}` entries the snapshot's `calendar`
 * carries — up to the last 371 days (53 weeks × 7). Bucketing uses fixed
 * thresholds (1 / 4 / 8 / 16) so the ramp scales the same way for a member
 * with a handful of tiny days and one with hundreds of commits — matches how
 * GitHub renders it, and keeps the intensity comparable across members.
 */

const WEEKS = 53;

function bucketFor(count) {
  if (count <= 0) return 0;
  if (count < 4) return 1;
  if (count < 8) return 2;
  if (count < 16) return 3;
  return 4;
}

const RAMP = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];

function buildWeeks(calendar) {
  const byDate = new Map();
  for (const entry of calendar ?? []) {
    if (entry?.date) byDate.set(entry.date, Number(entry.count) || 0);
  }
  // Anchor to the last Saturday so columns align to weeks; walk backwards from
  // today by `WEEKS * 7` days, rounding up to complete the current week.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dow = today.getUTCDay(); // 0..6 (Sun..Sat)
  const lastCol = new Date(today);
  lastCol.setUTCDate(today.getUTCDate() + (6 - dow)); // roll forward to Saturday

  const weeks = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(lastCol);
      cur.setUTCDate(lastCol.getUTCDate() - w * 7 - (6 - d));
      const key = cur.toISOString().slice(0, 10);
      const count = byDate.get(key) ?? 0;
      days.push({ date: key, count, bucket: bucketFor(count) });
    }
    weeks.push(days);
  }
  return weeks;
}

export default function ContributionHeatmap({ calendar = [] }) {
  const reduced = useReducedMotion();
  const weeks = useMemo(() => buildWeeks(calendar), [calendar]);
  const [hover, setHover] = useState(null);

  const total = useMemo(
    () => (calendar ?? []).reduce((sum, e) => sum + (Number(e?.count) || 0), 0),
    [calendar],
  );

  const cellSize = 11;
  const gap = 3;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-ghmuted">
          <span className="text-ghfg font-semibold">{total.toLocaleString()}</span> contributions
          in the last year
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ghmuted">
          <span>Less</span>
          {RAMP.map((c) => (
            <span
              key={c}
              className="rounded-sm"
              style={{ background: c, width: cellSize, height: cellSize }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
      <div
        className="grid overflow-x-auto"
        style={{
          gridTemplateColumns: `repeat(${WEEKS}, ${cellSize}px)`,
          gap,
          gridAutoFlow: 'column',
        }}
        aria-label="Contribution heatmap"
      >
        {weeks.map((week, wi) =>
          week.map((day, di) => (
            <div
              key={`${wi}-${di}`}
              className={`rounded-[2px] cursor-pointer ${reduced ? '' : 'animate-wave'}`}
              style={{
                width: cellSize,
                height: cellSize,
                background: RAMP[day.bucket],
                animationDelay: reduced ? undefined : `${(wi * 3 + di) * 4}ms`,
              }}
              onMouseEnter={() => setHover(day)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(day)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${day.date}: ${day.count} contributions`}
              title={`${day.date}: ${day.count} contributions`}
            />
          )),
        )}
      </div>
      {hover && (
        <div className="mt-3 text-xs text-ghmuted">
          <span className="text-ghfg font-semibold">{hover.count}</span> contribution
          {hover.count === 1 ? '' : 's'} on {hover.date}
        </div>
      )}
    </div>
  );
}
