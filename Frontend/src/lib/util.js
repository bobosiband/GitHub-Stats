/**
 * Utility grab-bag: number/date formatters, a language-color lookup so
 * profile/analytics bars match GitHub's repo-page colours, and a small
 * `useFetch` hook — kept here (rather than a hooks/ folder) because it's
 * the only cross-cutting piece of client-side state we need.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.js';

/* --------------------------------------------------------------------------
 * Numbers
 * -------------------------------------------------------------------------- */

/**
 * Compact number: 12 → "12", 1234 → "1.2k", 1_500_000 → "1.5M".
 * @param {number|null|undefined} n
 */
export function compact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trimZero(n / 1e9)}B`;
  if (abs >= 1e6) return `${trimZero(n / 1e6)}M`;
  if (abs >= 1e3) return `${trimZero(n / 1e3)}k`;
  return String(Math.round(n));
}

/** Locale-formatted integer with thousands separators. */
export function num(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

/**
 * Percentage from a 0–1 ratio (or null).
 * @param {number|null|undefined} r
 * @param {number} [digits=0]
 */
export function pct(r, digits = 0) {
  if (r == null || Number.isNaN(r)) return '—';
  return `${(r * 100).toFixed(digits)}%`;
}

function trimZero(x) {
  return x.toFixed(1).replace(/\.0$/, '');
}

/* --------------------------------------------------------------------------
 * Dates
 * -------------------------------------------------------------------------- */

/**
 * Relative time, GitHub-style: "3 minutes ago", "2 days ago", "on Jan 5".
 * @param {string|Date|null|undefined} input
 */
export function timeAgo(input) {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const abs = Math.abs(diffMs);
  const sec = 1000, min = 60 * sec, hr = 60 * min, day = 24 * hr, wk = 7 * day, mo = 30 * day, yr = 365 * day;

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < min) return rtf.format(Math.round(diffMs / sec), 'second');
  if (abs < hr)  return rtf.format(Math.round(diffMs / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hr),  'hour');
  if (abs < wk)  return rtf.format(Math.round(diffMs / day), 'day');
  if (abs < mo)  return rtf.format(Math.round(diffMs / wk),  'week');
  if (abs < yr)  return rtf.format(Math.round(diffMs / mo),  'month');
  return rtf.format(Math.round(diffMs / yr), 'year');
}

/** Short absolute date like "5 Jan 2025". */
export function shortDate(input) {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* --------------------------------------------------------------------------
 * Language colours (GitHub Linguist top 30, hardcoded — no network fetch)
 * -------------------------------------------------------------------------- */

const LANG_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Ruby: '#701516',
  PHP: '#4F5D95',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Scala: '#c22d40',
  Haskell: '#5e5086',
  Lean: '#5f7e5f',
  Elixir: '#6e4a7e',
  Clojure: '#db5855',
  Dart: '#00B4AB',
  Shell: '#89e051',
  Bash: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  R: '#198CE7',
  Perl: '#0298c3',
  Lua: '#000080',
  Assembly: '#6E4C13',
  COBOL: '#005ca5',
  Fortran: '#4d41b1',
  MATLAB: '#e16737',
  'Jupyter Notebook': '#DA5B0B',
  Makefile: '#427819',
  Dockerfile: '#384d54',
  TeX: '#3D6117',
  Nix: '#7e7eff',
};

/** Language dot colour with a stable pseudo-random fallback for unknowns. */
export function langColor(name) {
  if (LANG_COLORS[name]) return LANG_COLORS[name];
  // Deterministic hue based on the language name so unknowns still look consistent.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return `hsl(${hash % 360} 55% 55%)`;
}

/* --------------------------------------------------------------------------
 * Misc
 * -------------------------------------------------------------------------- */

/** True if the given cohort has ended relative to `now`. */
export function hasEnded(cohort, now = new Date()) {
  return cohort?.endDate ? new Date(cohort.endDate).getTime() < now.getTime() : false;
}

/** Human status label for a cohort. */
export function cohortStatus(cohort, now = new Date()) {
  if (!cohort) return 'Unknown';
  if (cohort.kind === 'GLOBAL') return 'Rolling 365 days';
  if (!cohort.isActive) return 'Inactive';
  if (hasEnded(cohort, now)) return 'Ended';
  return 'Active';
}

/** Clamp a number between two bounds. */
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/* --------------------------------------------------------------------------
 * useFetch — the single hook every data-driven page uses.
 * -------------------------------------------------------------------------- */

/**
 * Load data with loading/error/data state and a stable `retry` callback.
 * The fetcher runs whenever `deps` change; use JSON-stable primitives.
 *
 * @template T
 * @param {() => Promise<T>} fn      Ideally an endpoint helper from `api.js`
 * @param {any[]} [deps=[]]          React-style dep list (JSON-stable values)
 * @returns {{ data: T|null, error: ApiError|Error|null, loading: boolean, retry: () => void }}
 */
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    mounted.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    let cancelled = false;
    fn()
      .then((data) => {
        if (!cancelled && mounted.current) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (!cancelled && mounted.current) setState({ data: null, error, loading: false });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, retry };
}

/** Re-export for pages so they don't have to import ApiError from api.js separately. */
export { ApiError };
