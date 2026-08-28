// Pure qualification-scenario computation for the knockout view — no Firebase.
//
// Once a pool reaches its LAST round (every team has at most one counting match
// left to play, and at least one is still to play), the playoff bracket shows,
// under each match fed by a pool position, which teams can still take that place
// and — in plain, sport-appropriate language — what each needs to do.
//
// computePoolQualificationScenarios(competition, rows, poolFixtures, matches)
//   → { finalRound: boolean, byPosition: { [pos]: { contested, candidates } } }
//
//   rows          the pool's already-computed standings rows (from
//                 computePoolStandings): each carries teamId, teamName, orgName,
//                 Pts and manualDecisionRequired.
//   candidates    [{ teamId, teamName, orgName, requirement }] — every team that
//                 could still finish in exactly this position, ordered by current
//                 points then name. `requirement` is a short human sentence.
//   contested     true when two or more teams can still take the place (so it is
//                 worth spelling out); a place with a single possible team is
//                 already settled and is left to the resolved-team display.
//
// Method: the remaining pool results are enumerated at win / draw / loss
// granularity (correct at the points level — the dominant last-round case).
// A team's reachable finishing positions in each outcome come from its points
// rank band (teams strictly above it are fixed above; teams level on points
// could sit either side, so the tie-breakers / goal difference decide within
// that band). Requirements are phrased conservatively: a claim that a result
// "secures" or "takes" a place is only made when every enumerated outcome with
// that result puts the team there outright; otherwise the sentence defers to
// "other results" and, when the place can only ever be reached level on points,
// to the goal / points difference. Bonus points, when the competition awards
// them, are noted but not enumerated — the conservative wording already covers
// the extra swing they introduce.

import { SPORT } from './sport.js'

const PENDING = new Set(['scheduled', 'upcoming', 'live', 'paused', 'awaiting_result'])

// Combinatorial ceiling. The last-round gate keeps the remaining-match count
// small (each team plays at most once), so this is never reached in practice;
// it only guards against a pathological pool definition.
const MAX_REMAINING = 12

function diffLabel() {
  return SPORT.scoreUnit === 'points' ? 'points difference' : 'goal difference'
}

