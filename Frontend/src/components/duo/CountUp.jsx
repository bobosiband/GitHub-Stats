import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Animated integer count-up. Skips animation entirely for reduced-motion users
 * and for zero → non-zero transitions on the first render (avoids the
 * initial-render flash of "0…" on every page load).
 */
export default function CountUp({
  value = 0,
  duration = 900,
  formatter = (v) => v.toLocaleString(),
  className = '',
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const startVal = from.current;
    const delta = value - startVal;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic — snappy at the end, decisive like a Duolingo counter.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(startVal + delta * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    from.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display === value]);

  return <span className={className}>{formatter(display)}</span>;
}
