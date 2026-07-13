import { useEffect, useState } from 'react';

/**
 * Live `prefers-reduced-motion` subscription. Components disable confetti,
 * springs, and count-ups when this returns true — the CSS reset already caps
 * transition durations, but framer-motion springs and JS-driven animations
 * need explicit gating.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => setReduced(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, []);

  return reduced;
}
