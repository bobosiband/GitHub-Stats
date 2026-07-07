/**
 * All GraphQL query strings live here so the shape of what we ask GitHub for is
 * in one auditable place. Everything read is PUBLIC data.
 */

/**
 * Minimal profile lookup used to verify a user exists at join time.
 * A non-existent login makes GitHub return a NOT_FOUND error.
 */
export const VERIFY_USER = /* GraphQL */ `
  query VerifyUser($login: String!) {
    user(login: $login) {
      id
      databaseId
      login
      name
      avatarUrl
      createdAt
    }
  }
`;

/**
 * The main per-member stats query: profile, owned repos (stars + languages),
 * external contribution count, lifetime merged PRs, and the windowed
 * contributionsCollection (commits/PRs/reviews/issues + daily calendar).
 */
export const USER_STATS = /* GraphQL */ `
  query UserStats($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      id
      databaseId
      login
      name
      avatarUrl
      createdAt
      followers {
        totalCount
      }
      repositoriesContributedTo(
        first: 1
        includeUserRepositories: false
        contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, PULL_REQUEST_REVIEW]
      ) {
        totalCount
      }
      mergedPullRequests: pullRequests(states: MERGED) {
        totalCount
      }
      repositories(
        first: 100
        ownerAffiliations: OWNER
        isFork: false
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        totalCount
        nodes {
          name
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
              }
            }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

/**
 * Commit history for a single registered ProgramRepo, filtered to the member
 * (by node id) and the cohort window. Used only to derive night-owl ratio from
 * commit timestamps, since the contribution calendar has no hour data.
 */
export const REPO_COMMITS = /* GraphQL */ `
  query RepoCommits(
    $owner: String!
    $name: String!
    $authorId: ID!
    $since: GitTimestamp!
    $until: GitTimestamp
    $cursor: String
  ) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(
              first: 100
              since: $since
              until: $until
              author: { id: $authorId }
              after: $cursor
            ) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                committedDate
              }
            }
          }
        }
      }
    }
  }
`;
