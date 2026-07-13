/**
 * Profile — gamified member page.
 *
 * Left column (sticky on wide screens):
 *   - Avatar wrapped in an XP ring showing level progress for the primary cohort.
 *   - Streak flame + count with milestone glow.
 *   - Compact identity block (login, GitHub since, followers, GitHub link).
 *
 * Right column:
 *   - Per-cohort progression card (XP, level, xp-to-next-level count-up).
 *   - Contribution heatmap from the latest snapshot's calendar.
 *   - Language "skills" (Duolingo circular icons w/ mini progress rings).
 *   - Held titles + badges — the existing GitHub-Primer chips.
 *
 * Level-up detection fires once per (username, level) via LevelUpToast.
 *
 * Data: GET /members/:username.
 */

import { Link, useParams } from 'react-router-dom';
import { ApiError, getMember } from '../lib/api.js';
import { useFetch, num, shortDate, timeAgo } from '../lib/util.js';
import { Avatar, EmptyState, ErrorState } from '../components/ui.jsx';
import {
  IconCalendar,
  IconLink,
  IconMarkGithub,
  IconMedal,
  IconPeople,
  IconTrophy,
} from '../components/Icons.jsx';
import XpRing from '../components/duo/XpRing.jsx';
import StreakFlame from '../components/duo/StreakFlame.jsx';
import LanguageSkills from '../components/duo/LanguageSkills.jsx';
import ContributionHeatmap from '../components/duo/ContributionHeatmap.jsx';
import CountUp from '../components/duo/CountUp.jsx';
import LevelUpToast from '../components/duo/LevelUpToast.jsx';
import { SkeletonList } from '../components/duo/SkeletonRow.jsx';
import { progressionFrom } from '../lib/xp.js';

const GLOBAL_SLUG = 'global';

