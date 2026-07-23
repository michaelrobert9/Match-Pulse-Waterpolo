// Deterministic tests for pool standings, festival stats, and knockout
// advancement resolution. Pure logic — no Firebase.
// Run: node scripts/test-competition-logic.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePoolStandings, computeFestivalStats } from '../src/lib/standings.js'
import {
  computeBestPlacedAtPosition, resolveSlot, resolveBracket,
  knockoutResult, formatScoreline, SLOT_STATUS,
} from '../src/lib/competitionStructure.js'

const POINTS = { win: 3, draw: 1, loss: 0 }
const TIE_BREAKERS = [
  { key: 'points',              direction: 'desc' },
  { key: 'headToHeadMiniTable', direction: 'desc' },
  { key: 'goalDifference',      direction: 'desc' },
  { key: 'goalsFor',            direction: 'desc' },
  { key: 'manualDecision',      direction: null   },
]
const comp = () => ({ id: 'c1', rules: { points: POINTS, tieBreakers: TIE_BREAKERS } })
const member = (teamId, status = 'accepted') => ({ teamId, status, displaySnapshot: { teamName: teamId } })
const match = (id, h, a, hs, as, status = 'final', extra = {}) =>
  ({ id, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, status, cards: [], ...extra })
const fixture = (matchId, h, a, counts = true) =>
  ({ matchId, homeTeamId: h, awayTeamId: a, countsTowardStandings: counts })
const row = (res, t) => res.rows.find(r => r.teamId === t)

// ── Pool standings ────────────────────────────────────────────────────────

test('Pool standings: only that pool\'s fixtures count', () => {
  // Pool A fixtures only. A beats B in pool A.
  const res = computePoolStandings(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B')],
    [match('m1', 'A', 'B', 3, 1)],
  )
  assert.equal(row(res, 'A').Pts, 3)
  assert.equal(row(res, 'A').pos, 1)
  assert.equal(row(res, 'B').Pts, 0)
  assert.equal(res.manualDecisionRequired.length, 0)
})

test('Pool standings: pending team is ignored', () => {
  const res = computePoolStandings(
    comp(),
    [member('A'), member('P', 'invited')],
    [fixture('m1', 'A', 'P')],
    [match('m1', 'A', 'P', 5, 0)],
  )
  assert.equal(row(res, 'P'), undefined)
  assert.equal(row(res, 'A').P, 0)
})

test('Pool standings: countsTowardStandings=false ignored', () => {
  const res = computePoolStandings(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B', false)],
    [match('m1', 'A', 'B', 4, 0)],
  )
  assert.equal(row(res, 'A').P, 0)
  assert.equal(row(res, 'B').P, 0)
})

test('Pool standings: shootout does NOT change a pool draw', () => {
  // Drawn regulation 2-2 with a shootout — pool treats it as a draw, 1pt each,
  // and GF/GA reflect only regulation goals.
  const res = computePoolStandings(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B')],
    [match('m1', 'A', 'B', 2, 2, 'final', { shootoutHome: 4, shootoutAway: 3 })],
  )
  assert.equal(row(res, 'A').Pts, 1); assert.equal(row(res, 'A').D, 1)
  assert.equal(row(res, 'B').Pts, 1); assert.equal(row(res, 'B').D, 1)
  assert.equal(row(res, 'A').GF, 2); assert.equal(row(res, 'A').GA, 2)
})

test('Pool standings: unresolved tie flags MANUAL DECISION REQUIRED', () => {
  const res = computePoolStandings(
    comp(),
    [member('A'), member('B'), member('C'), member('D')],
    [fixture('m1', 'A', 'C'), fixture('m2', 'B', 'D')],
    [match('m1', 'A', 'C', 2, 1), match('m2', 'B', 'D', 2, 1)],
  )
  assert.equal(row(res, 'A').pos, row(res, 'B').pos)
  assert.equal(row(res, 'A').manualDecisionRequired, true)
  const grp = res.manualDecisionRequired.find(g => g.teamIds.includes('A') && g.teamIds.includes('B'))
  assert.ok(grp)
})

