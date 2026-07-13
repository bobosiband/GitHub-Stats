import { motion } from 'framer-motion';
import CountUp from './CountUp.jsx';
import { xpForLevel } from '../../lib/xp.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * The single source of truth for showing XP + level progress.
 *
 * Renders one horizontal bar:
 *
 *   ┌─ Level 12 ────────── 7,001 / 8,124 XP ─┐
 *   │████████████████████░░░░░░░░░░░░░░░░░░░│
 *   │              1,123 XP to Level 13      │
 *   └────────────────────────────────────────┘
 *
 * Replaces the earlier two-chip layout (a bare `0 XP` pill + a `{n} XP to level
 * {L+1}` pill) that showed the same value twice and had adjacent numbers running
 * visually together. Used on the profile per-cohort card, the profile header,
 * and the leaderboard rows so the display never drifts between surfaces.
 *
 * When `progression` is `null` (member has no snapshot yet), the bar renders in
 * an "unsynced" empty state instead of pretending XP is 0.
 */
export default function XpProgressBar({
  progression,
  compact = false,
  className = '',
}) {
  const reduced = useReducedMotion();

  if (!progression) {
    return (
      <div
        className={
          'rounded-xl border-2 border-dashed border-ghborder bg-ghinset px-3 py-2 ' +
          'text-xs text-ghmuted italic ' +
          className
        }
      >
        First sync pending — XP will appear once GitHub has been polled.
      </div>
    );
  }

  const { xp, level, levelProgress, xpToNextLevel } = progression;
  const nextThreshold = xpForLevel(level + 1);
  const clamped = Math.max(0, Math.min(1, levelProgress ?? 0));
  const isMax = xpToNextLevel === 0 && nextThreshold === xp;

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span
            className={
              'inline-flex items-center justify-center rounded-full bg-duo-green text-black font-black ' +
              (compact ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm')
            }
            title={`Level ${level}`}
          >
            {level}
          </span>
          <span className={`font-bold text-ghfg ${compact ? 'text-xs' : 'text-sm'}`}>
            Level {level}
          </span>
        </div>
        <span
          className={`font-mono text-ghfg tabular-nums ${compact ? 'text-xs' : 'text-sm'}`}
        >
          <CountUp value={xp} className="font-black text-duo-green" />
          <span className="text-ghmuted"> / {nextThreshold.toLocaleString()} XP</span>
        </span>
      </div>
      <div
        className={
          'relative overflow-hidden rounded-full bg-ghinset border border-ghborder ' +
          (compact ? 'h-2' : 'h-3')
        }
        role="progressbar"
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Level ${level} progress: ${Math.round(clamped * 100)}%`}
      >
        <motion.div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-duo-green to-duo-greenDeep"
          initial={reduced ? { width: `${clamped * 100}%` } : { width: 0 }}
          animate={{ width: `${clamped * 100}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.9, ease: 'easeOut' }}
        />
      </div>
      {!compact && (
        <div className="mt-1 text-[11px] text-ghmuted text-right">
          {isMax ? (
            'Max level for this XP curve — keep shipping.'
          ) : (
            <>
              <span className="font-mono text-ghfg font-bold">
                {xpToNextLevel.toLocaleString()}
              </span>{' '}
              XP to Level {level + 1}
            </>
          )}
        </div>
      )}
    </div>
  );
}
