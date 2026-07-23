// Deterministic unit tests for src/lib/standings.js
// Run: node scripts/test-standings.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeStandings } from '../src/lib/standings.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const POINTS = { win: 3, draw: 1, loss: 0 }

const TIE_BREAKERS = [
  { key: 'points',              direction: 'desc' },
  { key: 'headToHeadMiniTable', direction: 'desc' },
  { key: 'goalDifference',      direction: 'desc' },
  { key: 'goalsFor',            direction: 'desc' },
  { key: 'goalsAgainst',        direction: 'asc'  },
  { key: 'wins',                direction: 'desc' },
  { key: 'manualDecision',      direction: null   },
]

const comp = (tbs = TIE_BREAKERS) =>
  ({ id: 'c1', rules: { points: POINTS, tieBreakers: tbs } })

const member = (teamId, status = 'accepted') =>
  ({ teamId, status, displaySnapshot: { teamName: teamId } })

// Final match between two teams.
const match = (id, homeId, awayId, homeScore, awayScore, status = 'final') =>
  ({ id, homeTeamId: homeId, awayTeamId: awayId, homeScore, awayScore, status, cards: [] })

// Fixture-membership join record.
const fixture = (matchId, homeId, awayId, counts = true) =>
  ({ matchId, homeTeamId: homeId, awayTeamId: awayId, countsTowardStandings: counts })

const row = (res, teamId) => res.rows.find(r => r.teamId === teamId)

// ── Tests ──────────────────────────────────────────────────────────────────

test('1. A beats B: A gets 3pts/1W, B gets 0pts/1L; A ranked above B', () => {
  const res = computeStandings(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B')],
    [match('m1', 'A', 'B', 2, 0)],
  )
  const A = row(res, 'A'), B = row(res, 'B')
  assert.equal(A.Pts, 3);  assert.equal(A.W, 1); assert.equal(A.L, 0)
  assert.equal(A.GF, 2);   assert.equal(A.GA, 0); assert.equal(A.GD, 2)
  assert.equal(B.Pts, 0);  assert.equal(B.W, 0); assert.equal(B.L, 1)
  assert.equal(B.GF, 0);   assert.equal(B.GA, 2); assert.equal(B.GD, -2)
  assert.equal(A.pos, 1);  assert.equal(B.pos, 2)
  assert.equal(res.manualDecisionRequired.length, 0)
})

test('2. C draws D: both 1pt, P=1 D=1, GD=0', () => {
  const res = computeStandings(
    comp(),
    [member('C'), member('D')],
    [fixture('m1', 'C', 'D')],
    [match('m1', 'C', 'D', 1, 1)],
  )
  const C = row(res, 'C'), D = row(res, 'D')
  assert.equal(C.Pts, 1); assert.equal(C.D, 1); assert.equal(C.GD, 0)
  assert.equal(D.Pts, 1); assert.equal(D.D, 1); assert.equal(D.GD, 0)
  assert.equal(C.P, 1);   assert.equal(D.P, 1)
})

test('3. Only accepted + admin_approved teams appear in standings', () => {
  const res = computeStandings(
    comp(),
    [
      member('A', 'accepted'),
      member('B', 'admin_approved'),
      member('X', 'declined'),
      member('Y', 'withdrawn'),
      member('Z', 'invited'),
    ],
    [], [],
  )
  const ids = res.rows.map(r => r.teamId).sort()
  assert.deepEqual(ids, ['A', 'B'])
  assert.equal(res.rows.find(r => r.teamId === 'X'), undefined)
  assert.equal(res.rows.find(r => r.teamId === 'Z'), undefined)
})

test('4. Fixture involving a pending (invited) team is ignored', () => {
  const res = computeStandings(
    comp(),
    [member('A', 'accepted'), member('P', 'invited')],
    [fixture('m1', 'A', 'P')],
    [match('m1', 'A', 'P', 5, 0)],
  )
  // Pending team P must not appear at all.
  assert.equal(row(res, 'P'), undefined)
  // A is a confirmed member but its opponent is pending — result must be ignored.
  const A = row(res, 'A')
  assert.equal(A.P, 0)
  assert.equal(A.Pts, 0)
  assert.equal(A.GF, 0)
})

