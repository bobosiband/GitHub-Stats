/**
 * Leaderboard — default (index) tab of the Cohort page.
 *
 * Duolingo × GitHub treatment:
 *   - Default sort is XP; other sorts stay available for drill-in analysis.
 *   - Every row shows a level ring around the avatar, XP count, rank delta
 *     (▲2 / ▼1 / —) and animates in with a spring stagger.
 *   - Top three land on a chunky podium above the table.
 *
 * Data: GET /cohorts/:slug/leaderboard?sort=<sort>
 */

import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getLeaderboard } from '../lib/api.js';
import { useFetch, timeAgo } from '../lib/util.js';
import { EmptyState, ErrorState, MemberLink } from '../components/ui.jsx';
import {
  IconFlame,
  IconGitCommit,
  IconGraph,
  IconStar,
  IconTrophy,
} from '../components/Icons.jsx';
import XpRing from '../components/duo/XpRing.jsx';
import RankDeltaBadge from '../components/duo/RankDeltaBadge.jsx';
import CountUp from '../components/duo/CountUp.jsx';
import { SkeletonList } from '../components/duo/SkeletonRow.jsx';
import { progressionFrom } from '../lib/xp.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';

const SORTS = ['xp', 'commits', 'contributions', 'streak', 'stars'];
const SORT_META = {
  xp: { label: 'XP', icon: IconTrophy, statKey: 'xp' },
  commits: { label: 'Commits', icon: IconGitCommit, statKey: 'totalCommits' },
  contributions: { label: 'Contributions', icon: IconGraph, statKey: 'totalContributions' },
  streak: { label: 'Longest streak', icon: IconFlame, statKey: 'longestStreak' },
  stars: { label: 'Stars', icon: IconStar, statKey: 'totalStars' },
};

export default function Leaderboard() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { cohort } = useOutletContext() ?? {};
  const reduced = useReducedMotion();

  const requestedSort = params.get('sort');
  const sort = SORTS.includes(requestedSort) ? requestedSort : 'xp';

  const { data, error, loading, retry } = useFetch(
    () => getLeaderboard(slug, sort),
    [slug, sort],
  );

  const setSort = (next) => {
    const p = new URLSearchParams(params);
    if (next === 'xp') p.delete('sort');
    else p.set('sort', next);
    setParams(p, { replace: true });
  };

  const ranking = data?.ranking ?? [];
  const lastSyncedAt =
    ranking.map((r) => r.stats?.capturedAt).filter(Boolean).sort().pop() ?? null;

  if (loading) return <SkeletonList rows={6} />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!ranking.length) {
    return (
      <EmptyState
        icon={<IconTrophy size={28} />}
        title="No members on this cohort yet"
        description="Once someone joins and gets synced, they'll show up here."
        action={
          <Link to="/join" className="btn primary">
            Join
          </Link>
        }
      />
    );
  }

  const podium = ranking.slice(0, 3);
  const rest = ranking.slice(3);

  return (
    <section className="stack gap-24">
      <div className="flex flex-wrap items-center gap-2">
        {SORTS.map((s) => {
          const active = s === sort;
          const Meta = SORT_META[s];
          const Icon = Meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition-transform border-2 ' +
                (active
                  ? 'bg-duo-green text-black border-black/20 shadow-chunkyGreen hover:-translate-y-0.5'
                  : 'bg-ghsurface text-ghfg border-ghborder hover:border-duo-green')
              }
            >
              <Icon size={12} /> {Meta.label}
            </button>
          );
        })}
      </div>

      {/* Podium */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {podium.map((r, i) => (
          <PodiumCard key={r.member.githubUsername} entry={r} tier={i} reduced={reduced} sort={sort} />
        ))}
      </div>

      {/* Rest of the ranking */}
      <div className="stack gap-8">
        {rest.map((r, i) => (
          <LeaderboardRow
            key={r.member.githubUsername}
            entry={r}
            index={i}
            reduced={reduced}
            sort={sort}
          />
        ))}
      </div>

      <div className="text-xs text-ghmuted">
        {lastSyncedAt ? <>Last sync {timeAgo(lastSyncedAt)}. </> : 'No members have been synced yet. '}
        Unsynced members sort last. XP on the <code>global</code> cohort follows a rolling 365-day
        window — it can decrease as old work falls out.
      </div>
    </section>
  );
}

