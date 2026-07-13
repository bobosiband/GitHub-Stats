import { useMemo, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
import { buildGrid, ROWS } from '../../lib/heatmap.js';

/**
 * GitHub-style contribution heatmap: **7 rows (day-of-week) × ~53 columns
 * (weeks)**.
 *
 * The grid uses `gridTemplateRows: repeat(7, cellSize)` + `gridAutoFlow: column`
 * — days flow down each column before moving to the next. The earlier version
 * declared `gridTemplateColumns` with `gridAutoFlow: column` and no
 * `gridTemplateRows`, which collapsed the whole calendar into a single row.
 *
 * The heatmap is **anchored to `capturedAt`** (the date the snapshot was taken)
 * rather than today. The GitHub `contributionsCollection` window ends at that
 * date, and if the app hasn't synced in a while (or you're looking at seed data)
 * anchoring to today would push every day out of the window and render an
 * all-grey grid.
 *
 * Intensity buckets use **quartiles of the member's own nonzero days** so an
 * "average" day for a low-activity member still shows green — matches GitHub's
 * per-user scaling.
 *
 * The pure grid+bucketing math lives in `src/lib/heatmap.js` so it can be
 * unit-tested without a React renderer.
 */

// Ramp reads through `var(--duo-contrib-N)` so the light/dark toggle in the
// header flips the greens to match GitHub's own theme-specific palettes.
const RAMP = [
  'var(--duo-contrib-0)',
  'var(--duo-contrib-1)',
  'var(--duo-contrib-2)',
  'var(--duo-contrib-3)',
  'var(--duo-contrib-4)',
];

export default function ContributionHeatmap({ calendar = [], capturedAt = null }) {
  const reduced = useReducedMotion();
  const anchor = useMemo(() => {
    if (!capturedAt) return new Date();
    const d = new Date(capturedAt);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [capturedAt]);

  const cells = useMemo(() => buildGrid(calendar, anchor), [calendar, anchor]);
  const [hover, setHover] = useState(null);

  const total = useMemo(
    () => (calendar ?? []).reduce((sum, e) => sum + (Number(e?.count) || 0), 0),
    [calendar],
  );

  const cellSize = 11;
  const gap = 3;

  const monthLabels = useMemo(() => buildMonthLabels(cells, ROWS, cellSize, gap), [cells]);

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
      <div className="overflow-x-auto">
        <div className="relative" style={{ paddingLeft: 22 }}>
          <div
            className="flex text-[10px] text-ghmuted mb-1 select-none"
            style={{ paddingLeft: 0, gap }}
          >
            {monthLabels.map((label, i) => (
              <span
                key={i}
                style={{ width: cellSize, minWidth: cellSize, textAlign: 'left' }}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="flex" style={{ gap }}>
            <div
              className="flex flex-col text-[10px] text-ghmuted select-none"
              style={{ marginRight: 4, gap }}
              aria-hidden="true"
            >
              {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, i) => (
                <span key={i} style={{ height: cellSize, lineHeight: `${cellSize}px` }}>
                  {label}
                </span>
              ))}
            </div>
            <div
              className="grid"
              style={{
                gridTemplateRows: `repeat(${ROWS}, ${cellSize}px)`,
                gridAutoFlow: 'column',
                gridAutoColumns: `${cellSize}px`,
                gap,
              }}
              aria-label="Contribution heatmap"
              role="grid"
            >
              {cells.map((day, i) => (
                <div
                  key={i}
                  className={`rounded-[2px] cursor-pointer focus:outline focus:outline-2 focus:outline-duo-green ${
                    reduced ? '' : 'animate-wave'
                  }`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: day.future ? 'transparent' : RAMP[day.bucket],
                    animationDelay: reduced ? undefined : `${i * 2}ms`,
                  }}
                  onMouseEnter={() => setHover(day)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(day)}
                  onBlur={() => setHover(null)}
                  tabIndex={day.future ? -1 : 0}
                  role="gridcell"
                  aria-label={
                    day.future ? '' : `${day.date}: ${day.count} contributions`
                  }
                  title={day.future ? '' : `${day.date}: ${day.count} contribution${day.count === 1 ? '' : 's'}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs text-ghmuted min-h-[1.25rem]">
        {hover ? (
          <>
            <span className="text-ghfg font-semibold">{hover.count}</span> contribution
            {hover.count === 1 ? '' : 's'} on {hover.date}
          </>
        ) : (
          <span className="opacity-70">Hover a cell for the day&apos;s count.</span>
        )}
      </div>
    </div>
  );
}

/** Compute "Jan / Feb / …" labels per column, blank when the label would repeat. */
function buildMonthLabels(cells) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const labels = [];
  let lastMonth = null;
  for (let c = 0; c < cells.length; c += ROWS) {
    // Use the first cell of each column (top-of-column = Sunday of that week).
    const day = cells[c];
    if (!day?.date) {
      labels.push('');
      continue;
    }
    const m = months[Number(day.date.slice(5, 7)) - 1];
    if (m !== lastMonth) {
      labels.push(m);
      lastMonth = m;
    } else {
      labels.push('');
    }
  }
  return labels;
}
