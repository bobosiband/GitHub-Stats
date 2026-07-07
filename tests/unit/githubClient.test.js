import { describe, it, expect } from 'vitest';
import { createGithubClient } from '../../src/services/github/client.js';

describe('createGithubClient retry behaviour', () => {
  const noSleep = async () => {};

  it('retries transient 5xx errors then succeeds', async () => {
    let calls = 0;
    const graphqlImpl = async () => {
      calls += 1;
      if (calls < 3) {
        const err = new Error('server error');
        err.status = 502;
        throw err;
      }
      return { ok: true };
    };
    const client = createGithubClient({ graphql: graphqlImpl, sleep: noSleep });
    await expect(client.query('q', {})).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('honours a retry-after header from the secondary rate limit', async () => {
    const waits = [];
    let calls = 0;
    const graphqlImpl = async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('secondary rate limit');
        err.response = { headers: { 'retry-after': '2' } };
        throw err;
      }
      return { ok: true };
    };
    const client = createGithubClient({
      graphql: graphqlImpl,
      sleep: async (ms) => waits.push(ms),
    });
    await client.query('q', {});
    expect(waits).toEqual([2000]);
  });

  it('gives up after maxRetries and rethrows', async () => {
    const graphqlImpl = async () => {
      const err = new Error('boom');
      err.status = 500;
      throw err;
    };
    const client = createGithubClient({ graphql: graphqlImpl, sleep: noSleep, maxRetries: 2 });
    await expect(client.query('q', {})).rejects.toThrow('boom');
  });

  it('does not retry a non-transient client error', async () => {
    let calls = 0;
    const graphqlImpl = async () => {
      calls += 1;
      const err = new Error('bad request');
      err.status = 400;
      throw err;
    };
    const client = createGithubClient({ graphql: graphqlImpl, sleep: noSleep });
    await expect(client.query('q', {})).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });
});
