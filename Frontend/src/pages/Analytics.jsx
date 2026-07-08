/**
 * Analytics tab — computed entirely client-side from the cohort's leaderboard
 * payload (no extra endpoints). We reuse the same GET /cohorts/:slug/leaderboard
 * response the Leaderboard tab uses; the api.js 60s cache means it's typically a
 * cache hit and this tab is instant.
 *
 * What we show:
 *   - Cohort totals: commits, contributions, merged PRs, stars
 *   - Top languages, aggregated across every member's `topLanguages`, rendered
 *     as a repo-style language bar with a legend
 *   - Commit-distribution histogram bucketed on totalCommits
 *   - Fun superlatives derived from snapshots (biggest single day, weekend
 *     warrior %, night owl %)
 */

import { useOutletContext, useParams } from 'react-router-dom';
import { getLeaderboard } from '../lib/api.js';
import { useFetch, num, pct } from '../lib/util.js';
import { EmptyState, ErrorState, LanguageBar, Loading, MemberLink, StatCard } from '../components/ui.jsx';
import { IconGraph } from '../components/Icons.jsx';

export default function Analytics() {
  const { slug } = useParams();
  const { cohort } = useOutletContext() ?? {};
  const { data, error, loading, retry } = useFetch(
    () => getLeaderboard(slug, 'commits'),
    [slug],
  );

  if (loading) return <Loading rows={5} height={40} />;
  if (error)   return <ErrorState error={error} onRetry={retry} />;
  const ranking = data?.ranking ?? [];
  if (!ranking.length) {
    return (
      <EmptyState
        icon={<IconGraph size={28} />}
        title="No data yet"
        description="Analytics appear once members join and get synced."
      />
    );
  }

  const withStats = ranking.filter((r) => r.stats);
  const totals = withStats.reduce(
    (t, r) => ({
      commits:       t.commits       + (r.stats.totalCommits       ?? 0),
      contributions: t.contributions + (r.stats.totalContributions ?? 0),
      mergedPRs:     t.mergedPRs     + (r.stats.mergedPRs          ?? 0),
      stars:         t.stars         + (r.stats.totalStars         ?? 0),
    }),
    { commits: 0, contributions: 0, mergedPRs: 0, stars: 0 },
  );

  const languages = aggregateLanguages(withStats);
  const buckets = commitBuckets(withStats.map((r) => r.stats.totalCommits ?? 0));
  const supers = superlatives(withStats);

  return (
    <div className="stack gap-24">
      <section className="stack gap-12">
        <div className="row gap-8"><h2>Cohort totals</h2><span className="muted text-sm">Across {withStats.length} synced members</span></div>
        <div className="stat-card-grid">
          <StatCard label="Commits"       value={num(totals.commits)} />
          <StatCard label="Contributions" value={num(totals.contributions)} />
          <StatCard label="Merged PRs"    value={num(totals.mergedPRs)} />
          <StatCard label="Stars earned"  value={num(totals.stars)} />
        </div>
      </section>

      <section className="box">
        <div className="box-header"><h2>Top languages</h2><span className="right muted text-sm">Aggregated bytes across every member's top-5</span></div>
        <div className="box-body">
          <LanguageBar entries={languages} max={10} />
        </div>
      </section>

      <section className="box">
        <div className="box-header"><h2>Commit distribution</h2><span className="right muted text-sm">Members bucketed by total commits</span></div>
        <div className="box-body">
          <Histogram buckets={buckets} />
        </div>
      </section>

      <section className="box">
        <div className="box-header"><h2>Superlatives</h2></div>
        <div className="box-body">
          <SuperlativesList items={supers} cohortName={cohort?.name ?? slug} />
        </div>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Client-side aggregations
 * -------------------------------------------------------------------------- */

function aggregateLanguages(rows) {
  const totals = new Map();
  for (const r of rows) {
    for (const l of r.stats?.topLanguages ?? []) {
      totals.set(l.name, (totals.get(l.name) ?? 0) + (l.bytes ?? 0));
    }
  }
  return [...totals.entries()].map(([name, bytes]) => ({ name, bytes }));
}

/** Bucket total-commit values into 6 ranges — inclusive lower, exclusive upper. */
function commitBuckets(values) {
  const ranges = [
    { lo: 0, hi: 10, label: '0–9' },
    { lo: 10, hi: 50, label: '10–49' },
    { lo: 50, hi: 150, label: '50–149' },
    { lo: 150, hi: 300, label: '150–299' },
    { lo: 300, hi: 600, label: '300–599' },
    { lo: 600, hi: Infinity, label: '600+' },
  ];
  return ranges.map(({ lo, hi, label }) => ({
    label,
    count: values.filter((v) => v >= lo && v < hi).length,
  }));
}

/** Level [0..4] for the calendar-square cell colouring. */
function levelFor(count, max) {
  if (!count) return 0;
  if (!max) return 1;
  const r = count / max;
  if (r > 0.75) return 4;
  if (r > 0.50) return 3;
  if (r > 0.25) return 2;
  return 1;
}

function Histogram({ buckets }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="histogram" style={{ gridTemplateColumns: `repeat(${buckets.length}, 1fr)` }}>
      {buckets.map((b) => {
        const height = Math.max(12, (b.count / max) * 96);
        return (
          <div key={b.label} className="bucket">
            <div
              className={`cell l${levelFor(b.count, max)}`}
              style={{ height, alignSelf: 'flex-end' }}
              title={`${b.label}: ${b.count} members`}
            />
            <span className="bucket-label">{b.label}</span>
            <span className="bucket-label num">{b.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function superlatives(rows) {
  const bestBy = (getter) =>
    rows.reduce(
      (best, r) => {
        const v = getter(r);
        if (v == null) return best;
        if (best.value == null || v > best.value) return { row: r, value: v };
        return best;
      },
      { row: null, value: null },
    );

  const biggestDay = bestBy((r) => r.stats.maxCommitsInOneDay);
  const weekend    = bestBy((r) => r.stats.weekendCommitRatio);
  const nightOwl   = bestBy((r) => r.stats.nightCommitRatio);
  const longestStreak = bestBy((r) => r.stats.longestStreak);

  return [
    biggestDay.row && {
      label: 'Biggest single day',
      row: biggestDay.row,
      value: `${biggestDay.value} commits`,
    },
    longestStreak.row && {
      label: 'Longest streak',
      row: longestStreak.row,
      value: `${longestStreak.value} days`,
    },
    weekend.row && {
      label: 'Weekend warrior',
      row: weekend.row,
      value: pct(weekend.value, 0) + ' on weekends',
    },
    nightOwl.row && nightOwl.value != null && {
      label: 'Night owl',
      row: nightOwl.row,
      value: pct(nightOwl.value, 0) + ' at night',
    },
  ].filter(Boolean);
}

function SuperlativesList({ items }) {
  if (!items.length) return <div className="muted">Not enough data yet.</div>;
  return (
    <ul className="stack gap-12" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((s) => (
        <li key={s.label} className="row gap-12">
          <div className="stack gap-4" style={{ minWidth: 160 }}>
            <span className="muted text-sm">{s.label}</span>
            <span className="mono">{s.value}</span>
          </div>
          <MemberLink member={s.row.member} size={28} />
        </li>
      ))}
    </ul>
  );
}