function PodiumCard({ entry, tier, reduced, sort }) {
  const stats = entry.stats;
  const prog = progressionFrom({ stats });
  const activeStatKey = SORT_META[sort].statKey;
  const statValue = stats?.[activeStatKey] ?? 0;
  const tierBg = ['from-duo-gold/30', 'from-white/10', 'from-[#b08d57]/30'][tier];

  return (
    <motion.div
      initial={reduced ? {} : { opacity: 0, y: 20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: 0 } : { delay: tier * 0.08, type: 'spring', stiffness: 240, damping: 22 }}
      className={`relative rounded-2xl border-2 border-ghborder bg-gradient-to-b ${tierBg} to-ghsurface p-4 flex flex-col items-center gap-3`}
    >
      <div className="absolute -top-3 -left-3 rounded-full bg-duo-gold text-black w-8 h-8 flex items-center justify-center font-black shadow-chunky">
        {entry.rank}
      </div>
      <XpRing
        size={110}
        progress={prog.levelProgress}
        level={prog.level}
        badgeSize={30}
      >
        <img
          src={entry.member.avatarUrl}
          alt=""
          className="rounded-full w-full h-full object-cover"
        />
      </XpRing>
      <div className="text-center">
        <Link
          to={`/u/${encodeURIComponent(entry.member.githubUsername)}`}
          className="font-bold text-ghfg hover:text-duo-green"
        >
          {entry.member.displayName || entry.member.githubUsername}
        </Link>
        <div className="text-xs text-ghmuted font-mono">
          @{entry.member.githubUsername}
        </div>
      </div>
      <div className="flex items-center gap-2 font-mono text-ghfg">
        <CountUp value={statValue} className="text-lg font-black text-duo-green" />
        <span className="text-xs uppercase text-ghmuted">{SORT_META[sort].label}</span>
      </div>
      <RankDeltaBadge delta={entry.rankDelta} />
    </motion.div>
  );
}

function LeaderboardRow({ entry, index, reduced, sort }) {
  const stats = entry.stats;
  const prog = progressionFrom({ stats });
  const activeStatKey = SORT_META[sort].statKey;
  const statValue = stats?.[activeStatKey] ?? 0;

  return (
    <motion.div
      initial={reduced ? {} : { opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? { duration: 0 } : { delay: index * 0.03, type: 'spring', stiffness: 260, damping: 24 }}
      whileHover={reduced ? {} : { scale: 1.005 }}
      className="flex items-center gap-4 rounded-xl border-2 border-ghborder bg-ghsurface hover:border-duo-green px-3 py-2"
    >
      <div className="w-8 text-center font-mono text-ghmuted font-bold">{entry.rank}</div>
      <RankDeltaBadge delta={entry.rankDelta} />
      <div className="shrink-0">
        <XpRing size={52} progress={prog.levelProgress} level={prog.level} badgeSize={20} strokeWidth={4}>
          <img
            src={entry.member.avatarUrl}
            alt=""
            className="rounded-full w-full h-full object-cover"
          />
        </XpRing>
      </div>
      <div className="min-w-0 grow">
        <div className="truncate">
          <MemberLink member={entry.member} />
        </div>
        {stats ? (
          <div className="text-xs text-ghmuted font-mono">
            {stats.totalCommits.toLocaleString()} commits · {stats.mergedPRs.toLocaleString()} merged ·{' '}
            {stats.reviewsGiven.toLocaleString()} reviews
          </div>
        ) : (
          <div className="text-xs text-ghmuted italic">first sync pending</div>
        )}
      </div>
      <div className="text-right font-mono">
        <CountUp
          value={statValue}
          className="block text-lg font-black text-duo-green leading-none"
        />
        <div className="text-[10px] uppercase text-ghmuted">{SORT_META[sort].label}</div>
      </div>
    </motion.div>
  );
}
