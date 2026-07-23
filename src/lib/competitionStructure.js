// Pure competition-structure logic — stages, pools, knockout advancement.
// NO Firebase, NO side effects. Everything here is deterministic so it can be
// unit-tested in isolation and so the platform NEVER invents a result: every
// resolution is either fully determined by the inputs or explicitly reported as
// unresolved / provisional / requiring a manual decision.

// ── Stage types ──────────────────────────────────────────────────────────────
export const STAGE_TYPES = {
  pool:         { value: 'pool',         label: 'Pool stage',   summary: 'Round-robin groups with pool standings.' },
  knockout:     { value: 'knockout',     label: 'Knockout',     summary: 'Bracket of elimination matches.' },
  single_match: { value: 'single_match', label: 'Single match', summary: 'One decisive fixture (e.g. a final).' },
}
export const STAGE_TYPE_ORDER = ['pool', 'knockout', 'single_match']

// ── Knockout advancement source types ────────────────────────────────────────
// A knockout slot is filled from EXACTLY ONE explicitly-configured source. The
// platform resolves these from data; it never infers a qualification rule that
// the admin did not configure.
export const ADVANCEMENT_SOURCE_TYPES = {
  pool_position:   { value: 'pool_position',   label: 'Pool position',        needs: ['poolId', 'position'] },
  best_runner_up:  { value: 'best_runner_up',  label: 'Best Nth-placed team', needs: ['position', 'rank'] },
  bracket_winner:  { value: 'bracket_winner',  label: 'Winner of match',      needs: ['matchSlotId'] },
  bracket_loser:   { value: 'bracket_loser',   label: 'Loser of match',       needs: ['matchSlotId'] },
  manual_selection:{ value: 'manual_selection',label: 'Manual selection',     needs: [] },
  direct_team:     { value: 'direct_team',     label: 'Specific team',        needs: ['teamId'] },
}

// Resolution status of a knockout slot.
//   resolved        → teamId is final (verified pool result, completed bracket
//                     match, or admin direct/manual choice)
//   provisional     → teamId is the current best guess from LIVE pool standings
//                     (pool not yet verified) — display muted, not locked
//   manual_required → the underlying standings reached a manual-decision tie and
//                     an administrator must place the team
//   unresolved      → no input yet (match not played, no selection made)
export const SLOT_STATUS = {
  resolved: 'resolved',
  provisional: 'provisional',
  manual_required: 'manual_required',
  unresolved: 'unresolved',
}

// Compare two standings-style rows by a numeric tie-breaker chain. Used for
// cross-pool comparisons (best runner-up) where teams have NOT met, so the
// head-to-head mini-table is inapplicable and is skipped. Returns negative if a
// should rank above b, positive if below, 0 if indistinguishable by the chain.
function compareByChain(a, b, tieBreakers) {
  for (const tb of tieBreakers) {
    if (tb.key === 'manualDecision') return 0          // chain exhausted → tie
    if (tb.key === 'headToHeadMiniTable') continue      // N/A across pools
    const av = statValue(tb.key, a)
    const bv = statValue(tb.key, b)
    if (av !== bv) return tb.direction === 'asc' ? av - bv : bv - av
  }
  return 0
}

function statValue(key, row) {
  switch (key) {
    case 'points':         return row.Pts ?? 0
    case 'goalDifference': return row.GD ?? 0
    case 'goalsFor':       return row.GF ?? 0
    case 'goalsAgainst':   return row.GA ?? 0
    case 'wins':           return row.W ?? 0
    case 'fairPlayScore':  return row.fairPlayScore ?? 0
    default:               return 0
  }
}

// Rank the teams that finished at `position` (1-based) across the given pools —
// e.g. position 2 ranks every pool runner-up. Returns:
//   { ranked: [{ teamId, poolId, row }], manualRequired: [[teamId,…]], allVerified }
// `manualRequired` lists clusters the chain could not separate; the caller must
// not treat their order as decided.
export function computeBestPlacedAtPosition(pools, position, tieBreakers = []) {
  const candidates = []
  let allVerified = true
  for (const pool of pools) {
    if (!pool.verified) allVerified = false
    const row = (pool.rows ?? [])[position - 1]
    if (row && row.teamId) candidates.push({ teamId: row.teamId, poolId: pool.poolId, row })
  }
  // Stable base order before sorting so ties are deterministic (not random).
  candidates.sort((a, b) => String(a.teamId).localeCompare(String(b.teamId)))
  const ranked = [...candidates].sort((a, b) => compareByChain(a.row, b.row, tieBreakers))

  // Detect adjacent indistinguishable clusters → manual decision required.
  const manualRequired = []
  let i = 0
  while (i < ranked.length) {
    let j = i + 1
    while (j < ranked.length && compareByChain(ranked[i].row, ranked[j].row, tieBreakers) === 0) j++
    if (j - i > 1) manualRequired.push(ranked.slice(i, j).map(c => c.teamId))
    i = j
  }
  return { ranked, manualRequired, allVerified }
}

