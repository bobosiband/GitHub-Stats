import { USER_STATS, VERIFY_USER, REPO_COMMITS } from './queries.js';
import {
  longestStreak,
  currentStreak,
  maxCommitsInOneDay,
  weekendCommitRatio,
  nightCommitRatio,
} from '../streaks.js';

/**
 * Normalised, storage-shaped view of a member's public GitHub activity. This is
 * the ONLY thing the rest of the app depends on — no GraphQL leaks past here.
 *
 * @typedef {object} UserStats
 * @property {number|null} githubId
 * @property {string} nodeId
 * @property {string} login
 * @property {string|null} displayName
 * @property {string|null} avatarUrl
 * @property {Date|null} accountCreatedAt
 * @property {number} followers
 * @property {number} contributedRepoCount
 * @property {number} mergedPRs
 * @property {number} repoCount
 * @property {number} totalStars
 * @property {number} languageCount
 * @property {{name: string, bytes: number}[]} topLanguages
 * @property {number} totalCommits
 * @property {number} totalPRs
 * @property {number} reviewsGiven
 * @property {number} issuesOpened
 * @property {number} totalContributions
 * @property {{date: string, count: number}[]} calendar
 * @property {number} longestStreak
 * @property {number} currentStreak
 * @property {number} maxCommitsInOneDay
 * @property {number} weekendCommitRatio
 * @property {number|null} nightCommitRatio
 */

/** Thrown when GitHub has no such user. Routes translate this to HTTP 422. */
export class GithubUserNotFoundError extends Error {
  constructor(username) {
    super(`GitHub user not found: ${username}`);
    this.name = 'GithubUserNotFoundError';
    this.code = 'GITHUB_USER_NOT_FOUND';
    this.username = username;
  }
}

/** Detect octokit's GraphqlResponseError carrying a NOT_FOUND for the user. */
function isNotFoundError(err) {
  const errors = err?.errors ?? err?.response?.errors;
  return Array.isArray(errors) && errors.some((e) => e?.type === 'NOT_FOUND');
}

const oneYearAgoIso = () => new Date(Date.now() - 365 * 86_400_000).toISOString();
const toIso = (v, fallback) => (v ? new Date(v).toISOString() : fallback);

/**
 * Turn the raw `user` node from USER_STATS into a {@link UserStats}. Pure — no I/O.
 * @param {object} user  the `data.user` node
 * @param {object} [ctx]
 * @param {(string)[]} [ctx.programCommitTimestamps]  commit timestamps for night-owl
 * @param {Date|string} [ctx.today]
 * @returns {UserStats}
 */
export function normalizeUserStats(
  user,
  { programCommitTimestamps = [], today = new Date() } = {},
) {
  if (!user) throw new GithubUserNotFoundError('(unknown)');

  const repoNodes = user.repositories?.nodes ?? [];
  const totalStars = repoNodes.reduce((sum, r) => sum + (r.stargazerCount ?? 0), 0);

  const langBytes = new Map();
  for (const repo of repoNodes) {
    for (const edge of repo.languages?.edges ?? []) {
      const name = edge?.node?.name;
      if (!name) continue;
      langBytes.set(name, (langBytes.get(name) ?? 0) + (edge.size ?? 0));
    }
  }
  const sortedLangs = [...langBytes.entries()].sort((a, b) => b[1] - a[1]);
  const topLanguages = sortedLangs.slice(0, 5).map(([name, bytes]) => ({ name, bytes }));

  const cc = user.contributionsCollection ?? {};
  const calendar = [];
  for (const week of cc.contributionCalendar?.weeks ?? []) {
    for (const day of week.contributionDays ?? []) {
      calendar.push({ date: day.date, count: day.contributionCount ?? 0 });
    }
  }

  return {
    githubId: user.databaseId ?? null,
    nodeId: user.id,
    login: user.login,
    displayName: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
    accountCreatedAt: user.createdAt ? new Date(user.createdAt) : null,

    followers: user.followers?.totalCount ?? 0,
    contributedRepoCount: user.repositoriesContributedTo?.totalCount ?? 0,
    mergedPRs: user.mergedPullRequests?.totalCount ?? 0,
    repoCount: user.repositories?.totalCount ?? 0,
    totalStars,
    languageCount: sortedLangs.length,
    topLanguages,

    totalCommits: cc.totalCommitContributions ?? 0,
    totalPRs: cc.totalPullRequestContributions ?? 0,
    reviewsGiven: cc.totalPullRequestReviewContributions ?? 0,
    issuesOpened: cc.totalIssueContributions ?? 0,
    totalContributions: cc.contributionCalendar?.totalContributions ?? 0,
    calendar,

    longestStreak: longestStreak(calendar),
    currentStreak: currentStreak(calendar, today),
    maxCommitsInOneDay: maxCommitsInOneDay(calendar),
    weekendCommitRatio: weekendCommitRatio(calendar),
    nightCommitRatio: nightCommitRatio(programCommitTimestamps),
  };
}

