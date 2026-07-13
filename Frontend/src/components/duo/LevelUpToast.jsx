import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Level-up detector + celebration.
 *
 * Persists per-username level in `localStorage` under `gitrank:lvl:<username>`.
 * When the current level is strictly higher than the last cached value we:
 *   - fire a confetti burst (skipped for prefers-reduced-motion),
 *   - toast the new level for ~3.6s.
 *
 * Runs once per (username, level) so navigating back doesn't retrigger it.
 */
export default function LevelUpToast({ username, level }) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!username || typeof level !== 'number' || level <= 0) return;
    const key = `gitrank:lvl:${username}`;
    let prev = null;
    try {
      const raw = localStorage.getItem(key);
      prev = raw == null ? null : Number(raw);
    } catch {
      /* localStorage unavailable */
    }

    if (prev != null && level > prev) {
      setVisible(true);
      if (!reduced) {
        // Two symmetric bursts so the confetti reaches both sides on wide
        // screens without over-crowding the middle.
        const opts = { spread: 70, startVelocity: 45, particleCount: 90, ticks: 200 };
        confetti({ ...opts, origin: { x: 0.2, y: 0.35 } });
        confetti({ ...opts, origin: { x: 0.8, y: 0.35 } });
      }
      const t = setTimeout(() => setVisible(false), 3600);
      try {
        localStorage.setItem(key, String(level));
      } catch {
        /* localStorage unavailable */
      }
      return () => clearTimeout(t);
    }

    if (prev == null) {
      // First time we see this member — record the baseline WITHOUT firing.
      try {
        localStorage.setItem(key, String(level));
      } catch {
        /* localStorage unavailable */
      }
    } else if (level < prev) {
      // Global rolling window can decrease XP — quietly track the new floor.
      try {
        localStorage.setItem(key, String(level));
      } catch {
        /* localStorage unavailable */
      }
    }
  }, [username, level, reduced]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduced ? {} : { y: -30, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { y: -20, opacity: 0, scale: 0.95 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 20 }}
          className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-2xl bg-duo-green text-black px-6 py-3 font-black text-xl shadow-chunkyGreen border-2 border-black/20"
          role="status"
          aria-live="polite"
        >
          🎉 LEVEL {level}!
        </motion.div>
      )}
    </AnimatePresence>
  );
}
