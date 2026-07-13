# GitHub-Stats

Monorepo for **GitRank v2** — a public GitHub-activity leaderboard fused with
Duolingo-style gamification (XP, levels, streak flame, level-up celebrations,
rank-movement deltas).

- [`Backend/`](./Backend) — Node 20 / Fastify 5 / Prisma / Postgres API. Syncs
  member stats every 30 minutes, computes deterministic XP per snapshot, ranks
  members on program + global leaderboards, and awards titles through a
  declarative engine. See [`Backend/README.md`](./Backend/README.md).
- [`Frontend/`](./Frontend) — React + Vite + Tailwind + framer-motion SPA that
  reads the public JSON API. GitHub-dark palette with a Duolingo layer on top
  (XP rings, chunky level badges, streak flame, language "skill" circles,
  52-week contribution heatmap, rank-delta pills). See
  [`Frontend/README.md`](./Frontend/README.md).

See [`CHANGES.md`](./CHANGES.md) for what shipped in v2.