/** Page through one repo's commit history, collecting the member's commit times. */
async function collectRepoTimestamps(client, { owner, name, authorId, since, until }) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const data = await client.query(REPO_COMMITS, { owner, name, authorId, since, until, cursor });
    const history = data?.repository?.defaultBranchRef?.target?.history;
    if (!history) break;
    for (const node of history.nodes ?? []) {
      if (node?.committedDate) out.push(node.committedDate);
    }
    if (!history.pageInfo?.hasNextPage) break;
    cursor = history.pageInfo.endCursor;
  }
  return out;
}

/**
 * Build the member stats fetcher bound to a github client.
 * @param {{ query: Function }} client
 */
export function createStatsFetcher(client) {
  /**
   * @param {object} params
   * @param {string} params.username
   * @param {{owner: string, name: string}[]} [params.programRepos]
   * @param {Date|string} [params.since]
   * @param {Date|string} [params.until]
   * @param {Date|string} [params.today]
   * @returns {Promise<UserStats>}
   */
  return async function fetchUserStats({ username, programRepos = [], since, until, today }) {
    const from = toIso(since, oneYearAgoIso());
    const to = toIso(until, new Date().toISOString());

    let data;
    try {
      data = await client.query(USER_STATS, { login: username, from, to });
    } catch (err) {
      if (isNotFoundError(err)) throw new GithubUserNotFoundError(username);
      throw err;
    }
    if (!data?.user) throw new GithubUserNotFoundError(username);

    const timestamps = [];
    for (const repo of programRepos) {
      try {
        const ts = await collectRepoTimestamps(client, {
          owner: repo.owner,
          name: repo.name,
          authorId: data.user.id,
          since: from,
          until: to,
        });
        timestamps.push(...ts);
      } catch {
        // A renamed/deleted/private repo just yields no night-owl data — skip it.
      }
    }

    return normalizeUserStats(data.user, {
      programCommitTimestamps: timestamps,
      today: today ?? to,
    });
  };
}

/**
 * Build the lightweight "does this GitHub user exist?" verifier used at join time.
 * @param {{ query: Function }} client
 */
export function createUserVerifier(client) {
  /**
   * @param {{ username: string }} params
   * @returns {Promise<{githubId: number|null, nodeId: string, login: string,
   *   displayName: string|null, avatarUrl: string|null, accountCreatedAt: Date|null}>}
   */
  return async function verifyGithubUser({ username }) {
    let data;
    try {
      data = await client.query(VERIFY_USER, { login: username });
    } catch (err) {
      if (isNotFoundError(err)) throw new GithubUserNotFoundError(username);
      throw err;
    }
    if (!data?.user) throw new GithubUserNotFoundError(username);
    const u = data.user;
    return {
      githubId: u.databaseId ?? null,
      nodeId: u.id,
      login: u.login,
      displayName: u.name ?? null,
      avatarUrl: u.avatarUrl ?? null,
      accountCreatedAt: u.createdAt ? new Date(u.createdAt) : null,
    };
  };
}

/**
 * Convenience factory returning both service functions bound to one client.
 * @param {{ query: Function }} client
 */
export function createGithubService(client) {
  return {
    fetchUserStats: createStatsFetcher(client),
    verifyGithubUser: createUserVerifier(client),
  };
}
