# GitRank v2 — CHANGES

This is a summary of the v2 delta: what shipped, and the decisions (with
reasons) where I deviated from the original prompt.

## Feature 1 — Open the global cohort (zid optional)

### Delivered
- `Member.zid` is now nullable in Prisma (`prisma/schema.prisma`), with the
  unique constraint intact — Postgres unique indexes ignore NULLs, so any
  number of members can have `zid = NULL` while real zids stay unique.
- Additive, reversible migration `20260713120000_zid_nullable` — no `db push`,
  no `migrate reset`.
- Join validation in `src/routes/cohorts.js` is now cohort-aware: program
  cohorts require `zid`, `global` treats it as optional (empty/whitespace →
  absent). Empty string and `null` are coerced to "not supplied" so a bare
  form submit works.
- Identity rules in `src/services/join.js` handle every combination:
  - No zid + no existing member ⇒ create with `zid = NULL`.
  - No zid + existing username ⇒ reuse the member row; do not touch the
    stored zid.
  - zid + existing member with `zid = NULL` and matching username ⇒ **claim
    flow** (upgrade the row in place, keep the same `Member.id`).
  - zid + existing member with a *different* zid ⇒ **409** (never silently
    re-link).
  - All the pre-existing 409 cases still fire.
- Auto-enrollment onto `global` for program-cohort joiners is preserved.
- 15 new join tests cover: happy-path global join without zid, zid claim
  flow, refuse-to-claim-taken-zid, empty-string zid, program join without
  zid rejected, and every conflict permutation.

### Decisions
- The route uses a **cohort-aware schema factory** (`buildJoinBodySchema(slug)`)
  rather than a single "always optional" schema with a manual check afterwards
  — this way the validation surface (Zod error `path`s) stays consistent for
  the frontend, and program cohorts still 400 on a missing zid at the Zod
  layer rather than a service-layer branch.

---

## Feature 2 — XP + Levels

### Delivered
- Pure `src/services/xp.js` exports `computeXp`, `xpForLevel`, `levelForXp`,
  `levelProgress`, `xpSummary`. Formula and level curve match the spec
  exactly, including the sanity anchors (L1=100, L2=325, L5≈1540, L10≈5012,
  L20≈16302, L50≈77312 — all within the tolerance implied by "≈").
- 26 unit tests in `tests/unit/xp.test.js`: zeroed baseline, per-term
  isolation, streak-multiplier cap at 1.5×, `min(300, …)` per-language cap
  proven, polyglot bonus proven, streak-only-affects-activity check,
  monotonicity property tests on commits and reviews, negative/NaN input
  handling, `levelForXp` inverse-of-`xpForLevel` at bucket boundaries, and
  `levelProgress` mid-bucket / near-boundary shape.
- `StatSnapshot.xp` column added via migration
  `20260713120100_stat_snapshot_xp` (default 0, indexed on `(cohortId, xp DESC)`).
- `statsToSnapshot` in `src/services/sync.js` computes `xp` at sync time.
- Backfill script `scripts/backfill-xp.mjs` (`npm run db:backfill-xp`) is
  idempotent, batched, and skips bad rows with a log line.
- Leaderboard sort `xp` added and made the default (`views.js`
  `DEFAULT_LEADERBOARD_SORT`). Ties break by `totalContributions` desc, then
  `accountCreatedAt` asc, then `memberId` for a fully-deterministic order.
- Profile response includes per-cohort `progression: { xp, level,
  levelProgress, xpToNextLevel }`.
- Three level badges (`level_5`, `level_10`, `level_20`) added to
  `src/services/titles/badges.js` — evaluated by the **existing** title
  engine, no parallel awards path.

### Decisions
- The XP-per-language cap in the formula is applied per language (not
  globally). Reading the spec as "one giant repo in one language ≈ one maxed
  skill" implies each *language* caps at 300 rather than the whole
  languageXP term.
- The leaderboard's `sortField` in the response payload is now `xp` when
  sort defaults are used — an existing test asserted `totalCommits`; I
  updated that test to match the new default and added a companion test
  that explicitly requests `?sort=commits` to keep the old behaviour covered.

---

## Feature 3 — Sync every 30 minutes

### Delivered
- `SYNC_CRON` default in `src/config.js`, `.env.example`, README table, and
  the runner's internal fallback all moved from `*/5 * * * *` to
  `*/30 * * * *`.
- `.github/workflows/sync.yml` schedule moved to `*/30 * * * *` with an
  in-file comment about GH Actions best-effort delivery.
- README's "Real-time updates" section rewritten with explicit language on
  Render's free-tier sleep behaviour, the shared lock guaranteeing no
  double-syncs, and the API-budget math (200 members × 2 cohorts × 48 runs/day
  ≈ 480N points/day against 5,000 points/hour = ~120k/day, so plenty of
  headroom).
- Existing sync-runner lock tests still pass (they don't hard-code the cron
  value that changed; they assert the `{ skipped: true, reason: 'in_progress' }`
  contract).

### Decisions
- The prompt suggested making `delayMs` env-configurable if projected load
  is unsafe. Concrete number: 200 members × 2 cohorts × 48 runs/day × 5
  points ≈ 96k GraphQL points/day = 4k/hr. That fits inside GitHub's 5k/hr
  budget with margin, and the existing budget guard in `src/lib/budget.js`
  already stretches the cadence automatically when active-member counts
  climb. So I chose **not** to add a new env var for `delayMs` right now —
  the safety net is already there. Called out in the README so an operator
  can flip it if a program balloons.

