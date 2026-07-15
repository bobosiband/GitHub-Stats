import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { languageColor } from '../../lib/linguist.js';
import { perLanguageXp } from '../../lib/xp.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Duolingo "skill circle" for each of a member's top languages.
 *
 * Fullness of the ring = `lang.xp / lang.xpCap` (defaults to a 300-XP cap when
 * the backend hasn't annotated the entry). This is now the single source of
 * truth — the backend ships per-language xp on every `topLanguages` entry
 * (`services/views.js#annotateTopLanguages`), so the ring math no longer
 * drifts from the XP formula.
 *
 * The previous version made the ring invisible: the inner disc used
 * `inset-1` (1px), while the SVG stroke was 6px wide, so the disc sat *on top
 * of the ring* and covered it. The inner disc now insets by `stroke + gap` so
 * the ring is always visible around it.
 */

const CAP = 300;
const COLLAPSED_LIMIT = 5;

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

function Skill({ lang, index, reduced, sharePct, staggerBase = 0 }) {
  const color = languageColor(lang.name);
  const progress = skillProgress(lang);
  const size = 72;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c - c * progress;
  const innerInset = stroke + 4;
  const maxed = progress >= 1;
  const showShare = sharePct != null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduced
          ? { duration: 0 }
          : {
              delay: staggerBase + index * 0.025,
              duration: 0.15,
              ease: 'easeOut',
            }
      }
      whileHover={reduced ? {} : { scale: 1.06 }}
      className="flex flex-col items-center gap-1 select-none"
      title={
        `${lang.name} · ${Math.round((lang.xp ?? perLanguageXp(lang.bytes)) || 0)} / ` +
        `${lang.xpCap ?? CAP} XP · ${(lang.bytes ?? 0).toLocaleString()} bytes` +
        (showShare ? ` · ${sharePct.toFixed(1)}% of code` : '')
      }
    >
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          filter: maxed ? `drop-shadow(0 0 6px ${color})` : 'none',
        }}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={stroke}
          />
          {progress > 0 && (
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={reduced ? { strokeDashoffset: dashOffset } : { strokeDashoffset: c }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={reduced ? { duration: 0 } : { duration: 0.8, ease: 'easeOut' }}
            />
          )}
          {/* Thin share-of-bytes fill along the bottom edge — only visible when
              the caller supplies a percentage (expanded mode). Sits inside the
              same SVG so it inherits the rotation and never affects layout. */}
          {showShare && (
            <motion.rect
              x={size / 2 - r}
              y={size - stroke - 1}
              width={2 * r * (sharePct / 100)}
              height={2}
              fill={color}
              opacity="0.85"
              initial={reduced ? { opacity: 0.85 } : { opacity: 0 }}
              animate={{ opacity: 0.85 }}
              transition={reduced ? { duration: 0 } : { duration: 0.2, delay: 0.15 }}
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
      {showShare && (
        <div className="text-[10px] text-ghmuted font-mono leading-none">
          {sharePct >= 1 ? `${sharePct.toFixed(0)}%` : '<1%'}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Expandable list of language skills.
 *
 * Props:
 *   - topLanguages: full sorted list (bytes desc). The component renders the
 *     first COLLAPSED_LIMIT and hides the rest behind a "+N" toggle chip.
 *   - extraCount: DEPRECATED. Old callers passed `languageCount - shown` when
 *     the backend still sliced to 5; the API now ships every language so
 *     `topLanguages.length` is the truth. Ignored when the list itself has
 *     more than COLLAPSED_LIMIT entries; still used as a fallback when the
 *     caller couldn't ship the tail (e.g. very old snapshots).
 */
export default function LanguageSkills({ topLanguages = [], extraCount = 0 }) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef(null);
  const containerRef = useRef(null);
  const [maxHeight, setMaxHeight] = useState('none');

  if (!topLanguages.length) return null;

  const visible = expanded ? topLanguages : topLanguages.slice(0, COLLAPSED_LIMIT);
  const hiddenTailCount = Math.max(0, topLanguages.length - COLLAPSED_LIMIT);
  // If the backend still slices the tail off (legacy snapshots) we fall back
  // to the count-only chip that used to render — no dead click target.
  const legacyExtra = hiddenTailCount === 0 && extraCount > 0 ? extraCount : 0;
  const canExpand = hiddenTailCount > 0;
  const totalBytes = topLanguages.reduce((sum, l) => sum + (l.bytes ?? 0), 0);

  // Smooth height transition on the wrapper: measure the natural height of the
  // chip row on every render and apply it as maxHeight. CSS transitions the
  // change, so the surrounding card grows/shrinks without content jumping.
  useEffect(() => {
    if (!containerRef.current) return;
    if (reduced) {
      setMaxHeight('none');
      return;
    }
    const el = containerRef.current;
    // Two frames: let the DOM settle after chips mount before measuring.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setMaxHeight(`${el.scrollHeight}px`);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [expanded, topLanguages.length, reduced]);

  const handleToggle = () => {
    setExpanded((v) => !v);
    // On collapse, return focus to the toggle chip so keyboard users don't
    // lose their place. The button re-mounts at the end of the row when
    // expanded, so a re-focus on the same ref works in both directions.
    requestAnimationFrame(() => {
      toggleRef.current?.focus?.();
    });
  };

  return (
    <div
      ref={containerRef}
      className="overflow-hidden"
      style={{
        maxHeight: reduced ? 'none' : maxHeight,
        transition: reduced ? undefined : 'max-height 220ms ease',
      }}
    >
      <div className="flex flex-wrap gap-4 items-center">
        {visible.map((lang, i) => {
          const isNewlyRevealed = expanded && i >= COLLAPSED_LIMIT;
          const sharePct =
            expanded && totalBytes > 0 ? ((lang.bytes ?? 0) / totalBytes) * 100 : null;
          return (
            <Skill
              key={lang.name}
              lang={lang}
              index={isNewlyRevealed ? i - COLLAPSED_LIMIT : 0}
              staggerBase={isNewlyRevealed ? 0 : 0}
              reduced={reduced}
              sharePct={sharePct}
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
            className={
              'flex flex-col items-center justify-center rounded-full border-2 border-dashed ' +
              'border-ghborder text-ghmuted text-xs font-bold cursor-pointer ' +
              'hover:border-duo-green hover:text-duo-green ' +
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-duo-green ' +
              'focus-visible:ring-offset-2 focus-visible:ring-offset-ghsurface ' +
              'transition-colors'
            }
            style={{ width: 72, height: 72 }}
          >
            {expanded ? (
              <>
                <span aria-hidden="true">−</span>
                <span className="text-[10px] font-semibold leading-tight mt-0.5">
                  Show less
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">+{hiddenTailCount}</span>
                <span className="text-[10px] font-semibold leading-tight mt-0.5">
                  more
                </span>
              </>
            )}
          </button>
        )}
        {!canExpand && legacyExtra > 0 && (
          <div
            className="flex flex-col items-center justify-center rounded-full border-2 border-dashed border-ghborder text-ghmuted text-xs font-bold"
            style={{ width: 72, height: 72 }}
            title={`${legacyExtra} more language${legacyExtra === 1 ? '' : 's'}`}
          >
            +{legacyExtra}
          </div>
        )}
      </div>
    </div>
  );
}
