/**
 * Small shared building blocks used by multiple pages. All are pure
 * presentational — no data fetching — so they're safe to compose freely.
 */

import { Link } from 'react-router-dom';
import { IconAlert, IconGraph } from './Icons.jsx';
import { compact, langColor } from '../lib/util.js';

/* --------------------------------------------------------------------------
 * Avatar
 * -------------------------------------------------------------------------- */

/**
 * Round avatar with graceful fallback. If we have a URL, render `<img>`;
 * otherwise show the initial(s) of the login on a subtle background.
 *
 * @param {object} props
 * @param {string} [props.src]
 * @param {string} props.alt
 * @param {number} [props.size=32]
 */
export function Avatar({ src, alt, size = 32 }) {
  const initials = (alt || '?').replace(/^@/, '').slice(0, 2);
  const dim = { width: size, height: size, fontSize: Math.max(10, size * 0.4) };
  if (src) {
    return (
      <img
        className="avatar"
        src={src}
        alt={alt}
        style={dim}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.replaceWith(fallbackNode(initials, dim));
        }}
      />
    );
  }
  return (
    <span className="avatar" style={dim} aria-label={alt}>
      {initials}
    </span>
  );
}

function fallbackNode(text, dim) {
  const el = document.createElement('span');
  el.className = 'avatar';
  Object.assign(el.style, dim);
  el.textContent = text;
  return el;
}

/* --------------------------------------------------------------------------
 * MemberLink
 * -------------------------------------------------------------------------- */

/**
 * Standard member row: avatar + display name + `@username`, linking to the
 * profile page. Used inside the leaderboard, title cards, and podium.
 *
 * @param {object} props
 * @param {object} props.member  Public member shape from the backend
 * @param {number} [props.size=32]
 * @param {boolean} [props.showLogin=true]
 */
export function MemberLink({ member, size = 32, showLogin = true }) {
  if (!member) return null;
  const login = member.githubUsername;
  const name = member.displayName || login;
  return (
    <Link to={`/u/${encodeURIComponent(login)}`} className="member-cell link-plain">
      <Avatar src={member.avatarUrl} alt={name} size={size} />
      <span className="stack gap-4" style={{ minWidth: 0 }}>
        <span className="name">{name}</span>
        {showLogin && <span className="login">@{login}</span>}
      </span>
    </Link>
  );
}

/* --------------------------------------------------------------------------
 * Loading / Error / Empty
 * -------------------------------------------------------------------------- */

/**
 * Skeleton block(s). Pass `rows` to render a stack of shimmering lines,
 * or use the raw `.skeleton` class inline for one-offs.
 */
export function Loading({ rows = 4, height = 16, className = '' }) {
  return (
    <div className={`stack gap-8 ${className}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height, width: `${88 - i * 6}%` }}
        />
      ))}
    </div>
  );
}

/** Error banner with a retry button. Uses the message from ApiError verbatim. */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="flash danger" role="alert">
      <IconAlert size={16} />
      <div className="stack gap-4 grow">
        <strong>{title}</strong>
        <span>{error?.message ?? 'Unknown error'}</span>
        {error?.code && <span className="text-sm mono">code: {error.code}</span>}
      </div>
      {onRetry && (
        <button type="button" className="btn small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * GitHub-style blankslate. Consumers pass an icon (or fall back to a graph
 * glyph), title, description, and optional call-to-action node.
 */
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="blankslate">
      <div className="icon">{icon ?? <IconGraph size={32} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * LanguageBar
 * -------------------------------------------------------------------------- */

/**
 * Repo-page-style language bar with a legend beneath. Segments are ordered
 * by size and coloured via {@link langColor}. Percentages are computed from
 * the sum of `bytes` across the given entries.
 *
 * @param {object} props
 * @param {{ name: string, bytes: number }[]} props.entries
 * @param {number} [props.max=8] Max legend entries shown; the rest roll into "Other"
 */
export function LanguageBar({ entries, max = 8 }) {
  if (!entries?.length) {
    return <div className="muted text-sm">No language data.</div>;
  }
  const total = entries.reduce((s, e) => s + (e.bytes ?? 0), 0) || 1;
  const sorted = [...entries].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  const other = tail.length
    ? { name: 'Other', bytes: tail.reduce((s, e) => s + (e.bytes ?? 0), 0), fallbackColor: '#8b949e' }
    : null;
  const legend = other ? [...head, other] : head;

  return (
    <div>
      <div className="lang-bar" aria-hidden="true">
        {legend.map((e) => {
          const pct = ((e.bytes ?? 0) / total) * 100;
          return (
            <span
              key={e.name}
              style={{ width: `${pct}%`, background: e.fallbackColor ?? langColor(e.name) }}
            />
          );
        })}
      </div>
      <ul className="lang-list">
        {legend.map((e) => {
          const pct = ((e.bytes ?? 0) / total) * 100;
          return (
            <li key={e.name}>
              <span className="lang-dot" style={{ background: e.fallbackColor ?? langColor(e.name) }} />
              <strong>{e.name}</strong>
              <span className="num">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * HeatStat
 * -------------------------------------------------------------------------- */

/**
 * A numeric cell with an in-place green heat bar scaled to `value / max`.
 * `top` renders in a darker green — reserved for the leader.
 */
export function HeatStat({ value, max, top = false, compactValue = false }) {
  const shown = compactValue ? compact(value) : (value ?? 0).toLocaleString();
  const pct = max > 0 ? Math.min(100, (Number(value) / max) * 100) : 0;
  return (
    <span className={`heat ${top ? 'top' : ''}`} style={{ '--fill': `${pct}%` }}>
      {shown}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * StatCard
 * -------------------------------------------------------------------------- */

/** Small labelled stat used on Profile + Analytics. */
export function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="muted text-sm">{hint}</div>}
    </div>
  );
}
