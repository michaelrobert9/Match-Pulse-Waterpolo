// Pure standings computation — no Firebase reads or writes.
//
// computeStandings(competition, members, fixtures, matches, options) →
//   { rows, manualDecisionRequired }
//
// rows: sorted array of team stat rows. Each row has:
//   pos, teamId, teamName, P, W, D, L, GF, GA, GD, Pts, manualDecisionRequired
//
// manualDecisionRequired: array of { pos, teamIds } for groups where the
//   tie-breaker chain reached `manualDecision` (or was exhausted) AND no
//   recorded manual placement covers every team in the group. The UI MUST
//   surface a "Manual decision required" warning for these groups — the
//   engine will never invent an ordering alphabetically or randomly.
//
// options.manualOverrides: array of { placements: [{ teamId, position }] }
//   (the pool's recorded manual placements). When every team in a tied group
//   has a recorded placement, that explicit administrator order is applied,
//   the group is marked resolved (manuallyPlaced: true) and it no longer
//   appears in manualDecisionRequired. The engine still never decides — it
//   only applies an order an administrator explicitly recorded.

import { fixtureContribution } from './fixtureResult.js'

const CONFIRMED = new Set(['accepted', 'admin_approved'])

// Fair play: a match exclusion (player out for the game) counts 1, a brutality
// (red-card ejection) counts 3. Routine 20-second exclusions are NOT counted —
// they are an ordinary part of water polo, not a discipline signal. Lower is
// better (direction: 'asc'). Keys mirror the stored tiers (yellow=match
// exclusion, red=brutality).
const FAIR_PLAY_WEIGHTS = { yellow: 1, red: 3 }

function mkStats(teamId) {
  return { teamId, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, BP: 0, Pts: 0, fairPlayScore: 0 }
}

// Bonus points earned by one team from a single played result, given the goals
// it scored and conceded and the competition's bonus config. Rule types stack:
// a decisive high-scoring win can earn both a margin and a score-threshold
// bonus. Returns 0 when bonus points are disabled or the config is absent.
export function bonusPointsFor(scored, conceded, bonusCfg) {
  if (!bonusCfg || bonusCfg.enabled !== true) return 0
  const r = bonusCfg.rules ?? {}
  const margin = scored - conceded
  let bp = 0

  const st = r.scoreThreshold
  if (st?.enabled && scored >= (st.threshold ?? Infinity)) bp += st.points ?? 0

  // A winning-margin bonus requires an actual win (margin > 0).
  const wm = r.winMargin
  if (wm?.enabled && margin > 0 && margin >= (wm.threshold ?? Infinity)) bp += wm.points ?? 0

  // A losing bonus requires an actual loss (margin < 0) within the threshold.
  const lw = r.lossWithin
  if (lw?.enabled && margin < 0 && (conceded - scored) <= (lw.threshold ?? -Infinity)) bp += lw.points ?? 0

  return bp
}

// bonus is the competition's bonusPoints config, or null to skip bonus scoring
// (e.g. awarded/walkover allocations, which are not genuinely-played results).
function applyResult(stats, homeId, awayId, homeGoals, awayGoals, pts, bonus = null) {
  const h = stats[homeId]
  const a = stats[awayId]
  if (!h || !a) return
  h.P++; a.P++
  h.GF += homeGoals; h.GA += awayGoals; h.GD = h.GF - h.GA
  a.GF += awayGoals; a.GA += homeGoals; a.GD = a.GF - a.GA
  if (homeGoals > awayGoals) {
    h.W++; a.L++
    h.Pts += pts.win ?? 3; a.Pts += pts.loss ?? 0
  } else if (awayGoals > homeGoals) {
    h.L++; a.W++
    h.Pts += pts.loss ?? 0; a.Pts += pts.win ?? 3
  } else {
    h.D++; a.D++
    h.Pts += pts.draw ?? 1; a.Pts += pts.draw ?? 1
  }
  if (bonus) {
    const hb = bonusPointsFor(homeGoals, awayGoals, bonus)
    const ab = bonusPointsFor(awayGoals, homeGoals, bonus)
    h.BP += hb; h.Pts += hb
    a.BP += ab; a.Pts += ab
  }
}

