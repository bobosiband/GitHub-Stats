# GitRank — frontend

A tiny React SPA for the GitRank backend. It's a public, read-only dashboard
that looks and feels like GitHub itself (Primer tokens, coral tab markers,
contribution-graph greens used as data ink) and ships as a static bundle to
GitHub Pages.

> _Screenshot placeholder — swap in `docs/screenshot.png` once the site is live._

## What's here

- **Home** — a hero, the cohort list (global first, then active, then ended),
  and a "Global top 5" podium card.
- **Cohort** — header + repo-style tab nav → **Leaderboard**, **Titles**,
  **Analytics**. Sort is a URL param, so `?sort=stars` is shareable.
- **Profile `/u/:username`** — GitHub-style two-column layout with per-cohort
  stat grids, an aggregate language bar, held titles (lapsed ones dimmed +
  struck), and badges.
- **Join** — the public self-serve form, with per-status error messaging
  (400/403/404/409/422/network) and client-side zID validation.

Every data view has all four states: loading skeleton, error (with retry),
empty blankslate, and populated.

## Quick start

Prereq: [Node 20+](https://nodejs.org) and a running GitRank backend
(default `http://localhost:3000`).

```bash
npm install
cp .env.example .env         # or leave it — localhost:3000 is the default
npm run dev                  # http://localhost:5173
```

Build for production:

```bash
npm run build                # → dist/
npm run preview              # local static server
```

## Configuration

| Source                | Wins over            | Purpose                                     |
| --------------------- | -------------------- | ------------------------------------------- |
| `?api=<url>` in URL   | everything           | Point at a different backend for one QA run |
| `localStorage`        | env / default        | The `?api=` override is persisted           |
| `VITE_API_BASE` env   | localhost default    | Set at build time (Pages workflow uses it)  |
| `http://localhost:3000` | —                  | Fallback                                    |

Example — point a running dev build at a staging backend without rebuilding:

```
http://localhost:5173/?api=https://staging.gitrank.example.com
```

## Deploy to GitHub Pages

Automated via [`.github/workflows/deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml)
at the repo root. It builds the frontend on every push to `main` that touches
`Frontend/**` and publishes `dist/` to Pages via the official
`actions/deploy-pages` action.

One-time setup on the repo:

1. **Settings → Pages → Build and deployment → Source** = `GitHub Actions`.
2. **Settings → Secrets and variables → Actions → Variables**:
   - `API_BASE` = `https://gitrank-backend.onrender.com` (production Render deploy).
   - **Must be `https://`.** Pages is HTTPS-only, so a browser will block any
     fetch to `http://` as mixed content even though Render 301s HTTP→HTTPS.
3. **Backend CORS**. This site's origin (e.g. `https://<user>.github.io`) must be
   in the backend's `CORS_ORIGIN` env var — otherwise the browser will block
   every request with a CORS error. That's an operational config change, not a
   code one; the frontend can't fix it for you and will surface a
   `NETWORK_ERROR` message pointing at exactly this.

Because the app uses **`HashRouter`** and `vite.config.js` sets `base: './'`,
it works from any Pages path (project, user, or custom domain) with no
404-rewrite hack and refreshes on deep links Just Work.

## Design system

Values live in [`src/styles.css`](src/styles.css) as CSS custom properties on
`:root` and `[data-theme='dark']`. Theme is picked (in order):

1. localStorage `gitrank-theme` (set by the toggle in the header)
2. `prefers-color-scheme`
3. light

A tiny inline script in `index.html` applies the theme **before** the first
paint, so dark-mode users don't get a white flash on page load.

The contribution-graph green ramp (`--ramp-0` … `--ramp-4`) is used as data
ink — leaderboard heat bars, calendar-square histograms — rather than as
decoration.

## Page-by-page feature tour

- **Home (`/`)** — `GET /cohorts` + `GET /cohorts/global/leaderboard` (podium)
  + `GET /health` (last-sync timestamp). Each card handles its own loading.
- **Cohort shell (`/cohorts/:slug`)** — `GET /cohorts/:slug` for the header;
  three tab routes underneath render into `<Outlet/>`.
  - **Leaderboard (index)** — `GET /cohorts/:slug/leaderboard?sort=…`.
    Column headers `aria-sort` toggles + heat bar on the actively sorted stat.
  - **Titles** — `GET /cohorts/:slug/titles`. Records + badges grids.
  - **Analytics** — reuses the leaderboard payload (cache hit) to compute
    totals, top languages, a commit-distribution histogram, and superlatives.
- **Profile (`/u/:username`)** — `GET /members/:username`. 404 renders a
  friendly "no such member — have they joined?" blankslate linking to Join.
- **Join (`/join`)** — `GET /cohorts` for the select (active only,
  preselectable via `?cohort=<slug>`) and `POST /cohorts/:slug/join` on
  submit. zID is validated client-side; each backend error status maps to a
  specific human message in the flash banner.
- **404** — friendly blankslate with quick links home.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Dependencies

We hold the runtime dependency list to five packages:

- `react`, `react-dom`
- `react-router-dom`
- `vite`, `@vitejs/plugin-react` (dev-only)

No UI framework, no chart library, no icon package — Octicons are inlined in
`src/components/Icons.jsx`. This keeps the built bundle around 65 kB gzipped.
