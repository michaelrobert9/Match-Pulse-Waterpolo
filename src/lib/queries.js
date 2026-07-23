import { db, configured } from '../firebase'
import { doc, getDoc, onSnapshot, collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { slugify } from './slugify'
import { isScheduled, SCHEDULED_QUERY_VALUES } from './fixtureStatus'

export { onSnapshot, doc, db, configured }
import {
  people as samplePeople,
  competitions as sampleCompetitions,
  getCareerForPerson,
  getTeamsForCompetition,
  getMatchesForCompetition,
  getTopScorersForCompetition,
  getPlayersForTeam,
  matches as sampleMatches,
} from './sampleData'

// ── Shared util ───────────────────────────────────────────────────────────────

export function toDate(val) {
  if (!val) return null
  if (typeof val.toDate === 'function') return val.toDate()
  if (val instanceof Date) return val
  return new Date(val)
}

// ── Person / Career ─────────────────────────────────────────────────────────

export async function fetchPerson(personId) {
  if (!configured) return samplePeople[personId] ?? null
  const snap = await getDoc(doc(db, 'people', personId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function fetchCareerForPerson(personId) {
  if (!configured) return getCareerForPerson(personId)
  const snap = await getDocs(query(collection(db, 'players'), where('personId', '==', personId)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.competitionSeason ?? b.season ?? '').localeCompare(String(a.competitionSeason ?? a.season ?? '')))
}

// ── Competitions ────────────────────────────────────────────────────────────

export async function fetchCompetition(id) {
  if (!configured) return sampleCompetitions[id] ?? null
  const snap = await getDoc(doc(db, 'competitions', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function fetchActiveCompetitions() {
  if (!configured) {
    return Object.values(sampleCompetitions)
      .filter(c => c.status === 'active')
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }
  const snap = await getDocs(query(collection(db, 'competitions'), where('status', '==', 'active')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function fetchAllCompetitions() {
  if (!configured) {
    return Object.values(sampleCompetitions)
      .sort((a, b) => String(b.season).localeCompare(String(a.season)))
  }
  const snap = await getDocs(query(collection(db, 'competitions'), orderBy('name')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Teams / Standings ────────────────────────────────────────────────────────

export async function fetchCompetitionTeams(competitionId) {
  if (!configured) return getTeamsForCompetition(competitionId)
  const memberSnap = await getDocs(collection(db, 'competitions', competitionId, 'teams'))
  const members = memberSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const accepted = members.filter(m => m.status === 'accepted' || m.status === 'admin_approved')
  if (accepted.length === 0) return []
  const teamDocs = await Promise.all(accepted.map(m => getDoc(doc(db, 'teams', m.id))))
  return accepted
    .map((m, i) => {
      const d = teamDocs[i]
      if (d.exists()) {
        return { ...d.data(), id: d.id, memberStatus: m.status, claimed: !!m.organizationId }
      }
      // Unclaimed / name-only participant — the membership doc IS the team record.
      const snap = m.displaySnapshot ?? {}
      return {
        id:             m.id,
        displayName:    snap.teamName ?? m.id,
        orgName:        snap.orgName ?? null,
        organizationId: m.organizationId ?? null,
        primaryColor:   snap.primaryColor ?? null,
        memberStatus:   m.status,
        claimed:        !!m.organizationId,
      }
    })
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
}

// ── Fixtures / Matches ─────────────────────────────────────────────────────

export async function fetchCompetitionFixtures(competitionId) {
  if (!configured) return getMatchesForCompetition(competitionId)
  const snap = await getDocs(
    query(collection(db, 'matches'), where('competitionId', '==', competitionId))
  )
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
}

export async function fetchMatch(matchId) {
  if (!configured) return sampleMatches[matchId] ?? null
  const snap = await getDoc(doc(db, 'matches', matchId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Fixtures awaiting a human-confirmed result — the admin confirmation queue
// (spec §6). Populated by the daily sweep (live → awaiting_result) and by any
// submit-only fixture. Most recently scheduled first.
export async function fetchAwaitingResultMatches() {
  if (!configured) return []
  const snap = await getDocs(query(collection(db, 'matches'), where('status', '==', 'awaiting_result')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.scheduledAt) ?? 0) - (toDate(a.scheduledAt) ?? 0))
}

// Competition-scoped variant: only fixtures belonging to one competition.
export async function fetchAwaitingResultMatchesForCompetition(competitionId) {
  if (!configured) return []
  const snap = await getDocs(query(
    collection(db, 'matches'),
    where('competitionId', '==', competitionId),
    where('status', '==', 'awaiting_result')
  ))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.scheduledAt) ?? 0) - (toDate(a.scheduledAt) ?? 0))
}

// A fixture's audit history (spec §6), newest first. Organiser-only — the rules
// gate read access; a denied read resolves to an empty list.
export async function fetchFixtureAuditLog(matchId) {
  if (!configured) return []
  try {
    const snap = await getDocs(query(collection(db, 'matches', matchId, 'auditLog'), orderBy('occurredAt', 'desc')))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch {
    return []
  }
}

// ── Players ──────────────────────────────────────────────────────────────────

export async function fetchCompetitionTopScorers(competitionId, limit = 5) {
  if (!configured) return getTopScorersForCompetition(competitionId, limit)
  // Teams are org assets without a competitionId — resolve participants via the
  // membership subcollection, then load players by teamId ('in' caps at 10 ids
  // per query, so chunk).
  const memberSnap = await getDocs(collection(db, 'competitions', competitionId, 'teams'))
  const teamIds = memberSnap.docs
    .filter(d => { const s = d.data().status; return s === 'accepted' || s === 'admin_approved' })
    .map(d => d.id)
  if (teamIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < teamIds.length; i += 10) chunks.push(teamIds.slice(i, i + 10))
  const snaps = await Promise.all(chunks.map(ids =>
    getDocs(query(collection(db, 'players'), where('teamId', 'in', ids)))
  ))
  return snaps
    .flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    .filter(p => p.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit)
}

export async function fetchCompetitionTopPOTM(competitionId, limit = 5) {
  if (!configured) return []
  const snap = await getDocs(
    query(collection(db, 'matches'),
      where('competitionId', '==', competitionId),
      where('status', '==', 'final'))
  )
  const counts = new Map()
  snap.docs.forEach(d => {
    const data = d.data()
    const potm = data.playerOfMatch
    if (!potm?.name) return
    const key = potm.personId ?? potm.name
    const entry = counts.get(key)
    if (entry) {
      entry.count++
    } else {
      counts.set(key, {
        key,
        personId:  potm.personId ?? null,
        name:      potm.name,
        photoUrl:  potm.photoUrl ?? null,
        teamName:  potm.side === 'home' ? data.homeTeamName : data.awayTeamName,
        teamColor: potm.side === 'home' ? (data.homeTeamColor ?? null) : (data.awayTeamColor ?? null),
        count: 1,
      })
    }
  })
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export async function fetchTeamLineup(teamId) {
  if (!configured) return getPlayersForTeam(teamId)
  const snap = await getDocs(query(collection(db, 'players'), where('teamId', '==', teamId)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.shirtNumber || 99) - (b.shirtNumber || 99))
}

// ── Scorer helpers ───────────────────────────────────────────────────────────

// Live + upcoming matches the user may score. Platform admins see everything;
// organisation members see only matches involving one of their orgs. We filter
// client-side on homeOrgId/awayOrgId to avoid a (status, orgId) composite index.
export async function fetchActionableMatches({ isPlatformAdmin = false, orgIds = [], competitionIds = [] } = {}) {
  if (!configured) {
    const all = Object.values(sampleMatches)
    return [
      ...all.filter(m => m.status === 'live'),
      ...all.filter(isScheduled)
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    ]
  }
  const [liveSnap, upcomingSnap, pausedSnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'), where('status', '==', 'live'))),
    getDocs(query(collection(db, 'matches'), where('status', 'in', SCHEDULED_QUERY_VALUES))),
    getDocs(query(collection(db, 'matches'), where('status', '==', 'paused'))),
  ])
  const byDate = (a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt)
  const orgSet  = new Set(orgIds)
  const compSet = new Set(competitionIds)
  const inScope = m => isPlatformAdmin
    || orgSet.has(m.homeOrgId)
    || orgSet.has(m.awayOrgId)
    || (m.competitionId && compSet.has(m.competitionId))
  const live = [...liveSnap.docs, ...pausedSnap.docs].map(d => ({ id: d.id, ...d.data() }))
  const upcoming = upcomingSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  // Start of today — upcoming matches scheduled before today are historic (never
  // activated) and should not appear in the actionable scorer list.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const notPast = m => { const d = toDate(m.scheduledAt); return !d || d >= startOfToday }
  return [
    ...live.filter(inScope).sort(byDate),
    ...upcoming.filter(inScope).filter(notPast).sort(byDate),
  ]
}

// Subscribe to a single match document in real-time.
// Returns an unsubscribe function.
export function subscribeMatch(matchId, onChange) {
  if (!configured) return () => {}
  return onSnapshot(doc(db, 'matches', matchId), snap => {
    if (snap.exists()) onChange({ id: snap.id, ...snap.data() })
  })
}

// ── Organizations ──────────────────────────────────────────────────────────

export async function fetchOrganizations() {
  if (!configured) return []
  const snap = await getDocs(query(collection(db, 'organizations'), orderBy('name')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// An organisation is publicly visible unless it is awaiting platform-admin
// review or was rejected. Legacy orgs (no approvalState) are treated as active.
export function isOrgPubliclyVisible(org) {
  const state = org?.approvalState
  return !state || state === 'active'
}

// Public schools / clubs listings. Single-field where() + client-side sort to
// avoid requiring a (type, name) composite index. Pending/rejected organisations
// are excluded so they never appear as fully official public profiles (R3).
export async function fetchOrganizationsByType(type) {
  if (!configured) return []
  const snap = await getDocs(query(collection(db, 'organizations'), where('type', '==', type)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(isOrgPubliclyVisible)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

// Resolve a public org page by slug. Enforces type so /schools/:slug never
// resolves a club (and vice-versa). Falls back to a name-derived slug match for
// legacy orgs created before slugs existed.
export async function fetchOrganizationBySlug(slug, type) {
  if (!configured) return null
  // Rejected organisations are not public; pending ones still resolve so their
  // owner can view them (listings already hide them).
  const visible = org => org.type === type && org.approvalState !== 'rejected'
  const bySlug = await getDocs(query(collection(db, 'organizations'), where('slug', '==', slug)))
  if (bySlug.docs[0]) {
    const org = { id: bySlug.docs[0].id, ...bySlug.docs[0].data() }
    return visible(org) ? org : null
  }
  const byType = await getDocs(query(collection(db, 'organizations'), where('type', '==', type)))
  const match = byType.docs.find(d => slugify(d.data().name) === slug)
  if (!match) return null
  const org = { id: match.id, ...match.data() }
  return visible(org) ? org : null
}

// Resolve an org by slug regardless of type — used by the nested team URL
// /{orgSlug}/{teamSlug} where the type is not part of the path.
export async function fetchOrganizationBySlugAny(slug) {
  if (!configured) return null
  const visible = org => org.approvalState !== 'rejected'
  const bySlug = await getDocs(query(collection(db, 'organizations'), where('slug', '==', slug)))
  if (bySlug.docs[0]) {
    const org = { id: bySlug.docs[0].id, ...bySlug.docs[0].data() }
    return visible(org) ? org : null
  }
  // Legacy fallback: orgs created before slugs existed.
  const all = await getDocs(collection(db, 'organizations'))
  const match = all.docs.find(d => slugify(d.data().name) === slug)
  if (!match) return null
  const org = { id: match.id, ...match.data() }
  return visible(org) ? org : null
}

// Resolve a team from a nested URL: /{orgSlug}/{teamSeg}. Finds the org, then the
// team within it whose slug reconstructs to teamSeg (prefix-stripped, raw, or
// display-name derived). Returns { org, team } — either may be null.
export async function fetchTeamByOrgPath(orgSlug, teamSeg) {
  if (!configured) return { org: null, team: null }
  const org = await fetchOrganizationBySlugAny(orgSlug)
  if (!org) return { org: null, team: null }
  const teams = await fetchTeamsForOrganization(org.id)
  const full = `${orgSlug}-${teamSeg}`
  const team = teams.find(t =>
    t.slug === full ||
    t.slug === teamSeg ||
    (t.slug?.startsWith(`${orgSlug}-`) && t.slug.slice(orgSlug.length + 1) === teamSeg) ||
    slugify(t.displayName ?? '') === teamSeg
  ) ?? null
  return { org, team }
}

// Single team document by id. Used by the competition fixture builder to get
// full team records (slug, colours, org) for creating fixtures between members.
export async function fetchTeam(id) {
  if (!configured || !id) return null
  const snap = await getDoc(doc(db, 'teams', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function fetchTeamsForOrganization(orgId) {
  if (!configured) return []
  const snap = await getDocs(query(collection(db, 'teams'), where('organizationId', '==', orgId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Recent / Upcoming matches ───────────────────────────────────────────────

export async function fetchRecentMatches(limitN = 5) {
  if (!configured) {
    return Object.values(sampleMatches)
      .filter(m => m.status === 'final')
      .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
      .slice(0, limitN)
  }
  // Use a single-field where() only — no orderBy — to avoid requiring a
  // composite index that may not exist. Sort client-side instead.
  const snap = await getDocs(
    query(collection(db, 'matches'), where('status', '==', 'final'))
  )
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toDate(b.scheduledAt) - toDate(a.scheduledAt))
    .slice(0, limitN)
}

export async function fetchUpcomingMatches(limitN = 5) {
  if (!configured) {
    return Object.values(sampleMatches)
      .filter(isScheduled)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, limitN)
  }
  // Same: single-field where() only, sort client-side. `in` tolerates legacy
  // 'upcoming' docs until the status migration has run everywhere.
  const snap = await getDocs(
    query(collection(db, 'matches'), where('status', 'in', SCHEDULED_QUERY_VALUES))
  )
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
    .slice(0, limitN)
}

export async function fetchLiveMatches(n = 10) {
  if (!configured) return []
  const snap = await getDocs(query(
    collection(db, 'matches'),
    where('status', 'in', ['live', 'paused'])
  ))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
    .slice(0, n)
}

// Every match across the platform, most recent first (by scheduled date).
// Admin-only use — the public site never lists all matches at once.
export async function fetchAllMatches() {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'matches'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.scheduledAt) ?? 0) - (toDate(a.scheduledAt) ?? 0))
}

export async function fetchTodayMatches() {
  if (!configured) return []
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const snap  = await getDocs(query(collection(db, 'matches'), where('status', 'in', SCHEDULED_QUERY_VALUES)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(m => { const d = toDate(m.scheduledAt); return d && d >= start && d <= end })
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
}

// ── People ─────────────────────────────────────────────────────────────────

export async function fetchTopPeople(limit = 10) {
  if (!configured) {
    return Object.values(samplePeople)
      .sort((a, b) => (b.careerCaps ?? 0) - (a.careerCaps ?? 0))
      .slice(0, limit)
  }
  const snap = await getDocs(collection(db, 'people'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.careerCaps ?? 0) - (a.careerCaps ?? 0))
    .slice(0, limit)
}

export async function fetchAllPeople() {
  if (!configured) {
    return Object.values(samplePeople)
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }
  const snap = await getDocs(query(collection(db, 'people'), orderBy('fullName')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// People who have declared themselves a player (roles array includes 'player').
// Sorted client-side to avoid requiring a composite index.
export async function fetchPlayers() {
  if (!configured) {
    return Object.values(samplePeople)
      .filter(p => Array.isArray(p.roles) && p.roles.includes('player'))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }
  const snap = await getDocs(query(
    collection(db, 'people'),
    where('roles', 'array-contains', 'player'),
  ))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

// All matches where a player appears in either lineup (homeLineup or awayLineup).
// lineupPersonIds is a flat denormalised index kept in sync by the lineup
// management functions so this query needs no composite index.
export async function fetchMatchesForPlayer(personId) {
  if (!configured) return []
  const snap = await getDocs(query(
    collection(db, 'matches'),
    where('lineupPersonIds', 'array-contains', personId),
  ))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = a.scheduledAt?.toDate?.() ?? (a.scheduledAt ? new Date(a.scheduledAt) : new Date(0))
      const tb = b.scheduledAt?.toDate?.() ?? (b.scheduledAt ? new Date(b.scheduledAt) : new Date(0))
      return tb - ta
    })
}

// People whose representativeOrgIds array contains the given org.
export async function fetchPeopleByOrg(orgId) {
  if (!configured) return []
  const snap = await getDocs(query(
    collection(db, 'people'),
    where('representativeOrgIds', 'array-contains', orgId)
  ))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

// Per-match lineup (non-permanent player assignments for a single fixture).
export async function fetchMatchLineup(matchId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'matches', matchId, 'lineup'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.personName || '').localeCompare(b.personName || ''))
}

// ── Slug-based lookups ─────────────────────────────────────────────────────

export async function fetchCompetitionByPath(path) {
  if (!configured) {
    return Object.values(sampleCompetitions).find(c => c.competitionPath === path) ?? null
  }
  const snap = await getDocs(query(collection(db, 'competitions'), where('competitionPath', '==', path)))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// Resolve a competition edition by its long-term URL: series slug + season.
// Two equality filters — no composite index required.
export async function fetchCompetitionBySlugSeason(slug, season) {
  if (!configured) {
    return Object.values(sampleCompetitions)
      .find(c => c.slug === slug && String(c.season) === String(season)) ?? null
  }
  const snap = await getDocs(query(
    collection(db, 'competitions'),
    where('slug', '==', slug),
    where('season', '==', String(season)),
  ))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// ── Competition subcollections (managed model) ──────────────────────────────
// Team membership / invitation records, fixture-membership join records, and a
// single invite token. Read-only helpers; mutations live in adminQueries.js.

export async function fetchCompetitionMembers(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'teams'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function fetchCompetitionFixtureMembers(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'fixtures'))
  return snap.docs.map(d => ({ matchId: d.id, ...d.data() }))
}

// Single membership record by team id. Used by the accept-invite page: a team's
// org admin may read their OWN membership doc even on an unpublished competition
// (rules allow isTeamOrgMember), whereas LISTING all members would be rejected.
export async function fetchCompetitionMember(competitionId, teamId) {
  if (!configured) return null
  const snap = await getDoc(doc(db, 'competitions', competitionId, 'teams', teamId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Derived invite expiry (R7). `expired` is never stored — an invite past its
// expiresAt while still pending is reported as expired at read time. The stored
// status is preserved as `storedStatus` for audit/debugging.
function isPast(expiresAt) {
  if (!expiresAt) return false
  const d = toDate(expiresAt)
  return d ? d.getTime() < Date.now() : false
}

export function derivedInviteStatus(invite) {
  if (!invite) return null
  if (invite.status === 'pending' && isPast(invite.expiresAt)) return 'expired'
  return invite.status
}

export async function fetchCompetitionInvite(competitionId, token) {
  if (!configured) return null
  const snap = await getDoc(doc(db, 'competitions', competitionId, 'invites', token))
  if (!snap.exists()) return null
  const data = { id: snap.id, ...snap.data() }
  return { ...data, storedStatus: data.status, status: derivedInviteStatus(data) }
}

export async function fetchCompetitionAuditLog(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'auditLog'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toDate(b.occurredAt) - toDate(a.occurredAt))
}

// ── Tournament structure (stages / pools / knockout / advancement) ───────────
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)

export async function fetchCompetitionStages(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'stages'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byOrder)
}

export async function fetchCompetitionPools(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'pools'))
  return snap.docs.map(d => ({ id: d.id, poolId: d.id, ...d.data() })).sort(byOrder)
}

export async function fetchCompetitionKnockout(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'knockout'))
  return snap.docs.map(d => ({ id: d.id, slotId: d.id, ...d.data() })).sort(byOrder)
}

export async function fetchCompetitionAdvancement(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'advancement'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function fetchCompetitionSnapshots(competitionId) {
  if (!configured) return []
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'snapshots'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Slug-correction redirects ────────────────────────────────────────────────
// Firestore document IDs cannot contain '/', so a public path is encoded by
// stripping the leading slash and replacing the rest with '~'.
export function redirectKey(path) {
  return String(path ?? '').replace(/^\/+/, '').replace(/\//g, '~') || 'root'
}

export async function fetchRedirect(path) {
  if (!configured) return null
  const snap = await getDoc(doc(db, 'redirects', redirectKey(path)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function fetchMatchBySlug(slug) {
  if (!configured) {
    const all = Object.values(sampleMatches)
    return all.find(m => m.slug === slug) ?? null
  }
  const snap = await getDocs(query(collection(db, 'matches'), where('slug', '==', slug)))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export function subscribeMatchBySlug(slug, onChange) {
  if (!configured) return () => {}
  const q = query(collection(db, 'matches'), where('slug', '==', slug))
  return onSnapshot(q, snap => {
    if (!snap.empty) onChange({ id: snap.docs[0].id, ...snap.docs[0].data() })
  })
}

export async function fetchPersonBySlug(slug) {
  if (!configured) {
    return Object.values(samplePeople).find(p => p.slug === slug) ?? null
  }
  const snap = await getDocs(query(collection(db, 'people'), where('slug', '==', slug)))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export async function fetchTeamBySlug(slug) {
  if (!configured) return []
  const snap = await getDocs(query(collection(db, 'teams'), where('slug', '==', slug)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.competitionSeason ?? '').localeCompare(String(a.competitionSeason ?? '')))
}

export async function fetchOrganization(id) {
  if (!configured) return null
  const snap = await getDoc(doc(db, 'organizations', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function fetchMatchesForTeam(teamId) {
  if (!configured) return []
  const [homeSnap, awaySnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'), where('homeTeamId', '==', teamId))),
    getDocs(query(collection(db, 'matches'), where('awayTeamId', '==', teamId))),
  ])
  const all = [
    ...homeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    ...awaySnap.docs.map(d => ({ id: d.id, ...d.data() })),
  ]
  return all.sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
}

export async function fetchMatchesForOrg(orgId) {
  if (!configured) return []
  const [homeSnap, awaySnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'), where('homeOrgId', '==', orgId))),
    getDocs(query(collection(db, 'matches'), where('awayOrgId', '==', orgId))),
  ])
  const seen = new Set()
  return [
    ...homeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    ...awaySnap.docs.map(d => ({ id: d.id, ...d.data() })),
  ].filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
}

export async function fetchMatchByMatchSlug(matchSlug) {
  if (!configured) return null
  const snap = await getDocs(query(collection(db, 'matches'), where('matchSlug', '==', matchSlug)))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export function subscribeMatchByMatchSlug(matchSlug, onChange) {
  if (!configured) return () => {}
  const q = query(collection(db, 'matches'), where('matchSlug', '==', matchSlug))
  return onSnapshot(q, snap => {
    if (!snap.empty) onChange({ id: snap.docs[0].id, ...snap.docs[0].data() })
    else onChange(null)
  })
}

export async function fetchMatchBySeasonSlug(season, matchSlug) {
  if (!configured) return null
  const snap = await getDocs(query(
    collection(db, 'matches'),
    where('season', '==', season),
    where('matchSlug', '==', matchSlug)
  ))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// Resolve a competition-scoped match by its competition slug + match slug.
// Match slugs are made unique WITHIN a competition at creation, so this is the
// authoritative lookup for /competitions/:season/:slug/matches/:matchSlug — it
// does NOT depend on the edition season segment matching the fixture's own
// season (which the season+slug lookup would). Two equality filters: no index.
export async function fetchMatchByCompetitionSlug(competitionSlug, matchSlug) {
  if (!configured) {
    return Object.values(sampleMatches)
      .find(m => m.competitionSlug === competitionSlug && m.matchSlug === matchSlug) ?? null
  }
  const snap = await getDocs(query(
    collection(db, 'matches'),
    where('competitionSlug', '==', competitionSlug),
    where('matchSlug', '==', matchSlug)
  ))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export function subscribeMatchByCompetitionSlug(competitionSlug, matchSlug, onChange) {
  if (!configured) return () => {}
  const q = query(collection(db, 'matches'),
    where('competitionSlug', '==', competitionSlug),
    where('matchSlug', '==', matchSlug))
  return onSnapshot(q, snap => {
    if (!snap.empty) onChange({ id: snap.docs[0].id, ...snap.docs[0].data() })
    else onChange(null)
  })
}

export function subscribeMatchBySeasonSlug(season, matchSlug, onChange) {
  if (!configured) return () => {}
  const q = query(collection(db, 'matches'),
    where('season', '==', season),
    where('matchSlug', '==', matchSlug))
  return onSnapshot(q, snap => {
    if (!snap.empty) onChange({ id: snap.docs[0].id, ...snap.docs[0].data() })
  })
}
