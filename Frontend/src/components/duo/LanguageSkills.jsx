import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { languageColor } from '../../lib/linguist.js';
import { perLanguageXp } from '../../lib/xp.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Language "skill circles" for a member's profile.
 *
 * Rendering model — deliberately dumb, so the reveal can't get stuck:
 *   - Every language in `topLanguages` renders once, unconditionally.
 *   - Chips at index >= COLLAPSED_LIMIT carry the `is-extra` class, which is
 *     `display: none` until the container gains `is-expanded` (a plain CSS
 *     class toggle — no JS measurement, no max-height math).
 *   - The toggle button (a real <button>) flips the class + aria-expanded.
 *   - Reveal animation is a CSS @keyframes (see `styles.css`) with a stagger
 *     driven by the per-chip `--i` custom property, muted under
 *     prefers-reduced-motion. Because it's an animation on `display: none →
 *     inline-flex` (via keyframes on the newly-shown chips only), it fires
 *     every time the container expands and never on collapse.
 *
 * The mount animation on individual Skill components is kept (framer-motion)
 * only for the *initial* card entrance — it does not participate in the
 * expand/collapse cycle.
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

function Skill({ lang, index, reduced, sharePct, isExtra }) {
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
        reduced ? { duration: 0 } : { delay: index * 0.025, duration: 0.15, ease: 'easeOut' }
      }
      whileHover={reduced ? {} : { scale: 1.06 }}
      className={`lang-chip flex flex-col items-center gap-1 select-none${isExtra ? ' is-extra' : ''}`}
      // --i lets the reveal keyframe stagger extras by their tail-index only.
      // Non-extras don't use it (they're always visible, no reveal fires).
      style={isExtra ? { '--i': index } : undefined}
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
 * Props:
 *   - topLanguages: full sorted list (bytes desc). Everything past index
 *     COLLAPSED_LIMIT is hidden until the "+N" toggle is clicked.
 *   - extraCount: legacy fallback for very old snapshots where the backend
 *     still sliced the tail off. Rendered as a static "+N" pill (no
 *     interaction — there is nothing to reveal).
 */
export default function LanguageSkills({ topLanguages = [], extraCount = 0 }) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef(null);

  if (!topLanguages.length) return null;

  const hiddenTailCount = Math.max(0, topLanguages.length - COLLAPSED_LIMIT);
  const canExpand = hiddenTailCount > 0;
  const legacyExtra = !canExpand && extraCount > 0 ? extraCount : 0;
  const totalBytes = topLanguages.reduce((sum, l) => sum + (l.bytes ?? 0), 0);

  const handleToggle = () => {
    setExpanded((v) => !v);
    // Keep keyboard focus on the toggle across the state flip; the button is
    // the same DOM node so this is a no-op re-focus that satisfies the
    // "focus stays on toggle" behaviour spec on both expand and collapse.
    requestAnimationFrame(() => {
      toggleRef.current?.focus?.();
    });
  };

  return (
    <div
      className={`lang-row flex flex-wrap gap-4 items-center${expanded ? ' is-expanded' : ''}`}
    >
      {topLanguages.map((lang, i) => {
        const isExtra = i >= COLLAPSED_LIMIT;
        // Only compute share when expanded (collapsed state must look
        // identical to before this feature landed).
        const sharePct = expanded && totalBytes > 0
          ? ((lang.bytes ?? 0) / totalBytes) * 100
          : null;
        return (
          <Skill
            key={lang.name}
            lang={lang}
            // Stagger index for the reveal keyframe: tail chips only.
            index={isExtra ? i - COLLAPSED_LIMIT : i}
            reduced={reduced}
            sharePct={sharePct}
            isExtra={isExtra}
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
            'lang-toggle flex flex-col items-center justify-center rounded-full border-2 border-dashed ' +
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

      {legacyExtra > 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-full border-2 border-dashed border-ghborder text-ghmuted text-xs font-bold"
          style={{ width: 72, height: 72 }}
          title={`${legacyExtra} more language${legacyExtra === 1 ? '' : 's'}`}
        >
          +{legacyExtra}
        </div>
      )}
    </div>
  );
}