// Resolve a single knockout slot against the current competition context.
//
// context = {
//   pools:           { [poolId]: { rows, verified } },
//   bestPlaced:      { [position]: { ranked, manualRequired, allVerified } },
//   bracketResults:  { [slotId]: { winnerTeamId, loserTeamId } },  // from final matches
//   manualSelections:{ [slotId]: teamId },                          // admin choices
//   lockedTeams:     { [slotId]: teamId },                          // locked advancement
// }
export function resolveSlot(slot, context = {}) {
  const {
    pools = {}, bestPlaced = {}, bracketResults = {},
    manualSelections = {}, lockedTeams = {},
  } = context

  // A locked slot is final regardless of source — advancement was confirmed.
  if (lockedTeams[slot.slotId]) {
    return { teamId: lockedTeams[slot.slotId], status: SLOT_STATUS.resolved, locked: true, reason: 'Advancement locked' }
  }

  const src = slot.source ?? {}
  switch (src.type) {
    case 'direct_team':
      return src.teamId
        ? { teamId: src.teamId, status: SLOT_STATUS.resolved, reason: 'Directly assigned team' }
        : { teamId: null, status: SLOT_STATUS.unresolved, reason: 'No team assigned' }

    case 'manual_selection': {
      const tid = manualSelections[slot.slotId] ?? src.teamId ?? null
      return tid
        ? { teamId: tid, status: SLOT_STATUS.resolved, reason: 'Manually selected' }
        : { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Awaiting manual selection' }
    }

    case 'pool_position': {
      const pool = pools[src.poolId]
      if (!pool) return { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Pool not found' }
      const row = (pool.rows ?? [])[(src.position ?? 1) - 1]
      if (!row || !row.teamId) return { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Pool position empty' }
      if (row.manualDecisionRequired) {
        return { teamId: null, status: SLOT_STATUS.manual_required, reason: 'Pool position tied — manual decision required' }
      }
      return {
        teamId: row.teamId,
        status: pool.verified ? SLOT_STATUS.resolved : SLOT_STATUS.provisional,
        reason: pool.verified ? 'Verified pool position' : 'Provisional — pool not yet verified',
      }
    }

    case 'best_runner_up': {
      const bp = bestPlaced[src.position ?? 2]
      if (!bp) return { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Cross-pool ranking unavailable' }
      const pick = bp.ranked[(src.rank ?? 1) - 1]
      if (!pick) return { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Not enough qualifying teams' }
      const tied = bp.manualRequired.some(c => c.includes(pick.teamId))
      if (tied) return { teamId: null, status: SLOT_STATUS.manual_required, reason: 'Cross-pool ranking tied — manual decision required' }
      return {
        teamId: pick.teamId,
        status: bp.allVerified ? SLOT_STATUS.resolved : SLOT_STATUS.provisional,
        reason: bp.allVerified ? 'Verified cross-pool ranking' : 'Provisional — not all pools verified',
      }
    }

    case 'bracket_winner': {
      const res = bracketResults[src.matchSlotId]
      return res?.winnerTeamId
        ? { teamId: res.winnerTeamId, status: SLOT_STATUS.resolved, reason: 'Match winner' }
        : { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Source match not decided' }
    }

    case 'bracket_loser': {
      const res = bracketResults[src.matchSlotId]
      return res?.loserTeamId
        ? { teamId: res.loserTeamId, status: SLOT_STATUS.resolved, reason: 'Match loser' }
        : { teamId: null, status: SLOT_STATUS.unresolved, reason: 'Source match not decided' }
    }

    default:
      return { teamId: null, status: SLOT_STATUS.unresolved, reason: 'No source configured' }
  }
}

// Resolve every slot in a knockout structure. Returns a map slotId → resolution.
export function resolveBracket(slots = [], context = {}) {
  const out = {}
  for (const slot of slots) out[slot.slotId] = resolveSlot(slot, context)
  return out
}

// Derive the winner/loser of a final knockout match. In a knockout, a shootout
// is decisive: the shootout winner advances even though the regulation score is
// a draw. Returns { winnerTeamId, loserTeamId } or null if not decided.
export function knockoutResult(match) {
  if (!match || match.status !== 'final') return null
  // A walkover/withdrawal/no-show credits one side — the scoring engine sets the
  // winner explicitly, so the bracket advances the credited team (never a bare
  // scoreline). Abandoned attempts (frozen) are undecided until let-stand/replay.
  const o = match.outcome
  if (o?.awardedTo === 'home') return { winnerTeamId: match.homeTeamId, loserTeamId: match.awayTeamId }
  if (o?.awardedTo === 'away') return { winnerTeamId: match.awayTeamId, loserTeamId: match.homeTeamId }
  if (o?.flag === 'frozen') return null
  const h = match.homeScore ?? 0, a = match.awayScore ?? 0
  if (h > a) return { winnerTeamId: match.homeTeamId, loserTeamId: match.awayTeamId }
  if (a > h) return { winnerTeamId: match.awayTeamId, loserTeamId: match.homeTeamId }
  // Drawn after regulation — a shootout decides the knockout.
  const sh = match.shootoutHome ?? null, sa = match.shootoutAway ?? null
  if (sh != null && sa != null && sh !== sa) {
    return sh > sa
      ? { winnerTeamId: match.homeTeamId, loserTeamId: match.awayTeamId }
      : { winnerTeamId: match.awayTeamId, loserTeamId: match.homeTeamId }
  }
  return null   // genuine draw, no shootout recorded → undecided
}

// Which SIDE won a final knockout match — 'home' | 'away' | null. Unlike
// knockoutResult (which reads the match's team ids, null on an unstamped holding
// fixture), this reads only the score/shootout/outcome, so a caller can map the
// winning side onto the RESOLVED bracket slot and name the champion even before
// the fixture has real teams stamped onto it.
export function knockoutWinnerSide(match) {
  if (!match || match.status !== 'final') return null
  const o = match.outcome
  if (o?.awardedTo === 'home') return 'home'
  if (o?.awardedTo === 'away') return 'away'
  if (o?.flag === 'frozen') return null
  const h = match.homeScore ?? 0, a = match.awayScore ?? 0
  if (h > a) return 'home'
  if (a > h) return 'away'
  const sh = match.shootoutHome ?? null, sa = match.shootoutAway ?? null
  if (sh != null && sa != null && sh !== sa) return sh > sa ? 'home' : 'away'
  return null
}

// Final placings of a knockout, as RESOLVED team ids: { first, second, third|null }
// or null while the final isn't decided. Winners are taken by SIDE (score) mapped
// onto the resolved slot, so it works even when the fixtures aren't stamped.
//   knockout   — the slot array
//   resolved   — output of resolveBracket (slotId → { teamId, ... })
//   matches    — id → match doc
//   bronzeLabel — the 3rd-place round label (pass BRONZE_ROUND_LABEL)
export function bracketPodium({ knockout, resolved, matches, bronzeLabel }) {
  if (!knockout?.length) return null
  const sorted = [...knockout].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const byRound = new Map()
  for (const s of sorted) { const k = s.roundLabel || 'Knockout'; if (!byRound.has(k)) byRound.set(k, []); byRound.get(k).push(s) }
  const games = []
  for (const [label, ss] of byRound) for (let i = 0; i < ss.length; i += 2) if (ss[i] && ss[i + 1]) games.push({ label, home: ss[i], away: ss[i + 1] })
  if (!games.length) return null

  const referenced = new Set(knockout.map(s => s.source?.matchSlotId).filter(Boolean))
  const isThird = l => l === bronzeLabel || /\b(3rd|third)\b/i.test(l || '')
  const isFinal = l => /^final$/i.test((l || '').trim())
  // The 3rd-place game may be labelled "3rd place play-off" (generated bronze) OR
  // "3rd/4th" (ranking playoff) — match both.
  const bronzeGame = games.find(g => isThird(g.label)) || null
  const pool       = games.filter(g => g !== bronzeGame)
  const terminal   = pool.filter(g => !referenced.has(g.home.slotId) && !referenced.has(g.away.slotId))
  // Prefer the game explicitly labelled "Final". In a ranking playoff EVERY game
  // is terminal (all sourced from pool positions), so the terminal heuristic only
  // decides a true knockout (where exactly one game feeds nothing else). Never
  // fall back to "last game" — that mis-picks e.g. the 11th/12th place game.
  const finalGame  = pool.find(g => isFinal(g.label))
    || (referenced.size > 0 && terminal.length ? terminal[terminal.length - 1] : null)
    || pool.find(g => /final/i.test(g.label))
    || null

  const matchOf = g => { const w = g && [g.home, g.away].find(s => s.matchId && matches[s.matchId]); return w ? matches[w.matchId] : null }
  const teamOf  = slot => (slot ? (resolved[slot.slotId]?.teamId ?? null) : null)
  const winLose = g => {
    const side = knockoutWinnerSide(matchOf(g))
    if (!g || !side) return { win: null, lose: null }
    return side === 'home' ? { win: g.home, lose: g.away } : { win: g.away, lose: g.home }
  }

  const fin = winLose(finalGame)
  const first = teamOf(fin.win)
  if (!first) return null
  return { first, second: teamOf(fin.lose), third: teamOf(winLose(bronzeGame).win) }
}

// Format a scoreline including a knockout shootout suffix, e.g. "2–2 (4–3 SO)".
export function formatScoreline(match) {
  if (!match) return ''
  const base = `${match.homeScore ?? 0}–${match.awayScore ?? 0}`
  if (match.shootoutHome != null && match.shootoutAway != null) {
    return `${base} (${match.shootoutHome}–${match.shootoutAway} SO)`
  }
  return base
}
