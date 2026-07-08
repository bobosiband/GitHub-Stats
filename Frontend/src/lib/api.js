/**
 * Thin fetch client for the GitRank backend.
 *
 * Base URL resolution (evaluated once on module load):
 *   1. ?api=<url> query param   → localStorage-persisted, so it survives navigation
 *   2. VITE_API_BASE env var    → set at build time (GitHub Pages)
 *   3. http://localhost:3000    → dev default
 *
 * Every non-2xx response is translated into a typed {@link ApiError} whose
 * `code`/`message`/`details` come from the backend's uniform error shape,
 * `{ error: { code, message, details? } }`. Network failures use the code
 * `NETWORK_ERROR` and a message that reminds the caller to check that the
 * backend is running and its `CORS_ORIGIN` includes the current origin.
 *
 * A 60-second in-memory GET cache means tab-switches on the cohort tabs don't
 * refetch. It's keyed on the full URL, so `?sort=commits` and `?sort=stars`
 * are separate entries. Writes never touch the cache.
 */

const DEFAULT_BASE = 'http://localhost:3000';
const CACHE_TTL_MS = 60_000;

/** Typed backend error. */
export class ApiError extends Error {
  /**
   * @param {object} params
   * @param {number} params.status HTTP status (0 for network failure)
   * @param {string} params.code   Backend error code, or `NETWORK_ERROR`/`UNKNOWN`
   * @param {string} params.message Human-friendly message safe to render
   * @param {any}    [params.details]
   */
  constructor({ status, code, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Resolve the API base URL once. `?api=` overrides + persists to localStorage. */
function resolveBase() {
  try {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('api');
    if (override) {
      localStorage.setItem('gitrank-api-base', override);
      return override.replace(/\/$/, '');
    }
    const stored = localStorage.getItem('gitrank-api-base');
    if (stored) return stored.replace(/\/$/, '');
  } catch {
    /* SSR-safe */
  }
  const fromEnv = import.meta.env?.VITE_API_BASE;
  return (fromEnv || DEFAULT_BASE).replace(/\/$/, '');
}

export const API_BASE = resolveBase();

/** Clear the persisted `?api=` override so we go back to build-time default. */
export function clearApiOverride() {
  try {
    localStorage.removeItem('gitrank-api-base');
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------------------
 * Cache
 * -------------------------------------------------------------------------- */

/** @type {Map<string, { at: number, value: any }>} */
const cache = new Map();

/** Drop everything from the GET cache. Called after successful writes. */
export function invalidateCache() {
  cache.clear();
}

/** Drop cache entries whose URL contains a substring — narrower than a full flush. */
export function invalidateCacheMatching(substr) {
  for (const key of cache.keys()) {
    if (key.includes(substr)) cache.delete(key);
  }
}

/* --------------------------------------------------------------------------
 * Core request
 * -------------------------------------------------------------------------- */

/**
 * Perform an HTTP request against the backend and unwrap the response.
 *
 * @param {string} path     Absolute path starting with `/`
 * @param {object} [opts]
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [opts.method]
 * @param {any}     [opts.body]
 * @param {boolean} [opts.cache=true] Only honoured for GET
 * @returns {Promise<any>} Parsed JSON body of the response
 * @throws {ApiError}
 */
export async function request(path, opts = {}) {
  const method = opts.method ?? 'GET';
  const url = `${API_BASE}${path}`;
  const isGet = method === 'GET';

  if (isGet && opts.cache !== false) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message:
        `Couldn't reach the GitRank backend at ${API_BASE}. ` +
        `Check that it's running and that its CORS_ORIGIN env var includes ${originForCors()}.`,
      details: err?.message,
    });
  }

  const bodyText = await res.text();
  const body = bodyText ? safeJson(bodyText) : null;

  if (!res.ok) {
    const err = body?.error;
    throw new ApiError({
      status: res.status,
      code: err?.code ?? 'UNKNOWN',
      message: err?.message ?? `${res.status} ${res.statusText}`,
      details: err?.details,
    });
  }

  if (isGet && opts.cache !== false) {
    cache.set(url, { at: Date.now(), value: body });
  } else if (!isGet) {
    // Writes may have changed collection state — safest to drop reads.
    invalidateCache();
  }
  return body;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function originForCors() {
  try { return window.location.origin; } catch { return '(this origin)'; }
}

/* --------------------------------------------------------------------------
 * Endpoint helpers
 * -------------------------------------------------------------------------- */

/** GET /health */
export const getHealth = () => request('/health');

/** GET /cohorts */
export const getCohorts = () => request('/cohorts');

/** GET /cohorts/:slug */
export const getCohort = (slug) => request(`/cohorts/${encodeURIComponent(slug)}`);

/**
 * GET /cohorts/:slug/leaderboard
 * @param {string} slug
 * @param {'commits'|'contributions'|'streak'|'stars'} [sort='commits']
 */
export const getLeaderboard = (slug, sort = 'commits') =>
  request(`/cohorts/${encodeURIComponent(slug)}/leaderboard?sort=${encodeURIComponent(sort)}`);

/** GET /cohorts/:slug/titles */
export const getCohortTitles = (slug) =>
  request(`/cohorts/${encodeURIComponent(slug)}/titles`);

/** GET /members/:username */
export const getMember = (username) =>
  request(`/members/${encodeURIComponent(username)}`);

/**
 * POST /cohorts/:slug/join
 * Backend body accepts only `{ githubUsername, zid }` (strict); we still send
 * the two optional fields when supplied by the form so we surface any
 * backend-side "unexpected field" 400 to the user rather than silently
 * dropping their input.
 *
 * @param {string} slug
 * @param {{ githubUsername: string, zid: string, displayName?: string, programRepo?: string }} body
 */
export const joinCohort = (slug, body) =>
  request(`/cohorts/${encodeURIComponent(slug)}/join`, { method: 'POST', body });
