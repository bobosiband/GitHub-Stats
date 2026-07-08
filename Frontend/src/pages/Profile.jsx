/**
 * Profile — GitHub-style two-column member page.
 *
 * Left (sticky):  big avatar, display name, @login, zID, joined date, GitHub link.
 * Right:          per-cohort stat-card grid, aggregate language bar, held titles
 *                 (records — lapsed ones dimmed + struck), badges list.
 *
 * Data: GET /members/:username. Renders a friendly "no such member" blankslate
 * on 404 and points at the Join page.
 */

import { Link, useParams } from 'react-router-dom';
import { ApiError, getMember } from '../lib/api.js';
import { useFetch, num, shortDate, timeAgo } from '../lib/util.js';
import {
  Avatar,
  EmptyState,
  ErrorState,
  LanguageBar,
  Loading,
  StatCard,
} from '../components/ui.jsx';
import {
  IconCalendar,
  IconFlame,
  IconGitCommit,
  IconGitPR,
  IconLink,
  IconMarkGithub,
  IconMedal,
  IconPeople,
  IconStar,
  IconTrophy,
} from '../components/Icons.jsx';

export default function Profile() {
  const { username } = useParams();
  const { data, error, loading, retry } = useFetch(() => getMember(username), [username]);

  if (loading) {
    return (
      <div className="container">
        <Loading rows={6} height={22} />
      </div>
    );
  }
  if (error && error instanceof ApiError && error.status === 404) {
    return (
      <div className="container">
        <EmptyState
          icon={<IconPeople size={32} />}
          title="No such member"
          description={`We couldn't find @${username}. Have they joined yet?`}
          action={<Link to="/join" className="btn primary">Join a cohort</Link>}
        />
      </div>
    );
  }
  if (error) {
    return <div className="container"><ErrorState error={error} onRetry={retry} /></div>;
  }
  if (!data) return null;

  const { member, cohorts, titles, badges } = data;
  const languages = aggregateLangs(cohorts);
  const activeRecords = titles.filter((t) => t.kind === 'RECORD');
  const badgeAwards = badges.length ? badges : titles.filter((t) => t.kind === 'BADGE');
  const followers = latestStat(cohorts, 'followers');

  return (
    <div className="container">
      <div className="profile-grid">
        <aside className="profile-sidebar" aria-label="Member details">
          <Avatar src={member.avatarUrl} alt={member.displayName || member.githubUsername} size={260} />
          <div>
            <h1>{member.displayName || member.githubUsername}</h1>
            <div className="login">@{member.githubUsername}</div>
          </div>
          <dl>
            <dt><IconCalendar size={12} /> Joined</dt>
            <dd>{shortDate(member.createdAt)}</dd>
            {member.accountCreatedAt && (
              <>
                <dt><IconMarkGithub size={12} /> GitHub since</dt>
                <dd>{shortDate(member.accountCreatedAt)}</dd>
              </>
            )}
            {followers != null && (
              <>
                <dt><IconPeople size={12} /> Followers</dt>
                <dd>{num(followers)}</dd>
              </>
            )}
            <dt>zID</dt>
            <dd className="mono">{member.zid}</dd>
          </dl>
          <div>
            <a
              className="btn"
              href={`https://github.com/${encodeURIComponent(member.githubUsername)}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <IconLink size={14} /> View on GitHub
            </a>
          </div>
        </aside>

        <section className="stack gap-24">
          <section>
            <div className="row gap-8 mb-16">
              <h2>Cohorts</h2>
              <span className="counter">{cohorts.length}</span>
            </div>
            {cohorts.length ? (
              <div className="stack gap-16">
                {cohorts.map((c) => <CohortStatsBlock key={c.cohort.slug} c={c} />)}
              </div>
            ) : (
              <EmptyState
                title="Not on any cohorts yet"
                description="Once they join, their per-cohort stats show up here."
              />
            )}
          </section>

          {languages.length > 0 && (
            <section className="box">
              <div className="box-header"><h3>Language mix</h3><span className="right muted text-sm">Across every cohort's latest snapshot</span></div>
              <div className="box-body"><LanguageBar entries={languages} /></div>
            </section>
          )}

          <section>
            <div className="row gap-8 mb-16">
              <h2>Titles held</h2>
              <span className="counter">{activeRecords.filter((t) => t.active).length}</span>
            </div>
            {activeRecords.length ? (
              <div className="title-badge-list">
                {activeRecords.map((t, i) => (
                  <span key={i} className={`chip ${t.active ? '' : 'lapsed'}`}>
                    <IconTrophy size={12} />
                    <span>{t.name}</span>
                    <span className="muted">· {t.cohort.name}</span>
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconTrophy size={24} />}
                title="No records yet"
                description="Records show up here as soon as they hold one."
              />
            )}
          </section>

          <section>
            <div className="row gap-8 mb-16">
              <h2>Badges</h2>
              <span className="counter">{badgeAwards.length}</span>
            </div>
            {badgeAwards.length ? (
              <div className="title-badge-list">
                {badgeAwards.map((b, i) => (
                  <span key={i} className="chip">
                    <IconMedal size={12} />
                    <span>{b.name}</span>
                    <span className="muted">· {b.cohort?.name}</span>
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconMedal size={24} />}
                title="No badges yet"
                description="Keep shipping."
              />
            )}
          </section>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CohortStatsBlock({ c }) {
  const s = c.stats;
  return (
    <div className="box">
      <div className="box-header">
        <Link to={`/cohorts/${encodeURIComponent(c.cohort.slug)}`} className="link-plain">
          <strong>{c.cohort.name}</strong>
        </Link>
        <span className="muted text-sm mono">{c.cohort.slug}</span>
        <span className="right muted text-sm">
          {s?.capturedAt ? <>synced {timeAgo(s.capturedAt)}</> : 'not yet synced'}
        </span>
      </div>
      <div className="box-body">
        {s ? (
          <div className="stat-card-grid">
            <StatCard label="Commits"       value={<><IconGitCommit size={12} /> {num(s.totalCommits)}</>} />
            <StatCard label="Contributions" value={num(s.totalContributions)} />
            <StatCard label="Merged PRs"    value={<><IconGitPR size={12} /> {num(s.mergedPRs)}</>} />
            <StatCard label="Stars"         value={<><IconStar size={12} /> {num(s.totalStars)}</>} />
            <StatCard label="Longest streak" value={<><IconFlame size={12} /> {s.longestStreak}</>} />
            <StatCard label="Current streak" value={s.currentStreak} />
            <StatCard label="Languages"      value={s.languageCount} />
            <StatCard label="Repos"          value={s.repoCount} />
          </div>
        ) : (
          <div className="muted">No snapshot yet — stats appear after the next sync.</div>
        )}
      </div>
    </div>
  );
}

/** Merge topLanguages across every cohort's latest snapshot. */
function aggregateLangs(cohorts) {
  const totals = new Map();
  for (const c of cohorts) {
    for (const l of c.stats?.topLanguages ?? []) {
      totals.set(l.name, (totals.get(l.name) ?? 0) + (l.bytes ?? 0));
    }
  }
  return [...totals.entries()].map(([name, bytes]) => ({ name, bytes }));
}

/** Return the first non-null value of a named stat across cohorts. */
function latestStat(cohorts, key) {
  for (const c of cohorts) {
    if (c.stats && c.stats[key] != null) return c.stats[key];
  }
  return null;
}
