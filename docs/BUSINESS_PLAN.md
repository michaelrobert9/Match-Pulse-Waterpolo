# Match Pulse — Business Plan

> **Living document.** Every strategic decision, pivot, and piece of reasoning is recorded here in chronological order. When a decision changes, the old decision is not deleted — it is superseded and the reasoning for the change is appended.

---

## 1. Business Overview

**Name:** Match Pulse
**Firebase Project:** `match-pulse-waterpolo`
**Founded:** 2026
**Owner / Founder:** Michael Robert (michael@robertfamily.co.za)
**Status:** React app scaffold live; player career page deployed; Firestore ready for data

### Mission Statement

Match Pulse gives school and club water polo a professional digital home. Every fixture, result, and player record — searchable, shareable, and live — so that parents, coaches, scouts, and players never miss a moment of the game they love.

---

## 2. The Competitive Opportunity

### Primary Competitor: Altiusrt

The platform currently used by most field-water polo federations, including SA Water Polo Association (`saha.altiusrt.com`), is **Altiusrt** (`altiusrt.com`).

**Altiusrt's strengths:**
- Proven data model (competitions, fixtures, results, player records)
- Entrenched with administrators — knows the workflow

**Altiusrt's weaknesses (our opportunity):**
- Desktop-era presentation layer — cramped on mobile
- No team logos, crests, or colours — shows only shortcodes (WP, KZN)
- No player photos
- Player career record is buried and hard to find or share
- No shareable result cards or social-ready outputs
- Fixture dates are machine-formatted, not human-readable
- No "follow" or favourite functionality

### Where Match Pulse wins

| Capability | Altiusrt | Match Pulse |
|---|---|---|
| Mobile-first design | ✗ | ✓ |
| Team logos & colours | ✗ | ✓ |
| Player photos | ✗ | ✓ |
| Player career page (hero) | Buried | Front and centre |
| Shareable result cards (WhatsApp) | ✗ | ✓ (Phase 3) |
| Human-readable dates ("Fri 9 May, 19:15") | ✗ | ✓ |
| Live scoring (mobile-optimised) | Limited | ✓ (Phase 3) |

### Beachhead market

**South African water polo** — schools, clubs, and provincial unions. Altiusrt's interface is weakest here (parent and player-facing experience) and the switching cost is lowest (SA Water Polo has no infrastructure lock-in beyond data).

---

## 3. Product Thesis

**The player career page is the hero.** Altiusrt buries the lifetime player record. Match Pulse puts it front and centre — one human, every cap, goal, team, and season across their life. This is the page parents, players, scouts, and alumni share on WhatsApp. It is the strongest single differentiator from Altiusrt and is the first page built to production quality.

---

## 4. Target Market

**Primary:** South African schools and clubs with active inter-school or league water polo programmes (initially water polo; designed to expand to other codes).

**Secondary:** Sport administrators and coaches who currently manage records in spreadsheets or WhatsApp groups.

**Tertiary:** Parents and alumni who want to follow results without relying on informal channels.

---

## 5. Product Roadmap

### Phase 0 — Scaffold (Complete)

React + Vite SPA wired to Firebase on the Spark free plan. Deploy pipeline updated for build step. Firestore security rules and indexes defined.

**Deliverable:** App builds and deploys automatically on push to `main`.

### Phase 1 — Read-only public site with sample data (Complete)

Sample competitions, teams, people and matches seeded. Player career page (`/people/:id`) and home page built with full brand system.

**Deliverable:** Browsable, mobile-first public site on sample data — proves the product thesis.

### Phase 2 — Admin & real data (Next)

Firebase Auth + role system (`admin`, `scorer`). Admin screens to create competitions, teams, people, and assign players to squads. Replace sample data with real data entry.

**Deliverable:** Owner can create a real competition end-to-end.

### Phase 3 — Live scoring, sharing & reports (Planned)

Fast courtside scoring screen with live Firestore updates. Shareable match result cards with Open Graph tags (WhatsApp previews). PDF/CSV export of standings, fixtures, and scorers.