test('Pool standings: include ONLY teams assigned to the pool slots', () => {
  // E is a confirmed competition member but is NOT in this pool's slots —
  // it must not appear in the pool table, even with zero games.
  const res = computePoolStandings(
    comp(),
    [member('A'), member('B'), member('E')],
    [fixture('m1', 'A', 'B')],
    [match('m1', 'A', 'B', 1, 0)],
    { poolTeamIds: ['A', 'B'] },
  )
  assert.equal(row(res, 'E'), undefined)
  assert.equal(res.rows.length, 2)
  assert.equal(row(res, 'A').pos, 1)
})

test('Pool standings: non-final fixtures are excluded', () => {
  // m1 is final, m2 is live — only m1 may count.
  const res = computePoolStandings(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B'), fixture('m2', 'B', 'A')],
    [match('m1', 'A', 'B', 2, 0), match('m2', 'B', 'A', 9, 0, 'live')],
    { poolTeamIds: ['A', 'B'] },
  )
  assert.equal(row(res, 'A').P, 1)
  assert.equal(row(res, 'B').P, 1)
  assert.equal(row(res, 'B').GF, 0)          // live goals never counted
  assert.equal(row(res, 'A').Pts, 3)
})

test('Manual placement: resolves a tied pool and clears the flag', () => {
  // A and B are indistinguishable (identical results vs different opponents).
  const members = [member('A'), member('B'), member('C'), member('D')]
  const fixtures = [fixture('m1', 'A', 'C'), fixture('m2', 'B', 'D')]
  const matches = [match('m1', 'A', 'C', 2, 1), match('m2', 'B', 'D', 2, 1)]

  // Without a placement: manual decision required.
  const before = computePoolStandings(comp(), members, fixtures, matches, {
    poolTeamIds: ['A', 'B', 'C', 'D'],
  })
  assert.equal(before.manualDecisionRequired.length > 0, true)

  // Both {A,B} and {C,D} are tied groups. With recorded placements covering
  // every tied team: resolved in the recorded order, flag fully cleared.
  const after = computePoolStandings(comp(), members, fixtures, matches, {
    poolTeamIds: ['A', 'B', 'C', 'D'],
    manualOverrides: [{
      placements: [
        { teamId: 'B', position: 1 }, { teamId: 'A', position: 2 },
        { teamId: 'D', position: 3 }, { teamId: 'C', position: 4 },
      ],
      reason: 'Coin toss per regulation 4.2',
    }],
  })
  assert.equal(after.manualDecisionRequired.length, 0)
  assert.equal(row(after, 'B').pos, 1)
  assert.equal(row(after, 'A').pos, 2)
  assert.equal(row(after, 'B').manualDecisionRequired, false)
  assert.equal(row(after, 'B').manuallyPlaced, true)
  assert.equal(row(after, 'A').manuallyPlaced, true)
})

test('Manual placement: a PARTIAL placement never silently orders the rest', () => {
  const members = [member('A'), member('B'), member('C'), member('D')]
  const fixtures = [fixture('m1', 'A', 'C'), fixture('m2', 'B', 'D')]
  const matches = [match('m1', 'A', 'C', 2, 1), match('m2', 'B', 'D', 2, 1)]
  // Placement covers only A — the tied group {A,B} is NOT resolved.
  const res = computePoolStandings(comp(), members, fixtures, matches, {
    poolTeamIds: ['A', 'B', 'C', 'D'],
    manualOverrides: [{ placements: [{ teamId: 'A', position: 1 }] }],
  })
  assert.equal(res.manualDecisionRequired.length > 0, true)
  assert.equal(row(res, 'A').manualDecisionRequired, true)
})

