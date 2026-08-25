// Competition rule templates, type metadata, and helpers.
//
// CRITICAL: A competition stores its OWN copy of its rules. These exported
// objects are templates used only to PRE-FILL a new competition at creation
// time — they are copied into the competition document and never referenced at
// runtime by a live competition. Changing a template here never changes the
// rules of any competition that already exists.
//
// This module is part of the competition schema foundation. It deliberately
// contains NO calculation logic (no standings engine, no advancement, no
// bracket inference) — only the shape of the rules and their defaults.

// ── Competition types ────────────────────────────────────────────────────────
// User-facing comparison data for the three supported competition types. Used to
// render the "what each type does / does not do" comparison at creation time.
export const COMPETITION_TYPES = {
  league: {
    value: 'league',
    label: 'League',
    summary: 'Season-long competition with a cumulative standings table.',
    bestFor: 'Season-long competition',
    features: {
      fixtures: 'Yes', results: 'Yes', standings: 'Full table', rankings: 'Yes',
      knockouts: 'No', pools: 'No', shootouts: 'Optional', teamSchedules: 'Yes',
    },
  },
  tournament: {
    value: 'tournament',
    label: 'Tournament',
    summary: 'Short competitive event with pools and/or knockout stages.',
    bestFor: 'Short competitive event',
    features: {
      fixtures: 'Yes', results: 'Yes', standings: 'Pool standings', rankings: 'Yes',
      knockouts: 'Yes', pools: 'Yes', shootouts: 'Knockout use', teamSchedules: 'Yes',
    },
  },
  festival: {
    value: 'festival',
    label: 'Festival',
    summary: 'Showcase fixture collection. No winners, rankings or qualification.',
    bestFor: 'Showcase event',
    features: {
      fixtures: 'Yes', results: 'Yes', standings: 'Optional stats only', rankings: 'No official ranking',
      knockouts: 'No', pools: 'No', shootouts: 'No', teamSchedules: 'Yes',
    },
  },
}

export const COMPETITION_TYPE_ORDER = ['league', 'tournament', 'festival']

// ── Lifecycle ─────────────────────────────────────────────────────────────────
// A competition's lifecycle status is DERIVED automatically from its start and
// end datetimes — it is never set by hand. The three states are:
//   upcoming   — now is before startDate (or no start set yet)
//   live       — now is between startDate and endDate
//   completed  — now is after endDate
// Visibility is a SEPARATE concern, governed by the `published` flag (a
// competition is private while being set up, public once published).
export const COMPETITION_STATUSES = ['upcoming', 'live', 'completed']

// Normalise any stored date value (Firestore Timestamp, Date, epoch ms, or an
// ISO / datetime-local string) to epoch milliseconds, or null if absent/invalid.
export function toMs(val) {
  if (val == null) return null
  if (typeof val === 'number') return val
  if (typeof val.toMillis === 'function') return val.toMillis()
  if (val instanceof Date) return val.getTime()
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

// Derive the lifecycle status from the competition's start/end datetimes.
export function competitionLifecycle(competition, now = Date.now()) {
  const t     = typeof now === 'number' ? now : now.getTime()
  const start = toMs(competition?.startDate)
  const end   = toMs(competition?.endDate)
  if (start != null && t < start) return 'upcoming'
  if (end   != null && t > end)   return 'completed'
  if (start != null && t >= start) return 'live'
  return 'upcoming' // no start date yet
}

// The single effective status shown for a competition. Visibility (the
// `published` flag) takes precedence: an unpublished competition reads as
// "unpublished" regardless of its dates. Once published it reflects the derived
// lifecycle. This is the one source of truth for both CompetitionStatusBadge and
// the competitions-list status filter, so badge and filter can never disagree.
export function competitionStatus(competition, now = Date.now()) {
  if (competition?.published === false) return 'unpublished'
  return competitionLifecycle(competition, now)
}

// A competition is visible to the public only once published. An unpublished
// competition (published === false) is hidden from every public surface — the
// competitions list, search, browse and its own detail page. Admins/owners can
// still reach it (callers pass their own override). Missing/undefined published
// is treated as published, matching the rest of the app.
export function isPubliclyVisible(competition) {
  return competition?.published !== false
}

// Whether the current viewer may open a competition's detail pages. The public
// sees it only once published; a platform admin, its owning user, or a member
// of its owning org may preview it while still unpublished. Pass the value of
// useAuth() as `auth`.
export function competitionViewableBy(competition, auth = {}) {
  if (isPubliclyVisible(competition)) return true
  if (auth.isPlatformAdmin) return true
  if (competition?.ownerUserId && competition.ownerUserId === auth.uid) return true
  if (competition?.ownerOrgId && auth.orgRoles && auth.orgRoles[competition.ownerOrgId]) return true
  return false
}

// ── Points ────────────────────────────────────────────────────────────────────
export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 }

export const POINTS_PRESETS = [
  { label: '3 / 1 / 0', points: { win: 3, draw: 1, loss: 0 } },
  { label: '2 / 1 / 0', points: { win: 2, draw: 1, loss: 0 } },
]

