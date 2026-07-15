import { IconMedal } from '../Icons.jsx';
import { num } from '../../lib/util.js';

/**
 * "Next up" — small progress cards for badges the member is close to earning.
 * Data comes from `MemberProfile.badgeProgress` (top-4, sorted desc by pct).
 *
 * Cards with `pct === 0` are hidden — showing them adds noise without adding
 * signal ("Level 20 · 0%" for a brand-new member isn't useful).
 */

const STAT_LABELS = {
  totalContributions: 'contributions',
  totalCommits: 'commits',
  mergedPRs: 'merged PRs',
  reviewsGiven: 'reviews',
  longestStreak: 'day streak',
  languageCount: 'languages',
  totalStars: 'stars',
  xp: 'XP',
};

function labelFor(stat) {
  return STAT_LABELS[stat] ?? stat;
}

function BadgeProgressCard({ badge }) {
  const pctInt = Math.round(badge.pct * 100);
  const currentText = num(Math.round(badge.current));
  const targetText = num(Math.round(badge.target));

  return (
    <li className="rounded-2xl border-2 border-ghborder bg-ghinset p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-ghfg leading-tight flex items-center gap-1.5">
            <IconMedal size={12} className="text-duo-gold" />
            <span className="truncate">{badge.name}</span>
          </div>
          {badge.flavor && (
            <div className="text-xs text-ghmuted italic mt-0.5 truncate">{badge.flavor}</div>
          )}
        </div>
        <span className="text-xs font-mono font-bold text-duo-green whitespace-nowrap">
          {pctInt}%
        </span>
      </div>

      <div
        className="h-2 rounded-full bg-ghborder/60 overflow-hidden"
        role="progressbar"
        aria-valuenow={pctInt}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${badge.name} progress: ${currentText} of ${targetText} ${labelFor(badge.stat)}`}
      >
        <div
          className="h-full bg-duo-green rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, pctInt)}%` }}
        />
      </div>

      <div className="text-xs text-ghmuted font-mono">
        {currentText} / {targetText} {labelFor(badge.stat)}
      </div>
    </li>
  );
}

export default function BadgeProgressList({ items = [] }) {
  const visible = items.filter((b) => b.pct > 0);
  if (!visible.length) return null;
  return (
    <div>
      <h2 className="text-lg font-black text-ghfg mb-2">
        <IconMedal size={16} /> Next up
        <span className="ml-2 text-ghmuted font-mono text-sm">({visible.length})</span>
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map((b) => (
          <BadgeProgressCard key={b.key} badge={b} />
        ))}
      </ul>
    </div>
  );
}
