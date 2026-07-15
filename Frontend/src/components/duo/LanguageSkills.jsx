import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { languageColor } from '../../lib/linguist.js';
import { perLanguageXp } from '../../lib/xp.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Language "skill circles" on the profile.
 *
 * Every language in `topLanguages` is rendered up front; anything past the
 * first COLLAPSED_LIMIT gets `.is-extra` (display: none) until the row's
 * container gains `.is-expanded`. The toggle is a real <button> that flips
 * that class and its own aria-expanded — no JS animation math, no
 * measurement, so nothing to get out of sync.
 *
 * Prerequisite: the API must ship the full `topLanguages` array. Snapshots
 * written before `services/github/fetchUserStats.js` stopped `.slice(0, 5)`-ing
 * the list only have 5 entries, so this component can only reveal what's
 * there — old rows need a resync (or reseed) to gain the tail.
 */

const CAP = 300;
const COLLAPSED_LIMIT = 5;
const SIZE = 72;
const STROKE = 6;

function skillProgress(lang) {
  if (!lang) return 0;
  const xp = typeof lang.xp === 'number' ? lang.xp : perLanguageXp(lang.bytes);
  const cap = typeof lang.xpCap === 'number' && lang.xpCap > 0 ? lang.xpCap : CAP;
  return Math.max(0, Math.min(1, xp / cap));
}

function initialsOf(name) {
  if (!name) return '?';
  if (/^C\+\+$/.test(name)) return 'C++';
  if (/^C#$/.test(name)) return 'C#';
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[1][0] ?? '');
}

/**
 * A single circular language badge — reused for both the always-visible top
 * chips and the revealed extras. `revealIndex` drives the stagger delay
 * (via --i) when the badge is an extra; it's ignored otherwise.
 */
function Skill({ lang, reduced, isExtra, revealIndex = 0 }) {
  const color = languageColor(lang.name);
  const progress = skillProgress(lang);
  const r = (SIZE - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c - c * progress;
  const innerInset = STROKE + 4;
  const maxed = progress >= 1;

  return (
    <motion.div
      // Only the always-visible top chips play the framer-motion mount
      // animation. Extras rely on the CSS reveal keyframe so we don't fight
      // React remounts / re-renders on toggle.
      initial={isExtra ? false : { opacity: 0, y: 8, scale: 0.9 }}
      animate={isExtra ? false : { opacity: 1, y: 0, scale: 1 }}
      transition={isExtra || reduced ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
      whileHover={reduced ? {} : { scale: 1.06 }}
      className={`lang-chip flex flex-col items-center gap-1 select-none${isExtra ? ' is-extra' : ''}`}
      style={isExtra ? { '--i': revealIndex } : undefined}
      title={
        `${lang.name} · ${Math.round((lang.xp ?? perLanguageXp(lang.bytes)) || 0)} / ` +
        `${lang.xpCap ?? CAP} XP · ${(lang.bytes ?? 0).toLocaleString()} bytes`
      }
    >
      <div
        className="relative"
        style={{
          width: SIZE,
          height: SIZE,
          filter: maxed ? `drop-shadow(0 0 6px ${color})` : 'none',
        }}
      >
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={STROKE}
          />
          {progress > 0 && (
            <motion.circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={reduced ? { strokeDashoffset: dashOffset } : { strokeDashoffset: c }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={reduced ? { duration: 0 } : { duration: 0.8, ease: 'easeOut' }}
            />
          )}
        </svg>
        <div
          className="absolute rounded-full flex items-center justify-center font-black text-black text-sm"
          style={{
            top: innerInset,
            left: innerInset,
            right: innerInset,
            bottom: innerInset,
            background: color,
            boxShadow: `0 3px 0 rgba(0,0,0,0.35)`,
          }}
          aria-hidden="true"
        >
          {initialsOf(lang.name).toUpperCase()}
        </div>
      </div>
      <div className="text-[11px] text-ghfg font-semibold max-w-[80px] truncate text-center leading-tight">
        {lang.name}
      </div>
    </motion.div>
  );
}

/**
 * Props:
 *   - topLanguages: the full, byte-sorted language list. Everything past index
 *     COLLAPSED_LIMIT is hidden behind the "+N" toggle.
 *
 * If the API only shipped ≤ COLLAPSED_LIMIT languages (nothing to reveal), no
 * toggle is rendered at all. This is intentional — a "+N" pill you can't
 * click is worse than no pill.
 */
export default function LanguageSkills({ topLanguages = [] }) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef(null);

  if (!topLanguages.length) return null;

  const hiddenTailCount = Math.max(0, topLanguages.length - COLLAPSED_LIMIT);
  const canExpand = hiddenTailCount > 0;

  const handleToggle = () => {
    setExpanded((v) => !v);
    // Keep keyboard focus on the toggle across the state flip — the button is
    // the same DOM node either way, so re-focusing on the same ref covers
    // both expand and collapse without losing the caret.
    requestAnimationFrame(() => {
      toggleRef.current?.focus?.();
    });
  };

  return (
    <div className={`lang-row flex flex-wrap gap-4 items-center${expanded ? ' is-expanded' : ''}`}>
      {topLanguages.map((lang, i) => {
        const isExtra = i >= COLLAPSED_LIMIT;
        return (
          <Skill
            key={lang.name}
            lang={lang}
            reduced={reduced}
            isExtra={isExtra}
            revealIndex={isExtra ? i - COLLAPSED_LIMIT : 0}
          />
        );
      })}

      {canExpand && (
        <button
          ref={toggleRef}
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? 'Show fewer languages'
              : `Show ${hiddenTailCount} more language${hiddenTailCount === 1 ? '' : 's'}`
          }
          className="lang-toggle"
          style={{ width: SIZE, height: SIZE }}
        >
          {expanded ? (
            <>
              <span aria-hidden="true" className="text-lg leading-none">−</span>
              <span className="text-[10px] font-semibold leading-tight mt-0.5">Show less</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">+{hiddenTailCount}</span>
              <span className="text-[10px] font-semibold leading-tight mt-0.5">more</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
