# MatchPulse Design System
**Version 2.0 · July 2026 · Light theme · Hockey**

> Rewritten to match the shipped product. Supersedes v1.0 (June 2026), which described a
> dark, emerald-live theme that was never built. Every token below was read from the
> live code (`tailwind.config.js`, `index.css`, `Home.jsx`, `StatusBadge.jsx`,
> `TeamIdentity.jsx`). Sections 3–9 are shared byte-for-byte with the Rugby app;
> Section 10 is the hockey skin.

---

## 1. What this document is

This is the **shared MatchPulse design system**. It describes the visual language of
the product *as it is actually built* — the light theme, the semantic colour palette,
the card and typography systems, and the layout rules — read directly from the shipped
components (`Home.jsx`, `StatusBadge.jsx`, `TeamIdentity.jsx`, `tailwind.config.js`,
`index.css`).

MatchPulse ships as two apps — **Rugby** and **Hockey** — from two repositories that
share one design. The rule is:

> **One shared design, two sport skins.**
> Every visual token, component, and layout in Sections 3–9 is **identical** in both
> repositories. The two apps differ *only* in the sport-specific seam described in
> Section 10 — terminology, scoring, formats, positions, and copy. There is **no
> colour or layout divergence** between rugby and hockey.

When you change anything in Sections 3–9, apply the identical change to **both** repos
in the same design branch. When you change something in Section 10, change only the
sport it applies to.

---

## 2. What MatchPulse feels like

A **light, mobile-first live sports companion**. The product is a clean white column of
cards on a soft slate canvas. Matches are the heartbeat: a live match glows **red**,
scores are set in heavy tabular mono, and everything else — competitions, schools,
clubs, players — is a calm, legible list that gets out of the way.

The emotional job of the design is *clarity under time pressure*. A parent glancing at
their phone on the sideline should read the score, the status, and "who's playing" in
under a second. That is why status is colour-coded, scores are oversized, and the
column is narrow even on desktop.

---

## 3. Colour System

### 3.1 Neutral scale (Tailwind slate + config tokens)

The base is a **light** neutral scale. Named tokens live in `tailwind.config.js`:

```
canvas    #F8FAFC   — page background (slate-50)      → class: bg-canvas
surface   #FFFFFF   — default card / panel background → class: bg-surface (== bg-white)
elevated  #F1F5F9   — raised / inset panels (slate-100)→ class: bg-elevated
```

In practice components use `bg-white` for cards and Tailwind slate utilities for
everything else. Prefer the token classes for panels; `bg-white` is acceptable and
widespread for cards.

### 3.2 Border scale

```
border-slate-200   — default card / divider border   (the workhorse)
border-slate-300   — hover / stronger border
```

Cards sit at `border-slate-200` and move to `border-slate-300` on hover.

### 3.3 Text scale

```
text-slate-900   — primary: headlines, team names, scores, active labels
text-slate-700   — strong body / emphasised meta
text-slate-600   — body copy
text-slate-500   — supporting / secondary meta
text-slate-400   — micro-labels, timestamps, ghost meta
text-slate-300   — dividers-as-text (e.g. the "–" between scores)
```

### 3.4 Emerald — brand & action (NOT live)

Emerald is the MatchPulse brand colour. It marks **actions and affordances**, never
"live". Use it for primary buttons, links, "All →" affordances, the create-org CTA, and
positive/"today" context.

```
emerald-50    — CTA / positive tint background
emerald-100   — CTA icon chip background, hover tint
emerald-200   — CTA / positive border
emerald-300   — button outline, stronger border, focus ring (ring-emerald-500)
emerald-500   — hover text on links
emerald-600   — primary link/action text, focus ring
emerald-700   — emerald text on emerald tint (monograms, sub-labels)
```

### 3.5 Semantic status palette

Status is the most important colour signal in the product. It is a **five-hue** system,
implemented once in `StatusBadge.jsx` and echoed by the home-page pills. Always route
status colour through these — never invent a one-off.

| Status | Hue | Background · Border · Text |
|---|---|---|
| **Live / Active** | Red | `bg-red-50 border-red-200 text-red-600` · dot `bg-red-500 animate-pulse` |
| **Scheduled / Upcoming** | Sky | `bg-sky-50 border-sky-200 text-sky-600` |
| **Paused / Awaiting result** | Amber | `bg-amber-50 border-amber-200 text-amber-600` |
| **Postponed** | Violet | `bg-violet-50 border-violet-200 text-violet-600` |
| **Final / Completed / Draft / Unpublished** | Slate | `bg-slate-100 border-slate-200 text-slate-500` |
| **Cancelled** | Slate + strike | `bg-slate-100 border-slate-200 text-slate-400 line-through` |

Rules:
- **Live is red, and red is only live.** Red never appears as a decorative or error-only
  colour on match surfaces; a red pulse always means a match is in progress.
