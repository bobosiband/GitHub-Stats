import { motion } from 'framer-motion';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Duolingo-style streak flame.
 *
 * `days` = the member's current streak (0 = lost).
 * `longest` (optional) = the member's longest-ever streak — surfaced in the
 * "No active streak" copy so the widget doesn't just say `0`.
 *
 * Colouring escalates at 7 / 30 / 100-day milestones. A lost streak renders as
 * a grey de-saturated flame instead of vanishing so its absence is visible.
 */
export default function StreakFlame({ days = 0, longest = 0, size = 44, showLabel = true }) {
  const reduced = useReducedMotion();
  const lost = days <= 0;
  const tier = days >= 100 ? 3 : days >= 30 ? 2 : days >= 7 ? 1 : 0;
  const scale = 1 + tier * 0.06;

  const gradientId = `flame-grad-${tier}-${lost ? 'lost' : 'lit'}`;
  const [inner, outer] = lost
    ? ['#4a4f57', '#2a2d33']
    : tier >= 3
    ? ['#ffef88', '#ff4b4b']
    : tier >= 2
    ? ['#ffc800', '#ff4b4b']
    : ['#ffb800', '#ff9600'];

  return (
    <div
      className="inline-flex items-center gap-3 rounded-xl border-2 border-ghborder bg-ghinset px-3 py-2"
      aria-label={lost ? `No active streak, longest ${longest} days` : `${days}-day streak`}
    >
      <motion.div
        animate={reduced || lost ? {} : { scale: [scale, scale * 1.06, scale] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        className={lost ? 'opacity-70 saturate-0' : ''}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <defs>
            <radialGradient id={gradientId} cx="50%" cy="65%" r="60%">
              <stop offset="0%" stopColor={inner} />
              <stop offset="100%" stopColor={outer} />
            </radialGradient>
          </defs>
          <path
            d="M16 2 C 18 8 26 10 24 18 C 23 24 19 27 16 30 C 13 27 9 24 8 18 C 6 10 14 8 16 2 Z"
            fill={`url(#${gradientId})`}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="0.6"
          />
          {!lost && (
            <path
              d="M16 14 C 17 17 20 18 19 21 C 18 23 17 24 16 26 C 15 24 14 23 13 21 C 12 18 15 17 16 14 Z"
              fill="#fffde0"
              opacity="0.85"
            />
          )}
        </svg>
      </motion.div>
      {showLabel && (
        <div className="leading-tight">
          {lost ? (
            <>
              <div className="font-bold text-ghfg text-sm">No active streak</div>
              <div className="text-[11px] text-ghmuted">
                {longest > 0 ? (
                  <>
                    Longest:{' '}
                    <span className="font-mono font-bold text-ghfg">{longest}</span>{' '}
                    day{longest === 1 ? '' : 's'}
                  </>
                ) : (
                  'Ship something today to start one.'
                )}
              </div>
            </>
          ) : (
            <>
              <div className="font-black text-lg text-duo-orange leading-none">{days}</div>
              <div className="text-[11px] text-ghmuted uppercase tracking-wide">
                day streak
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
