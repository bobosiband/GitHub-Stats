/**
 * Compare — head-to-head duel between two members.
 *
 * URL is the source of truth: `/compare?a=alice&b=bob` renders the duel
 * directly (deep-linkable, shareable). The two picker inputs update the
 * URL when submitted; the fetcher keys off the query params, so navigating
 * back/forward replays the fetch.
 *
 * Data: GET /members/compare?a=&b=.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { compareMembers, ApiError } from '../lib/api.js';
import { useFetch, num } from '../lib/util.js';
import { Avatar, EmptyState, ErrorState } from '../components/ui.jsx';
import { IconPeople, IconTrophy } from '../components/Icons.jsx';
import { SkeletonList } from '../components/duo/SkeletonRow.jsx';

const STAT_LABELS = {
  totalCommits: 'Commits',
  totalContributions: 'Contributions',
  mergedPRs: 'Merged PRs',
  reviewsGiven: 'Reviews given',
  issuesOpened: 'Issues opened',
  longestStreak: 'Longest streak',
  totalStars: 'Stars earned',
  followers: 'Followers',
  languageCount: 'Languages used',
};

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const ready = a.length > 0 && b.length > 0;

  return (
    <div className="container stack gap-16">
      <PickerBar defaultA={a} defaultB={b} onSubmit={(na, nb) => setParams({ a: na, b: nb })} />
      {!ready ? (
        <EmptyState
          icon={<IconPeople size={32} />}
          title="Pick two members"
          description="Enter two GitHub usernames above to see who wins on the stats that matter."
        />
      ) : (
        <Duel a={a} b={b} />
      )}
    </div>
  );
}

function PickerBar({ defaultA, defaultB, onSubmit }) {
  const [aVal, setAVal] = useState(defaultA);
  const [bVal, setBVal] = useState(defaultB);

  // Keep local state in sync when the URL changes underneath us (e.g. browser
  // back/forward, or a link into the page).
  useEffect(() => {
    setAVal(defaultA);
    setBVal(defaultB);
  }, [defaultA, defaultB]);

  const submit = (e) => {
    e.preventDefault();
    const na = aVal.trim().replace(/^@/, '');
    const nb = bVal.trim().replace(/^@/, '');
    if (na && nb) onSubmit(na, nb);
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border-2 border-ghborder bg-ghsurface p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] items-end">
        <PickerInput label="Left" value={aVal} onChange={setAVal} id="compare-a" />
        <div className="text-center font-black text-ghmuted pb-2 hidden sm:block">vs</div>
        <PickerInput label="Right" value={bVal} onChange={setBVal} id="compare-b" />
        <button type="submit" className="btn primary">
          Compare
        </button>
      </div>
    </form>
  );
}

function PickerInput({ label, value, onChange, id }) {
  return (
    <label className="stack gap-4" htmlFor={id}>
      <span className="text-xs uppercase tracking-wide text-ghmuted font-semibold">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="GitHub username"
        className="rounded-xl border-2 border-ghborder bg-ghinset px-3 py-2 text-ghfg font-mono"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

function Duel({ a, b }) {
  // Deps use the URL params directly so back/forward re-triggers correctly.
  const { data, error, loading, retry } = useFetch(() => compareMembers(a, b), [a, b]);

  if (loading) return <SkeletonList rows={4} />;
  if (error && error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={<IconPeople size={32} />}
        title="One of them hasn't joined yet"
        description={`Could not find @${a} or @${b}. Both members need a profile before they can be compared.`}
      />
    );
  }
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!data) return null;

  const { a: aSide, b: bSide, stats, score } = data;
  return (
    <div className="stack gap-16">
      <Scoreboard aSide={aSide} bSide={bSide} score={score} />
      <StatTable stats={stats} />
    </div>
  );
}

function Scoreboard({ aSide, bSide, score }) {
  const aMember = aSide.profile.member;
  const bMember = bSide.profile.member;
  const leader = score.a > score.b ? 'a' : score.b > score.a ? 'b' : null;

  return (
    <section className="rounded-2xl border-2 border-ghborder bg-ghsurface p-6">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <MemberFace member={aMember} align="right" highlighted={leader === 'a'} />
        <div className="text-center">
          <div className="text-3xl font-black font-mono text-ghfg leading-none">
            <span className={leader === 'a' ? 'text-duo-green' : ''}>{score.a}</span>
            <span className="text-ghmuted mx-2">–</span>
            <span className={leader === 'b' ? 'text-duo-green' : ''}>{score.b}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ghmuted mt-1">
            {leader === null ? 'All square' : leader === 'a' ? `${aMember.githubUsername} leads` : `${bMember.githubUsername} leads`}
            {score.ties > 0 && ` · ${score.ties} tie${score.ties === 1 ? '' : 's'}`}
          </div>
        </div>
        <MemberFace member={bMember} align="left" highlighted={leader === 'b'} />
      </div>
    </section>
  );
}

function MemberFace({ member, align, highlighted }) {
  const name = member.displayName || member.githubUsername;
  const inner = (
    <>
      <Avatar
        src={member.avatarUrl}
        alt={name}
        size={96}
      />
      <div className={`min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
        <div className="font-black text-ghfg truncate leading-tight">
          {name}
          {highlighted && <IconTrophy size={12} className="inline ml-1 text-duo-gold" />}
        </div>
        <div className="text-xs text-ghmuted font-mono truncate">@{member.githubUsername}</div>
      </div>
    </>
  );
  const cls =
    `flex items-center gap-3 ${align === 'right' ? 'justify-end flex-row-reverse' : 'justify-start'}`;
  return (
    <Link to={`/u/${encodeURIComponent(member.githubUsername)}`} className={`link-plain ${cls}`}>
      {inner}
    </Link>
  );
}

function StatTable({ stats }) {
  return (
    <section className="rounded-2xl border-2 border-ghborder bg-ghsurface overflow-hidden">
      <table className="w-full">
        <caption className="sr-only">Per-stat comparison</caption>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-ghmuted border-b border-ghborder">
            <th className="px-4 py-2 text-right w-1/3">A</th>
            <th className="px-4 py-2 text-center">Stat</th>
            <th className="px-4 py-2 text-left w-1/3">B</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((row) => (
            <StatRow key={row.stat} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StatRow({ row }) {
  const label = STAT_LABELS[row.stat] ?? row.stat;
  const aWin = row.winner === 'a';
  const bWin = row.winner === 'b';
  const cell = (won) =>
    'px-4 py-3 font-mono ' +
    (won ? 'bg-duo-green/10 text-duo-green font-black' : 'text-ghfg');
  return (
    <tr className="border-b border-ghborder last:border-b-0">
      <td className={cell(aWin) + ' text-right'}>{num(row.a)}</td>
      <td className="px-4 py-3 text-center text-xs uppercase tracking-wide text-ghmuted">
        {label}
      </td>
      <td className={cell(bWin) + ' text-left'}>{num(row.b)}</td>
    </tr>
  );
}
