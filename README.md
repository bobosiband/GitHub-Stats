# GitRank

**Live site:** <https://bobosiband.github.io/GitHub-Stats/>

A public leaderboard for GitHub activity, dressed up like Duolingo. Join with
your GitHub username, get an XP-driven level, a streak flame, contribution
heatmap, language "skill" circles, and titles you win by out-committing (or
out-shipping, or out-reviewing) the other members of your cohort.

Nothing is private. There's no auth, no OAuth, no passwords — only your public
GitHub profile is read, only for members who opted in.

## What you can do on the site

- **Browse leaderboards.** Every cohort has one; the always-on **Global**
  cohort covers every joiner on a rolling 365-day window. Sort by XP (default),
  commits, contributions, streak, or stars — the sort is a URL param so
  `?sort=stars` is shareable. Rank movement since the last sync shows as a
  ▲2 / ▼1 / — pill on each row.
- **Open a profile** (`/u/<username>`). Big avatar wrapped in an XP ring
  showing progress toward the next level; a streak flame that lights up at
  7/30/100 days; a 52-week contribution heatmap; circular language badges (top
  5 shown, click **+N** to reveal the rest with byte-share percentages); the
  **Next up** cards showing which badges you're closest to earning.
- **Join a cohort** at [`/join`](https://bobosiband.github.io/GitHub-Stats/#/join).
  Enter your GitHub username. UNSW students add their zID; everyone else can
  leave it blank and land on the Global leaderboard. The backend verifies the
  GitHub user exists before adding you.
- **Compare two members head-to-head** at
  [`/compare`](https://bobosiband.github.io/GitHub-Stats/#/compare). Pick two
  people from the combobox (or share a `?a=X&b=Y` link); the page renders a
  duel across 9 stats with a running score.
- **See who holds what.** Each cohort's **Titles** tab lists the "records" —
  Machine (most commits), No Days Off (longest streak), Polyglot (most
  languages), Night Owl, Weekend Warrior, and more — plus every permanent
  **Badge** members have earned (Century, Week Streak, Reviewer, level
  milestones, …). Records transfer only when someone *strictly* beats the
  incumbent; ties keep the holder.

## How the numbers work

- **Stats** are pulled every 30 minutes from the GitHub GraphQL API and stored
  as append-only snapshots. Program cohorts count the window between the
  cohort's start and end dates; the global cohort counts the trailing 365
  days, so on Global your XP *can* fall as old work rolls off.
- **XP** is deterministic and denormalised onto every snapshot
  ([`Backend/src/services/xp.js`](Backend/src/services/xp.js)). Reviews are
  worth the most per unit; stars and followers use `sqrt` so you can't game
  them; language bytes cap at 300 XP per language (one maxed "skill" —
  Duolingo cap), with a small polyglot bonus for breadth.
- **Levels** follow the curve `xp = round(100 · level^1.7)`. Level 5 ≈ 1.5k
  XP, Level 10 ≈ 5k, Level 20 ≈ 16k. Hitting a new level triggers a one-time
  confetti burst on your next profile visit.
- **Titles** are evaluated declaratively after every sync — no bespoke code
  per title, just a rule in
  [`Backend/src/services/titles/`](Backend/src/services/titles/).

## Repo layout

- [`Backend/`](./Backend) — Node 20 / Fastify 5 / Prisma / Postgres API. Runs
  the sync cron, computes XP, evaluates the title engine, and exposes the
  public REST API. See [`Backend/README.md`](./Backend/README.md) for the
  full route table, XP formula, and admin endpoints.
- [`Frontend/`](./Frontend) — React + Vite + Tailwind + framer-motion SPA that
  reads the public JSON API. Deploys to GitHub Pages. See
  [`Frontend/README.md`](./Frontend/README.md) for the design system,
  configuration knobs, and the `?api=` override for pointing at a different
  backend.

## Run it locally

```bash
# Backend — Postgres via Docker, then Fastify on :3000
cd Backend
docker compose up -d
npm install
cp .env.example .env       # set GITHUB_TOKEN and ADMIN_TOKEN
npm run db:migrate
npm run db:seed            # 6 seeded members with data ready to browse
npm run dev

# Frontend — Vite on :5173, pointed at localhost:3000 by default
cd ../Frontend
npm install
npm run dev
```

Open <http://localhost:5173>. To point a running frontend at a different
backend without rebuilding, append `?api=<url>` to any page URL — it's
persisted in `localStorage` until you clear it.

## Contributing / roadmap

See [`CHANGES.md`](./CHANGES.md) for what shipped in v2. Both packages have
Vitest suites (`npm test` in each) and ESLint configs; CI runs both on every
push.