function applyCards(stats, homeId, awayId, cards) {
  if (!Array.isArray(cards)) return
  for (const c of cards) {
    if (c.status === 'reversed') continue
    const id = c.side === 'home' ? homeId : awayId
    if (stats[id] !== undefined) stats[id].fairPlayScore += FAIR_PLAY_WEIGHTS[c.cardType] ?? 0
  }
}

function getStatValue(key, row) {
  switch (key) {
    case 'points':         return row.Pts
    case 'goalDifference': return row.GD
    case 'goalsFor':       return row.GF
    case 'goalsAgainst':   return row.GA
    case 'wins':           return row.W
    case 'fairPlayScore':  return row.fairPlayScore ?? 0
    default:               return 0
  }
}

// Compute mini-table stats restricted to matches BETWEEN teams in the group.
// Returns an array of { teamId, Pts, GD, GF } — only what H2H sorting needs.
function computeH2HStats(group, fixtures, matches, pts, bonus = null) {
  const groupIds = new Set(group.map(t => t.teamId))
  const h2h = {}
  for (const t of group) h2h[t.teamId] = { teamId: t.teamId, Pts: 0, GD: 0, GF: 0, GA: 0 }
  for (const fx of fixtures) {
    if (!fx.countsTowardStandings) continue
    const match = matches[fx.matchId]
    if (!match || match.status !== 'final') continue
    const hId = fx.homeTeamId ?? match.homeTeamId
    const aId = fx.awayTeamId ?? match.awayTeamId
    if (!groupIds.has(hId) || !groupIds.has(aId)) continue
    // The banner flag decides whether (and with what score) a fixture counts in
    // the mini-table, exactly as it does in the full table: Awarded/Final count;
    // Not-played/Frozen do not.
    const c = fixtureContribution(match)
    if (!c.standings) continue
    const hg = c.home
    const ag = c.away
    h2h[hId].GF += hg; h2h[hId].GA += ag; h2h[hId].GD = h2h[hId].GF - h2h[hId].GA
    h2h[aId].GF += ag; h2h[aId].GA += hg; h2h[aId].GD = h2h[aId].GF - h2h[aId].GA
    if (hg > ag)      { h2h[hId].Pts += pts.win ?? 3;  h2h[aId].Pts += pts.loss ?? 0 }
    else if (ag > hg) { h2h[hId].Pts += pts.loss ?? 0; h2h[aId].Pts += pts.win ?? 3 }
    else              { h2h[hId].Pts += pts.draw ?? 1;  h2h[aId].Pts += pts.draw ?? 1 }
    // Bonus points count in the head-to-head mini-table too, so a team's points
    // mean the same here as in the full table — genuinely-played results only,
    // never awarded (walkover / no-show) allocations.
    if (bonus && c.stats) {
      h2h[hId].Pts += bonusPointsFor(hg, ag, bonus)
      h2h[aId].Pts += bonusPointsFor(ag, hg, bonus)
    }
  }
  return Object.values(h2h)
}

// Partition a sorted array into runs of equal values and recursively sort
// each run of size > 1 with the remaining tie-breakers.
function splitEqualRuns(sorted, equalFn, recurse) {
  const result = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && equalFn(sorted[i], sorted[j])) j++
    const run = sorted.slice(i, j)
    if (run.length === 1) result.push({ teams: run, manual: false })
    else result.push(...recurse(run))
    i = j
  }
  return result
}