export function computePoolQualificationScenarios(competition, rows, poolFixtures, matches) {
  const empty = { finalRound: false, byPosition: {} }
  const pts = competition?.rules?.points ?? { win: 3, draw: 1, loss: 0 }
  const winP = pts.win ?? 3, drawP = pts.draw ?? 1, lossP = pts.loss ?? 0

  const teams = (rows ?? [])
    .filter(r => r && r.teamId)
    .map(r => ({ teamId: r.teamId, teamName: r.teamName, orgName: r.orgName ?? null, cur: r.Pts ?? 0 }))
  const N = teams.length
  if (N === 0) return empty
  const teamSet = new Set(teams.map(t => t.teamId))

  // Remaining (still-to-play) pool matches with a known in-pool pairing.
  const remaining = []
  const remPerTeam = {}
  teams.forEach(t => { remPerTeam[t.teamId] = 0 })
  for (const fx of poolFixtures ?? []) {
    if (!fx.countsTowardStandings) continue
    const m = matches?.[fx.matchId]
    if (!m || !PENDING.has(m.status)) continue
    const hId = fx.homeTeamId ?? m.homeTeamId
    const aId = fx.awayTeamId ?? m.awayTeamId
    if (!teamSet.has(hId) || !teamSet.has(aId)) continue
    remaining.push({ homeId: hId, awayId: aId })
    remPerTeam[hId]++; remPerTeam[aId]++
  }
  const maxRem = Math.max(0, ...Object.values(remPerTeam))
  // Only the last round: every team at most one match left, at least one to play.
  if (maxRem !== 1) return empty
  const n = remaining.length
  if (n === 0 || n > MAX_REMAINING) return empty

  // Per team → per position: reachability, whether it is ever the sole occupant
  // on points (otherwise the place is only ever reached level on points), and
  // through which of its own results. ownCombos counts, per team, how many
  // enumerated outcomes give it each own result (win / draw / loss / none).
  const acc = {}
  const ownCombos = {}
  for (const t of teams) { acc[t.teamId] = {}; ownCombos[t.teamId] = { win: 0, draw: 0, loss: 0, none: 0 } }

  const total = 3 ** n
  for (let combo = 0; combo < total; combo++) {
    const finalPts = {}
    const own = {}
    for (const t of teams) { finalPts[t.teamId] = t.cur; own[t.teamId] = 'none' }
    let c = combo
    for (let i = 0; i < n; i++) {
      const d = c % 3; c = (c - d) / 3
      const { homeId, awayId } = remaining[i]
      if (d === 0)      { finalPts[homeId] += winP;  finalPts[awayId] += lossP; own[homeId] = 'win';  own[awayId] = 'loss' }
      else if (d === 1) { finalPts[homeId] += drawP; finalPts[awayId] += drawP; own[homeId] = 'draw'; own[awayId] = 'draw' }
      else              { finalPts[homeId] += lossP; finalPts[awayId] += winP;  own[homeId] = 'loss'; own[awayId] = 'win' }
    }
    for (const t of teams) ownCombos[t.teamId][own[t.teamId]]++
    for (const t of teams) {
      const fp = finalPts[t.teamId]
      let better = 0, equal = 0
      for (const u of teams) {
        if (u.teamId === t.teamId) continue
        if (finalPts[u.teamId] > fp) better++
        else if (finalPts[u.teamId] === fp) equal++
      }
      const lo = better + 1, hi = better + equal + 1
      const sole = lo === hi
      const a = acc[t.teamId]
      const o = own[t.teamId]
      for (let P = lo; P <= hi; P++) {
        if (!a[P]) a[P] = { reach: false, sole: false, own: new Set(), ownSole: { win: 0, draw: 0, loss: 0, none: 0 } }
        a[P].reach = true
        a[P].own.add(o)
        if (sole && P === lo) { a[P].sole = true; a[P].ownSole[o]++ }
      }
    }
  }

  const bonusNote = competition?.rules?.bonusPoints?.enabled === true
  const byPosition = {}
  for (let P = 1; P <= N; P++) {
    const candidates = teams
      .filter(t => acc[t.teamId][P]?.reach)
      .sort((a, b) => (b.cur - a.cur) || `${a.orgName ?? ''} ${a.teamName ?? ''}`.localeCompare(`${b.orgName ?? ''} ${b.teamName ?? ''}`))
      .map(t => {
        const reach = acc[t.teamId][P]
        const oc = ownCombos[t.teamId]
        const plays = oc.win + oc.draw + oc.loss > 0
        // A result "guarantees" this exact place only when every enumerated
        // outcome carrying that result leaves the team its sole occupant on
        // points (so no tie-breaker is needed).
        const guarantees = o => oc[o] > 0 && reach.ownSole[o] === oc[o]
        const requirement = phraseRequirement({
          canWin: reach.own.has('win'),
          canDraw: reach.own.has('draw'),
          winGuar: guarantees('win'),
          drawGuar: guarantees('draw'),
          neverSole: !reach.sole,
          plays,
          bonusNote,
        })
        return { teamId: t.teamId, teamName: t.teamName, orgName: t.orgName, requirement }
      })
    byPosition[P] = { contested: candidates.length >= 2, candidates }
  }
  return { finalRound: true, byPosition }
}

// Build one short, conservative sentence for a candidate. `neverSole` means the
// place can only ever be reached level on points, so the tie-breakers / goal
// difference are what actually decide it — said only when it is not already
// obvious from a "depends on other results" clause.
function phraseRequirement({ canWin, canDraw, winGuar, drawGuar, neverSole, plays, bonusNote }) {
  const gd = neverSole ? ` — could come down to ${diffLabel()}` : ''
  const bonus = bonusNote ? ' (bonus points may shift this)' : ''
  // A guaranteeing result is stated on its own — it is sufficient, so no hedge.
  // The draw guarantee is checked first because it is the easier requirement to
  // meet; a win is only quoted as the guarantee when a draw would not be enough.
  // Neither guarantee claims anything about the OTHER result (for a lower place
  // a win can lift a team out of it), so each names only the sufficient result.
  if (!plays) return `Relies on the other result${gd}${bonus}`
  if (drawGuar) return `A draw is enough for this place`
  if (winGuar) return `Takes this place with a win`
  if (canWin && canDraw) return `A win — or a draw if other results go their way${gd}${bonus}`
  if (canWin) return `Must win, then depends on other results${gd}${bonus}`
  if (canDraw) return `A draw could be enough, depending on other results${gd}${bonus}`
  return `Still in contention, depending on other results${gd}${bonus}`
}