test('Verified snapshot payload stores the resolved manual order', () => {
  // The verify flow snapshots exactly the rows the engine produced. After a
  // manual placement resolves the tie, those rows ARE the resolved order —
  // verification must be possible and the snapshot must carry it.
  const members = [member('A'), member('B'), member('C'), member('D')]
  const fixtures = [fixture('m1', 'A', 'C'), fixture('m2', 'B', 'D')]
  const matches = [match('m1', 'A', 'C', 2, 1), match('m2', 'B', 'D', 2, 1)]
  const manualOverrides = [{
    placements: [
      { teamId: 'B', position: 1 }, { teamId: 'A', position: 2 },
      { teamId: 'C', position: 3 }, { teamId: 'D', position: 4 },
    ],
    reason: 'Coin toss',
  }]

  const standings = computePoolStandings(comp(), members, fixtures, matches, {
    poolTeamIds: ['A', 'B', 'C', 'D'], manualOverrides,
  })
  // Gate that handleVerify enforces: no unresolved ties → verification allowed.
  assert.equal(standings.manualDecisionRequired.length, 0)

  // Snapshot payload as built by handleVerify ({ rows, manualOverrides, … }).
  const snapshotPayload = { rows: standings.rows, manualOverrides }
  assert.deepEqual(snapshotPayload.rows.map(r => r.teamId), ['B', 'A', 'C', 'D'])
  assert.equal(snapshotPayload.rows[0].manuallyPlaced, true)
  assert.equal(snapshotPayload.manualOverrides[0].reason, 'Coin toss')
})

// ── Festival stats (informational, not ranked) ─────────────────────────────

test('Festival stats: rows in membership order, NO position, NO points/sort', () => {
  // B clearly outscores A, but festival output must NOT reorder by performance.
  const stats = computeFestivalStats(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B')],
    [match('m1', 'A', 'B', 0, 9)],
  )
  assert.deepEqual(stats.map(s => s.teamId), ['A', 'B'])      // membership order preserved
  assert.equal(stats[0].pos, undefined)                        // no position column
  assert.equal(stats[0].Pts, undefined)                        // no points
  assert.equal(stats[1].GF, 9)                                 // stats still accumulate
  assert.equal(stats[0].GA, 9)
})

// ── Knockout: scoreline + result derivation ────────────────────────────────

test('formatScoreline: plain and shootout forms', () => {
  assert.equal(formatScoreline({ homeScore: 3, awayScore: 1 }), '3–1')
  assert.equal(formatScoreline({ homeScore: 2, awayScore: 2, shootoutHome: 4, shootoutAway: 3 }), '2–2 (4–3 SO)')
})

test('knockoutResult: shootout decides a drawn knockout match', () => {
  assert.deepEqual(
    knockoutResult(match('k1', 'A', 'B', 2, 2, 'final', { shootoutHome: 4, shootoutAway: 3 })),
    { winnerTeamId: 'A', loserTeamId: 'B' },
  )
  assert.deepEqual(
    knockoutResult(match('k2', 'A', 'B', 0, 1, 'final')),
    { winnerTeamId: 'B', loserTeamId: 'A' },
  )
  // Genuine draw with no shootout → undecided (never invent a winner).
  assert.equal(knockoutResult(match('k3', 'A', 'B', 1, 1, 'final')), null)
  assert.equal(knockoutResult(match('k4', 'A', 'B', 1, 1, 'live')), null)
})

// ── Advancement source resolution ──────────────────────────────────────────

const poolRows = (...ids) => ids.map((teamId, i) => ({ pos: i + 1, teamId, manualDecisionRequired: false }))

test('resolveSlot: direct_team and manual_selection', () => {
  assert.equal(resolveSlot({ slotId: 's', source: { type: 'direct_team', teamId: 'A' } }).teamId, 'A')
  assert.equal(resolveSlot({ slotId: 's', source: { type: 'direct_team' } }).status, SLOT_STATUS.unresolved)
  assert.equal(
    resolveSlot({ slotId: 's', source: { type: 'manual_selection' } }, { manualSelections: { s: 'Z' } }).teamId,
    'Z',
  )
})