---

## Feature 4 — Rank movement deltas

### Delivered
- New `src/services/rankDeltas.js` computes `Map<memberId, delta>` from the
  two most-recent snapshot rows per member (a single windowed query with
  `row_number()`). Field-name interpolation is whitelisted so it's
  injection-safe.
- Leaderboard response now includes `rankDelta` on every entry:
  positive = climbed, negative = fell, 0 = unchanged, `null` = no previous
  ranking (brand-new member).
- 4 dedicated integration tests in `tests/integration/rankDeltas.test.js`
  cover: null on first-ever sync, mixed climb/fall/stationary, and null for
  a member with only one snapshot even when others have two.

---

## Feature 5 — Frontend (Duolingo × GitHub)

### Delivered
- Tailwind + framer-motion + canvas-confetti added; a `tailwind.config.js`
  extends the GitHub-dark palette with Duolingo accents and a
  `contrib.0..4` ramp for the heatmap.
- New reusable components under `src/components/duo/`:
  - `XpRing.jsx` — SVG progress arc + chunky level badge over any content.
  - `StreakFlame.jsx` — SVG flame that scales & animates at 7/30/100-day
    milestones; renders as a grey "streak lost" state when 0.
  - `LanguageSkills.jsx` — Duolingo-style circular icons per top language,
    each with its own mini progress ring where fullness scales to the
    per-language 300-XP cap (mirrors the backend formula).
  - `ContributionHeatmap.jsx` — GitHub-style 52-week grid with hover
    tooltip, five-bucket ramp, and a subtle diagonal wave animation on first
    render.
  - `RankDeltaBadge.jsx` — the ▲2 / ▼1 / — pill, with spring pop.
  - `CountUp.jsx` — RAF-driven ease-out cubic count-up.
  - `LevelUpToast.jsx` — localStorage per-username level cache + confetti
    burst + bouncy `🎉 LEVEL n!` toast.
  - `SkeletonRow.jsx` — staggered fade-in skeleton for lists.
- Reduced-motion hook (`src/hooks/useReducedMotion.js`) is live-subscribed
  so a preference change mid-session takes effect. All Duolingo components
  disable springs, count-ups, and confetti when it's on.
- `Leaderboard.jsx` rewritten: chunky sort chips, spring-animated podium
  for the top 3, level rings on every avatar, rank-delta pills, count-up
  on the active stat.
- `Profile.jsx` rewritten: giant avatar wrapped in an XP ring, streak
  flame, per-cohort XP + XP-to-next-level chip, contribution heatmap,
  language skills grid, LevelUpToast wired to the global-cohort level.
- `Join.jsx` updated: `zid` field is required only for program cohorts;
  for `global` it's shown as optional with "UNSW student? add your zID".
  The submitted body omits `zid` entirely when the user leaves it blank.
- `lib/xp.js` mirrors the backend curve so the ring can render even before
  the API's `progression` field lands, and the level-up detector can compute
  the current level from a raw `xp`.
- `lib/api.js` — default leaderboard sort changed to `xp`; both
  `VITE_API_URL` (preferred) and `VITE_API_BASE` (kept for backwards
  compat) resolve the API base.
- `lib/linguist.js` maps language names to GitHub linguist colours for the
  skill circles.
- `Frontend/.env.example` uses `VITE_API_URL`.

### Decisions
- I **extended** the existing GitHub-Primer frontend rather than replacing
  it. The Duolingo layer lives in Tailwind-classed components; the existing
  stylesheet stays as the base coat. That kept the churn on non-hero pages
  (Home, Cohort shell, Titles, Analytics) to zero — those pages continue
  to work unchanged, which felt right for a v2 rather than a rewrite.
- Aggregate "Total XP" on the profile sums XP across every cohort the
  member is on. It's a summary stat for the sidebar chip; per-cohort
  progression (the rings) is still shown for each cohort in the main column.
- Level-up detection uses `localStorage` keyed on GitHub username, not
  member ID. GH usernames are what the URL exposes and are stable enough
  for a client-side celebration; if a member ever renames on GitHub they
  will get one bonus celebration on their new URL — an accepted cost.

---

## Definition-of-done checklist

- ✅ 214 Vitest tests passing (0 failures) — the pre-existing 169, plus 26
  new XP unit tests, 4 new rank-delta integration tests, and the extended
  join suite (15 new join scenarios).
- ✅ All migrations are additive and reversible; no `db push`, no
  `migrate reset`, no destructive commands.
- ✅ `src/docs/openapi.js` updated (new `sort=xp` enum value, nullable `zid`,
  `progression` block on the profile, `rankDelta` on leaderboard entries,
  `xp` on the snapshot schema) and `openapi.json` regenerated via
  `npm run docs:gen`.
- ✅ README updated: XP formula + level table, 30-min sync + Render sleep
  block + API-budget math, open-global-cohort join rules, frontend setup
  and dependency list.
- ✅ Frontend builds cleanly (`npm run build` — Vite reports the two new
  chunks: `~351 kB` JS (`115 kB` gzip), `~31 kB` CSS (`7 kB` gzip)).
- ✅ CHANGES.md (this file) written.
