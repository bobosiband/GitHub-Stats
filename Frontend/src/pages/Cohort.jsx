/**
 * Cohort shell — header (name, status, window, member count) plus a repo-style
 * underline tab nav routing to Leaderboard / Titles / Analytics via <Outlet/>.
 *
 * Data:
 *   GET /cohorts/:slug           — cohort header
 *   (child tabs fetch their own payloads)
 *
 * We surface the header immediately even while the child tab loads, and pass
 * the loaded cohort down to children via <Outlet context> so Analytics/Titles
 * can display the cohort name without re-fetching.
 */

import { NavLink, Outlet, useParams } from 'react-router-dom';
import { getCohort } from '../lib/api.js';
import { useFetch, cohortStatus, shortDate, hasEnded } from '../lib/util.js';
import { ErrorState, Loading } from '../components/ui.jsx';
import { IconCalendar, IconGraph, IconPeople, IconTrophy } from '../components/Icons.jsx';

export default function Cohort() {
  const { slug } = useParams();
  const { data, error, loading, retry } = useFetch(() => getCohort(slug), [slug]);
  const cohort = data?.cohort;

  return (
    <div className="container stack gap-16">
      {loading && <Loading rows={2} height={28} />}
      {error && <ErrorState error={error} onRetry={retry} title={`Couldn't load cohort "${slug}"`} />}
      {cohort && (
        <>
          <header className="stack gap-8">
            <div className="row gap-12 wrap">
              <h1>{cohort.name}</h1>
              <span className={`label ${labelClassFor(cohort)}`}>{cohortStatus(cohort)}</span>
              <span className="mono muted text-sm">{cohort.slug}</span>
            </div>
            <div className="row gap-12 wrap muted text-sm">
              <span><IconCalendar size={12} /> {windowLabel(cohort)}</span>
              <span><IconPeople size={12} /> {cohort.memberCount ?? 0} members</span>
              {cohort.kind === 'GLOBAL' && (
                <span className="text-sm">
                  Rolling 365-day window — titles here are <em>rolling records</em> and can
                  lapse as older activity falls out of the window.
                </span>
              )}
            </div>
          </header>

          <nav className="underline-nav" aria-label="Cohort sections">
            <NavLink to="." end className={({ isActive }) => (isActive ? 'active' : '')}>
              <IconGraph size={14} /> Leaderboard
            </NavLink>
            <NavLink to="titles" className={({ isActive }) => (isActive ? 'active' : '')}>
              <IconTrophy size={14} /> Titles
            </NavLink>
            <NavLink to="analytics" className={({ isActive }) => (isActive ? 'active' : '')}>
              <IconGraph size={14} /> Analytics
            </NavLink>
          </nav>

          <Outlet context={{ cohort }} />
        </>
      )}
    </div>
  );
}

function labelClassFor(cohort) {
  if (cohort.kind === 'GLOBAL') return 'done';
  if (!cohort.isActive) return 'danger';
  if (hasEnded(cohort)) return 'neutral';
  return 'success';
}

function windowLabel(cohort) {
  if (cohort.kind === 'GLOBAL') return 'Rolling 365 days';
  const end = cohort.endDate ? shortDate(cohort.endDate) : 'ongoing';
  return `${shortDate(cohort.startDate)} — ${end}`;
}