test('resolveSlot: pool_position is provisional until verified, resolved after', () => {
  const provisional = resolveSlot(
    { slotId: 's', source: { type: 'pool_position', poolId: 'PA', position: 1 } },
    { pools: { PA: { rows: poolRows('A', 'B'), verified: false } } },
  )
  assert.equal(provisional.teamId, 'A')
  assert.equal(provisional.status, SLOT_STATUS.provisional)

  const resolved = resolveSlot(
    { slotId: 's', source: { type: 'pool_position', poolId: 'PA', position: 1 } },
    { pools: { PA: { rows: poolRows('A', 'B'), verified: true } } },
  )
  assert.equal(resolved.status, SLOT_STATUS.resolved)
})

test('resolveSlot: pool_position on a tied row requires manual decision', () => {
  const tiedRows = [{ pos: 1, teamId: 'A', manualDecisionRequired: true }]
  const res = resolveSlot(
    { slotId: 's', source: { type: 'pool_position', poolId: 'PA', position: 1 } },
    { pools: { PA: { rows: tiedRows, verified: false } } },
  )
  assert.equal(res.status, SLOT_STATUS.manual_required)
  assert.equal(res.teamId, null)
})

test('resolveSlot: bracket_winner / bracket_loser from match results', () => {
  const ctx = { bracketResults: { SF1: { winnerTeamId: 'A', loserTeamId: 'B' } } }
  assert.equal(resolveSlot({ slotId: 'f', source: { type: 'bracket_winner', matchSlotId: 'SF1' } }, ctx).teamId, 'A')
  assert.equal(resolveSlot({ slotId: '3p', source: { type: 'bracket_loser', matchSlotId: 'SF1' } }, ctx).teamId, 'B')
  // Source match not decided → unresolved.
  assert.equal(
    resolveSlot({ slotId: 'f', source: { type: 'bracket_winner', matchSlotId: 'SF2' } }, ctx).status,
    SLOT_STATUS.unresolved,
  )
})

test('resolveSlot: locked advancement overrides everything', () => {
  const res = resolveSlot(
    { slotId: 's', source: { type: 'pool_position', poolId: 'PA', position: 1 } },
    { pools: { PA: { rows: poolRows('A'), verified: false } }, lockedTeams: { s: 'LOCKED' } },
  )
  assert.equal(res.teamId, 'LOCKED')
  assert.equal(res.status, SLOT_STATUS.resolved)
  assert.equal(res.locked, true)
})

// ── Best runner-up cross-pool ranking ──────────────────────────────────────

test('computeBestPlacedAtPosition: ranks runners-up by chain, resolves cleanly', () => {
  // Runner-up of A has 6pts, runner-up of B has 3pts → A's runner-up ranks first.
  const pools = [
    { poolId: 'PA', verified: true, rows: [
      { pos: 1, teamId: 'A1', Pts: 9 }, { pos: 2, teamId: 'A2', Pts: 6, GD: 2, GF: 5 },
    ] },
    { poolId: 'PB', verified: true, rows: [
      { pos: 1, teamId: 'B1', Pts: 9 }, { pos: 2, teamId: 'B2', Pts: 3, GD: 1, GF: 4 },
    ] },
  ]
  const { ranked, manualRequired, allVerified } = computeBestPlacedAtPosition(pools, 2, TIE_BREAKERS)
  assert.deepEqual(ranked.map(r => r.teamId), ['A2', 'B2'])
  assert.equal(manualRequired.length, 0)
  assert.equal(allVerified, true)
})

test('computeBestPlacedAtPosition: indistinguishable runners-up → manual required', () => {
  const pools = [
    { poolId: 'PA', verified: true, rows: [{ pos: 1, teamId: 'A1' }, { pos: 2, teamId: 'A2', Pts: 4, GD: 1, GF: 3 }] },
    { poolId: 'PB', verified: true, rows: [{ pos: 1, teamId: 'B1' }, { pos: 2, teamId: 'B2', Pts: 4, GD: 1, GF: 3 }] },
  ]
  const { manualRequired } = computeBestPlacedAtPosition(pools, 2, TIE_BREAKERS)
  assert.equal(manualRequired.length, 1)
  assert.deepEqual(manualRequired[0].sort(), ['A2', 'B2'])
})

