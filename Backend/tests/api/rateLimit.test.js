import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import { resetDb, disconnectDb, makeCohort } from '../helpers/db.js';
import { GithubUserNotFoundError } from '../../src/services/github/fetchUserStats.js';

let app;

const verifyGithubUser = async ({ username }) => {
  if (username === 'ghostuser') throw new GithubUserNotFoundError(username);
  return {
    githubId: 900,
    nodeId: `N-${username}`,
    login: username,
    displayName: `The ${username}`,
    avatarUrl: `https://avatar/${username}`,
    accountCreatedAt: new Date('2017-05-05T00:00:00Z'),
  };
};

beforeAll(async () => {
  // Strict caps: 3 joins/minute, 10 general/minute — small enough to trip easily
  // in-test but generous enough to leave non-join traffic un-affected.
  app = await buildTestApp({
    verifyGithubUser,
    rateLimitJoinMax: 3,
    rateLimitJoinWindow: '1 minute',
    rateLimitGlobalMax: 200,
    rateLimitGlobalWindow: '1 minute',
  });
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

describe('POST /cohorts/:slug/join rate limit', () => {
  it('returns 429 with the standard error shape after exceeding the join limit', async () => {
    await makeCohort({ slug: 'open', isActive: true });

    let last;
    // Fire 4 joins (limit is 3). Use distinct zids/usernames so the FIRST 3 are
    // legitimate 201s and the 4th hits the limiter.
    for (let i = 0; i < 4; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/cohorts/open/join',
        payload: { githubUsername: `u${i}`, zid: `z900001${i}` },
      });
    }

    expect(last.statusCode).toBe(429);
    const body = last.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(typeof body.error.message).toBe('string');
    // Should NOT include a top-level statusCode / raw plugin fields.
    expect(body.statusCode).toBeUndefined();
  });

  it('leaves ordinary reads unaffected by the join limit', async () => {
    await makeCohort({ slug: 'open', isActive: true });
    // Blow past the join limit.
    for (let i = 0; i < 4; i++) {
      await app.inject({
        method: 'POST',
        url: '/cohorts/open/join',
        payload: { githubUsername: `u${i}`, zid: `z900002${i}` },
      });
    }
    // Reads use the (very large) global limit only.
    const res = await app.inject({ method: 'GET', url: '/cohorts' });
    expect(res.statusCode).toBe(200);
  });
});