// Sort a group of teams by the tie-breaker chain.
// Returns: Array<{ teams: Team[], manual: boolean }>
//   manual=true → these teams could not be separated; UI must show warning.
function sortGroup(group, tieBreakers, fixtures, matches, pts, bonus = null) {
  if (group.length <= 1) return [{ teams: group, manual: false }]
  if (tieBreakers.length === 0) return [{ teams: group, manual: true }]

  const [tb, ...rest] = tieBreakers

  if (tb.key === 'manualDecision') return [{ teams: group, manual: true }]

  if (tb.key === 'headToHeadMiniTable') {
    const h2hRows = computeH2HStats(group, fixtures, matches, pts, bonus)
    const h2hById = Object.fromEntries(h2hRows.map(r => [r.teamId, r]))
    const sorted = [...group].sort((a, b) => {
      const ha = h2hById[a.teamId], hb = h2hById[b.teamId]
      return (hb.Pts - ha.Pts) || (hb.GD - ha.GD) || (hb.GF - ha.GF)
    })
    return splitEqualRuns(
      sorted,
      (a, b) => {
        const ha = h2hById[a.teamId], hb = h2hById[b.teamId]
        return ha.Pts === hb.Pts && ha.GD === hb.GD && ha.GF === hb.GF
      },
      g => sortGroup(g, rest, fixtures, matches, pts, bonus),
    )
  }

  // Standard numeric tie-breaker
  const sorted = [...group].sort((a, b) => {
    const av = getStatValue(tb.key, a)
    const bv = getStatValue(tb.key, b)
    return tb.direction === 'asc' ? av - bv : bv - av
  })
  return splitEqualRuns(
    sorted,
    (a, b) => getStatValue(tb.key, a) === getStatValue(tb.key, b),
    g => sortGroup(g, rest, fixtures, matches, pts, bonus),
  )
}

