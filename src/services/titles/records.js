/**
 * RECORD title definitions. Exactly one holder per cohort; the record transfers
 * only when someone is **strictly** better (ties keep the incumbent).
 *
 * To add a record, append one object. No engine change required.
 *
 * @typedef {object} RecordRule
 * @property {string} key
 * @property {string} name
 * @property {string} description
 * @property {string} [flavor]
 * @property {string} stat  snapshot field this record is keyed on (used for the default value)
 * @property {(snapshot: object, member: object) => (number|null)} getValue
 *   the ranking metric; `null` means the member is ineligible for this record
 * @property {(snapshot: object, member: object) => boolean} [qualifies]
 *   optional additional gate
 * @property {boolean} [higherIsBetter]  default true; false = smaller wins (e.g. oldest account)
 * @property {(snapshot: object, member: object, metric: number) => object} [toValue]
 *   what to persist in TitleAward.value
 */

/** @type {RecordRule[]} */
export const RECORD_RULES = [
  {
    key: 'most_commits',
    name: 'The Machine',
    description: 'Most commit contributions in the cohort window.',
    flavor: 'Does this person ever stop?',
    stat: 'totalCommits',
    getValue: (s) => s.totalCommits,
  },
  {
    key: 'longest_streak',
    name: 'No Days Off',
    description: 'Longest run of consecutive days with a contribution.',
    flavor: 'Sleep is for the weak.',
    stat: 'longestStreak',
    getValue: (s) => s.longestStreak,
  },
  {
    key: 'most_contributions',
    name: 'Omnipresent',
    description: 'Most total contributions (commits, PRs, reviews, issues).',
    flavor: 'Everywhere, all at once.',
    stat: 'totalContributions',
    getValue: (s) => s.totalContributions,
  },
  {
    key: 'most_languages',
    name: 'The Polyglot',
    description: 'Most distinct languages across owned repositories.',
    flavor: 'Fluent in tabs and spaces alike.',
    stat: 'languageCount',
    getValue: (s) => s.languageCount,
  },
  {
    key: 'most_repos',
    name: 'Serial Shipper',
    description: 'Most non-fork repositories owned.',
    flavor: 'Another day, another repo.',
    stat: 'repoCount',
    getValue: (s) => s.repoCount,
  },
  {
    key: 'most_contributed',
    name: 'Community Pillar',
    description: 'Most external repositories contributed to.',
    flavor: 'Lifting everyone up.',
    stat: 'contributedRepoCount',
    getValue: (s) => s.contributedRepoCount,
  },
  {
    key: 'most_stars',
    name: 'Star Collector',
    description: 'Most total stars across owned repositories.',
    flavor: 'Shining bright.',
    stat: 'totalStars',
    getValue: (s) => s.totalStars,
  },
  {
    key: 'most_followers',
    name: 'The Influencer',
    description: 'Most GitHub followers.',
    flavor: 'Smash that follow button.',
    stat: 'followers',
    getValue: (s) => s.followers,
  },
  {
    key: 'most_merged_prs',
    name: 'Merge Lord',
    description: 'Most merged pull requests (lifetime).',
    flavor: 'It is merged. Move on.',
    stat: 'mergedPRs',
    getValue: (s) => s.mergedPRs,
  },
  {
    key: 'most_reviews',
    name: 'The Gatekeeper',
    description: 'Most pull-request reviews given.',
    flavor: 'None shall pass unreviewed.',
    stat: 'reviewsGiven',
    getValue: (s) => s.reviewsGiven,
  },
  {
    key: 'oldest_account',
    name: 'The Ancient One',
    description: 'The earliest-created GitHub account in the cohort.',
    flavor: 'Was here before it was cool.',
    stat: 'accountCreatedAt',
    higherIsBetter: false, // smaller timestamp (older) wins
    getValue: (_s, member) =>
      member?.accountCreatedAt ? new Date(member.accountCreatedAt).getTime() : null,
    toValue: (_s, _m, metric) => ({ accountCreatedAt: new Date(metric).toISOString() }),
  },
  {
    key: 'biggest_day',
    name: 'The Bender',
    description: 'Most contributions in a single day.',
    flavor: 'One sitting. No regrets.',
    stat: 'maxCommitsInOneDay',
    getValue: (s) => s.maxCommitsInOneDay,
  },
  {
    key: 'weekend_warrior',
    name: 'Weekend Warrior',
    description: 'Highest share of contributions made on weekends (min 20 total).',
    flavor: 'Saturday is just another commit day.',
    stat: 'weekendCommitRatio',
    qualifies: (s) => s.totalContributions >= 20,
    getValue: (s) => s.weekendCommitRatio,
    toValue: (s, _m, metric) => ({
      weekendCommitRatio: metric,
      totalContributions: s.totalContributions,
    }),
  },
  {
    key: 'night_owl',
    name: 'Night Owl',
    description: 'Highest share of commits made at night (22:00–06:00), for members with a registered repo.',
    flavor: 'Ships best after midnight.',
    stat: 'nightCommitRatio',
    getValue: (s) => s.nightCommitRatio, // null when there is no repo data → ineligible
  },
];
