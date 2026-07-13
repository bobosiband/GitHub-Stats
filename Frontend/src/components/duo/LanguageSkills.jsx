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

function Skill({ lang, index, reduced }) {
  const color = languageColor(lang.name);
  const progress = skillProgress(lang);
  const size = 72;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c - c * progress;
  // Leave a visible gap between the inner disc and the ring so the ring is
  // never obscured. Previously the inner disc used `inset-1` (1px) which
  // completely covered a 6px-wide stroke.
  const innerInset = stroke + 4;
  const maxed = progress >= 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduced
          ? { duration: 0 }
          : { delay: index * 0.05, type: 'spring', stiffness: 220, damping: 18 }
      }
      whileHover={reduced ? {} : { scale: 1.06 }}
      className="flex flex-col items-center gap-1 select-none"
      title={`${lang.name} · ${Math.round((lang.xp ?? perLanguageXp(lang.bytes)) || 0)} / ${lang.xpCap ?? CAP} XP · ${(lang.bytes ?? 0).toLocaleString()} bytes`}
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
      <div className="text-[11px] text-ghfg font-semibold max-w-[80px] truncate text-center">
        {lang.name}
      </div>
    </motion.div>
  );
}

export default function LanguageSkills({ topLanguages = [], extraCount = 0 }) {
  const reduced = useReducedMotion();
  if (!topLanguages.length) return null;
  return (
    <div className="flex flex-wrap gap-4">
      {topLanguages.map((lang, i) => (
        <Skill key={lang.name} lang={lang} index={i} reduced={reduced} />
      ))}
      {extraCount > 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-full border-2 border-dashed border-ghborder text-ghmuted text-xs font-bold"
          style={{ width: 72, height: 72 }}
          title={`${extraCount} more language${extraCount === 1 ? '' : 's'}`}
        >
          +{extraCount}
        </div>
      )}
    </div>
  );
}
