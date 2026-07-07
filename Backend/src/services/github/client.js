import { graphql } from '@octokit/graphql';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inspect an error for a retry hint. Handles GitHub's secondary rate limit
 * (`retry-after` header) and primary rate limit (`x-ratelimit-remaining: 0`,
 * wait until `x-ratelimit-reset`). Returns milliseconds to wait, or null.
 */
function rateLimitDelayMs(err) {
  const headers = err?.response?.headers ?? err?.headers ?? {};
  const retryAfter = headers['retry-after'];
  if (retryAfter != null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  }
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (remaining === '0' && reset != null) {
    const resetMs = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(resetMs) && resetMs > 0) return resetMs;
  }
  return null;
}

/** Server errors and transient network failures are worth a retry. */
function isTransient(err) {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === 'number' && status >= 500) return true;
  const code = err?.code;
  return ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
}

/**
 * Thin wrapper around @octokit/graphql adding retry + rate-limit awareness.
 *
 * @param {object} opts
 * @param {string} [opts.token]      GitHub PAT (server auth)
 * @param {Function} [opts.graphql]  inject the underlying graphql callable (tests)
 * @param {Function} [opts.sleep]    inject a sleep fn (tests)
 * @param {number}  [opts.maxRetries]
 * @param {number}  [opts.maxDelayMs] cap on any single wait
 * @returns {{ query: Function }}
 */
export function createGithubClient(opts = {}) {
  const gql =
    opts.graphql ?? graphql.defaults({ headers: { authorization: `token ${opts.token}` } });
  const wait = opts.sleep ?? sleep;
  const maxRetries = opts.maxRetries ?? 3;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;

  /**
   * Execute a GraphQL document with retries.
   * @param {string} document
   * @param {object} variables
   */
  async function query(document, variables) {
    let attempt = 0;
    for (;;) {
      try {
        return await gql(document, variables);
      } catch (err) {
        attempt += 1;
        if (attempt > maxRetries) throw err;

        const rlDelay = rateLimitDelayMs(err);
        if (rlDelay != null) {
          await wait(Math.min(rlDelay, maxDelayMs));
          continue;
        }
        if (isTransient(err)) {
          // Exponential backoff: 0.5s, 1s, 2s …
          await wait(Math.min(500 * 2 ** (attempt - 1), maxDelayMs));
          continue;
        }
        throw err;
      }
    }
  }

  return { query };
}