// ── Bonus points ────────────────────────────────────────────────────────────
// Optional extra league points awarded on top of the win/draw/loss points,
// based on how a team performed in a single match. Three independent rule
// types, each separately toggleable with its own threshold and points value:
//
//   scoreThreshold — a team that SCORES ≥ threshold goals earns the points
//                    (rewards attacking play; either side can earn it).
//   winMargin      — the WINNER of a match won by ≥ threshold goals earns it
//                    (rewards a decisive win, e.g. "win by 3+ → +1").
//   lossWithin     — the LOSER of a match lost by ≤ threshold goals earns it
//                    (the classic "losing bonus point" for a close defeat).
//
// More than one rule can fire in the same match (a big, high-scoring win can
// earn both a margin and a score-threshold bonus). Bonus points are added into
// the team's total points AND tracked separately (the BP column) so a table
// makes clear how many bonus points each team has collected. Off by default.
export const DEFAULT_BONUS_POINTS = {
  enabled: false,
  rules: {
    scoreThreshold: { enabled: false, threshold: 4, points: 1 },
    winMargin:      { enabled: false, threshold: 3, points: 1 },
    lossWithin:     { enabled: false, threshold: 1, points: 1 },
  },
}

// The canonical bonus rule types, in display order, with the labels/help the
// scoring editor renders. Keeping this beside the defaults means the config UI
// and the engine share one source of truth for what a bonus rule can be.
export const BONUS_RULE_TYPES = [
  {
    key: 'scoreThreshold',
    label: 'Score threshold',
    help: 'Awarded to a team that scores at least this many goals in a match.',
    thresholdLabel: 'Goals scored (≥)',
  },
  {
    key: 'winMargin',
    label: 'Winning margin',
    help: 'Awarded to the winner when they win by at least this many goals.',
    thresholdLabel: 'Win by (≥)',
  },
  {
    key: 'lossWithin',
    label: 'Losing bonus',
    help: 'Awarded to the loser when they lose by this many goals or fewer.',
    thresholdLabel: 'Lose by (≤)',
  },
]

// ── Tie-breakers ──────────────────────────────────────────────────────────────
// Default recommended water polo order, following World Aquatics ranking of
// tied teams: points, then the head-to-head result between the level teams,
// then goal difference and goals scored. Goals against, wins and a fair-play
// (misconduct & brutality) count act as further separators before an
// administrator has to decide by lot. Alphabetical is intentionally absent — it
// may only ever be used for display stability, never to decide an outcome. If
// the chain is exhausted, callers must surface "Manual placement required"
// rather than inventing a winner (manualDecision is the explicit terminal step).
export const DEFAULT_TIE_BREAKERS = [
  { key: 'points',              label: 'Points',                        direction: 'desc', scope: 'all_fixtures' },
  { key: 'headToHeadMiniTable', label: 'Head-to-head mini-table',       direction: 'desc', scope: 'head_to_head' },
  { key: 'goalDifference',      label: 'Goal difference',               direction: 'desc', scope: 'all_fixtures' },
  { key: 'goalsFor',            label: 'Goals for',                      direction: 'desc', scope: 'all_fixtures' },
  { key: 'goalsAgainst',        label: 'Goals against',                  direction: 'asc',  scope: 'all_fixtures' },
  { key: 'wins',                label: 'Wins',                           direction: 'desc', scope: 'all_fixtures' },
  { key: 'fairPlayScore',       label: 'Fair play',                      direction: 'asc',  scope: 'all_fixtures' },
  { key: 'manualDecision',      label: 'Manual administrator decision',  direction: null,   scope: 'all_fixtures' },
]

// A walkover awards the opposing team a default scoreline; the conceding team
// records a loss. World Aquatics records a defaulted/forfeited water polo match
// as 5-0 to the team present. Values are configurable per competition.
export const DEFAULT_WALKOVER_SCORE = { concedingTeam: 0, opposingTeam: 5 }

// Festival informational stats — fixed canonical column order. No position
// column, no sorting (V1). Off by default.
export const FESTIVAL_STATS_COLUMNS = [
  'played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst', 'goalDifference',
]

// Build the default, fully self-contained rules object for a competition type.
// The returned object is a fresh deep copy safe to store on a new competition.
export function defaultRulesForType(type) {
  const rules = {
    points:        { ...DEFAULT_POINTS },
    tieBreakers:   DEFAULT_TIE_BREAKERS.map(t => ({ ...t })),
    walkoverScore: { ...DEFAULT_WALKOVER_SCORE },
    bonusPoints:   {
      enabled: DEFAULT_BONUS_POINTS.enabled,
      rules: {
        scoreThreshold: { ...DEFAULT_BONUS_POINTS.rules.scoreThreshold },
        winMargin:      { ...DEFAULT_BONUS_POINTS.rules.winMargin },
        lossWithin:     { ...DEFAULT_BONUS_POINTS.rules.lossWithin },
      },
    },
  }
  if (type === 'tournament') rules.stages = []
  if (type === 'festival')   rules.statsTable = { enabled: false, columns: [...FESTIVAL_STATS_COLUMNS] }
  return rules
}

// Deterministic, order-sensitive hash of a rules object. Stored on verified
// snapshots so a historical standings decision can be explained even if the
// competition's rules are later edited. Stable across key ordering via a sorted
// serialisation; djb2 over the result.
export function rulesHash(rules) {
  const json = stableStringify(rules ?? {})
  let h = 5381
  for (let i = 0; i < json.length; i++) h = (((h << 5) + h) + json.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}
