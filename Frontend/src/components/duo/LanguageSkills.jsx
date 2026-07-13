import { motion } from 'framer-motion';
import { languageColor } from '../../lib/linguist.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Duolingo "skill circle" for each of a member's top languages.
 *
 * The XP-per-language cap on the backend is 300 (one maxed skill), so we scale
 * each ring's fullness to `min(1, 30·log2(1 + bytes/1000) / 300)` — the same
 * shape the XP formula uses. That keeps the visual signal aligned with the
 * scoring rules: a huge one-language repo lights up its skill but doesn't
 * outshine breadth.
 */
function skillProgress(bytes) {
  if (!bytes || bytes <= 0) return 0;
  const raw = 30 * Math.log2(1 + bytes / 1000);
  return Math.max(0, Math.min(1, raw / 300));
}

function initialsOf(name) {
  if (!name) return '?';
  if (/^C\+\+$/.test(name)) return 'C++';
  if (/^C#$/.test(name)) return 'C#';
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[1][0] ?? '');
}

function Skill({ name, bytes, index, reduced }) {
  const color = languageColor(name);
  const progress = skillProgress(bytes);
  const size = 68;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

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
      title={`${name} · ${(bytes ?? 0).toLocaleString()} bytes`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - c * progress}
          />
        </svg>
        <div
          className="absolute inset-1 rounded-full flex items-center justify-center font-black text-black text-sm"
          style={{ background: color, boxShadow: `0 3px 0 rgba(0,0,0,0.35)` }}
        >
          {initialsOf(name).toUpperCase()}
        </div>
      </div>
      <div className="text-[11px] text-ghfg font-semibold max-w-[80px] truncate text-center">
        {name}
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
        <Skill key={lang.name} name={lang.name} bytes={lang.bytes} index={i} reduced={reduced} />
      ))}
      {extraCount > 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-full border-2 border-dashed border-ghborder text-ghmuted text-xs font-bold"
          style={{ width: 68, height: 68 }}
          title={`${extraCount} more language${extraCount === 1 ? '' : 's'}`}
        >
          +{extraCount}
        </div>
      )}
    </div>
  );
}
