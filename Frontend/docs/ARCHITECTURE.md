# Architecture

Ten-minute tour of how the GitRank frontend is put together. Aimed at whoever
picks this up next.

## What it is

A single-page React app that reads the GitRank backend and renders it. There
is no client-side state to speak of — every screen is a function of
`(URL, API responses)`. Nothing is written back except joins.

## Routing

We use **`HashRouter`** deliberately, not `BrowserRouter`. GitHub Pages
serves your app from `/<repo>/`, and refreshes on a deep link like
`/<repo>/cohorts/global` would 404 unless we teach Pages to rewrite —
usually by shipping a `404.html` hack. With `HashRouter`, deep links look
like `/<repo>/#/cohorts/global`, refreshes stay on the client, and there's
no rewrite hack.

Combined with `base: './'` in `vite.config.js`, the build is portable to any
Pages URL (user page, project page, custom domain) with no config change.

Route table:

| Path                              | Component            | Notes                              |
| --------------------------------- | -------------------- | ---------------------------------- |
| `/`                               | `Home`               | Hero + cohort list + Global top-5  |
| `/cohorts/:slug`                  | `Cohort` (shell)     | Header + tab nav + `<Outlet/>`     |
| `/cohorts/:slug` (index)          | `Leaderboard`        | Sort via `?sort=<stat>`            |
| `/cohorts/:slug/titles`           | `Titles`             | Records + badges                   |
| `/cohorts/:slug/analytics`        | `Analytics`          | Computed client-side               |
| `/u/:username`                    | `Profile`            | GitHub-style 2-col                 |
| `/join`                           | `Join`               | Public form                        |
| `*`                               | `NotFound`           | Blankslate                         |

The Cohort shell passes the loaded cohort down via `useOutletContext()` so
child tabs render the cohort name without an extra request.

## Data flow

```
Backend (Fastify)
  │
  ▼
lib/api.js       ── typed ApiError, 60s GET cache, base-URL resolution
  │
  ▼
lib/util.js:useFetch  ── { data, error, loading, retry } hook
  │
  ▼
Pages (Home, Cohort, …)  ── render loading skeleton / error / empty / populated
```

### `lib/api.js`

- **Base URL** is picked once at load time, in this order:
  1. `?api=<url>` on the current URL (persisted to `localStorage`).
  2. `VITE_API_BASE` env at build time.
  3. `http://localhost:3000`.
- **Errors** are always thrown as `ApiError({ status, code, message, details })`
  so pages can pattern-match by `status` (e.g. Profile's 404 blankslate).
- **Network failure** message tells the caller to check that the backend is
  running and that its `CORS_ORIGIN` includes this origin — the two things
  that break most often between "works on my machine" and "works on Pages."
- **Cache** is a `Map` keyed on full URL with a 60 s TTL. Only GETs are cached.
  Any non-GET call flushes the whole map (safer than trying to be clever).

### `lib/util.js`

- `useFetch(fn, deps)` returns `{ data, error, loading, retry }`. It's the
  only stateful abstraction in the app; every page composes multiple
  independent `useFetch` calls so a slow leaderboard can't block a hero.
- Formatters: `compact` (12k / 1.2M), `num`, `pct`, `timeAgo`, `shortDate`.
- `langColor(name)` is a hardcoded table of GitHub's top ~30 Linguist
  colours with a deterministic HSL fallback for unknowns — no network fetch.

## Design tokens

`src/styles.css` is one file, organised top-down (tokens → base → layout →
primitives → tab nav → data ink → tables/cards → forms → utils → responsive).

Tokens are declared as CSS custom properties on `:root` and
`[data-theme='dark']`. To flip theme, we set `document.documentElement.
dataset.theme = 'dark'|'light'` — everything downstream re-renders via CSS.

The theme is applied by an inline script in `index.html` **before** the
first paint (order: `localStorage` → `prefers-color-scheme` → light).
This is important — a React-side flip after mount produces a visible flash
that badly hurts perceived quality.

### The green ramp is data ink

The five contribution-graph colours (`--ramp-0` … `--ramp-4`, one theme
each) aren't decorative. They power:

- **`.heat`** — the bar behind an active leaderboard stat (`--fill` = pct).
- **`.histogram .cell.lN`** — analytics bucket cells.
- **`.lang-bar`** — repo-page-style horizontal language bar.

If you add a new data-ink component, reuse these variables so it stays
consistent across themes automatically.

## Analytics are derived client-side

`Analytics.jsx` never calls a dedicated endpoint. It reuses the same
`GET /cohorts/:slug/leaderboard?sort=commits` payload the Leaderboard tab
uses; because `lib/api.js` caches GETs for 60s, tab-switching to Analytics
is a cache hit.

From that one payload we compute:

- **Cohort totals** — sum stats across all synced members.
- **Top languages** — merge every member's `topLanguages` into one Map.
- **Commit distribution** — bucket total-commit counts into six ranges,
  render as calendar-square heights.
- **Superlatives** — pick the row with the max value for each of biggest
  single day, longest streak, weekend commit ratio, night commit ratio.

The trade-off: analytics reflect only members currently on the leaderboard
(so we can't say "commits this month across everyone who has ever joined").
For a first version that trade is well worth avoiding a second endpoint.

## How to add a new page

1. Create `src/pages/YourPage.jsx`. Give it a `default export` and start
   with the four-state pattern:
   ```jsx
   const { data, error, loading, retry } = useFetch(() => api.getX(id), [id]);
   if (loading) return <Loading />;
   if (error)   return <ErrorState error={error} onRetry={retry} />;
   if (!data)   return <EmptyState title="Nothing here yet" />;
   return <div>...</div>;
   ```
2. Register the route in `src/App.jsx`.
3. If the header should link to it, add a `<NavLink>` in
   `src/components/Layout.jsx`.

## How to add a new leaderboard stat column

The backend supports four sort keys today (`commits` / `contributions` /
`streak` / `stars`) via `GET /cohorts/:slug/leaderboard?sort=…`. To add a
fifth:

1. Add it to `SORTS` and `SORT_META` at the top of `Leaderboard.jsx`.
   Point `key` at the snapshot column and pick an icon.
2. Backend needs a matching entry in its `LEADERBOARD_SORTS` map — otherwise
   `?sort=<new>` will silently fall back to `commits`.

That's it — the sort URL param, the `aria-sort` toggle, and the heat-bar
all pick it up automatically.

## How to add a stat card to Profile

Every per-cohort stat card is one line in `CohortStatsBlock` inside
`Profile.jsx`:

```jsx
<StatCard label="Reviews" value={<><IconGitPR size={12} /> {num(s.reviewsGiven)}</>} />
```

Grab the field off the `stats` object and pick an icon. That's it — no
plumbing.

## What's intentionally missing

- **No global state library.** URL + per-hook `useFetch` is enough.
- **No form library.** The Join form has three fields; a controlled
  `useState` with a `validate()` fn beats a dependency.
- **No test framework.** For a static SPA with server-side auth, manual QA
  against a running backend is the honest thing.
- **No pre-rendering / SSR.** GitHub Pages is a static host; the tiny FCP
  cost of hydration is a fair price for shipping one folder of files.
