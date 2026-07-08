/**
 * Home page.
 *
 * Renders:
 *   1. Hero with primary CTAs
 *   2. Cohort list (Global first, then active PROGRAM, then ended) — one
 *      GET /cohorts call
 *   3. "Global top 5" podium — one GET /cohorts/global/leaderboard call
 *
 * Every card handles loading/error/empty independently so a slow leaderboard
 * doesn't hold the cohort list back.
 */

import { Link } from 'react-router-dom';
import {
  getCohorts,
  getHealth,
  getLeaderboard,
} from '../lib/api.js';
import { useFetch, compact, cohortStatus, hasEnded, timeAgo } from '../lib/util.js';
import {
  IconFlame,
  IconGitCommit,
  IconMarkGithub,
  IconPeople,
  IconTrophy,
} from '../components/Icons.jsx';
import {
  Avatar,
  EmptyState,
  ErrorState,
  Loading,
  MemberLink,
} from '../components/ui.jsx';

export default function Home() {
  return (
    <div className="container stack gap-24">
      <Hero />
      <PodiumCard />
      <CohortList />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="hero">
      <div className="stack gap-8">
        <h1>Ship in public. Climb the board.</h1>
        <p>
          GitRank tracks the public GitHub activity of everyone in the program, ranks
          them on cohort leaderboards, and awards titles that transfer when someone
          takes them from you. Read-only, opt-in, zero passwords.
        </p>
        <div className="cta">
          <Link to="/join" className="btn primary">
            <IconPeople size={16} /> Join a cohort
          </Link>
          <Link to="/cohorts/global" className="btn">
            <IconTrophy size={16} /> Global leaderboard
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer noopener"
            className="btn"
          >
            <IconMarkGithub size={16} /> About GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PodiumCard() {
  const health = useFetch(getHealth, []);
  const board = useFetch(() => getLeaderboard('global', 'commits'), []);

  return (
    <section className="box">
      <div className="box-header">
        <IconTrophy size={16} />
        <h2>Global top 5 — commits</h2>
        <span className="counter">rolling 365d</span>
        <span className="right muted text-sm">
          {health.data?.lastSnapshotAt
            ? <>synced {timeAgo(health.data.lastSnapshotAt)}</>
            : 'never synced'}
        </span>
      </div>
      <div className="box-body">
        {board.loading && <Loading rows={3} height={20} />}
        {board.error && <ErrorState error={board.error} onRetry={board.retry} />}
        {!board.loading && !board.error && (
          board.data?.ranking?.length ? (
            <div className="podium">
              {board.data.ranking.slice(0, 5).map((r, i) => (
                <div key={r.member.githubUsername} className="slot">
                  <span className={`rank ${['gold', 'silver', 'bronze'][i] ?? ''}`}>
                    <span className="dot" /> #{r.rank}
                  </span>
                  <Avatar
                    src={r.member.avatarUrl}
                    alt={r.member.displayName || r.member.githubUsername}
                    size={44}
                  />
                  <Link
                    to={`/u/${encodeURIComponent(r.member.githubUsername)}`}
                    className="link-plain text-sm"
                  >
                    @{r.member.githubUsername}
                  </Link>
                  <span className="num text-lg">
                    <IconGitCommit size={12} /> {compact(r.stats?.totalCommits ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<IconFlame size={28} />}
              title="No members yet"
              description="Nobody's on the global board. Be the first."
              action={<Link to="/join" className="btn primary">Join</Link>}
            />
          )
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function CohortList() {
  const { data, error, loading, retry } = useFetch(getCohorts, []);

  const partition = (cohorts) => {
    const now = new Date();
    const globals = [];
    const active = [];
    const ended = [];
    for (const c of cohorts) {
      if (c.kind === 'GLOBAL') globals.push(c);
      else if (!c.isActive || hasEnded(c, now)) ended.push(c);
      else active.push(c);
    }
    return [...globals, ...active, ...ended];
  };

  return (
    <section className="stack gap-12">
      <div className="row gap-8">
        <h2>Cohorts</h2>
        <span className="counter">{data?.cohorts?.length ?? 0}</span>
      </div>

      {loading && <Loading rows={3} height={72} />}
      {error && <ErrorState error={error} onRetry={retry} />}
      {!loading && !error && (
        data?.cohorts?.length ? (
          <div className="cohort-grid">
            {partition(data.cohorts).map((c) => <CohortCard key={c.slug} cohort={c} />)}
          </div>
        ) : (
          <EmptyState
            title="No cohorts yet"
            description="Once an organiser creates one, it'll show up here."
          />
        )
      )}
    </section>
  );
}

function CohortCard({ cohort }) {
  const status = cohortStatus(cohort);
  const labelClass =
    status === 'Ended' ? 'neutral'
      : status === 'Inactive' ? 'danger'
      : cohort.kind === 'GLOBAL' ? 'done'
      : 'success';
  return (
    <Link to={`/cohorts/${encodeURIComponent(cohort.slug)}`} className="cohort-card link-plain">
      <div className="row gap-8">
        <span className="title">{cohort.name}</span>
        <span className="right">
          <span className={`label ${labelClass}`}>{status}</span>
        </span>
      </div>
      <div className="meta">
        <span className="mono">{cohort.slug}</span>
        <span><IconPeople size={12} /> {cohort.memberCount ?? 0} members</span>
      </div>
    </Link>
  );
}