test('resolveSlot: best_runner_up provisional until all pools verified', () => {
  const pools = [
    { poolId: 'PA', verified: true,  rows: [{ pos: 1, teamId: 'A1' }, { pos: 2, teamId: 'A2', Pts: 6 }] },
    { poolId: 'PB', verified: false, rows: [{ pos: 1, teamId: 'B1' }, { pos: 2, teamId: 'B2', Pts: 3 }] },
  ]
  const bestPlaced = { 2: computeBestPlacedAtPosition(pools, 2, TIE_BREAKERS) }
  const res = resolveSlot({ slotId: 's', source: { type: 'best_runner_up', position: 2, rank: 1 } }, { bestPlaced })
  assert.equal(res.teamId, 'A2')
  assert.equal(res.status, SLOT_STATUS.provisional)   // PB not verified
})

test('bracket_winner resolves once a matchId is linked to the source slot', () => {
  // Mirrors the UI flow: SF1 has a linked matchId whose match is final; the
  // final's home slot sources bracket_winner from SF1.
  const slots = [
    { slotId: 'SF1', matchId: 'm-sf1', source: { type: 'direct_team', teamId: 'A' } },
    { slotId: 'F-h', source: { type: 'bracket_winner', matchSlotId: 'SF1' } },
  ]
  const matches = { 'm-sf1': match('m-sf1', 'A', 'B', 2, 1) }

  // Before linking: no bracketResults → unresolved.
  assert.equal(resolveSlot(slots[1], { bracketResults: {} }).status, SLOT_STATUS.unresolved)

  // After linking: derive results from each slot's linked match (as the
  // knockout panel does) and the winner resolves.
  const bracketResults = {}
  for (const s of slots) {
    if (s.matchId && matches[s.matchId]) {
      const r = knockoutResult(matches[s.matchId])
      if (r) bracketResults[s.slotId] = r
    }
  }
  const res = resolveSlot(slots[1], { bracketResults })
  assert.equal(res.teamId, 'A')
  assert.equal(res.status, SLOT_STATUS.resolved)
})

test('bracket_loser resolves once a matchId is linked to the source slot', () => {
  const slots = [
    { slotId: 'SF1', matchId: 'm-sf1', source: { type: 'direct_team', teamId: 'A' } },
    { slotId: '3P-h', source: { type: 'bracket_loser', matchSlotId: 'SF1' } },
  ]
  const matches = { 'm-sf1': match('m-sf1', 'A', 'B', 2, 1) }

  assert.equal(resolveSlot(slots[1], { bracketResults: {} }).status, SLOT_STATUS.unresolved)

  const bracketResults = {}
  for (const s of slots) {
    if (s.matchId && matches[s.matchId]) {
      const r = knockoutResult(matches[s.matchId])
      if (r) bracketResults[s.slotId] = r
    }
  }
  const res = resolveSlot(slots[1], { bracketResults })
  assert.equal(res.teamId, 'B')
  assert.equal(res.status, SLOT_STATUS.resolved)
})

test('resolveBracket: resolves every slot in a structure', () => {
  const slots = [
    { slotId: 'SF1-h', source: { type: 'pool_position', poolId: 'PA', position: 1 } },
    { slotId: 'F-h',   source: { type: 'bracket_winner', matchSlotId: 'SF1' } },
  ]
  const ctx = {
    pools: { PA: { rows: poolRows('A', 'B'), verified: true } },
    bracketResults: { SF1: { winnerTeamId: 'A', loserTeamId: 'B' } },
  }
  const out = resolveBracket(slots, ctx)
  assert.equal(out['SF1-h'].teamId, 'A')
  assert.equal(out['F-h'].teamId, 'A')
})
