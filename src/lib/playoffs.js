// Playoffs planning — PURE logic, NO Firebase, NO side effects.
//
// This module sits ABOVE the existing knockout engine (competitionStructure.js).
// It does NOT change the data model or resolveSlot/resolveBracket. It only plans
// the slots to create: it converts an organiser's plain-language choice
// (Playoff / Knockout round / Custom) into an ordered list of knockout-slot
// payloads whose `source` references the engine already understands
// (`pool_position`, `bracket_winner`, `bracket_loser`).
//
// Two contiguous slots = one game (the engine's pairing convention). The
// generator that consumes these plans (in CompetitionStructureSection.jsx)
// creates slots in `order`, so contiguity is preserved.

// ── Naming ───────────────────────────────────────────────────────────────────
export const PLAYOFF_TYPES = {
  playoff:  { value: 'playoff',  label: 'Playoff',        summary: 'Like-for-like ranking. Every position plays its equivalent — everyone gets ranked, no elimination.' },
  knockout: { value: 'knockout', label: 'Knockout round', summary: 'Elimination bracket. Cross-over or seeded — teams knocked out round by round.' },
  custom:   { value: 'custom',   label: 'Custom',         summary: 'Hand-built. Pick the pool position for each slot.' },
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// Stable, team-independent slug for a playoff game's fixture URL. Derived from
// the round label (+ a 1-based index when a round has several games) so the URL
// never changes when teams resolve, e.g. "final", "semi-final-1", "3rd-4th".
export function playoffFixtureSlug(roundLabel, matchIndex = 0, matchCount = 1) {
  const base = String(roundLabel || 'playoff')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'playoff'
  return matchCount > 1 ? `${base}-${matchIndex + 1}` : base
}

// The pair of overall positions a "like-for-like" game decides, e.g. p=2 → "3rd/4th".
export function positionPairLabel(p) {
  return `${ordinal(2 * p - 1)}/${ordinal(2 * p)}`
}

// Round labels are driven purely by how many matches the round contains.
const ROUND_LABELS = { 1: 'Final', 2: 'Semi-final', 4: 'Quarter-final', 8: 'Round of 16', 16: 'Round of 32', 32: 'Round of 64' }
export function roundLabelForMatches(m) { return ROUND_LABELS[m] ?? `Round of ${m * 2}` }

const ROUND_PREFIX = { 'Final': 'Final', 'Semi-final': 'SF', 'Quarter-final': 'QF', 'Round of 16': 'R16', 'Round of 32': 'R32', 'Round of 64': 'R64' }
export function roundPrefix(label) { return ROUND_PREFIX[label] ?? label }

export const BRONZE_ROUND_LABEL = '3rd place play-off'

// ── Pool-count router ────────────────────────────────────────────────────────
// Reads the EXISTING pool count and returns exactly the options the spec allows.
export function playoffRouter(poolCount) {
  if (poolCount <= 0) return { types: [], message: 'Create at least one pool before setting up playoffs.' }
  if (poolCount === 1) return { types: ['playoff', 'knockout', 'custom'], message: null }
  if (poolCount === 2) return { types: ['playoff', 'knockout', 'custom'], message: null }
  if (poolCount === 3) return { types: ['custom'], message: 'Three pools needs a custom build.' }
  if (poolCount === 4) return { types: ['knockout', 'custom'], message: null }
  return { types: ['custom'], message: 'Five or more pools needs a custom build.' }
}

// ── Playoff (like-for-like ranking) ──────────────────────────────────────────
// pools: [{ poolId, name, size }] — `size` is the number of ranked positions
//        (teams / filled slots) in the pool.
// depth: { mode: 'all' } | { mode: 'downTo', position: N }
//
// Returns { games, standalone }:
//   games:      [{ label, roundLabel, home:{ name, source }, away:{ name, source } }]
//   standalone: [{ label, roundLabel, name, source }]   ← a single ranked slot, no game
// Each game's roundLabel is UNIQUE (the game label itself) so the renderer groups
// it as exactly one match — sidestepping the contiguous-pairing trap entirely.
export function planPlayoff({ pools, depth = { mode: 'all' } }) {
  const games = []
  // Slot name carries the game label so the bracket card reads "Final" / "3rd/4th"
  // (the matchup detail — "Pool A Winner" — comes from the source at render time).
  const slot = (pool, position, label, side) => ({
    name: `${label} ${side}`,
    source: { type: 'pool_position', poolId: pool.poolId, position },
  })

  if (pools.length === 1) {
    const pool = pools[0]
    const maxRank = depth.mode === 'downTo' ? Math.min(depth.position, pool.size) : pool.size
    // Adjacent-rank games off the single standing: 1v2, 3v4, 5v6, … An odd team
    // at the bottom with no pair is dropped (not included in the playoff).
    for (let lo = 1; lo + 1 <= maxRank; lo += 2) {
      const label = lo === 1 ? 'Final' : `${ordinal(lo)}/${ordinal(lo + 1)}`
      games.push({ label, roundLabel: label,
        home: slot(pool, lo,     label, 'Home'),
        away: slot(pool, lo + 1, label, 'Away') })
    }
    return { games, standalone: [] }
  }

  // Two pools: like-for-like across the two standings. Only positions present in
  // BOTH pools get a game; a leftover team in the larger pool (odd number) is
  // dropped — it is NOT included in the playoff.
  const [A, B] = pools
  const common = Math.min(A.size, B.size)
  const cap = depth.mode === 'downTo' ? Math.floor(depth.position / 2) : common
  const gameCount = Math.min(common, cap)
  for (let p = 1; p <= gameCount; p++) {
    const label = p === 1 ? 'Final' : positionPairLabel(p)
    games.push({ label, roundLabel: label,
      home: slot(A, p, label, 'Home'),
      away: slot(B, p, label, 'Away') })
  }
  return { games, standalone: [] }
}

// ── Knockout round (elimination) ─────────────────────────────────────────────
// Standard single-bracket seed order for a power-of-two field, e.g.
// seedPairs(8) → [[1,8],[4,5],[2,7],[3,6]] (proper bracket halves).
export function seedPairs(size) {
  let seeds = [1]
  let n = 1
  while (n < size) {
    n *= 2
    const next = []
    for (const s of seeds) { next.push(s); next.push(n + 1 - s) }
    seeds = next
  }
  const pairs = []
  for (let i = 0; i < seeds.length; i += 2) pairs.push([seeds[i], seeds[i + 1]])
  return pairs
}

// Plan the FIRST knockout round only — an ordered list of source pairs:
//   [{ homeSource, awaySource, homeName, awayName }, …]
// Later rounds are wired to bracket_winner by the async generator, which needs
// the created slot ids. `qualifiers` means:
//   • 1 pool  → top `qualifiers` of the standing (2 / 4 / 8) seeded into a bracket
//   • 2 pools → top `qualifiers` of EACH pool (2 / 4 / 8), cross-over paired
//   • 4 pools → top `qualifiers` of EACH pool (1 / 2), cross-paired across pools
export function planKnockoutFirstRound({ pools, qualifiers }) {
  const pp = (pool, position, name) => ({ source: { type: 'pool_position', poolId: pool.poolId, position }, name })

  if (pools.length === 1) {
    const pool = pools[0]
    return seedPairs(qualifiers).map(([hi, lo]) => ({
      homeSource: pp(pool, hi, `${ordinal(hi)} ${pool.name}`).source, homeName: `${ordinal(hi)} ${pool.name}`,
      awaySource: pp(pool, lo, `${ordinal(lo)} ${pool.name}`).source, awayName: `${ordinal(lo)} ${pool.name}`,
    }))
  }

  if (pools.length === 2) {
    const [A, B] = pools
    const Q = qualifiers
    const out = []
    // Cross-over: A_s v B_(Q+1-s) and B_s v A_(Q+1-s), s = 1..Q/2.
    for (let s = 1; s <= Q / 2; s++) {
      const t = Q + 1 - s
      out.push({
        homeSource: { type: 'pool_position', poolId: A.poolId, position: s }, homeName: `${ordinal(s)} ${A.name}`,
        awaySource: { type: 'pool_position', poolId: B.poolId, position: t }, awayName: `${ordinal(t)} ${B.name}`,
      })
      out.push({
        homeSource: { type: 'pool_position', poolId: B.poolId, position: s }, homeName: `${ordinal(s)} ${B.name}`,
        awaySource: { type: 'pool_position', poolId: A.poolId, position: t }, awayName: `${ordinal(t)} ${A.name}`,
      })
    }
    return out
  }

  // 4 pools: top `qualifiers` (1 or 2) each. Cross-pair so a pool winner avoids
  // its own runner-up and same-pool teams meet only later. Adjacent pool pairs
  // (A,B) and (C,D) cross over; with 1 qualifier the four winners pair across.
  const out = []
  if (qualifiers === 1) {
    // 4 winners → two semis: (P0 v P3), (P1 v P2)
    const order = [[0, 3], [1, 2]]
    for (const [i, j] of order) {
      out.push({
        homeSource: { type: 'pool_position', poolId: pools[i].poolId, position: 1 }, homeName: `Winner ${pools[i].name}`,
        awaySource: { type: 'pool_position', poolId: pools[j].poolId, position: 1 }, awayName: `Winner ${pools[j].name}`,
      })
    }
    return out
  }
  // qualifiers === 2 → 8 teams, cross-over quarter-finals.
  for (let i = 0; i < pools.length; i += 2) {
    const X = pools[i], Y = pools[i + 1]
    out.push({
      homeSource: { type: 'pool_position', poolId: X.poolId, position: 1 }, homeName: `Winner ${X.name}`,
      awaySource: { type: 'pool_position', poolId: Y.poolId, position: 2 }, awayName: `Runner-up ${Y.name}`,
    })
    out.push({
      homeSource: { type: 'pool_position', poolId: Y.poolId, position: 1 }, homeName: `Winner ${Y.name}`,
      awaySource: { type: 'pool_position', poolId: X.poolId, position: 2 }, awayName: `Runner-up ${X.name}`,
    })
  }
  return out
}

// Round structure (match counts) from a first-round match count, e.g. 4 → [4,2,1].
export function knockoutRoundCounts(firstRoundMatches) {
  const rounds = []
  let m = firstRoundMatches
  while (m >= 1) { rounds.push(m); if (m === 1) break; m = Math.floor(m / 2) }
  return rounds
}

// The knockout "size" options offered for a given pool count. Each option is
// { value, label, qualifiers } where qualifiers feeds planKnockoutFirstRound.
export function knockoutSizeOptions(poolCount) {
  if (poolCount === 1) return [
    { value: 2, label: 'Top 2 → Final',              qualifiers: 2 },
    { value: 4, label: 'Top 4 → Semi-finals',        qualifiers: 4 },
    { value: 8, label: 'Top 8 → Quarter-finals',     qualifiers: 8 },
  ]
  if (poolCount === 2) return [
    { value: 2, label: '1 v 2 — top 2 each pool (semis)',        qualifiers: 2 },
    { value: 4, label: '1 v 4 — top 4 each pool (quarter-finals)', qualifiers: 4 },
    { value: 8, label: '1 v 8 — top 8 each pool (round of 16)',  qualifiers: 8 },
  ]
  if (poolCount === 4) return [
    { value: 1, label: 'Winners → Semi-finals',          qualifiers: 1 },
    { value: 2, label: 'Top 2 each → Quarter-finals',    qualifiers: 2 },
  ]
  return []
}