export default function Profile() {
  const { username } = useParams();
  const { data, error, loading, retry } = useFetch(() => getMember(username), [username]);

  if (loading) {
    return (
      <div className="container">
        <SkeletonList rows={6} />
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
          action={
            <Link to="/join" className="btn primary">
              Join a cohort
            </Link>
          }
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="container">
        <ErrorState error={error} onRetry={retry} />
      </div>
    );
  }
  if (!data) return null;

  const { member, cohorts, titles, badges } = data;
  const globalCohort = cohorts.find((c) => c.cohort.slug === GLOBAL_SLUG) ?? cohorts[0] ?? null;
  const primaryProg = progressionFrom(globalCohort ?? {});
  const currentStreak = globalCohort?.stats?.currentStreak ?? 0;
  const followers = latestStat(cohorts, 'followers');
  const totalXp = cohorts.reduce((acc, c) => acc + (c.stats?.xp ?? 0), 0);
  const badgeAwards = badges.length ? badges : titles.filter((t) => t.kind === 'BADGE');

  return (
    <div className="container">
      <LevelUpToast username={member.githubUsername} level={primaryProg.level} />

      <div className="grid gap-8 lg:grid-cols-[300px_1fr] items-start">
        <aside className="lg:sticky lg:top-20 space-y-4">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-ghborder bg-ghsurface p-5">
            <XpRing
              size={220}
              strokeWidth={12}
              progress={primaryProg.levelProgress}
              level={primaryProg.level}
              badgeSize={54}
            >
              <Avatar
                src={member.avatarUrl}
                alt={member.displayName || member.githubUsername}
                size={192}
              />
            </XpRing>
            <div className="text-center">
              <h1 className="text-2xl font-black text-ghfg">
                {member.displayName || member.githubUsername}
              </h1>
              <div className="text-ghmuted font-mono">@{member.githubUsername}</div>
            </div>
            <div className="w-full grid grid-cols-2 gap-2 text-center">
              <StatChip label="Total XP" value={<CountUp value={totalXp} className="text-duo-green" />} />
              <StatChip label="Level" value={<span className="text-duo-green">{primaryProg.level}</span>} />
            </div>
            <StreakFlame days={currentStreak} />
          </div>

          <dl className="rounded-2xl border-2 border-ghborder bg-ghsurface p-4 text-sm text-ghfg grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-ghmuted">
              <IconCalendar size={12} /> Joined
            </dt>
            <dd>{shortDate(member.createdAt)}</dd>
            {member.accountCreatedAt && (
              <>
                <dt className="text-ghmuted">
                  <IconMarkGithub size={12} /> GitHub since
                </dt>
                <dd>{shortDate(member.accountCreatedAt)}</dd>
              </>
            )}
            {followers != null && (
              <>
                <dt className="text-ghmuted">
                  <IconPeople size={12} /> Followers
                </dt>
                <dd>{num(followers)}</dd>
              </>
            )}
          </dl>

          <a
            className="block text-center rounded-xl border-2 border-ghborder bg-ghsurface hover:border-duo-green py-2 font-bold text-ghfg"
            href={`https://github.com/${encodeURIComponent(member.githubUsername)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <IconLink size={14} /> View on GitHub
          </a>
        </aside>

        <section className="space-y-6">
          {cohorts.map((c) => (
            <CohortBlock key={c.cohort.slug} entry={c} />
          ))}

          {(titles?.length ?? 0) + badgeAwards.length > 0 && (
            <TitleAndBadgeBlock titles={titles ?? []} badges={badgeAwards} />
          )}
        </section>
      </div>
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <div className="rounded-xl border-2 border-ghborder bg-ghinset px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ghmuted font-semibold">{label}</div>
      <div className="text-lg font-black font-mono">{value}</div>
    </div>
  );
}

function CohortBlock({ entry }) {
  const prog = progressionFrom(entry);
  const stats = entry.stats;
  const topLanguages = stats?.topLanguages ?? [];
  const extraCount = Math.max(0, (stats?.languageCount ?? 0) - topLanguages.length);

  return (
    <section className="rounded-2xl border-2 border-ghborder bg-ghsurface overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ghborder bg-ghinset">
        <Link
          to={`/cohorts/${encodeURIComponent(entry.cohort.slug)}`}
          className="font-bold text-ghfg hover:text-duo-green"
        >
          {entry.cohort.name}
        </Link>
        <span className="text-xs text-ghmuted font-mono">{entry.cohort.slug}</span>
        <span className="ml-auto text-xs text-ghmuted">
          {stats?.capturedAt ? <>synced {timeAgo(stats.capturedAt)}</> : 'first sync pending'}
        </span>
      </header>

      <div className="p-4 space-y-5">
        {stats ? (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 rounded-xl bg-ghinset border-2 border-ghborder px-4 py-2">
                <div className="text-3xl font-black text-duo-green font-mono leading-none">
                  <CountUp value={prog.xp} />
                </div>
                <div className="text-xs uppercase tracking-wide text-ghmuted">XP</div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-ghinset border-2 border-ghborder px-4 py-2">
                <div className="rounded-full bg-duo-green text-black font-black w-8 h-8 grid place-items-center">
                  {prog.level}
                </div>
                <div className="text-xs text-ghmuted">
                  {prog.xpToNextLevel > 0 ? (
                    <>
                      <span className="font-mono text-ghfg font-bold">
                        {prog.xpToNextLevel.toLocaleString()}
                      </span>{' '}
                      XP to level {prog.level + 1}
                    </>
                  ) : (
                    'max level reached'
                  )}
                </div>
              </div>
            </div>

            {stats.calendar && (
              <div className="rounded-xl border border-ghborder bg-ghinset p-4">
                <ContributionHeatmap calendar={stats.calendar} />
              </div>
            )}

            {topLanguages.length > 0 && (
              <div>
                <div className="text-sm text-ghmuted mb-2">Language skills</div>
                <LanguageSkills topLanguages={topLanguages} extraCount={extraCount} />
              </div>
            )}
          </>
        ) : (
          <div className="text-ghmuted italic">
            First sync pending — stats and XP appear after the next scheduled run.
          </div>
        )}
      </div>
    </section>
  );
}

function TitleAndBadgeBlock({ titles, badges }) {
  const records = titles.filter((t) => t.kind === 'RECORD');
  return (
    <section className="rounded-2xl border-2 border-ghborder bg-ghsurface p-4 space-y-4">
      <div>
        <h2 className="text-lg font-black text-ghfg mb-2">
          <IconTrophy size={16} /> Titles held
        </h2>
        {records.length ? (
          <div className="flex flex-wrap gap-2">
            {records.map((t, i) => (
              <span
                key={i}
                className={
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border-2 ' +
                  (t.active
                    ? 'bg-duo-gold/15 text-duo-gold border-duo-gold/40'
                    : 'bg-ghinset text-ghmuted border-ghborder line-through opacity-75')
                }
              >
                <IconTrophy size={10} /> {t.name}
                <span className="opacity-70">· {t.cohort.name}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-ghmuted text-sm italic">No records held yet.</div>
        )}
      </div>
      <div>
        <h2 className="text-lg font-black text-ghfg mb-2">
          <IconMedal size={16} /> Badges
        </h2>
        {badges.length ? (
          <div className="flex flex-wrap gap-2">
            {badges.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full bg-duo-green/15 text-duo-green border-2 border-duo-green/40 px-3 py-1 text-xs font-bold"
              >
                <IconMedal size={10} /> {b.name}
                <span className="opacity-70">· {b.cohort?.name}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-ghmuted text-sm italic">Keep shipping.</div>
        )}
      </div>
    </section>
  );
}

function latestStat(cohorts, key) {
  for (const c of cohorts) {
    if (c.stats && c.stats[key] != null) return c.stats[key];
  }
  return null;
}
