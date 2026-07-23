# Match Pulse — Brand Book

> **Living document.** This is the single source of truth for all design, visual, and style decisions on the Match Pulse platform. Any deviation from this book must be recorded as a decision with reasoning. When a decision changes, the previous decision is **not deleted** — it is preserved in the Decision Log with the date and reasoning for the change.

---

## 1. Brand Identity

### Name

**Match Pulse**

Two words. Always "Match Pulse" (title case) in body copy. In the logo/wordmark it may be rendered as one unit: **MatchPulse** with "Pulse" in the accent colour.

### Positioning

Match Pulse is a **professional sports data platform for school sport** — not a school newsletter, not a social app. The aesthetic is "tech-forward sports data": closer to a broadcast sports channel than a school website. Data-driven. Confident. Fast.

### Tone of Voice

- Direct and factual — fixtures, results, and stats don't need commentary
- Energetic without being loud
- Inclusive of all skill levels — a player's first match matters as much as a finals win

---

## 2. Colour Palette

**Status: Confirmed 2026-05-28.**

### Background & Surface Hierarchy

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| App canvas | `#0A0C10` | — | Core application background — very deep near-black |
| Surface / Panels | `#0F1219` | — | Cards, headers, sidebars, elevated containers |
| Table headers / alt rows | `#161B22` | — | Subtle contrast within data tables only |

### Borders & Dividers

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| Subtle layout borders | `#1e293b` | `border-slate-800` | Card outlines and dividers |
| Prominent boundaries | `#334155` | `border-slate-700` | Image outlines, stronger separators |

### Brand & Interactive Highlights

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| Primary accent | `#34d399` | `text-emerald-400` | Primary metrics, active status indicators, links, brand logo |
| Primary accent (filled) | `#10b981` | `bg-emerald-500` | Filled buttons, active backgrounds |
| Subtle accent background | — | `bg-emerald-950/20` → `bg-emerald-950/50` | Badge backgrounds — glowing, tech-like feel without overwhelming |

### Text Hierarchy

| Role | Tailwind | Usage |
|------|----------|-------|
| Primary | `text-white` | Names, values, primary headings |
| Secondary | `text-slate-400` to `text-slate-500` | Descriptions, subtitles, labels |
| Muted / structural | `text-slate-600` | Dividers, deeply de-emphasised text |

### Semantic / Hockey Event Colours

| Event | Tailwind | Suspension |
|-------|----------|------------|
| Green Card | `green-500` | 2 minutes |
| Yellow Card | `yellow-400` | 5 minutes |
| Red Card | `red-600` | Full dismissal |

### Colour Rules

- Emerald is the brand accent. Use it for live indicators, primary stats, active states, and the logo. Do not scatter it decoratively.
- All backgrounds default to `#0A0C10`. Use `#0F1219` to create depth for raised surfaces.
- `#161B22` is strictly for table row contrast — not for general card use.
- Light mode: **not in scope.** The platform is dark-only.

---

## 3. Typography

**Status: Confirmed 2026-05-28.**

### Font Families

| Role | Family | Usage |
|------|--------|-------|
| **Display** | Space Grotesk | Player names, main titles, app logo, score displays, match timers |
| **Sans / UI** | Inter | Paragraphs, standard UI elements, lists, body copy |
| **Mono / Data** | JetBrains Mono (or `ui-monospace`) | All numerical stats, caps, goals, season years — enforces rigid grid alignment |

The three-font system is intentional: each family has an exclusive domain. Do not use Space Grotesk for body copy or Inter for score numbers.