test('5. countsTowardStandings=false fixture is excluded', () => {
  const res = computeStandings(
    comp(),
    [member('A'), member('B')],
    [fixture('m1', 'A', 'B', /* counts= */ false)],
    [match('m1', 'A', 'B', 4, 0)],
  )
  const A = row(res, 'A'), B = row(res, 'B')
  assert.equal(A.P, 0); assert.equal(A.Pts, 0)
  assert.equal(B.P, 0); assert.equal(B.Pts, 0)
})

test('6. Equal points separated by goal difference: better GD ranks higher', () => {
  // A and B both beat C (3pts each), but A wins by a bigger margin.
  // H2H does not apply (A and B never played each other), so GD decides.
  const res = computeStandings(
    comp(),
    [member('A'), member('B'), member('C')],
    [fixture('m1', 'A', 'C'), fixture('m2', 'B', 'C')],
    [
      match('m1', 'A', 'C', 5, 0),  // A: GD +5
      match('m2', 'B', 'C', 1, 0),  // B: GD +1
    ],
  )
  const A = row(res, 'A'), B = row(res, 'B')
  assert.equal(A.Pts, 3); assert.equal(B.Pts, 3)
  assert.equal(A.GD, 5);  assert.equal(B.GD, 1)
  assert.equal(A.pos, 1); assert.equal(B.pos, 2)
  assert.equal(res.manualDecisionRequired.length, 0)
})

test('7. Points-tied cluster resolved by head-to-head mini-table', () => {
  // A beats B, D beats A, B beats C.
  // A, B, D all finish on 3pts — enter the H2H mini-table.
  // H2H results among {A,B,D}: D beat A, A beat B → strict order D > A > B.
  // Engine must produce D=1st, A=2nd, B=3rd with no manual decision.
  const res = computeStandings(
    comp(),
    [member('A'), member('B'), member('C'), member('D')],
    [fixture('m1', 'A', 'B'), fixture('m2', 'D', 'A'), fixture('m3', 'B', 'C')],
    [
      match('m1', 'A', 'B', 1, 0),  // A beats B
      match('m2', 'D', 'A', 1, 0),  // D beats A
      match('m3', 'B', 'C', 1, 0),  // B beats C
    ],
  )
  const A = row(res, 'A'), B = row(res, 'B'), D = row(res, 'D')
  // Confirm all three are level on raw points.
  assert.equal(A.Pts, 3); assert.equal(B.Pts, 3); assert.equal(D.Pts, 3)
  // H2H order: D > A > B.
  assert.equal(D.pos, 1); assert.equal(A.pos, 2); assert.equal(B.pos, 3)
  assert.ok(A.pos < B.pos, 'A should rank above B (A beat B head-to-head)')
  assert.ok(D.pos < A.pos, 'D should rank above A (D beat A head-to-head)')
  // Fully separated — no manual decision.
  assert.equal(res.manualDecisionRequired.length, 0)
})

test('8. Tie-breakers exhausted: MANUAL DECISION REQUIRED flagged, no ordering invented', () => {
  // A and B are statistically identical and never played each other.
  // All numeric tie-breakers are equal; H2H is a wash (no result between them);
  // the chain reaches manualDecision → engine must stop and flag the tie.
  const res = computeStandings(
    comp(),
    [member('A'), member('B'), member('C'), member('D')],
    [fixture('m1', 'A', 'C'), fixture('m2', 'B', 'D')],
    [
      match('m1', 'A', 'C', 2, 1),  // A: 3pts, GF=2, GA=1, GD=+1, W=1
      match('m2', 'B', 'D', 2, 1),  // B: identical stats
    ],
  )
  const A = row(res, 'A'), B = row(res, 'B')
  // A and B are statistically identical.
  assert.equal(A.Pts, B.Pts)
  assert.equal(A.GD,  B.GD)
  assert.equal(A.GF,  B.GF)
  assert.equal(A.GA,  B.GA)
  assert.equal(A.W,   B.W)
  // They share the same position (tie unresolved — no invented order).
  assert.equal(A.pos, B.pos)
  // Both are explicitly flagged as requiring manual decision.
  assert.equal(A.manualDecisionRequired, true)
  assert.equal(B.manualDecisionRequired, true)
  // A manual-decision group containing both A and B must be reported.
  const grp = res.manualDecisionRequired.find(
    g => g.teamIds.includes('A') && g.teamIds.includes('B')
  )
  assert.ok(grp, 'expected manualDecisionRequired group with A and B')
  assert.equal(grp.teamIds.length, 2)
})