- The "today" home-page pill is **emerald** (`bg-emerald-50 border-emerald-200
  text-emerald-600`) because "today" is positive context, not live status.
- Amber additionally marks the platform-admin shortcut (an operational, not a match,
  signal).

### 3.6 Team identity colour

Team identity is always the team's own `primaryColor`, never a fixed hue. The pattern,
used by `TeamCrest` / `OrgBadge`:

```
background: primaryColor + '20'      // ~12% tint
border:     1.5px solid primaryColor
text/icon:  primaryColor
```

When a team has a logo, the crest shows the logo on white with a hairline
`border rgba(15,23,42,0.08)`; otherwise it shows the name monogram on the solid
`primaryColor`.

---

## 4. Typography

### 4.1 Font stack (`tailwind.config.js`)

```
font-display   Space Grotesk   — page titles, team & competition names, monograms
font-sans      Inter           — body, labels, buttons, all UI text
font-mono      Roboto          — scores, badges, timestamps, any tabular-nums figure
```

> Note: `font-mono` is mapped to **Roboto** in the config (not a true monospace). It is
> used everywhere `tabular-nums` matters — scores and clocks — so figures still align.
> If you ever want genuinely fixed-width digits, that is the one token to revisit.

### 4.2 Type roles (as used in code)

| Role | Classes |
|---|---|
| Page title | `font-display font-bold text-slate-900 text-2xl` |
| Card / competition title | `font-display font-bold text-slate-900 text-sm leading-snug` |
| Team name (row) | `font-semibold text-slate-900 text-[13px] leading-snug` |
| Team name (feature) | `font-semibold text-slate-900 text-sm leading-snug` |
| Body | `text-sm text-slate-600 leading-relaxed` |
| Supporting meta | `text-[11px] text-slate-500` |
| Micro-label | `text-[10px] font-bold uppercase tracking-widest text-slate-400` |
| Section label | `text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400` |
| Live section label | `text-[11px] font-bold uppercase tracking-[0.1em] text-red-500` |
| Score · feature | `font-mono font-black tabular-nums text-slate-900` at `clamp(36px,7vw,52px)` |
| Score · row | `font-mono font-black text-base tabular-nums text-slate-900` |
| Badge text | `font-mono text-[9px] font-bold uppercase tracking-widest` |
| Timestamp | `font-mono text-[10px] text-slate-400 uppercase tracking-widest` |

Two utility classes in `index.css` back this up: `.micro-label` and `.stat-number`
(`font-mono font-black text-slate-900 tabular-nums`).

---

## 5. Card System

All cards share a base and step up for feature moments.

### 5.1 Base card (lists, rows, org/competition cards)

```
bg-white rounded-xl border border-slate-200 shadow-sm
```
Interactive cards add hover + lift:
```
hover:border-slate-300 card-lift        // card-lift: transition + hover -translate-y-px shadow-md
```
Row cards keep a comfortable tap target: `min-h-[44px]`, padding `px-3.5 py-3` to
`px-5 py-4`.

### 5.2 Feature card (live match, CTAs)

Feature moments step the radius up to `rounded-2xl` and carry a coloured accent:

**Featured live match** (`FeaturedLiveCard`)
```
relative overflow-hidden bg-white rounded-2xl border border-red-200
px-5 py-4 hover:border-red-300 shadow-sm card-lift
```
- Left accent strip: `absolute left-0 inset-y-0 w-1 bg-red-500 rounded-l-2xl`
- Live pill: red badge with `animate-pulse` dot, plus `currentPeriod` and `PB {time}` meta
- Score: `font-mono font-black tabular-nums` at `clamp(36px,7vw,52px)`, dash in `text-slate-300`
- Layout: `[crest + name] · [score] · [name + crest]`, crests at 36px

**CTA card** (create org, admin shortcut)
```
flex items-center gap-3 rounded-xl px-4 py-3.5
bg-emerald-50 border border-emerald-200 hover:bg-emerald-100     // positive CTA
bg-amber-50  border border-amber-200  hover:bg-amber-100         // admin/operational
```
Leading icon sits in a `w-9 h-9 rounded-xl` tinted chip; trailing `ChevronRight`.

### 5.3 Match row (`MatchRow`)

The workhorse for today's fixtures and recent results. A **three-column grid** that never
lets long names collide with the centre:
```
grid grid-cols-[1fr_72px_1fr] items-center gap-x-2
bg-white rounded-xl border border-slate-200 px-3 py-3 hover:border-slate-300 shadow-sm card-lift
```
- Home zone: crest (28px) left of name
- Centre (fixed 72px): result → `score` + `FT`; upcoming → push-back time + pitch
- Away zone: name left of crest, right-aligned

### 5.4 Skeletons