**Deliverable:** A competition can be run live, start to finish. Organisers can generate the printouts they depend on (Altiusrt's quiet moat).

### Later (post-validation)

Custom domain. Blaze plan upgrade + Firebase App Hosting with server-side rendering for search visibility ("school X water polo results 2026"). Push notifications / follow-your-team.

---

## 6. Technical Architecture

### Constraint: Spark (free) plan

Firebase Spark plan supports classic Hosting (static files only). There is no server. All product phases up to and including Phase 3 must be implemented as a client-side SPA that talks to Firestore and Auth directly from the browser.

### Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | React 18 + Vite 5 | Static output; fast build; excellent ecosystem |
| Routing | React Router 6 | Client-side routing with clean URL scheme |
| Styling | Tailwind CSS 3 | Utility-first; tight design-system tokens |
| Database | Cloud Firestore | Real-time capable; scales; native to Firebase |
| Auth | Firebase Authentication | Native to Firebase; free on Spark plan |
| Hosting | Firebase Hosting (Spark) | CDN; instant cache invalidation; SPA rewrites |
| Deploy | GitHub Actions | On push to `main`; secrets-based Firebase config |

### URL Scheme (clean and stable for future SEO migration)

| Route | Page |
|---|---|
| `/` | Home |
| `/competitions` | All competitions |
| `/competitions/:id` | Competition overview |
| `/competitions/:id/fixtures` | Fixture list |
| `/competitions/:id/standings` | League table |
| `/competitions/:id/stats` | Statistics |
| `/matches/:id` | Match detail |
| `/teams/:id` | Team in a competition |
| `/people/:id` | **Player career page** |

### Firestore Data Model

The central design decision (lifted from Altiusrt and made more prominent) is the **Person / Player split**:

- A **Person** is the human being — exists for life, accumulates career stats
- A **Player** is that Person on one Team in one Competition (a single season/tournament slot)

**Collections:** `people`, `organizations`, `competitions`, `teams`, `players`, `matches`, `matches/{id}/events`, `rulesets`, `awards`, `users`

All display fields (team name, shortcode, logo, colour) are **denormalised** onto Player and Match documents so list views render without extra Firestore reads.

Aggregate stats (career caps/goals on `people`; points/GD on `teams`) are maintained on result entry in one place.

---

## 7. Branding

See `/docs/BRAND_BOOK.md` for all brand, typography, and colour decisions.

**Design direction (summary):** "Tech-forward sports data." Dark, high-density, high-contrast. Emerald as the primary accent. Space Grotesk for display, Inter for body, JetBrains Mono for all numbers. Mobile-first `max-w-md` frame simulating a phone screen.

---

## 8. Revenue Model

Not yet defined. The product must first prove it delivers value to water polo organisations before a monetisation model is chosen.

**Candidates under consideration (no decision made):**
- Free for one competition; paid subscription to unlock additional competitions or organisations
- Annual organisation licence fee
- Freemium with a paid tier for exports, custom branding, and advanced stats

---

## 9. Open Questions

| # | Question | Priority | Status |
|---|----------|----------|--------|
| 1 | Target launch date for Phase 2 (admin & real data)? | High | Open |
| 2 | Which sport codes in scope at launch? Water Polo only, or multi-sport? | High | Open |
| 3 | First real competition to run through the system? | High | Open |
| 4 | Revenue model selection | Medium | Open |
| 5 | Mobile app in the roadmap, or mobile-web only? | Medium | Open |
| 6 | Custom domain for Firebase Hosting | Low | Open |
| 7 | Blaze plan upgrade timeline (needed for SSR/SEO) | Low | Post-validation |

---

## 10. Decision Log

All major decisions are recorded here with date, reasoning, and alternatives considered. Superseded decisions are preserved — never deleted.

| Date | Decision | Status | Reasoning |
|------|----------|--------|-----------|
| 2026-05-28 | Firebase Hosting (Spark plan) as hosting platform | **Current** | Zero-config CDN, free tier covers all phases through Phase 3, natural upgrade path to Firestore/Auth/Functions. Alternatives: Netlify, Vercel, GitHub Pages — Firebase chosen for the integrated ecosystem. |
| 2026-05-28 | GitHub Actions + FirebaseExtended action for CI/CD | **Current** | Automated deploys on push to `main`; secrets-based config; manual dispatch available. |
| 2026-05-28 | Plain HTML/CSS for Coming Soon page (no framework) | **Current — holding page only** | Zero complexity, zero build failures. Explicitly scoped to the holding page only; did not constrain the app framework decision. |
| 2026-05-28 | **React 18 + Vite 5 for the application** | **Current** | Compiles to static files (Spark-compatible). Fast build. Industry-standard ecosystem. Next.js SSR ruled out — requires Blaze/App Hosting. Alternative: SvelteKit (static adapter) — React chosen for wider developer familiarity. |
| 2026-05-28 | **Person/Player split as the core data model** | **Current** | Directly counters Altiusrt's weakness: a person's career spans many teams and competitions. Separating the lifelong Person from the per-competition Player record makes the career page — the product's hero — possible. |
| 2026-05-28 | **Player career page built first (before fixtures or standings)** | **Current** | Fastest proof of the product thesis. If the career page is more compelling than Altiusrt's equivalent, the product has a reason to exist. Fixtures and standings are table-stakes; the career page is the differentiator. |
| 2026-05-28 | **Denormalise display fields onto Player and Match documents** | **Current** | Firestore charges per read and has no server-side joins. Copying name, shortcode, logo, and colour onto child documents makes list views render in one query without extra lookups. |
| 2026-05-28 | Ember red (`#FF3B22`) as primary brand accent | **Superseded 2026-05-28** | Initial choice; too aggressive for a dense data UI. |
| 2026-05-28 | **Emerald (`#34d399`) as primary brand accent** | **Current** | Reads as "live", "active", "performance" — natural for sports data. Better contrast across the dense UI. |
| 2026-05-28 | Bricolage Grotesque as sole typeface | **Superseded 2026-05-28** | No mono companion; inconsistent in data tables. |
| 2026-05-28 | **Space Grotesk + Inter + JetBrains Mono type stack** | **Current** | Three-font system: display impact, legible body, rigid data alignment — each font has an exclusive domain. |

---

*Last updated: 2026-05-28*