export function computeStandings(competition, members, fixtures, matchesInput, { manualOverrides = [] } = {}) {
  const pts = competition.rules?.points ?? { win: 3, draw: 1, loss: 0 }
  const tieBreakers = competition.rules?.tieBreakers ?? []
  const bonus = competition.rules?.bonusPoints ?? null

  // Flatten recorded manual placements to teamId → position. Later overrides
  // win (they are appended chronologically by setPoolManualPlacement).
  const manualPos = {}
  for (const ov of manualOverrides ?? []) {
    for (const p of ov?.placements ?? []) {
      if (p && p.teamId != null && p.position != null) manualPos[p.teamId] = p.position
    }
  }

  const matchesMap = Array.isArray(matchesInput)
    ? Object.fromEntries(matchesInput.map(m => [m.id, m]))
    : (matchesInput ?? {})

  const confirmedMembers = (members ?? []).filter(m => CONFIRMED.has(m.status))
  const confirmedIds = new Set(confirmedMembers.map(m => m.teamId))

  const stats = {}
  const teamNames = {}
  const teamOrgNames = {}
  for (const m of confirmedMembers) {
    stats[m.teamId] = mkStats(m.teamId)
    teamNames[m.teamId] = m.displaySnapshot?.teamName ?? m.teamId
    teamOrgNames[m.teamId] = m.displaySnapshot?.orgName ?? null
  }

  let played = 0
  for (const fx of fixtures ?? []) {
    if (!fx.countsTowardStandings) continue
    const match = matchesMap[fx.matchId]
    if (!match) continue
    // The banner flag decides whether (and with what score) a fixture counts:
    // Awarded/Final count; Not-played/Frozen do not.
    const c = fixtureContribution(match)
    if (!c.standings) continue
    const hId = fx.homeTeamId ?? match.homeTeamId
    const aId = fx.awayTeamId ?? match.awayTeamId
    if (!confirmedIds.has(hId) || !confirmedIds.has(aId)) continue
    // Bonus points, like cards, count for genuinely-played results only — not
    // awarded (walkover / no-show) allocations with a default scoreline.
    applyResult(stats, hId, aId, c.home, c.away, pts, c.stats ? bonus : null)
    if (c.stats) applyCards(stats, hId, aId, match.cards)
    played++
  }

  const teams = confirmedMembers.map(m => ({ ...stats[m.teamId], teamName: teamNames[m.teamId], orgName: teamOrgNames[m.teamId] }))

  // Before ANY match has been played the table has no sporting order yet — the
  // points/tie-breaker calculation would just report every team as tied. Until
  // then, list teams ALPHABETICALLY (by full org + team label). The configured
  // scoring/tie-breaker system kicks in as soon as the first result is in.
  if (played === 0) {
    const labelOf = t => `${t.orgName ? t.orgName + ' ' : ''}${t.teamName ?? ''}`.trim().toLowerCase()
    const sorted = [...teams].sort((a, b) => labelOf(a).localeCompare(labelOf(b)))
    return {
      rows: sorted.map((team, i) => ({ pos: i + 1, ...team, manualDecisionRequired: false, clinched: false })),
      manualDecisionRequired: [],
    }
  }

  // ── Clinched-position detection (public "Provisional" badge) ────────────────
  // A team's final position is mathematically fixed when, for EVERY other team,
  // their relative order is already decided: the other team is guaranteed above
  // (its CURRENT points already exceed this team's MAXIMUM possible) or
  // guaranteed below (its maximum possible is already below this team's current
  // points). Strict inequalities, so no tie-breaker can flip an equal-points
  // pair. A team's own points can only rise, so its floor is its current Pts;
  // its ceiling is current Pts + (not-yet-final counting fixtures) × the most
  // points one match can yield (a win plus any stacking bonus). When no counting
  // fixture is left to play, every position is locked. Manual-decision rows are
  // never marked clinched — that tie is unresolved until an administrator places
  // it. The badge reads "provisional": only an owner/manager amendment (editing a
  // recorded result) can change it thereafter.
  const PENDING = new Set(['scheduled', 'upcoming', 'live', 'paused', 'awaiting_result'])
  const remaining = {}
  for (const id of confirmedIds) remaining[id] = 0
  for (const fx of fixtures ?? []) {
    if (!fx.countsTowardStandings) continue
    const match = matchesMap[fx.matchId]
    const hId = fx.homeTeamId ?? match?.homeTeamId
    const aId = fx.awayTeamId ?? match?.awayTeamId
    if (!confirmedIds.has(hId) || !confirmedIds.has(aId)) continue
    // Missing match = not scheduled yet; a pending status = still to be decided.
    // Terminal states (final, not-played, cancelled, abandoned) add no future
    // points, so they never count as remaining.
    if (!match || PENDING.has(match.status)) { remaining[hId]++; remaining[aId]++ }
  }
  const poolRemaining = Object.values(remaining).reduce((s, n) => s + n, 0)
  const maxBonusPerMatch = (bonus && bonus.enabled === true)
    ? ((bonus.rules?.scoreThreshold?.enabled ? (bonus.rules.scoreThreshold.points ?? 0) : 0)
       + (bonus.rules?.winMargin?.enabled ? (bonus.rules.winMargin.points ?? 0) : 0))
    : 0
  const maxPerMatch = (pts.win ?? 3) + maxBonusPerMatch
  const ptsById = {}
  const maxFinalById = {}
  for (const t of teams) {
    ptsById[t.teamId] = t.Pts
    maxFinalById[t.teamId] = t.Pts + (remaining[t.teamId] ?? 0) * maxPerMatch
  }
  const isClinched = (teamId) => {
    if (poolRemaining === 0) return true
    const maxT = maxFinalById[teamId]
    const ptsT = ptsById[teamId]
    for (const t of teams) {
      if (t.teamId === teamId) continue
      const guaranteedAbove = ptsById[t.teamId] > maxT
      const guaranteedBelow = maxFinalById[t.teamId] < ptsT
      if (!guaranteedAbove && !guaranteedBelow) return false
    }
    return true
  }

  const groups = sortGroup(teams, tieBreakers, fixtures ?? [], matchesMap, pts, bonus)

  const rows = []
  const manualDecisionRequired = []
  let pos = 1
  for (const group of groups) {
    if (group.manual) {
      // A recorded manual placement resolves the tie — but only when it covers
      // EVERY team in the group. A partial placement never silently orders
      // the remaining teams.
      const fullyPlaced = group.teams.length > 0
        && group.teams.every(t => manualPos[t.teamId] != null)
      if (fullyPlaced) {
        const ordered = [...group.teams].sort((a, b) => manualPos[a.teamId] - manualPos[b.teamId])
        for (const team of ordered) {
          rows.push({ pos, ...team, manualDecisionRequired: false, manuallyPlaced: true, clinched: isClinched(team.teamId) })
          pos++
        }
      } else {
        manualDecisionRequired.push({ pos, teamIds: group.teams.map(t => t.teamId) })
        for (const team of group.teams) {
          rows.push({ pos, ...team, manualDecisionRequired: true, clinched: false })
        }
        pos += group.teams.length
      }
    } else {
      for (const team of group.teams) {
        rows.push({ pos, ...team, manualDecisionRequired: false, clinched: isClinched(team.teamId) })
        pos++
      }
    }
  }

  return { rows, manualDecisionRequired }
}

