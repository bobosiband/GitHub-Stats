import { motion } from 'framer-motion';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Circular XP ring — wraps an avatar (or any content) with a green progress
 * arc + a chunky level badge pinned to the bottom-right. The arc animates in
 * on mount unless the visitor has reduced-motion on, then it snaps.
 */
export default function XpRing({
  size = 128,
  strokeWidth = 8,
  progress = 0, // 0..1
  level = 0,
  children,
  badgeSize = 34,
  className = '',
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = clamped * circumference;

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#58cc02"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={reduced ? { duration: 0 } : { duration: 0.9, ease: 'easeOut' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ padding: strokeWidth + 4 }}
      >
        {children}
      </div>
      <div
        className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-duo-green text-black font-black shadow-chunkyGreen border-2 border-ghbg"
        style={{
          width: badgeSize,
          height: badgeSize,
          fontSize: badgeSize * 0.42,
          lineHeight: 1,
        }}
        title={`Level ${level}`}
      >
        {level}
      </div>
    </div>
  );
}