Loading state mirrors the card it replaces: `bg-white rounded-xl border border-slate-200
animate-pulse` at the row (`h-14`) or card (`h-28`) height.

---

## 6. Buttons & Actions

| Tier | Use | Classes |
|---|---|---|
| **Primary** | The one key action | `bg-emerald-600 text-white font-bold text-sm rounded-lg px-4 py-2.5 hover:bg-emerald-500 transition-colors disabled:opacity-50` |
| **Secondary / outline** | Retry, supporting | `text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors` |
| **Link action** | "All →", "+ New" | `text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-600 hover:text-emerald-500` |
| **CTA card** | Full-width entry point | see §5.2 CTA card |

Focus is handled globally in `index.css`: `:focus-visible` gets
`ring-2 ring-emerald-500 ring-offset-2`. Do not add per-component focus rings.

---

## 7. Layout & Spacing

### 7.1 The column

MatchPulse is **mobile-first and stays narrow on desktop**. The primary content column is:
```
max-w-2xl mx-auto px-5 py-6 pb-12
```
Home stacks its sections with `space-y-8`; within a section, cards stack with
`space-y-2` (rows) to `space-y-3` (feature cards). This single-column model is the
default for the whole product — discovery, detail, and manage pages alike. Wider
multi-column tables (standings, admin) may exceed it, but the reading column does not.

### 7.2 Page entrance

Top-level page containers add `page-enter` (`index.css`): a 0.18s fade + 6px rise. Use it
on the outermost page `div`.

### 7.3 Section rhythm

Every page reads top-to-bottom in priority order:
1. **Operational shortcuts** (admin/create CTAs) — only when relevant
2. **Live now** — red, first, impossible to miss
3. **Primary content** — competitions / fixtures / results
4. **Discovery** — browse schools & clubs

Each section opens with a `SectionHead`: a micro uppercase label (left) and an optional
action link (right); the live label carries a pulsing red dot.

---

## 8. Iconography

MatchPulse uses **`lucide-react`** for UI icons (e.g. `ChevronRight`, `Plus`,
`Settings2`). Keep icons at `w-4 h-4` inline and tint them to match their context
(`text-slate-400` in neutral rows, `text-emerald-500`/`text-amber-500` in tinted CTAs).
Crests and identity swatches are **not** icons — they are colour/logo/monogram blocks
(§3.6), rendered by `TeamCrest` / `OrgBadge`.

---

## 9. Shared Components (source of truth)

These components implement the system above. Treat them as the single source of truth and
reuse them rather than re-styling inline:

- `StatusBadge.jsx` — the semantic status palette (§3.5). One implementation, every status.
- `TeamIdentity.jsx` — `TeamIdentity`, `TeamCrest`, `MatchTeamIdentity`, `MatchTeamCrest`,
  `MatchVersus`. All team/org identity rendering.
- `Nav.jsx` / `BottomNav` / `Layout.jsx` — chrome and the content column.
- `CompetitionStatusBadge.jsx`, `StandingsTable.jsx`, `FixtureBanner.jsx` — competition surfaces.
- `index.css` utilities — `.micro-label`, `.stat-number`, `.card-lift`, `.page-enter`.

If you find a fourth way to render a status, a score, or a team name, that is a bug in the
system — fold it back into these components.

---

## 10. Sport skin — Hockey

The shared design (Sections 3–9) is **identical** to the Rugby app. Hockey differs only in
this seam. Keep every change here inside the files listed below so the visual layer stays
in sync across both repositories.

### 10.1 Terminology

- **Unit of scoring:** goals. A match score is a goal total (e.g. `3–2`).
- **Scoring events:** goal (1), typically from open play, a short corner, or a penalty
  stroke.
- **Roster:** a squad of 11 plus substitutes; positions split goalkeeper / defence /
  midfield / forwards.
- **Period language:** quarters (Q1–Q4) or halves depending on format; "FT" at full time.
- **Tagline:** "The easiest way to create, score and publish school and club **hockey**
  fixtures."

### 10.2 Scoring & rules code

- The hockey scoring lib (the counterpart to Rugby's `rugbyScoring.js`) — goal-based
  score derivation.
- `StandingsTable.jsx` — standard win/draw/loss points with **goal difference**;
  **no rugby bonus-point columns**. This is the main structural difference from Rugby's
  standings.
- `FormatSelector.jsx` — hockey match formats (11-a-side outdoor, indoor, etc.).
- `SquadManager.jsx` — hockey positions and squad size.

### 10.3 Copy & metadata

- SEO/meta copy and `useSeoMeta` strings, `package.json` name, PWA manifest, and any
  "hockey" wording in `Nav` / `Layout`.

Everything not in this section — colours, cards, typography, layout, icons, shared
components — must match the Rugby app exactly.

---

*End of MatchPulse Design System v2.0 (Hockey). The Rugby repository carries an identical
document differing only in Section 10.*
