/**
 * Titles tab — records + badges for a cohort.
 *
 * Records: one holder per cohort, transfers on strictly-better challenger.
 * Badges: additive, permanent; anyone who qualifies keeps them.
 *
 * Data: GET /cohorts/:slug/titles
 */

import { useOutletContext, useParams } from 'react-router-dom';
import { getCohortTitles } from '../lib/api.js';
import { useFetch, num, timeAgo } from '../lib/util.js';
import { Avatar, EmptyState, ErrorState, Loading, MemberLink } from '../components/ui.jsx';
import { IconMedal, IconTrophy } from '../components/Icons.jsx';

export default function Titles() {
  const { slug } = useParams();
  const { cohort } = useOutletContext() ?? {};
  const { data, error, loading, retry } = useFetch(() => getCohortTitles(slug), [slug]);

  return (
    <div className="stack gap-24">
      {loading && <Loading rows={4} height={80} />}
      {error && <ErrorState error={error} onRetry={retry} />}
      {!loading && !error && data && (
        <>
          <RecordsGrid records={data.records ?? []} />
          <BadgesGrid badges={data.badges ?? []} cohortName={cohort?.name ?? slug} />
        </>
      )}
    </div>
  );
}

function RecordsGrid({ records }) {
  return (
    <section>
      <div className="row gap-8 mb-16">
        <h2>Records</h2>
        <span className="counter">{records.length}</span>
        <span className="muted text-sm">One holder per cohort — transfer on strictly greater.</span>
      </div>
      {records.length ? (
        <div className="title-grid">
          {records.map((t) => <RecordCard key={t.key} title={t} />)}
        </div>
      ) : (
        <EmptyState
          icon={<IconTrophy size={28} />}
          title="No records defined"
          description="Records show up here as soon as the backend has any."
        />
      )}
    </section>
  );
}

function RecordCard({ title }) {
  return (
    <article className="title-card">
      <div className="head">
        <IconTrophy size={16} />
        <h3 className="grow">{title.name}</h3>
      </div>
      <div className="desc">{title.description}</div>
      {title.flavor && <div className="flavor">"{title.flavor}"</div>}
      {title.holder ? (
        <div className="holder">
          <MemberLink member={title.holder.member} size={28} />
          <div className="stack gap-4" style={{ alignItems: 'flex-end' }}>
            <span className="value">{formatValue(title.holder.value)}</span>
            <span className="muted text-sm">{timeAgo(title.holder.awardedAt)}</span>
          </div>
        </div>
      ) : (
        <div className="unclaimed">Unclaimed — take it.</div>
      )}
    </article>
  );
}

function BadgesGrid({ badges, cohortName }) {
  return (
    <section>
      <div className="row gap-8 mb-16">
        <h2>Badges</h2>
        <span className="counter">{badges.length}</span>
        <span className="muted text-sm">Thresholds — permanent, anyone who qualifies keeps them.</span>
      </div>
      {badges.length ? (
        <div className="title-grid">
          {badges.map((b) => <BadgeCard key={b.key} badge={b} cohortName={cohortName} />)}
        </div>
      ) : (
        <EmptyState
          icon={<IconMedal size={28} />}
          title="No badges defined"
          description="Once thresholds are configured, badges appear here."
        />
      )}
    </section>
  );
}

function BadgeCard({ badge }) {
  const shown = (badge.earners ?? []).slice(0, 5);
  const overflow = (badge.earners ?? []).length - shown.length;
  return (
    <article className="title-card">
      <div className="head">
        <IconMedal size={16} />
        <h3 className="grow">{badge.name}</h3>
        <span className="counter">{badge.earnedCount ?? 0}</span>
      </div>
      <div className="desc">{badge.description}</div>
      {badge.flavor && <div className="flavor">"{badge.flavor}"</div>}
      {badge.earnedCount > 0 ? (
        <div className="holder">
          <div className="avatar-stack">
            {shown.map((e) => (
              <Avatar
                key={e.member.githubUsername}
                src={e.member.avatarUrl}
                alt={e.member.displayName || e.member.githubUsername}
                size={28}
              />
            ))}
            {overflow > 0 && <span className="more">+{overflow}</span>}
          </div>
          <span className="muted text-sm">{badge.earnedCount} earned</span>
        </div>
      ) : (
        <div className="unclaimed">Nobody's earned this yet.</div>
      )}
    </article>
  );
}

function formatValue(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'object') {
    const entries = Object.entries(v);
    if (entries.length === 1) {
      const [, val] = entries[0];
      return typeof val === 'number' ? num(val) : String(val);
    }
    return entries.map(([k, val]) => `${k}: ${val}`).join(' · ');
  }
  return String(v);
}
