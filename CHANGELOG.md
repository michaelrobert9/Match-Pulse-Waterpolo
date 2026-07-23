# Changelog

All notable changes to Match Pulse are recorded here in reverse-chronological order (newest first).

Format per entry:
- **Date** — What changed
- **Why** — The reason or decision behind the change (recorded when non-obvious or marking a strategic choice)
- **Files** — Files created, modified, or deleted

---

## [Unreleased]

Changes staged but not yet in production.

---

## 2026-05-28 — Phase 0 & Phase 1 build

### Changed

- **`.github/workflows/firebase-deploy.yml`** — Added build step for React/Vite
  - Added `actions/setup-node@v4` (Node 20) with npm cache
  - Added `npm ci` and `npm run build` steps before deploy
  - Build reads `VITE_FIREBASE_*` config from GitHub Actions secrets
  - **Why:** A compiled React/Vite app requires a build step before the static output can be hosted; the previous workflow only published raw files

- **`firebase.json`** — Updated for SPA hosting
  - `"public"` changed from `"public"` to `"dist"` (Vite output folder)
  - Added SPA rewrite: all routes → `/index.html` so React Router handles client-side navigation
  - **Why:** Without the rewrite, a direct URL like `/people/person-tvdm-001` returns a 404 from Firebase Hosting

### Added — Phase 0 (scaffold)

- **`package.json`** — React 18 + Vite 5 + Firebase JS SDK v10 + React Router 6 + Tailwind CSS 3

- **`vite.config.js`** — Vite build config with React plugin

- **`tailwind.config.js`** — Design system tokens: `canvas` (`#0A0C10`), `surface` (`#0F1219`), `table-row` (`#161B22`); `font-display` (Space Grotesk), `font-mono` (JetBrains Mono), `font-sans` (Inter)

- **`postcss.config.js`** — Tailwind + Autoprefixer

- **`index.html`** — Vite entry point with Google Fonts preload (Inter, Space Grotesk, JetBrains Mono)

- **`.gitignore`** — Excludes `node_modules/`, `dist/`, `.env*`

- **`.env.example`** — Documents the 6 `VITE_FIREBASE_*` secrets needed for the CI build

- **`firestore.rules`** — Firestore security rules
  - Public read on all collections (competitions, teams, players, matches, people, awards, rulesets)
  - Writes require authenticated user with `admin` or `scorer` role stored in `/users/{uid}`
  - Users collection: self-read allowed; role writes are admin-only

- **`firestore.indexes.json`** — Composite indexes for:
  - Players by `personId` + `competitionId` (career page query)
  - Matches by `competitionId` + `scheduledAt` (fixture list)
  - Matches by `status` + `scheduledAt` (home page live/recent)
  - Awards by `personId` + `competitionId` (career page awards)

- **`src/firebase.js`** — Firebase app init; exports `db`, `auth`, `configured` flag; gracefully no-ops if `VITE_FIREBASE_API_KEY` is not set (falls back to sample data)

- **`src/index.css`** — Tailwind base/components/utilities; `.micro-label` and `.stat-number` utility classes matching the Brand Book

- **`src/App.jsx`** — React Router route tree (all routes defined, shells in place for Phase 2 pages)

- **`src/main.jsx`** — React DOM entry point wrapped in `BrowserRouter`

- **`src/components/Layout.jsx`** — `max-w-md mx-auto` mobile frame + sticky nav

- **`src/components/Nav.jsx`** — MatchPulse wordmark (Match white / Pulse emerald), home and search icons

- **`src/lib/sampleData.js`** — Comprehensive SA hockey sample data matching the Firestore schema:
  - 4 organisations (WP, KZN Raiders, Northerns, Southern Gauteng)
  - 6 competitions across 4 seasons (SA Hockey League 2024–2026, Senior IPT 2024–2025, U21 IPT 2023)
  - 2 people (Tyrone van der Merwe, Prashant Govender)
  - 6 player records (Tyrone's full 6-season career across all competitions)
  - 3 awards (Gold Medal, Top Goal Scorer, Player of the Tournament)

- **`src/lib/queries.js`** — Firestore query functions for person, career, and awards; falls back to `sampleData.js` when `configured === false`

### Added — Phase 1 (player career page)

- **`src/pages/PersonCareer.jsx`** — Hero page at `/people/:id`
  - Trading-card square photo (`rounded-xl`) with initials fallback — never a circle
  - Player name in Space Grotesk `font-black uppercase`
  - Team colour top-strip and inline `w-2.5 h-2.5 rounded-sm` colour block
  - Live/Active badge on in-progress competitions
  - Career stat bar: Caps · Goals · Cards in `font-mono font-black` with `#161B22` background
  - Per-competition career cards — each with team colour top-strip, per-game goal average, card detail row (green/yellow/red individual counts)
  - Award tags: gold medal (yellow), silver (slate), bronze (orange), player of tournament (emerald star), top scorer (blue goal)
  - Falls back to sample data (Tyrone van der Merwe, 94 caps, 47 goals, 6 competitions) when Firestore is not configured

- **`src/pages/Home.jsx`** — Home page at `/`
  - Live competitions section with animated pulse dot
  - Recent competitions list
  - Players list with caps and goals

- **`src/pages/NotFound.jsx`** — 404 page

- **`src/pages/MatchDetail.jsx`**, **`CompetitionOverview.jsx`**, **`CompetitionStandings.jsx`**, **`CompetitionFixtures.jsx`** — Phase 2 shell pages (routes defined, full implementation next)

---

## 2026-05-28 — Brand Book confirmed

### Changed

- **`docs/BRAND_BOOK.md`** — Replaced placeholder with confirmed full design system
  - **Decision pivots recorded:**
    1. **Primary accent: ember red (`#FF3B22`) → emerald (`#34d399`)** — ember red too aggressive for a dense data UI where the accent appears on every screen constantly; emerald reads as "live" and "performance"
    2. **Typeface: Bricolage Grotesque → Space Grotesk + Inter + JetBrains Mono** — three-font system assigns display, body, and data each an exclusive purpose-built family
  - Added confirmed component patterns: Data Badges, Stat Blocks, List Items, Hockey Event Timeline Items, Live Indicator
  - Added layout rules: mobile-first `max-w-md`, tight density, square avatars, flat elevation

---

## 2026-05-28 — UI prototypes

### Added

- **`prototypes/view-a-live-match.html`** — Live Match Detail UI prototype (WP 2–1 KZN Raiders, Q3 42'; timeline + lineups tabs; interactive)
- **`prototypes/view-b-standings.html`** — Competition Standings prototype (8-team SA Hockey League; team colour left-borders; mono stats)
- **`prototypes/view-c-courtside.html`** — Courtside Scoring Admin UI prototype (split-screen, large touch buttons, player number grid modal, event log)

---

## 2026-05-28 — Foundation

### Added

- **`public/index.html`** — Coming Soon landing page (Bricolage Grotesque; animated pulse line; no JS)
- **`firebase.json`** — Initial Firebase Hosting config (`public/` root — later superseded)
- **`.github/workflows/firebase-deploy.yml`** — Initial CI/CD deploy on push to `main`
- **`docs/BUSINESS_PLAN.md`** — Living business plan
- **`docs/BRAND_BOOK.md`** — Brand book placeholder (superseded same day)
- **`CHANGELOG.md`** — This file

---

*Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)*
