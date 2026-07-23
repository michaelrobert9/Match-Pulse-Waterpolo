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

// Fair play: yellow=1pt, red=3pts. Lower score is better (direction: 'asc').
const FAIR_PLAY_WEIGHTS = { yellow: 1, red: 3 }

function mkStats(teamId) {
  return { teamId, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0, fairPlayScore: 0 }
}

function applyResult(stats, homeId, awayId, homeGoals, awayGoals, pts) {
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
function computeH2HStats(group, fixtures, matches, pts) {
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
    const hg = match.homeScore ?? 0
    const ag = match.awayScore ?? 0
    h2h[hId].GF += hg; h2h[hId].GA += ag; h2h[hId].GD = h2h[hId].GF - h2h[hId].GA
    h2h[aId].GF += ag; h2h[aId].GA += hg; h2h[aId].GD = h2h[aId].GF - h2h[aId].GA
    if (hg > ag)      { h2h[hId].Pts += pts.win ?? 3;  h2h[aId].Pts += pts.loss ?? 0 }
    else if (ag > hg) { h2h[hId].Pts += pts.loss ?? 0; h2h[aId].Pts += pts.win ?? 3 }
    else              { h2h[hId].Pts += pts.draw ?? 1;  h2h[aId].Pts += pts.draw ?? 1 }
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
function sortGroup(group, tieBreakers, fixtures, matches, pts) {
  if (group.length <= 1) return [{ teams: group, manual: false }]
  if (tieBreakers.length === 0) return [{ teams: group, manual: true }]

  const [tb, ...rest] = tieBreakers

  if (tb.key === 'manualDecision') return [{ teams: group, manual: true }]

  if (tb.key === 'headToHeadMiniTable') {
    const h2hRows = computeH2HStats(group, fixtures, matches, pts)
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
      g => sortGroup(g, rest, fixtures, matches, pts),
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
    g => sortGroup(g, rest, fixtures, matches, pts),
  )
}

export function computeStandings(competition, members, fixtures, matchesInput, { manualOverrides = [] } = {}) {
  const pts = competition.rules?.points ?? { win: 3, draw: 1, loss: 0 }
  const tieBreakers = competition.rules?.tieBreakers ?? []

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
    applyResult(stats, hId, aId, c.home, c.away, pts)
    // Cards apply for genuinely-played results only (not awarded allocations).
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
      rows: sorted.map((team, i) => ({ pos: i + 1, ...team, manualDecisionRequired: false })),
      manualDecisionRequired: [],
    }
  }

  const groups = sortGroup(teams, tieBreakers, fixtures ?? [], matchesMap, pts)

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
          rows.push({ pos, ...team, manualDecisionRequired: false, manuallyPlaced: true })
          pos++
        }
      } else {
        manualDecisionRequired.push({ pos, teamIds: group.teams.map(t => t.teamId) })
        for (const team of group.teams) {
          rows.push({ pos, ...team, manualDecisionRequired: true })
        }
        pos += group.teams.length
      }
    } else {
      for (const team of group.teams) {
        rows.push({ pos, ...team, manualDecisionRequired: false })
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
    applyResult(stats, hId, aId, match.homeScore ?? 0, match.awayScore ?? 0, pts)
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
