import { motion } from 'framer-motion';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';

/**
 * Skeleton placeholders. Uses the existing `.skeleton` shimmer class from
 * styles.css so the animation matches the rest of the app; motion here only
 * provides the staggered fade-in on first render.
 */
export function SkeletonRow({ height = 44 }) {
  return <div className="skeleton" style={{ height, marginBottom: 8 }} />;
}

export function SkeletonList({ rows = 6, height = 44 }) {
  const reduced = useReducedMotion();
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <motion.div
          key={i}
          initial={reduced ? {} : { opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduced ? { duration: 0 } : { delay: i * 0.04, duration: 0.25 }}
        >
          <SkeletonRow height={height} />
        </motion.div>
      ))}
    </div>
  );
}
