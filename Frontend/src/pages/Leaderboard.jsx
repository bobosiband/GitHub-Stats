/**
 * Leaderboard — the default (index) tab of the Cohort page.
 *
 * Table columns:
 *   rank, member (avatar + name + login), commits, contributions, streak, stars,
 *   plus merged PRs and current streak on wider screens.
 *
 * Sortable columns are the four the backend supports (commits, contributions,
 * streak, stars) — sort is a URL query param so it survives refresh + share.
 * The actively-sorted column renders a green heat bar scaled to the leader's
 * value. Members without a snapshot render `—` and sort last.
 *
 * Data: GET /cohorts/:slug/leaderboard?sort=<sort>
 */

import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { getLeaderboard } from '../lib/api.js';
import { useFetch, timeAgo } from '../lib/util.js';
import { EmptyState, ErrorState, HeatStat, Loading, MemberLink } from '../components/ui.jsx';
import { IconFlame, IconGitCommit, IconGitPR, IconGraph, IconStar, IconTrophy } from '../components/Icons.jsx';

const SORTS = ['commits', 'contributions', 'streak', 'stars'];

const SORT_META = {
  commits:       { key: 'totalCommits',       label: 'Commits',        icon: IconGitCommit },
  contributions: { key: 'totalContributions', label: 'Contributions',  icon: IconGraph },
  streak:        { key: 'longestStreak',      label: 'Longest streak', icon: IconFlame },
  stars:         { key: 'totalStars',         label: 'Stars',          icon: IconStar },
};

export default function Leaderboard() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { cohort } = useOutletContext() ?? {};

  const requestedSort = params.get('sort');
  const sort = SORTS.includes(requestedSort) ? requestedSort : 'commits';

  const { data, error, loading, retry } = useFetch(
    () => getLeaderboard(slug, sort),
    [slug, sort],
  );

  const setSort = (next) => {
    const p = new URLSearchParams(params);
    if (next === 'commits') p.delete('sort'); else p.set('sort', next);
    setParams(p, { replace: true });
  };

  const activeMeta = SORT_META[sort];
  const ranking = data?.ranking ?? [];
  const leaderVal =
    ranking.find((r) => r.stats)?.stats?.[activeMeta.key] ?? 0;

  const lastSyncedAt =
    ranking.map((r) => r.stats?.capturedAt).filter(Boolean).sort().pop() ?? null;

  return (
    <section className="stack gap-12">
      {loading && <Loading rows={5} height={40} />}
      {error && <ErrorState error={error} onRetry={retry} />}
      {!loading && !error && (
        ranking.length ? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" aria-label={`${cohort?.name ?? slug} leaderboard`}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>#</th>
                    <th>Member</th>
                    {SORTS.map((s) => {
                      const Meta = SORT_META[s];
                      const Icon = Meta.icon;
                      return (
                        <th
                          key={s}
                          className="sortable num-col"
                          aria-sort={s === sort ? 'descending' : 'none'}
                          onClick={() => setSort(s)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSort(s); }
                          }}
                          tabIndex={0}
                          role="button"
                          title={`Sort by ${Meta.label.toLowerCase()}`}
                        >
                          <span className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                            <Icon size={12} /> {Meta.label}
                          </span>
                        </th>
                      );
                    })}
                    <th className="num-col hide-sm">
                      <span className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                        <IconGitPR size={12} /> Merged
                      </span>
                    </th>
                    <th className="num-col hide-xs">
                      <span className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                        <IconFlame size={12} /> Current
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => (
                    <tr key={r.member.githubUsername}>
                      <td>
                        <span className={`rank ${['gold', 'silver', 'bronze'][i] ?? ''}`}>
                          <span className="dot" /> {r.rank}
                        </span>
                      </td>
                      <td><MemberLink member={r.member} /></td>
                      {SORTS.map((s) => {
                        const meta = SORT_META[s];
                        const v = r.stats?.[meta.key];
                        const active = s === sort;
                        return (
                          <td key={s} className="num-col">
                            {v == null ? (
                              <span className="muted">—</span>
                            ) : active ? (
                              <HeatStat value={v} max={leaderVal} top={i === 0} />
                            ) : (
                              <span className="num">{Number(v).toLocaleString()}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num-col hide-sm">
                        {r.stats?.mergedPRs == null
                          ? <span className="muted">—</span>
                          : <span className="num">{r.stats.mergedPRs.toLocaleString()}</span>}
                      </td>
                      <td className="num-col hide-xs">
                        {r.stats?.currentStreak == null
                          ? <span className="muted">—</span>
                          : <span className="num">{r.stats.currentStreak}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={8} className="text-sm muted" style={{ padding: 10 }}>
                      {lastSyncedAt
                        ? <>Last sync {timeAgo(lastSyncedAt)}.</>
                        : 'No members have been synced yet.'}
                      {' '}Unsynced members sort last.
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<IconTrophy size={28} />}
            title="No members on this cohort yet"
            description="Once someone joins and gets synced, they'll show up here."
            action={<Link to="/join" className="btn primary">Join</Link>}
          />
        )
      )}
    </section>
  );
}