// Compute pool standings — identical engine, restricted to the fixtures assigned
// to one pool AND to the teams assigned to that pool's slots. The caller passes
// only that pool's fixture-membership records plus poolTeamIds taken from
// pool.slots[].teamId — the single source of truth for pool membership
// (membership.poolId is a dead field and must not be used).
// Same eligibility and manual-decision guarantees as the full table.
export function computePoolStandings(competition, members, poolFixtures, matchesInput, {
  poolTeamIds = null, manualOverrides = [],
} = {}) {
  const scopedMembers = poolTeamIds
    ? (members ?? []).filter(m => poolTeamIds.includes(m.teamId))
    : (members ?? [])
  return computeStandings(competition, scopedMembers, poolFixtures, matchesInput, { manualOverrides })
}

// Festival informational stats — accumulation WITHOUT ranking. There is no
// position, no points-based sort, no winner. Rows are returned in the order the
// members were supplied (a stable, non-decisive order). This is deliberately
// NOT a standings table; the UI must label it as informational only.
export function computeFestivalStats(competition, members, fixtures, matchesInput) {
  const pts = competition.rules?.points ?? { win: 3, draw: 1, loss: 0 }
  const matchesMap = Array.isArray(matchesInput)
    ? Object.fromEntries(matchesInput.map(m => [m.id, m]))
    : (matchesInput ?? {})

  const confirmedMembers = (members ?? []).filter(m => CONFIRMED.has(m.status))
  const confirmedIds = new Set(confirmedMembers.map(m => m.teamId))

  const stats = {}
  const teamNames = {}
  const teamOrgNames = {}
  for (const m of confirmedMembers) {
    stats[m.teamId] = mkStats(m.teamId)
    teamNames[m.teamId] = m.displaySnapshot?.teamName ?? m.teamId
    teamOrgNames[m.teamId] = m.displaySnapshot?.orgName ?? null
  }

  for (const fx of fixtures ?? []) {
    // Festival fixtures are created with countsTowardStandings:false (no official
    // standings), but ALL final festival matches count for informational stats.
    const match = matchesMap[fx.matchId]
    if (!match || match.status !== 'final') continue
    const hId = fx.homeTeamId ?? match.homeTeamId
    const aId = fx.awayTeamId ?? match.awayTeamId
    if (!confirmedIds.has(hId) || !confirmedIds.has(aId)) continue
    // Same gating as the league table: awarded results count via their awarded
    // scoreline; voided results (abandoned/awarded-void) never contribute.
    const c = fixtureContribution(match)
    if (!c.standings) continue
    applyResult(stats, hId, aId, c.home, c.away, pts)
  }

  // No sort — preserve membership order. No position field. Informational only.
  return confirmedMembers.map(m => ({
    teamId: m.teamId,
    teamName: teamNames[m.teamId],
    orgName: teamOrgNames[m.teamId],
    P: stats[m.teamId].P, W: stats[m.teamId].W, D: stats[m.teamId].D, L: stats[m.teamId].L,
    GF: stats[m.teamId].GF, GA: stats[m.teamId].GA, GD: stats[m.teamId].GD,
  }))
}
