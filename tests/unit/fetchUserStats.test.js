import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizeUserStats,
  createStatsFetcher,
  createUserVerifier,
  GithubUserNotFoundError,
} from '../../src/services/github/fetchUserStats.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/userStatsResponse.json', import.meta.url)), 'utf8'),
);

describe('normalizeUserStats', () => {
  const stats = normalizeUserStats(fixture.user, { today: '2025-03-10' });

  it('maps profile fields', () => {
    expect(stats.githubId).toBe(12345);
    expect(stats.nodeId).toBe('MDQ6VXNlcjEyMzQ1');
    expect(stats.login).toBe('octostudent');
    expect(stats.displayName).toBe('Octo Student');
    expect(stats.avatarUrl).toContain('avatars.githubusercontent.com');
    expect(stats.accountCreatedAt).toBeInstanceOf(Date);
    expect(stats.accountCreatedAt.toISOString()).toBe('2019-06-15T08:00:00.000Z');
  });

  it('maps counters', () => {
    expect(stats.followers).toBe(42);
    expect(stats.contributedRepoCount).toBe(7);
    expect(stats.mergedPRs).toBe(18);
    expect(stats.repoCount).toBe(3);
    expect(stats.totalStars).toBe(42); // 30 + 12 + 0
  });

  it('maps windowed contribution counts', () => {
    expect(stats.totalCommits).toBe(30);
    expect(stats.totalPRs).toBe(4);
    expect(stats.reviewsGiven).toBe(2);
    expect(stats.issuesOpened).toBe(3);
    expect(stats.totalContributions).toBe(36);
  });

  it('aggregates languages by bytes and takes the top 5', () => {
    expect(stats.languageCount).toBe(4);
    expect(stats.topLanguages).toEqual([
      { name: 'TypeScript', bytes: 13000 },
      { name: 'JavaScript', bytes: 10000 },
      { name: 'Python', bytes: 3000 },
      { name: 'CSS', bytes: 2000 },
    ]);
  });

  it('flattens the calendar and derives streak stats', () => {
    expect(stats.calendar).toHaveLength(10);
    expect(stats.longestStreak).toBe(4); // Mar 5-8
    expect(stats.currentStreak).toBe(1); // Mar 10 (Mar 9 was 0)
    expect(stats.maxCommitsInOneDay).toBe(8);
    expect(stats.weekendCommitRatio).toBeCloseTo(14 / 36, 10);
  });

  it('leaves night ratio null without commit timestamps', () => {
    expect(stats.nightCommitRatio).toBeNull();
  });

  it('computes night ratio when timestamps are supplied', () => {
    const withNight = normalizeUserStats(fixture.user, {
      today: '2025-03-10',
      programCommitTimestamps: [
        '2025-03-05T23:30:00+10:00',
        '2025-03-06T14:00:00+10:00',
        '2025-03-07T02:00:00+10:00',
      ],
    });
    expect(withNight.nightCommitRatio).toBeCloseTo(2 / 3, 10);
  });

  it('throws GithubUserNotFoundError for a null user', () => {
    expect(() => normalizeUserStats(null)).toThrow(GithubUserNotFoundError);
  });
});

describe('createStatsFetcher', () => {
  it('runs USER_STATS then repo commit queries and normalizes', async () => {
    const seen = [];
    const client = {
      query: async (doc, vars) => {
        seen.push(vars);
        if (doc.includes('query UserStats')) return fixture;
        if (doc.includes('query RepoCommits')) {
          return {
            repository: {
              defaultBranchRef: {
                target: {
                  history: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      { committedDate: '2025-03-05T23:30:00+10:00' },
                      { committedDate: '2025-03-06T14:00:00+10:00' },
                      { committedDate: '2025-03-07T02:00:00+10:00' },
                    ],
                  },
                },
              },
            },
          };
        }
        throw new Error(`unexpected query: ${doc.slice(0, 40)}`);
      },
    };

    const fetchUserStats = createStatsFetcher(client);
    const stats = await fetchUserStats({
      username: 'octostudent',
      programRepos: [{ owner: 'octostudent', name: 'cool-project' }],
      since: '2025-01-01',
      until: '2025-03-10',
      today: '2025-03-10',
    });

    expect(stats.login).toBe('octostudent');
    expect(stats.nightCommitRatio).toBeCloseTo(2 / 3, 10);
    // First call is the stats query with the login variable.
    expect(seen[0]).toMatchObject({ login: 'octostudent' });
    // Second call is the repo history with the resolved author node id.
    expect(seen[1]).toMatchObject({ owner: 'octostudent', name: 'cool-project', authorId: 'MDQ6VXNlcjEyMzQ1' });
  });

  it('maps a GraphQL NOT_FOUND to GithubUserNotFoundError', async () => {
    const client = {
      query: async () => {
        const err = new Error('Could not resolve to a User');
        err.errors = [{ type: 'NOT_FOUND', path: ['user'] }];
        throw err;
      },
    };
    await expect(createStatsFetcher(client)({ username: 'ghost' })).rejects.toBeInstanceOf(
      GithubUserNotFoundError,
    );
  });

  it('skips program repos that error without failing the whole fetch', async () => {
    const client = {
      query: async (doc) => {
        if (doc.includes('query UserStats')) return fixture;
        throw new Error('repo blew up');
      },
    };
    const stats = await createStatsFetcher(client)({
      username: 'octostudent',
      programRepos: [{ owner: 'x', name: 'gone' }],
      today: '2025-03-10',
    });
    expect(stats.nightCommitRatio).toBeNull();
  });
});

describe('createUserVerifier', () => {
  it('returns a profile for an existing user', async () => {
    const client = { query: async () => fixture };
    const profile = await createUserVerifier(client)({ username: 'octostudent' });
    expect(profile).toMatchObject({ githubId: 12345, login: 'octostudent', nodeId: 'MDQ6VXNlcjEyMzQ1' });
    expect(profile.accountCreatedAt).toBeInstanceOf(Date);
  });

  it('throws GithubUserNotFoundError when the user does not exist', async () => {
    const client = {
      query: async () => {
        const err = new Error('not found');
        err.errors = [{ type: 'NOT_FOUND' }];
        throw err;
      },
    };
    await expect(createUserVerifier(client)({ username: 'ghost' })).rejects.toBeInstanceOf(
      GithubUserNotFoundError,
    );
  });
});
