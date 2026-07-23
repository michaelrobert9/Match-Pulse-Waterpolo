// Firestore rules behavioural test for the competition system.
//
// Run against the emulator:
//   firebase emulators:exec --only firestore --project demo-matchpulse \
//     'node scripts/test-firestore-rules.mjs'
//
// Verifies the single Competition Administrator model, team-side invite
// acceptance authority, create-only audit/snapshots, and published-gating.

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
} from 'firebase/firestore'

const PROJECT = 'demo-matchpulse'

let passed = 0, failed = 0
async function check(name, promise) {
  try { await promise; passed++; console.log(`  ✓ ${name}`) }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`) }
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
})

// ── Seed baseline data with rules disabled ────────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  // Platform admin user
  await setDoc(doc(db, 'users/admin'),  { platformAdmin: true })
  await setDoc(doc(db, 'users/owner'),  { platformAdmin: false })
  await setDoc(doc(db, 'users/teamOwner'), { platformAdmin: false })
  await setDoc(doc(db, 'users/stranger'), { platformAdmin: false })

  // Owning org of the competition; 'owner' is staff(owner) of it.
  await setDoc(doc(db, 'organizations/orgA'), { name: 'Org A', approvalState: 'active', createdBy: 'owner' })
  await setDoc(doc(db, 'organizations/orgA/staff/owner'), { role: 'owner' })

  // Invited team's org; 'teamOwner' is staff(owner) of it.
  await setDoc(doc(db, 'organizations/orgB'), { name: 'Org B', approvalState: 'active', createdBy: 'teamOwner' })
  await setDoc(doc(db, 'organizations/orgB/staff/teamOwner'), { role: 'owner' })
  await setDoc(doc(db, 'teams/teamB'), { organizationId: 'orgB', displayName: 'Team B' })

  // A published competition owned by orgA, and a draft one.
  await setDoc(doc(db, 'competitions/compPub'),   { name: 'Pub', ownerOrgId: 'orgA', createdBy: 'owner', status: 'active', published: true })
  await setDoc(doc(db, 'competitions/compDraft'), { name: 'Draft', ownerOrgId: 'orgA', createdBy: 'owner', status: 'draft', published: false })

  // Seed an invite + participation record on the draft competition.
  await setDoc(doc(db, 'competitions/compDraft/invites/tok1'), { token: 'tok1', teamId: 'teamB', status: 'pending' })
  await setDoc(doc(db, 'competitions/compDraft/teams/teamB'),  { teamId: 'teamB', status: 'invited' })
  await setDoc(doc(db, 'competitions/compPub/fixtures/fx1'),   { matchId: 'm1' })
  await setDoc(doc(db, 'competitions/compDraft/fixtures/fx9'), { matchId: 'm9' })

  // Structure docs for stage/pool/knockout read-gating tests.
  await setDoc(doc(db, 'competitions/compPub/stages/st1'),     { type: 'pool', name: 'Groups' })
  await setDoc(doc(db, 'competitions/compDraft/stages/st9'),   { type: 'pool', name: 'Groups' })
  await setDoc(doc(db, 'competitions/compPub/knockout/k1'),    { name: 'Final' })
  await setDoc(doc(db, 'competitions/compDraft/knockout/k9'),  { name: 'Final' })

  // ── Fixture-authority fixtures ──────────────────────────────────────────
  // Two ACCEPTED member teams owned by orgs the competition admin does NOT
  // manage (Fatima / Curro), a PENDING team, and a NON-member team.
  await setDoc(doc(db, 'organizations/orgX'), { name: 'Fatima', approvalState: 'active' })
  await setDoc(doc(db, 'organizations/orgY'), { name: 'Curro',  approvalState: 'active' })
  await setDoc(doc(db, 'organizations/orgP'), { name: 'Pend',   approvalState: 'active' })
  await setDoc(doc(db, 'organizations/orgN'), { name: 'NonMem', approvalState: 'active' })
  await setDoc(doc(db, 'teams/teamX'), { organizationId: 'orgX', displayName: 'Fatima 1st' })
  await setDoc(doc(db, 'teams/teamY'), { organizationId: 'orgY', displayName: 'Curro 1st' })
  await setDoc(doc(db, 'teams/teamP'), { organizationId: 'orgP', displayName: 'Pending 1st' })
  await setDoc(doc(db, 'teams/teamN'), { organizationId: 'orgN', displayName: 'Outsider 1st' })

  await setDoc(doc(db, 'competitions/compDraft/teams/teamX'), { teamId: 'teamX', status: 'accepted' })
  await setDoc(doc(db, 'competitions/compDraft/teams/teamY'), { teamId: 'teamY', status: 'admin_approved' })
  await setDoc(doc(db, 'competitions/compDraft/teams/teamP'), { teamId: 'teamP', status: 'invited' })

  // An existing standalone match between two accepted members (for linking).
  await setDoc(doc(db, 'matches/existingM'), {
    homeTeamId: 'teamX', awayTeamId: 'teamY', homeOrgId: 'orgX', awayOrgId: 'orgY',
    homeTeamName: 'Fatima 1st', awayTeamName: 'Curro 1st', matchSlug: 'fatima-1st-vs-curro-1st',
  })
  // A competition fixture already created by the admin (for update tests).
  await setDoc(doc(db, 'matches/compFix'), {
    competitionId: 'compDraft', homeTeamId: 'teamX', awayTeamId: 'teamY',
    homeOrgId: 'orgX', awayOrgId: 'orgY', homeTeamName: 'Fatima 1st', awayTeamName: 'Curro 1st',
    pitch: 'A', homeScore: 0, awayScore: 0,
  })
})

const admin    = env.authenticatedContext('admin').firestore()
const owner    = env.authenticatedContext('owner').firestore()      // competition admin (orgA owner)
const teamOwn  = env.authenticatedContext('teamOwner').firestore()  // invited team's org owner
const stranger = env.authenticatedContext('stranger').firestore()
const anon     = env.unauthenticatedContext().firestore()

console.log('\nCompetition document:')
await check('platform admin updates any competition',
  assertSucceeds(updateDoc(doc(admin, 'competitions/compDraft'), { name: 'X' })))
await check('competition admin (owning-org owner) updates competition',
  assertSucceeds(updateDoc(doc(owner, 'competitions/compDraft'), { name: 'Y' })))
await check('stranger cannot update competition',
  assertFails(updateDoc(doc(stranger, 'competitions/compDraft'), { name: 'Z' })))
await check('competition admin cannot re-assign ownerOrgId',
  assertFails(updateDoc(doc(owner, 'competitions/compDraft'), { ownerOrgId: 'orgB' })))
await check('platform admin may re-assign ownerOrgId',
  assertSucceeds(updateDoc(doc(admin, 'competitions/compDraft'), { ownerOrgId: 'orgA' })))

console.log('\nFixtures (published-gating):')
await check('anon reads fixtures of PUBLISHED competition',
  assertSucceeds(getDoc(doc(anon, 'competitions/compPub/fixtures/fx1'))))
await check('anon CANNOT read fixtures of DRAFT competition',
  assertFails(getDoc(doc(anon, 'competitions/compDraft/fixtures/fx9'))))
await check('competition admin reads fixtures of DRAFT competition',
  assertSucceeds(getDoc(doc(owner, 'competitions/compDraft/fixtures/fx9'))))
await check('competition admin creates a fixture',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/fixtures/fx10'), { matchId: 'm10' })))
await check('stranger cannot create a fixture',
  assertFails(setDoc(doc(stranger, 'competitions/compDraft/fixtures/fx11'), { matchId: 'm11' })))
await check('competition admin toggles countsTowardStandings',
  assertSucceeds(updateDoc(doc(owner, 'competitions/compDraft/fixtures/fx10'), { countsTowardStandings: false })))
await check('stranger cannot toggle countsTowardStandings',
  assertFails(updateDoc(doc(stranger, 'competitions/compDraft/fixtures/fx10'), { countsTowardStandings: true })))
await check('stranger cannot remove a fixture',
  assertFails(deleteDoc(doc(stranger, 'competitions/compDraft/fixtures/fx10'))))
await check('competition admin removes a fixture',
  assertSucceeds(deleteDoc(doc(owner, 'competitions/compDraft/fixtures/fx10'))))

console.log('\nUnified fixture write path (/fixtures/new with a competition):')
// An org owner creating a fixture for a competition they administer writes
// BOTH the match (with competitionId) AND the membership join record, then
// the Manage > Fixtures listing (the join subcollection) shows it.
await check('org owner creates the match doc with competitionId',
  assertSucceeds(setDoc(doc(owner, 'matches/uMatch1'), {
    competitionId: 'compDraft', homeOrgId: 'orgA', awayOrgId: 'orgZ',
    homeTeamId: 'teamA1', awayTeamId: null,
    homeTeamName: 'Org A 1st', awayTeamName: 'Visitors',
    status: 'upcoming', homeScore: 0, awayScore: 0,
  })))
await check('…and creates the membership join record (unified path)',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/fixtures/uMatch1'), {
    matchId: 'uMatch1', countsTowardStandings: false,
    homeTeamId: 'teamA1', awayTeamId: null,
  })))
await check('…and the Manage > Fixtures listing includes the join record', (async () => {
  const snap = await getDocs(collection(owner, 'competitions/compDraft/fixtures'))
  if (!snap.docs.some(d => d.id === 'uMatch1')) throw new Error('membership doc missing from listing')
})())
await check('linked competition fixture HAS a membership doc (invariant)', (async () => {
  const m = await getDoc(doc(owner, 'matches/uMatch1'))
  if (!m.exists() || !m.data().competitionId) throw new Error('match missing competitionId')
  const join = await getDoc(doc(owner, `competitions/${m.data().competitionId}/fixtures/uMatch1`))
  if (!join.exists()) throw new Error('match has competitionId but NO membership doc')
})())

console.log('\nFixture authority — MATCH documents (neutral competition admin):')
const compFixDoc = {
  competitionId: 'compDraft', homeTeamId: 'teamX', awayTeamId: 'teamY',
  homeOrgId: 'orgX', awayOrgId: 'orgY', homeTeamName: 'Fatima 1st', awayTeamName: 'Curro 1st',
}
// Allowed
await check('comp admin creates fixture between two ACCEPTED members',
  assertSucceeds(setDoc(doc(owner, 'matches/newFix1'), { ...compFixDoc })))
await check('comp admin updates own competition fixture (reschedule/score)',
  assertSucceeds(updateDoc(doc(owner, 'matches/compFix'), { pitch: 'B', homeScore: 2 })))
await check('comp admin LINKS existing match (stamps competition metadata)',
  assertSucceeds(updateDoc(doc(owner, 'matches/existingM'),
    { competitionId: 'compDraft', competitionSlug: 'draft', competitionSeason: '2026' })))
// Denied
await check('comp admin CANNOT create fixture involving a NON-member team',
  assertFails(setDoc(doc(owner, 'matches/badFix1'),
    { competitionId: 'compDraft', homeTeamId: 'teamX', awayTeamId: 'teamN', homeOrgId: 'orgX', awayOrgId: 'orgN' })))
await check('comp admin CANNOT create fixture involving a PENDING team',
  assertFails(setDoc(doc(owner, 'matches/badFix2'),
    { competitionId: 'compDraft', homeTeamId: 'teamX', awayTeamId: 'teamP', homeOrgId: 'orgX', awayOrgId: 'orgP' })))
await check('comp admin CANNOT change team identity on a competition fixture',
  assertFails(updateDoc(doc(owner, 'matches/compFix'), { homeTeamId: 'teamN', homeOrgId: 'orgN' })))
await check('comp admin CANNOT create a fixture OUTSIDE any competition',
  assertFails(setDoc(doc(owner, 'matches/badFix3'),
    { homeTeamId: 'teamX', awayTeamId: 'teamY', homeOrgId: 'orgX', awayOrgId: 'orgY' })))
await check('comp admin CANNOT edit a team document',
  assertFails(updateDoc(doc(owner, 'teams/teamX'), { displayName: 'Hacked' })))
await check('ordinary user CANNOT create a competition fixture',
  assertFails(setDoc(doc(stranger, 'matches/badFix4'), { ...compFixDoc })))
await check('unrelated team owner CANNOT update a match they neither own nor administer',
  assertFails(updateDoc(doc(teamOwn, 'matches/existingM'), { pitch: 'Z' })))
await check('a team’s own org owner can still update their team document (unchanged)',
  assertSucceeds(updateDoc(doc(teamOwn, 'teams/teamB'), { displayName: 'Team B2' })))

console.log('\nTeam invite acceptance (R4 authority):')
await check('invited team org owner accepts (status fields only)',
  assertSucceeds(updateDoc(doc(teamOwn, 'competitions/compDraft/teams/teamB'),
    { status: 'accepted', acceptedBy: 'teamOwner', acceptedAt: 123 })))
await check('invited team org owner CANNOT edit seeding via accept path',
  assertFails(updateDoc(doc(teamOwn, 'competitions/compDraft/teams/teamB'),
    { status: 'accepted', seeding: 1 })))
await check('stranger cannot accept on behalf of team',
  assertFails(updateDoc(doc(stranger, 'competitions/compDraft/teams/teamB'),
    { status: 'accepted' })))
await check('competition admin invites a team (create participation)',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/teams/teamC'),
    { teamId: 'teamC', status: 'invited' })))
await check('team org owner CANNOT create a participation record',
  assertFails(setDoc(doc(teamOwn, 'competitions/compDraft/teams/teamD'),
    { teamId: 'teamD', status: 'invited' })))

console.log('\nInvites:')
await check('invited team org owner consumes invite (status only)',
  assertSucceeds(updateDoc(doc(teamOwn, 'competitions/compDraft/invites/tok1'),
    { status: 'consumed', consumedBy: 'teamOwner', consumedAt: 1 })))
await check('stranger cannot read invite',
  assertFails(getDoc(doc(stranger, 'competitions/compDraft/invites/tok1'))))
await check('invited team org owner CAN read invite (accept page)',
  assertSucceeds(getDoc(doc(teamOwn, 'competitions/compDraft/invites/tok1'))))
await check('anonymous user cannot read invite',
  assertFails(getDoc(doc(anon, 'competitions/compDraft/invites/tok1'))))
await check('competition admin can read invite',
  assertSucceeds(getDoc(doc(owner, 'competitions/compDraft/invites/tok1'))))
await check('invited team org owner CAN read own membership doc (accept page)',
  assertSucceeds(getDoc(doc(teamOwn, 'competitions/compDraft/teams/teamB'))))

console.log('\nAudit log (create-only, immutable):')
await check('competition admin writes audit event',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/auditLog/a1'),
    { eventType: 'rules_changed', actorId: 'owner', payload: { before: null, after: null, reason: null } })))
await check('team org owner writes invite_accepted audit event',
  assertSucceeds(setDoc(doc(teamOwn, 'competitions/compDraft/auditLog/a2'),
    { eventType: 'invite_accepted', actorId: 'teamOwner', payload: { before: null, after: { teamId: 'teamB' }, reason: null } })))
await check('cannot spoof actorId on audit event',
  assertFails(setDoc(doc(owner, 'competitions/compDraft/auditLog/a3'),
    { eventType: 'rules_changed', actorId: 'someoneElse', payload: {} })))
await check('audit events are immutable (no update)',
  assertFails(updateDoc(doc(owner, 'competitions/compDraft/auditLog/a1'), { eventType: 'x' })))
await check('audit events cannot be deleted',
  assertFails(deleteDoc(doc(admin, 'competitions/compDraft/auditLog/a1'))))
await check('stranger cannot read audit log',
  assertFails(getDoc(doc(stranger, 'competitions/compDraft/auditLog/a1'))))

console.log('\nSnapshots (create-only, never deleted):')
await check('competition admin creates a snapshot',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/snapshots/s1'), { kind: 'verification' })))
await check('snapshots cannot be updated',
  assertFails(updateDoc(doc(owner, 'competitions/compDraft/snapshots/s1'), { kind: 'x' })))
await check('snapshots cannot be deleted (even platform admin)',
  assertFails(deleteDoc(doc(admin, 'competitions/compDraft/snapshots/s1'))))

console.log('\nTournament structure (stages / pools / knockout):')
await check('anon reads stages of PUBLISHED competition',
  assertSucceeds(getDoc(doc(anon, 'competitions/compPub/stages/st1'))))
await check('anon CANNOT read stages of DRAFT competition',
  assertFails(getDoc(doc(anon, 'competitions/compDraft/stages/st9'))))
await check('competition admin creates a stage',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/stages/st10'), { type: 'knockout', name: 'KO' })))
await check('stranger cannot create a stage',
  assertFails(setDoc(doc(stranger, 'competitions/compDraft/stages/st11'), { type: 'pool' })))
await check('competition admin creates a pool',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/pools/p1'), { name: 'Pool A', slots: [] })))
await check('stranger cannot create a pool',
  assertFails(setDoc(doc(stranger, 'competitions/compDraft/pools/p2'), { name: 'Pool B' })))
await check('anon reads knockout of PUBLISHED competition',
  assertSucceeds(getDoc(doc(anon, 'competitions/compPub/knockout/k1'))))
await check('anon CANNOT read knockout of DRAFT competition',
  assertFails(getDoc(doc(anon, 'competitions/compDraft/knockout/k9'))))
await check('competition admin creates a knockout slot',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/knockout/k10'), { name: 'SF1', source: { type: 'pool_position', poolId: 'p1', position: 1 } })))
await check('stranger cannot create a knockout slot',
  assertFails(setDoc(doc(stranger, 'competitions/compDraft/knockout/k11'), { name: 'X' })))
await check('competition admin locks advancement (advancement record)',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/advancement/k10'), { slotId: 'k10', teamId: 'teamX' })))
await check('stranger cannot write an advancement record',
  assertFails(setDoc(doc(stranger, 'competitions/compDraft/advancement/k12'), { slotId: 'k12', teamId: 'teamX' })))
await check('competition admin creates a verification snapshot',
  assertSucceeds(setDoc(doc(owner, 'competitions/compDraft/snapshots/v1'), { kind: 'pool_verification', poolId: 'p1' })))
await check('verification snapshot cannot be updated',
  assertFails(updateDoc(doc(owner, 'competitions/compDraft/snapshots/v1'), { poolId: 'p2' })))

console.log('\nRedirects:')
await check('anon reads a redirect',
  assertSucceeds(getDoc(doc(anon, 'redirects/oldpath'))))
await check('platform admin writes a redirect',
  assertSucceeds(setDoc(doc(admin, 'redirects/oldpath'), { toPath: '/new' })))
await check('stranger cannot write a redirect',
  assertFails(setDoc(doc(stranger, 'redirects/other'), { toPath: '/x' })))

console.log('\nSelf-promotion guard:')
await check('user cannot set their own platformAdmin flag',
  assertFails(updateDoc(doc(stranger, 'users/stranger'), { platformAdmin: true })))

await env.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