### Google Fonts Load

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
```

### Tailwind Config

```js
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'monospace'],
      }
    }
  }
}
```

### Type Scale & Rhythms

| Role | Tailwind Classes | Notes |
|------|-----------------|-------|
| Hero / Player name | `font-display font-black text-4xl` – `text-6xl uppercase tracking-tighter leading-none` | Maximum impact — player names, competition titles |
| Score display | `font-display font-black text-4xl` – `text-5xl tabular-nums` | Always `tabular-nums` for score alignment |
| Stat numbers | `font-mono font-black text-5xl` – `text-sm` | All numerical data, season stats |
| Data labels (micro-copy) | `text-[9px]` or `text-[10px] font-bold uppercase tracking-widest text-slate-500` | Creates the "dashboard" feel — e.g. "CAREER CAPS", "BORN", "PLAYED" |
| Body / UI | `font-sans text-sm` – `text-base` | All non-display text |

### Letter Spacing

- Hero headers: `tracking-tighter` — tight and powerful
- All-caps micro-labels: `tracking-widest` — wide-set for readability at tiny sizes
- Body: default (no override)

---

## 4. Layout & Spacing

### Primary Viewport

The application is **mobile-first**. The primary frame:

```html
<div class="max-w-md mx-auto min-h-screen bg-[#0A0C10]">
```

This constrains to ~448px — a phone screen held by a spectator or courtside admin. All layouts must work here first before scaling wider.

### Density Principles

- Internal padding: `p-3` or `p-4` (tight, data-dense — not airy)
- Grid/flex gaps: `gap-4` or `gap-6`
- Every pixel earns its place. No decorative whitespace.

### Border Radius

| Context | Class | Notes |
|---------|-------|-------|
| Cards & modals | `rounded-xl` | Smooth, modern feel for major containers |
| Badges & small accents | `rounded` | Tighter, more technical edge |
| Player / team avatars | `rounded-xl` or `rounded-lg` | **Square with rounded corners** — trading-card style. Never circular. |

### Elevation

Flat design — no heavy drop shadows. Elevation is communicated through:
1. Background lightening (`#0F1219` above `#0A0C10`)
2. Border (`border-slate-800` or `border-slate-700`)

---

## 5. Component Patterns

### Data Badges

Used for tags, active statuses, and awards.

```html
<!-- Live / Active -->
<span class="inline-flex text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-400">
  Live
</span>

<!-- Neutral -->
<span class="inline-flex text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-800 text-slate-400">
  Label
</span>
```

### Stat Blocks (Big Numbers)

Used in hero sections for lifetime achievements.

```html
<div class="border-l border-slate-800/80 pl-6">
  <div class="font-mono text-5xl font-black text-emerald-400">142</div>
  <div class="text-[10px] uppercase font-bold tracking-widest text-slate-500 mt-1">Career Caps</div>
</div>
```

### Lists & List Items

```html
<div class="bg-[#0F1219] p-4 rounded-xl border border-slate-800">

  <!-- Column header -->
  <div class="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-3">Competition History</div>

  <!-- List item -->
  <div class="flex items-center gap-3 py-2 border-b border-slate-800/50">
    <!-- Team colour block — NOT a circle, always rounded-sm -->
    <div class="w-3 h-3 rounded-sm bg-[#00A859] shrink-0"></div>
    <span class="text-sm text-white font-medium">Western Province</span>
    <span class="ml-auto font-mono text-sm text-slate-400">2024</span>
  </div>

</div>
```

**Team identifiers are always `w-3 h-3 rounded-sm` colour blocks** in the team's primary colour — never empty circles. This is a platform-wide rule.

### Hockey Event Timeline Items

Map event type to visual treatment consistently across all views:

| Event | Icon | Border / Background |
|-------|------|---------------------|
| Goal / PC Goal | Filled circle, `text-emerald-400` | `border-emerald-500/40 bg-emerald-500/15` |
| Green Card | Rectangle card shape, `text-green-400` | `border-green-500/40 bg-green-600/15` |
| Yellow Card | Rectangle card shape, `text-yellow-400` | `border-yellow-500/40 bg-yellow-400/15` |
| Red Card | Rectangle card shape, `text-red-400` | `border-red-500/40 bg-red-600/15` |

Score state is shown inline with the event using `font-mono font-semibold` at `text-[9px]` in the team's accent colour.

### Live Indicator

Standard pattern for any "live" or "in progress" state:

```html
<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
<span class="text-emerald-400 text-[10px] font-mono uppercase tracking-widest">Live · Q3 · 42'</span>
```

---

## 6. Logo & Wordmark

### Current State (Placeholder)

CSS/HTML wordmark — Match in white, Pulse in `emerald-400`:

```html
<h1 class="font-display font-black text-white">
  Match<span class="text-emerald-400">Pulse</span>
</h1>
```

### Replacing the Wordmark

When a proper SVG logo is designed:
1. Save as `public/logo.svg`
2. Replace the `<h1>` with `<img src="logo.svg" alt="Match Pulse" class="logo" />`

### Logo Rules

*To be defined when the logo is designed.*

---

## 7. Motion & Animation

### Principles

- Animations should feel **athletic**: fast in, settled quickly. Never bouncy or playful.
- Entrance animations: `cubic-bezier(.2, .7, .2, 1)` — quick acceleration, smooth arrival.
- Ambient animations (glow, pulse): slow and subtle — noticeable only when you look for them.
- **Always** respect `prefers-reduced-motion`. Every animation must have a fallback.

### Current Animations (Coming Soon Page)

| Element | Animation | Duration | Notes |
|---------|-----------|----------|-------|
| Wordmark, tagline, footer | Rise + fade in | 0.9s | Staggered delays: 0.2s, 0.55s, 1.0s |
| Pulse line (SVG path) | Stroke draw | 3.2s | Starts at 0.6s delay |
| Pulse line (glow) | Opacity oscillation | 2.4s, infinite | Starts after draw completes |

---

## 8. Iconography & Imagery

### Icons

Prefer inline SVG — no external icon library dependency. Standard sizes: `w-4 h-4` or `w-5 h-5` for UI, `w-3 h-3` for inline/timeline use.

### Player / Avatar Images

`rounded-xl` or `rounded-lg` — square with rounded corners ("trading card" style). Never `rounded-full`.

### Photography

*Not yet defined.* Direction: high-contrast action photography, colour-graded to complement the dark palette.

---

## 9. Decision Log

All design decisions recorded chronologically. Superseded decisions are **preserved, never deleted**.

| Date | Decision | Status | Reasoning |
|------|----------|--------|-----------|
| 2026-05-28 | Dark-first colour scheme | **Current** | School sport is watched at evening matches on phones. Dark UI reduces eye strain and battery use on OLED screens. Dark-only — no light mode planned. |
| 2026-05-28 | Ember red (`#FF3B22`) as primary accent | **Superseded 2026-05-28** | Initial choice for energy and urgency against the dark background. |
| 2026-05-28 | **Emerald (`#34d399`) replaces ember red as primary accent** | **Current** | Platform is a data and stats product, not a broadcast brand. Emerald reads as "live", "active", and "performance" — natural to sports data dashboards. Provides strong contrast against near-black backgrounds. Ember red was emotionally correct but too aggressive for dense data UIs where the accent colour appears constantly. |
| 2026-05-28 | Bricolage Grotesque as primary typeface | **Superseded 2026-05-28** | Initial choice: variable font with optical sizing, contemporary feel. Dropped because it lacks a dedicated mono companion, making data tables typographically inconsistent. |
| 2026-05-28 | **Space Grotesk + Inter + JetBrains Mono type stack** | **Current** | Three-font system assigns each family an exclusive domain: display impact (Space Grotesk), legible body (Inter), monospaced data alignment (JetBrains Mono). No overlap, no ambiguity. |
| 2026-05-28 | **Square-cornered avatars (`rounded-xl`) over circular** | **Current** | Trading-card aesthetic reinforces the "player record" concept central to the platform. Circles are generic; the square crop is aggressive and distinctive. |
| 2026-05-28 | **Team identifiers as `w-3 h-3 rounded-sm` colour blocks** | **Current** | Colour blocks immediately communicate team identity without needing text or a logo asset. Solid colour blocks read as intentional design; empty circles look unfinished. |

---

*Last updated: 2026-05-28*
