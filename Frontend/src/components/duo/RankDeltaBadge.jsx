import { motion } from 'framer-motion';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * The ▲2 / ▼1 / — pill next to each rank on the leaderboard.
 *
 * `delta === null` renders the em-dash placeholder (no previous ranking).
 * Positive = climbed (green + upward bounce), negative = fell (red + dip).
 */
export default function RankDeltaBadge({ delta }) {
  const reduced = useReducedMotion();

  if (delta === null || delta === undefined) {
    return (
      <span className="inline-flex min-w-[36px] items-center justify-center rounded-full bg-ghsurface text-ghmuted text-xs font-semibold px-2 py-0.5 border border-ghborder">
        —
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex min-w-[36px] items-center justify-center rounded-full bg-ghsurface text-ghmuted text-xs font-semibold px-2 py-0.5 border border-ghborder">
        =
      </span>
    );
  }

  const positive = delta > 0;
  const label = `${positive ? '▲' : '▼'}${Math.abs(delta)}`;

  return (
    <motion.span
      initial={reduced ? {} : { y: positive ? 6 : -6, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 22 }}
      className={
        'inline-flex min-w-[36px] items-center justify-center rounded-full text-xs font-black px-2 py-0.5 ' +
        (positive
          ? 'bg-[rgba(63,185,80,0.15)] text-duo-green border border-[rgba(63,185,80,0.4)]'
          : 'bg-[rgba(248,81,73,0.15)] text-duo-red border border-[rgba(248,81,73,0.4)]')
      }
      title={`${positive ? 'Climbed' : 'Fell'} ${Math.abs(delta)} place${
        Math.abs(delta) === 1 ? '' : 's'
      } since the previous sync`}
    >
      {label}
    </motion.span>
  );
}
