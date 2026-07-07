# GitRank — backend

Tracks the GitHub activity of participants in DevSoc's training program, ranks them
on a leaderboard, and awards **titles** — named records (one holder per cohort, they
transfer when beaten) and threshold badges (permanent, anyone can earn them).

Membership is **strictly opt-in**. People join by submitting their GitHub username +
UNSW zID to a public endpoint; the backend verifies the GitHub user exists and adds
them to the cohort. There is no member auth, no OAuth, no passwords — only **public**
GitHub data is ever read, and only for people who are rows in the `Member` table.

```
   join (public)                scheduled sync (cron)                title engine
  ┌────────────┐   Member   ┌───────────────────────┐  snapshots  ┌──────────────┐
  │ POST /join │──────────▶ │ GitHub GraphQL API →   │───────────▶ │ evaluate     │
  └────────────┘            │ normalized UserStats → │             │ records +    │
                            │ StatSnapshot (append)  │             │ badges       │
                            └───────────────────────┘             └──────┬───────┘
                                                                          │ awards
                                        ┌─────────────────────────────────▼───────┐
                                        │ JSON REST API: leaderboards, profiles,   │
                                        │ titles, cohorts, admin                   │
                                        └──────────────────────────────────────────┘
```

**Data flow:** a cron job pulls each member's stats via the GitHub GraphQL API →
stats are stored as append-only **snapshots** (latest snapshot per member = "current
stats", so history comes for free) → the **title engine** evaluates declarative rules
against the latest snapshots and persists awards → the API serves it all.

## Tech stack

Node 20+ (ES modules) · Fastify 5 · PostgreSQL + Prisma · `@octokit/graphql` ·
node-cron · zod · pino · Vitest · ESLint + Prettier.

## Quick start

```bash
# 1. Postgres (creates `gitrank` + `gitrank_test` databases)
docker compose up -d

# 2. Install + configure
npm install
cp .env.example .env          # then set GITHUB_TOKEN and ADMIN_TOKEN

# 3. Migrate + seed a demo cohort (6 members, snapshots, awards)
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev                   # http://localhost:3000
curl localhost:3000/cohorts/devsoc-2025/leaderboard
```

### Sample leaderboard output (from the seed)

```
sortField: totalCommits
 1 ada-lovelace         commits=480 contrib=627 streak=39 stars=60
 2 linus-torvalds       commits=300 contrib=362 streak=8  stars=1500
 3 alan-turing          commits=260 contrib=308 streak=6  stars=20
 4 grace-hopper         commits=220 contrib=450 streak=11 stars=45
 5 margaret-hamilton    commits=140 contrib=536 streak=14 stars=12
 6 katherine-johnson    commits=18  contrib=120 streak=2  stars=1
```

## Environment variables

All variables are validated at boot by [`src/config.js`](src/config.js); the process
exits with a readable message if anything is missing or malformed.

| Variable       | Required | Default       | Description                                                         |
| -------------- | -------- | ------------- | ------------------------------------------------------------------- |
| `DATABASE_URL` | yes      | —             | Postgres connection string.                                         |
| `GITHUB_TOKEN` | yes      | —             | GitHub PAT for the sync job. Only needs **public** read scope.      |
| `ADMIN_TOKEN`  | yes      | —             | Static bearer token guarding `/admin/*`.                            |
| `SYNC_CRON`    | no       | `0 */3 * * *` | Cron expression for the scheduled sync (every 3 hours).             |
| `PORT`         | no       | `3000`        | HTTP port.                                                          |
| `HOST`         | no       | `0.0.0.0`     | Bind host.                                                          |
| `LOG_LEVEL`    | no       | `info`        | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`.             |
| `ENABLE_CRON`  | no       | `true`        | Set `false` to build the app without scheduling the sync.           |
| `CORS_ORIGIN`  | no       | `http://localhost:5173` | Comma-separated origins allowed to call the API from a browser. |
| `NODE_ENV`     | no       | `development` | `test` disables the logger.                                         |

## npm scripts

| Script               | Does                                             |
| -------------------- | ------------------------------------------------ |
| `npm run dev`        | Start the server with `--watch`.                 |
| `npm start`          | Start the server.                                |
| `npm test`           | Run the full Vitest suite (needs the test DB up).|
| `npm run test:coverage` | Tests with a V8 coverage report.              |
| `npm run lint`       | ESLint.                                           |
| `npm run format`     | Prettier `--write`.                              |
| `npm run db:migrate` | `prisma migrate dev`.                            |
| `npm run db:seed`    | Seed the demo cohort.                            |
| `npm run db:reset`   | Drop + re-create + re-seed the dev DB.           |
| `npm run docs:gen`   | Regenerate `openapi.json` from the spec source.  |

## API

All responses are JSON. Errors use a consistent shape:
`{ "error": { "code": "NOT_FOUND", "message": "…" } }`. Reads are unauthenticated;
`/admin/*` requires `Authorization: Bearer <ADMIN_TOKEN>`.

**Interactive docs:** Swagger UI is served at **`/docs`**; the raw OpenAPI 3.0 spec is at
**`/openapi.json`** (also `/docs/json`). The spec is authored in
[`src/docs/openapi.js`](src/docs/openapi.js) and served in static mode (decoupled from
route validation); a committed copy lives at [`openapi.json`](openapi.json) — regenerate
it with `npm run docs:gen`.

| Method & path                        | Auth  | Description                                                    |
| ------------------------------------ | ----- | ------------------------------------------------------------- |
| `GET /health`                        | —     | DB status + last snapshot time.                               |
| `GET /docs`                          | —     | Swagger UI.                                                    |
| `GET /openapi.json`                  | —     | Raw OpenAPI 3.0 spec.                                          |
| `GET /cohorts`                       | —     | List cohorts with member counts.                              |
| `GET /cohorts/:slug`                 | —     | Cohort detail + member count.                                 |
| `GET /cohorts/:slug/leaderboard`     | —     | Ranked members. `?sort=commits\|contributions\|streak\|stars`.|
| `GET /cohorts/:slug/titles`          | —     | All titles with current holders / badge earners.              |
| `GET /members/:username`             | —     | Profile: latest stats per cohort, titles (incl. past), badges.|
| `POST /cohorts/:slug/join`           | —     | **Public** self-serve join (see below).                       |
| `POST /admin/cohorts`                | admin | Create a cohort.                                              |
| `DELETE /admin/members/:username`    | admin | Remove a member (cascades), then re-evaluate affected cohorts.|
| `POST /admin/sync/:slug`             | admin | Trigger a manual sync + title evaluation; returns a summary.  |

### Join flow — `POST /cohorts/:slug/join`

Body: `{ githubUsername, zid, displayName?, programRepo? }` where `programRepo` is
`"owner/name"` or `{ owner, name }`.

- `zid` must match `z` + 7 digits → otherwise **400**.
- Unknown cohort → **404**; inactive/ended cohort → **403**.
- The `(zid, githubUsername)` pair is the identity boundary:
  - duplicate zid or username belonging to a **different** identity → **409** (no silent re-linking);
  - the **same** `(zid, username)` returning to join a new cohort → the existing `Member`
    row is reused, a new `Membership` is added, and old titles are preserved.
- New members are verified against the GitHub API; a non-existent user → **422**.
- Success → **201** with the member profile.

## Titles

Records (one holder per cohort, transfer on **strictly** greater — ties keep the incumbent):
`most_commits`, `longest_streak`, `most_contributions`, `most_languages`, `most_repos`,
`most_contributed`, `most_stars`, `most_followers`, `most_merged_prs`, `most_reviews`,
`oldest_account`, `biggest_day`, `weekend_warrior` (min 20 contributions), `night_owl`.

Badges (threshold, permanent): `first_push`, `century`, `streak_7`, `streak_30`,
`first_merge`, `reviewer`, `five_languages`, `starred`.

### Adding a new title (≈5 lines, no engine changes)

Append one object to [`src/services/titles/records.js`](src/services/titles/records.js)
or [`badges.js`](src/services/titles/badges.js):

```js
// a record:
{
  key: 'most_issues', name: 'Bug Hunter',
  description: 'Most issues opened.', stat: 'issuesOpened',
  getValue: (s) => s.issuesOpened,           // optional: qualifies, higherIsBetter, toValue
}
// a badge:
{ key: 'issue_10', name: 'Ten Issues', description: 'Opened 10 issues.',
  stat: 'issuesOpened', qualifies: (s) => s.issuesOpened >= 10 }
```

The engine upserts the definition into the `Title` table on the next run and starts
awarding it. It is idempotent — evaluating twice changes nothing.

## GitHub data & rate limits

- Everything read is **public**. Contribution-calendar totals include private activity
  only if the user enables *"Include private contributions on my profile"* in their
  GitHub settings; stars/languages/program-repo stats require the repos to be **public**.
  **Program guideline: make your training project repo public.**
- The night-owl ratio comes from registered `ProgramRepo` commit timestamps (the
  contribution calendar has no hour data). Members without a registered repo simply
  can't win Night Owl.
- Sync costs ~4–5 GraphQL points per member; a 50-person cohort is trivial against the
  5,000/hr budget. The client ([`src/services/github/client.js`](src/services/github/client.js))
  retries transient errors and honours secondary-rate-limit `retry-after` headers, and
  the sync processes members **sequentially** with a small delay (never `Promise.all`).

## Architecture notes

- GitHub access is sealed behind `src/services/github/` — everything else depends only
  on a plain `UserStats` object, which keeps the title engine and tests network-free.
- All math/rules are small **pure** functions ([`streaks.js`](src/services/streaks.js),
  the title definitions); I/O lives at the edges (sync, routes, engine persistence).
- Snapshots are **append-only**, giving progress history for free.

## Global Leaderboard

GitRank ships with a single always-on **global cohort** (slug `global`, `kind: GLOBAL`).
Every member who joins any cohort is auto-added to it in the same transaction; joining
`global` directly also works. It reuses all the existing plumbing:

- `GET /cohorts/global/leaderboard` — ranked members across everyone who has ever joined,
- `GET /cohorts/global/titles` — records + badges scoped to the global cohort,
- `POST /admin/sync/global` — manual sync/eval, same shape as any other cohort.

**Rolling window.** GitHub's `contributionsCollection` window is capped at ~one year, and
handing early joiners a permanent lead would kill the leaderboard within a trimester. So
the global cohort ranks the **last 365 days** of activity — the window slides forward on
every sync (`syncWindowForCohort` in [`src/services/sync.js`](src/services/sync.js)).
Titles held on `global` are therefore **rolling records** — an old holder can lose it
without a challenger simply because their year-ago work fell out of the window.

Program cohorts are unaffected: they still use `[startDate, min(endDate, now)]` (clamped
to the most recent 365 days with a warning if a cohort ever exceeds a year). Titles on
program cohorts and `global` are independent — the same member can hold `most_commits`
in both.

## Testing

Vitest, with the GitHub layer mocked (no real network). Tests run against a dedicated
`gitrank_test` Postgres database (created by `docker compose up`); the schema is applied
once per run via `prisma migrate deploy`, and each test truncates between cases.

```bash
docker compose up -d      # if not already running
npm test
```

- **Unit** (`tests/unit/`): `streaks.js` (exhaustive), stat normalization, github client
  retry, sync-job lock.
- **Integration** (`tests/integration/`): title engine (award / transfer / tie /
  idempotency / gates) and the sync → snapshot → award flow with a fake client.
- **API** (`tests/api/`): leaderboard ordering, member profiles, admin auth, and the
  full public join flow.
