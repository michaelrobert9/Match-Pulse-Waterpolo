import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, startAt, endAt, limit,
  serverTimestamp, writeBatch, increment, arrayUnion, deleteField,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, auth, functions } from '../firebase'
import { slugify, matchSlug as buildMatchSlug } from './slugify'
import { periodLabels, DEFAULT_PERIODS, DEFAULT_PERIOD_MINUTES, DEFAULT_BREAK_MINUTES } from './matchClock'
import { generatedTeamName } from './teamNaming'
import { defaultRulesForType, rulesHash } from './competitionRules'
import { assertCanAdministerCompetition } from './competitionAuth'
import { schedulePoolFixtures } from './scheduler'
import { PLAYER_CONSENT_VERSION } from './consent'

function uid() { return auth?.currentUser?.uid ?? null }
function userEmail() { return auth?.currentUser?.email ?? null }

// Resolve the current user's authorisation state (platformAdmin + orgRoles)
// from their users/{uid} profile. Used by competition-admin guards in the data
// layer so authorisation is enforced at the source, not only in the UI.
async function currentAuthState() {
  const userId = uid()
  if (!userId) return { uid: null, isPlatformAdmin: false, orgRoles: {} }
  const snap = await getDoc(doc(db, 'users', userId))
  const data = snap.exists() ? snap.data() : {}
  return { uid: userId, isPlatformAdmin: data.platformAdmin === true, orgRoles: data.orgRoles ?? {} }
}

// Throws competition/not-found or competition/not-authorised. Returns the
// resolved competition document so callers can reuse it.
async function assertCompetitionAdmin(competitionId) {
  const [compSnap, authState] = await Promise.all([
    getDoc(doc(db, 'competitions', competitionId)),
    currentAuthState(),
  ])
  if (!compSnap.exists()) {
    const err = new Error('Competition not found.'); err.code = 'competition/not-found'; throw err
  }
  const competition = { id: compSnap.id, ...compSnap.data() }
  assertCanAdministerCompetition(competition, authState)
  return competition
}

// Append an immutable audit event to a competition. Audit entries are
// create-only (never updated or deleted).
export async function addCompetitionAuditEvent(competitionId, { eventType, before = null, after = null, reason = null, matchId = null }) {
  return addDoc(collection(db, 'competitions', competitionId, 'auditLog'), {
    eventType,
    actorId:    uid(),
    actorEmail: userEmail(),
    occurredAt: serverTimestamp(),
    payload:    { before, after, reason },
    ...(matchId ? { matchId } : {}),
  })
}

// Append an immutable audit event to a fixture's own log AND, when the fixture
// belongs to a competition, to that competition's log (carrying matchId). This
// gives the two query shapes the spec (§6) requires: per-fixture ("what
// happened to this match") and per-competition ("who's been editing results in
// this league"). Create-only — never updated or deleted, by anyone.
//
// `method` records HOW a result was reached, the most important detail for
// queue-approved results: tapped_finalise | submitted | admin_approved |
// edited | status_change. `before`/`after` capture the value change.
export async function recordFixtureAudit(matchId, { eventType, method = null, before = null, after = null, competitionId = null, reason = null }) {
  const entry = {
    eventType, method,
    actorId:    uid(),
    actorEmail: userEmail(),
    occurredAt: serverTimestamp(),
    payload:    { before, after, reason },
  }
  const writes = [addDoc(collection(db, 'matches', matchId, 'auditLog'), entry)]
  if (competitionId) {
    writes.push(addDoc(collection(db, 'competitions', competitionId, 'auditLog'), { ...entry, matchId }))
  }
  return Promise.all(writes)
}

// Client-generated id for an event inside the goals/cards arrays. Used to
// identify an entry for enrichment (goal type, scorer) and reversal.
function eventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Slugs are globally unique across all organisations (schools + clubs) and are
// frozen at creation — renaming an org does not change its public URL. We read
// existing slugs (admin-only path, low volume, no index) and append a numeric
// suffix until we find a free one. Mirrors scripts/backfill-org-slugs.mjs.
async function generateUniqueOrgSlug(name) {
  const base = slugify(name) || 'org'
  const snap = await getDocs(collection(db, 'organizations'))
  const taken = new Set(snap.docs.map(d => d.data().slug).filter(Boolean))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export async function createOrganization(data) {
  const slug = await generateUniqueOrgSlug(data.name)
  return addDoc(collection(db, 'organizations'), { ...data, slug, createdBy: uid(), createdAt: serverTimestamp() })
}

// Self-service org creation: any authenticated user creates an org and
// automatically becomes its owner. Uses two sequential writes because
// Firestore rules can't read a document being created in the same batch
// (the bootstrap staff rule reads org.createdBy, which must already exist).
export async function selfCreateOrganization(data) {
  const userId = uid()
  if (!userId) throw new Error('Must be signed in to create an organisation')
  const slug = await generateUniqueOrgSlug(data.name)

  // Step 1 — create the organisation document.
  const orgRef = await addDoc(collection(db, 'organizations'), {
    ...data, slug, createdBy: userId, createdAt: serverTimestamp(),
  })

  // Step 2 — add creator as owner in staff subcollection + mirror to user doc.
  // The bootstrap rule now passes (org exists, createdBy == userId).
  const batch = writeBatch(db)
  batch.set(doc(db, 'organizations', orgRef.id, 'staff', userId), {
    role: 'owner', teamId: null, grantedBy: userId, grantedAt: serverTimestamp(),
  })
  // Use a field-path update so the single new entry is merged into the
  // existing orgRoles map without replacing the whole field.
  batch.update(doc(db, 'users', userId), {
    [`orgRoles.${orgRef.id}`]: { role: 'owner', teamId: null },
  })
  await batch.commit()

  return orgRef
}
export async function updateOrganization(id, data) {
  return updateDoc(doc(db, 'organizations', id), { ...data, updatedAt: serverTimestamp() })
}
export async function deleteOrganization(id) {
  return deleteDoc(doc(db, 'organizations', id))
}

// Generate a unique slug for a person's fullName. First tries the clean
// slugified name; if taken appends -2, -3, … until a free slot is found.
// Collision rule: first registration keeps the clean slug; later ones get the
// lowest available numeric suffix. excludeId skips the person's own doc so
// that updates don't collide with the record itself.
async function generatePersonSlug(fullName, excludeId = null) {
  const base = slugify(fullName) || 'player'
  const isFree = async (candidate) => {
    const snap = await getDocs(query(collection(db, 'people'), where('slug', '==', candidate)))
    return snap.docs.filter(d => d.id !== excludeId).length === 0
  }
  if (await isFree(base)) return base
  for (let n = 2; n <= 999; n++) {
    const candidate = `${base}-${n}`
    if (await isFree(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export async function createPerson(data) {
  const slug = await generatePersonSlug(data.fullName ?? '')
  return addDoc(collection(db, 'people'), {
    ...data,
    slug,
    careerCaps: 0, careerGoals: 0,
    careerCards: { green: 0, yellow: 0, red: 0 },
    createdBy: uid(), createdAt: serverTimestamp(),
  })
}
export async function updatePerson(id, data) {
  // Slugs are frozen at creation: only backfill if this record has none yet.
  let extra = {}
  if (!data.slug) {
    const existing = await getDoc(doc(db, 'people', id))
    if (existing.exists() && !existing.data().slug) {
      extra.slug = await generatePersonSlug(
        data.fullName ?? existing.data().fullName ?? '', id
      )
    }
  }
  return updateDoc(doc(db, 'people', id), { ...data, ...extra, updatedAt: serverTimestamp() })
}

// Per-match player lineup — stored as homeLineup / awayLineup arrays on the
// match document so existing Firestore rules for match writes already apply.
// Entries are independent of the permanent `players` roster.
//
// lineupPersonIds is a flat string array (all personIds across both lineups)
// maintained alongside the lineup arrays so that the reverse query
// "which matches is player X listed in?" can use a single array-contains
// index with no composite index required.
export async function addPersonToMatchLineup(matchId, { personId, personName, side, shirtNumber = null, isStarter = false }) {
  const matchRef = doc(db, 'matches', matchId)
  const [snap, personSnap] = await Promise.all([
    getDoc(matchRef),
    getDoc(doc(db, 'people', personId)),
  ])
  if (!snap.exists()) throw new Error('Match not found')
  const data = snap.data()
  const field = side === 'home' ? 'homeLineup' : 'awayLineup'
  const current = data[field] ?? []
  if (current.some(e => e.personId === personId)) return
  const pd = personSnap.exists() ? personSnap.data() : {}
  const controllerUids = [
    pd.ownerUid,
    ...(pd.guardianUids ?? []),
    ...(pd.managerUids ?? []),
  ].filter(Boolean)
  const entry = {
    id: crypto.randomUUID(),
    personId, personName,
    photoUrl: pd.photoUrl ?? null,
    shirtNumber: shirtNumber || null,
    isStarter,
    controllerUids,
  }
  const existing = data.lineupPersonIds ?? []
  const lineupPersonIds = existing.includes(personId) ? existing : [...existing, personId]
  // Write competitionIds maintenance FIRST (committed before any stat write reads it).
  if (data.competitionId) {
    await updateDoc(doc(db, 'people', personId), {
      competitionIds: arrayUnion(data.competitionId),
    }).catch(() => {})
  }
  await updateDoc(matchRef, { [field]: [...current, entry], lineupPersonIds })

  // Best-effort: make sure a stat slice exists for this player + team so the
  // appearance accrues stats immediately (competition slice for a competition
  // match; season roster entry for a friendly). The stats engine self-heals any
  // gap nightly, so a permission failure here is harmless.
  await ensurePlayerSlice(data, side, { id: personId, fullName: personName, slug: pd.slug ?? null })
    .catch(() => {})
}

// Create the (person, team, competition | season) stat slice for a lineup
// appearance when none exists. Mirrors functions/statsEngine.js
// ensureSlicesFromLineups — keep the two in sync.
async function ensurePlayerSlice(match, side, person) {
  const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId
  if (!teamId || !person.id) return
  const competitionId = match.competitionId ?? null
  const season = competitionId ? null : (match.season ? String(match.season) : null)

  const snap = await getDocs(query(
    collection(db, 'players'),
    where('personId', '==', person.id), where('teamId', '==', teamId),
  ))
  const existing = snap.docs.map(d => d.data())
  const has = competitionId
    ? existing.some(p => p.competitionId === competitionId)
    : existing.some(p => !p.competitionId && (!p.season || !season || String(p.season) === season))
  if (has) return

  const [teamSnap, compSnap] = await Promise.all([
    getDoc(doc(db, 'teams', teamId)),
    competitionId ? getDoc(doc(db, 'competitions', competitionId)) : Promise.resolve(null),
  ])
  const t = teamSnap.exists() ? teamSnap.data() : {}
  const c = compSnap?.exists() ? compSnap.data() : {}
  await addDoc(collection(db, 'players'), {
    personId: person.id, personName: person.fullName ?? null, personSlug: person.slug ?? null,
    teamId, competitionId, season,
    organizationId: t.organizationId ?? null,
    shirtNumber: null, position: null, isCaptain: false,
    caps: 0, goals: 0, assists: 0, cards: { green: 0, yellow: 0, red: 0 },
    competitionName: c.name ?? null,
    competitionSeason: c.season ?? null,
    competitionStatus: c.status ?? null,
    teamDisplayName: t.displayName ?? null,
    teamShortCode: t.shortCode ?? null,
    teamPrimaryColor: t.primaryColor ?? null,
    createdBy: uid(), createdAt: serverTimestamp(),
  })
}

export async function removePersonFromMatchLineup(matchId, entryId, side) {
  const matchRef = doc(db, 'matches', matchId)
  const snap = await getDoc(matchRef)
  if (!snap.exists()) return
  const data = snap.data()
  const field = side === 'home' ? 'homeLineup' : 'awayLineup'
  const current = data[field] ?? []
  const nextField = current.filter(e => e.id !== entryId)
  // Recompute the flat index from both lineups after removal.
  const homeLineup = field === 'homeLineup' ? nextField : (data.homeLineup ?? [])
  const awayLineup = field === 'awayLineup' ? nextField : (data.awayLineup ?? [])
  const lineupPersonIds = [
    ...homeLineup.map(e => e.personId),
    ...awayLineup.map(e => e.personId),
  ]
  await updateDoc(matchRef, { [field]: nextField, lineupPersonIds })
}

export async function toggleLineupStarter(matchId, entryId, side) {
  const matchRef = doc(db, 'matches', matchId)
  const snap = await getDoc(matchRef)
  if (!snap.exists()) return
  const field = side === 'home' ? 'homeLineup' : 'awayLineup'
  const current = snap.data()[field] ?? []
  await updateDoc(matchRef, {
    [field]: current.map(e => e.id === entryId ? { ...e, isStarter: !e.isStarter } : e),
  })
}

// Edit a single lineup entry's per-fixture details (shirt number / starter flag).
// The squad shirt number carries through when a squad player is added; a scorer
// can override it for THIS fixture here without altering the squad record.
export async function updateMatchLineupEntry(matchId, entryId, side, patch = {}) {
  const matchRef = doc(db, 'matches', matchId)
  const snap = await getDoc(matchRef)
  if (!snap.exists()) return
  const field = side === 'home' ? 'homeLineup' : 'awayLineup'
  const current = snap.data()[field] ?? []
  const clean = {}
  if ('shirtNumber' in patch) clean.shirtNumber = patch.shirtNumber ? String(patch.shirtNumber) : null
  if ('isStarter'  in patch)  clean.isStarter   = !!patch.isStarter
  await updateDoc(matchRef, {
    [field]: current.map(e => e.id === entryId ? { ...e, ...clean } : e),
  })
}

// data may include ownerOrgId to scope the competition to an organisation.
export async function createCompetition(data) {
  return addDoc(collection(db, 'competitions'), { ...data, createdBy: uid(), createdAt: serverTimestamp() })
}
export async function updateCompetition(id, data) {
  return updateDoc(doc(db, 'competitions', id), { ...data, updatedAt: serverTimestamp() })
}

// Delete a list of document refs in Firestore-batch-sized chunks (limit 500/op).
async function deleteRefsInBatches(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
}

// Deletable subcollections hanging off a competition document. Kept in one
// place so the cascade can't silently miss one as the structure model grows.
// `snapshots` and `auditLog` are intentionally omitted: Firestore rules make
// them immutable (allow delete: if false), so they cannot be removed by anyone.
// Once the parent competition document is deleted they are unreachable orphans,
// which is harmless.
const COMPETITION_SUBCOLLECTIONS = [
  'fixtures', 'teams', 'invites', 'stages', 'pools',
  'knockout', 'advancement',
]

// Permanently delete a competition and EVERYTHING associated with it:
//   • every fixture — the top-level match documents (competitionId == id) and
//     each match's events subcollection
//   • every competition subcollection (membership, structure, audit, …)
//   • the competition document itself
// Platform-admin only: enforced by Firestore rules (competition + match delete
// both require isPlatformAdmin); the UI gates the action to master admins too.
export async function deleteCompetition(competitionId) {
  // 1 — Linked match documents and their events subcollections.
  const matchSnap = await getDocs(
    query(collection(db, 'matches'), where('competitionId', '==', competitionId))
  )
  for (const m of matchSnap.docs) {
    const eventsSnap = await getDocs(collection(db, 'matches', m.id, 'events'))
    await deleteRefsInBatches(eventsSnap.docs.map(d => d.ref))
  }
  await deleteRefsInBatches(matchSnap.docs.map(d => d.ref))

  // 2 — Competition subcollections.
  for (const name of COMPETITION_SUBCOLLECTIONS) {
    const snap = await getDocs(collection(db, 'competitions', competitionId, name))
    await deleteRefsInBatches(snap.docs.map(d => d.ref))
  }

  // 2b — Player stat slices for this competition (top-level `players` docs).
  // Without this they linger and keep showing an empty team block on the
  // player's profile even though the competition and its fixtures are gone.
  const slicesSnap = await getDocs(
    query(collection(db, 'players'), where('competitionId', '==', competitionId))
  )
  await deleteRefsInBatches(slicesSnap.docs.map(d => d.ref))

  // 3 — The competition document itself.
  await deleteDoc(doc(db, 'competitions', competitionId))
}

// Structured competition creation used by the /manage/competitions/new flow.
// Creates the doc with default rules for the chosen type and marks it draft.
//
// Ownership is EITHER an org (orgId → ownerOrgId) OR an individual user
// (ownerUserId). Personal competitions carry ownerUserId and no ownerOrgId;
// createCompetition() also stamps createdBy, which grants admin authority.
export async function createManagedCompetition({ seriesName, name, slugBase, season, type, orgId, ownerUserId, gender, ageGroup }) {
  const compName = (name || `${seriesName} ${season}`).replace(/\s+/g, ' ').trim()
  // The slug is derived from slugBase ([gender] [age] [series]) when provided, so
  // the season — already present in the /competitions/:season/ URL segment — is
  // not repeated in the slug. Falls back to the full name for older callers.
  const slug = await generateUniqueCompetitionSlug((slugBase || compName).replace(/\s+/g, ' ').trim())
  return createCompetition({
    name: compName,
    slug,
    seriesName,
    season,
    type,
    ...(orgId       ? { ownerOrgId: orgId }        : {}),
    ...(ownerUserId ? { ownerUserId }              : {}),
    gender:     gender   || null,
    ageGroup:   ageGroup || null,
    status:     'draft',
    published:  false,
    rules:      defaultRulesForType(type),
  })
}

// Update wrapper used by the manage flow; reason param is for caller context only.
export async function updateManagedCompetition(id, patch) {
  return updateCompetition(id, patch)
}

export async function fetchCompetitionsForOrg(orgId) {
  const snap = await getDocs(query(collection(db, 'competitions'), where('ownerOrgId', '==', orgId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.season ?? '').localeCompare(String(a.season ?? '')))
}

// Personal competitions owned by an individual user (no org).
export async function fetchCompetitionsForUser(userId) {
  const snap = await getDocs(query(collection(db, 'competitions'), where('ownerUserId', '==', userId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.season ?? '').localeCompare(String(a.season ?? '')))
}

async function generateUniqueTeamSlug(orgSlug, qualifier) {
  const base = `${slugify(orgSlug)}-${slugify(String(qualifier ?? 'team'))}`
  const existing = await getDocs(query(collection(db, 'teams'), where('slug', '==', base)))
  if (existing.empty) return base
  let n = 2
  while (true) {
    const candidate = `${base}-${n}`
    const snap = await getDocs(query(collection(db, 'teams'), where('slug', '==', candidate)))
    if (snap.empty) return candidate
    n++
  }
}

async function generateUniqueCompetitionSlug(name) {
  const base = slugify(name) || 'competition'
  const existing = await getDocs(query(collection(db, 'competitions'), where('slug', '==', base)))
  if (existing.empty) return base
  let n = 2
  while (true) {
    const candidate = `${base}-${n}`
    const snap = await getDocs(query(collection(db, 'competitions'), where('slug', '==', candidate)))
    if (snap.empty) return candidate
    n++
  }
}

export async function generateUniqueMatchSlug(season, base) {
  const existing = await getDocs(query(
    collection(db, 'matches'),
    where('season', '==', season),
    where('matchSlug', '==', base)
  ))
  if (existing.empty) return base
  let n = 2
  while (true) {
    const candidate = `${base}-${n}`
    const snap = await getDocs(query(
      collection(db, 'matches'),
      where('season', '==', season),
      where('matchSlug', '==', candidate)
    ))
    if (snap.empty) return candidate
    n++
  }
}

async function generateUniqueMatchSlugGlobal(base) {
  const existing = await getDocs(query(collection(db, 'matches'), where('matchSlug', '==', base)))
  if (existing.empty) return base
  let n = 2
  while (true) {
    const candidate = `${base}-${n}`
    const snap = await getDocs(query(collection(db, 'matches'), where('matchSlug', '==', candidate)))
    if (snap.empty) return candidate
    n++
  }
}

export async function createTeam(orgData, displayName, options = {}) {
  const { competitionId = null, season = null, ageGroup = null, gender = null, teamLabel = null } = options
  const orgSlug = orgData.slug || slugify(orgData.name)
  // Always generate a slug. Season-based teams use "{org}-{season}";
  // non-season teams use "{org}-{displayName}" so every team has a profile URL.
  const slug = await generateUniqueTeamSlug(orgSlug, season ?? displayName ?? orgSlug)
  const name = displayName || orgData.name
  return addDoc(collection(db, 'teams'), {
    organizationId: orgData.id,
    orgName:        orgData.name,
    displayName:    name,
    searchName:     name.toLowerCase(),
    shortCode:      orgData.shortCode,
    logoUrl:        orgData.logoUrl || null,
    primaryColor:   orgData.primaryColor,
    secondaryColor: orgData.secondaryColor || '#FFFFFF',
    // Structured naming fields — gender (school: boys/girls, club: division)
    // and the team label (e.g. "U16A" or "1st Team") are stored alongside the
    // generated displayName so teams can be re-rendered and edited consistently.
    ...(ageGroup ? { ageGroup } : {}),
    ...(gender    ? { gender }    : {}),
    ...(teamLabel ? { teamLabel } : {}),
    ...(slug     ? { slug }     : {}),
    active: true,
    played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, points: 0,
    createdBy: uid(), createdAt: serverTimestamp(),
  })
}

// Create a reusable manual/unregistered opponent record. These can be searched
// and reused across fixtures; a platform admin can later link them to a
// registered organisation when that school or club joins the platform.
export async function createManualOpponent(data) {
  const name = (data.name ?? '').trim()
  return addDoc(collection(db, 'manualOpponents'), {
    name,
    searchName:           name.toLowerCase(),
    shortCode:            data.shortCode?.trim().toUpperCase().slice(0, 6) || null,
    type:                 data.type || 'unknown',
    primaryColor:         data.primaryColor || null,
    orgName:              data.orgName || null,
    orgGenderProfile:     data.orgGenderProfile || null,
    gender:               data.gender || null,
    teamLabel:            data.teamLabel || null,
    createdByUid:         uid(),
    createdByOrgId:       data.createdByOrgId || null,
    createdAt:            serverTimestamp(),
    updatedAt:            null,
    linkedOrganisationId: null,
    linkedTeamId:         null,
  })
}

// Case-insensitive prefix search across registered teams and manual opponents.
// Both collections store a lowercase `searchName` field for efficient range queries.
export async function searchOpponents(term, { excludeOrgId } = {}) {
  const t = (term ?? '').trim().toLowerCase()
  if (t.length < 2) return { teams: [], manual: [] }
  const hi = t + ''
  const [teamSnap, manualSnap] = await Promise.all([
    getDocs(query(collection(db, 'teams'),          orderBy('searchName'), startAt(t), endAt(hi), limit(8))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'manualOpponents'), orderBy('searchName'), startAt(t), endAt(hi), limit(8))).catch(() => ({ docs: [] })),
  ])
  let teams = teamSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  if (excludeOrgId) teams = teams.filter(tm => tm.organizationId !== excludeOrgId)
  return {
    teams,
    manual: manualSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  }
}
// Update a team. When the structured naming fields (gender/division +
// teamLabel) change, the cached displayName + searchName are recomputed from
// them so the stored fallback stays consistent with the generated name.
//
// Identity/ownership fields (organizationId, parent school/club) are stripped —
// a team cannot be reparented through this path. Match display names are NOT
// driven by this function; registered teams resolve live from the team + org
// records. propagateTeamNameToMatches (called separately) only refreshes the
// denormalised fallback used for manual opponents, search and legacy safety.
export async function updateTeam(id, data) {
  const { organizationId, orgName, ...patch } = data ?? {}
  if ('gender' in patch || 'teamLabel' in patch) {
    const name = generatedTeamName({ gender: patch.gender ?? null, teamLabel: patch.teamLabel ?? null })
    if (name) {
      patch.displayName = name
      patch.searchName  = name.toLowerCase()
    }
  }
  return updateDoc(doc(db, 'teams', id), { ...patch, updatedAt: serverTimestamp() })
}

// When a team's displayName changes, update the denormalized name on all
// match documents that reference this team so fixtures stay in sync.
export async function propagateTeamNameToMatches(teamId, newName) {
  const [homeSnap, awaySnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'), where('homeTeamId', '==', teamId))),
    getDocs(query(collection(db, 'matches'), where('awayTeamId', '==', teamId))),
  ])
  const total = homeSnap.docs.length + awaySnap.docs.length
  if (total === 0) return
  const batch = writeBatch(db)
  homeSnap.docs.forEach(d => batch.update(d.ref, { homeTeamName: newName }))
  awaySnap.docs.forEach(d => batch.update(d.ref, { awayTeamName: newName }))
  await batch.commit()
}

// When an org's name changes, update the denormalized orgName on all match
// documents that reference it so the display name stays in sync.
export async function propagateOrgNameToMatches(orgId, newName) {
  const [homeSnap, awaySnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'), where('homeOrgId', '==', orgId))),
    getDocs(query(collection(db, 'matches'), where('awayOrgId', '==', orgId))),
  ])
  const total = homeSnap.docs.length + awaySnap.docs.length
  if (total === 0) return
  const batch = writeBatch(db)
  homeSnap.docs.forEach(d => batch.update(d.ref, { homeOrgName: newName }))
  awaySnap.docs.forEach(d => batch.update(d.ref, { awayOrgName: newName }))
  await batch.commit()
}

// When a fixture's team IDs are changed via the edit modal, keep the
// competition fixture-membership doc in sync so standings/stats use the
// correct IDs (they read fx.homeTeamId / fx.awayTeamId first).
// Silently no-ops when no membership doc exists (standalone fixtures).
export async function syncFixtureMembership(matchId, competitionId, { homeTeamId, awayTeamId }) {
  if (!matchId || !competitionId) return
  const patch = {}
  if (homeTeamId !== undefined) patch.homeTeamId = homeTeamId
  if (awayTeamId !== undefined) patch.awayTeamId = awayTeamId
  if (!Object.keys(patch).length) return
  const fxRef = doc(db, 'competitions', competitionId, 'fixtures', matchId)
  return updateDoc(fxRef, { ...patch, updatedAt: serverTimestamp() })
    .catch(e => { if (e.code !== 'not-found') throw e })
}

// Switch a fixture's home and away teams. Swaps every denormalised identity
// field, the score, any shootout, lineups, and flips the side on each recorded
// goal/card so the result stays correct. Regenerates the match slug from the new
// orientation (so the public URL reflects it) and syncs the competition fixture
// membership. Works before OR after scoring.
export async function swapFixtureSides(matchId) {
  const ref = doc(db, 'matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  if (m.competitionId) await assertCompetitionAdmin(m.competitionId)

  const flipSide = arr => Array.isArray(arr)
    ? arr.map(e => (e?.side === 'home' || e?.side === 'away')
        ? { ...e, side: e.side === 'home' ? 'away' : 'home' } : e)
    : arr

  const newHomeName = m.awayTeamName ?? ''
  const newAwayName = m.homeTeamName ?? ''
  const seasonStr = m.competitionSeason ? String(m.competitionSeason) : (m.season ? String(m.season) : null)
  const baseSlug  = buildMatchSlug(newHomeName, newAwayName)
  const matchSlug = seasonStr
    ? await generateUniqueMatchSlug(seasonStr, baseSlug)
    : await generateUniqueMatchSlugGlobal(baseSlug)

  const patch = {
    homeTeamId: m.awayTeamId ?? null, homeTeamName: m.awayTeamName ?? null,
    homeTeamShortCode: m.awayTeamShortCode ?? null, homeTeamColor: m.awayTeamColor ?? null,
    homeTeamSlug: m.awayTeamSlug ?? null,
    homeOrgId: m.awayOrgId ?? null, homeOrgName: m.awayOrgName ?? null, homeRegistered: !!m.awayRegistered,
    awayTeamId: m.homeTeamId ?? null, awayTeamName: m.homeTeamName ?? null,
    awayTeamShortCode: m.homeTeamShortCode ?? null, awayTeamColor: m.homeTeamColor ?? null,
    awayTeamSlug: m.homeTeamSlug ?? null,
    awayOrgId: m.homeOrgId ?? null, awayOrgName: m.homeOrgName ?? null, awayRegistered: !!m.homeRegistered,
    homeScore: m.awayScore ?? 0, awayScore: m.homeScore ?? 0,
    goals: flipSide(m.goals ?? []), cards: flipSide(m.cards ?? []),
    matchSlug,
    updatedBy: uid(), updatedAt: serverTimestamp(),
  }
  if (m.shootoutHome != null || m.shootoutAway != null) {
    patch.shootoutHome = m.shootoutAway ?? null
    patch.shootoutAway = m.shootoutHome ?? null
  }
  if (m.homeLineup !== undefined || m.awayLineup !== undefined) {
    patch.homeLineup = m.awayLineup ?? []
    patch.awayLineup = m.homeLineup ?? []
  }
  // Keep playoff holding metadata aligned so team auto-stamping stays correct.
  if (m.isPlayoffHolding) {
    patch.playoffHomeSlotId = m.playoffAwaySlotId ?? null
    patch.playoffAwaySlotId = m.playoffHomeSlotId ?? null
  }
  await updateDoc(ref, patch)
  if (m.competitionId) {
    await syncFixtureMembership(matchId, m.competitionId, { homeTeamId: patch.homeTeamId, awayTeamId: patch.awayTeamId }).catch(() => {})
    await addCompetitionAuditEvent(m.competitionId, { eventType: 'fixture_sides_swapped', after: { matchId, matchSlug } }).catch(() => {})
  }
  return { matchSlug }
}

// Set (or clear) a person's profile banner image. Permitted by rules for the
// person's owner/guardians/managers and platform admins.
export async function updatePersonBanner(personId, bannerUrl) {
  return updateDoc(doc(db, 'people', personId), {
    bannerUrl: bannerUrl || null,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteTeam(id) {
  return deleteDoc(doc(db, 'teams', id))
}

// Team docs are org assets and carry no competitionId — when a player roster
// is competition-scoped, the caller passes competitionId explicitly.
export async function assignPlayer(teamData, personData, { shirtNumber, position, isCaptain = false, competitionId = null, season = null }) {
  const ref = await addDoc(collection(db, 'players'), {
    personId:      personData.id,
    teamId:        teamData.id,
    competitionId,
    // Roster entries are season-scoped: a player represents a team for a season
    // (calendar year). New seasons start with a clean slate; past entries stay
    // as the permanent record of who represented the team, with their stats.
    season:        season ? String(season) : null,
    organizationId: teamData.organizationId,
    personSlug:    personData.slug ?? null,
    personName:    personData.fullName,
    shirtNumber, position, isCaptain,
    caps: 0, goals: 0, assists: 0, cards: { green: 0, yellow: 0, red: 0 },
    competitionName:    null,
    competitionSeason:  null,
    competitionStatus:  null,
    teamDisplayName:    teamData.displayName,
    teamShortCode:      teamData.shortCode,
    teamPrimaryColor:   teamData.primaryColor,
    createdBy: uid(), createdAt: serverTimestamp(),
  })
  // Record competition participation on the person doc so the career-stat
  // rule can verify the chain (resource.data.competitionIds before-state check).
  if (competitionId && personData.id) {
    await updateDoc(doc(db, 'people', personData.id), {
      competitionIds: arrayUnion(competitionId),
    }).catch(() => {})
  }
  return ref
}
export async function updatePlayer(id, data) {
  return updateDoc(doc(db, 'players', id), { ...data, updatedAt: serverTimestamp() })
}
export async function removePlayer(id) {
  return deleteDoc(doc(db, 'players', id))
}

export async function createMatch(competitionId, homeTeam, awayTeam, {
  scheduledAt, pitch = '', season,
  periods = DEFAULT_PERIODS, periodMinutes = DEFAULT_PERIOD_MINUTES,
  breakMinutes = DEFAULT_BREAK_MINUTES,
  indoor = false,
}) {
  if (!scheduledAt) throw new Error('scheduledAt is required')
  const baseSlug = buildMatchSlug(homeTeam.displayName, awayTeam.displayName)
  const seasonStr = season ? String(season) : null
  const matchSlug = seasonStr
    ? await generateUniqueMatchSlug(seasonStr, baseSlug)
    : await generateUniqueMatchSlugGlobal(baseSlug)

  // A team may be a registered MatchPulse team (has .id) or a manual/unregistered
  // opponent (id is null). Both are supported; only registered teams earn stats.
  const homeRegistered = homeTeam.id != null
  const awayRegistered = awayTeam.id != null

  return addDoc(collection(db, 'matches'), {
    competitionId,
    homeTeamId:        homeRegistered ? homeTeam.id : null,
    homeTeamName:      homeTeam.displayName,
    homeOrgName:       homeTeam.orgName       || null,
    homeTeamShortCode: homeTeam.shortCode     || null,
    homeTeamSlug:      homeTeam.slug          || null,
    homeTeamColor:     homeTeam.primaryColor  || null,
    homeOrgId:         homeTeam.organizationId ?? null,
    homeRegistered,
    ...(homeTeam.manualOpponentId ? { manualHomeOpponentId: homeTeam.manualOpponentId } : {}),
    awayTeamId:        awayRegistered ? awayTeam.id : null,
    awayTeamName:      awayTeam.displayName,
    awayOrgName:       awayTeam.orgName       || null,
    awayTeamShortCode: awayTeam.shortCode     || null,
    awayTeamSlug:      awayTeam.slug          || null,
    awayTeamColor:     awayTeam.primaryColor  || null,
    awayOrgId:         awayTeam.organizationId ?? null,
    awayRegistered,
    ...(awayTeam.manualOpponentId ? { manualAwayOpponentId: awayTeam.manualOpponentId } : {}),
    homeScore: 0, awayScore: 0,
    periods: Number(periods) || DEFAULT_PERIODS,
    periodMinutes: Number(periodMinutes) || DEFAULT_PERIOD_MINUTES,
    breakMinutes: Array.isArray(breakMinutes) ? breakMinutes : DEFAULT_BREAK_MINUTES,
    goals: [], cards: [], controlLog: [],
    startedAt: null, pausedAt: null, totalPausedMs: 0,
    nextPeriodIndex: 1,
    scheduledAt, pitch, indoor: !!indoor, status: 'scheduled', tracked: false,
    matchSlug,
    ...(seasonStr ? { season: seasonStr } : {}),
    createdBy: uid(), createdAt: serverTimestamp(),
  })
}
export async function updateMatch(id, data) {
  return updateDoc(doc(db, 'matches', id), { ...data, updatedBy: uid(), updatedAt: serverTimestamp() })
}
export async function deleteMatch(id) {
  return deleteDoc(doc(db, 'matches', id))
}

// ── Match control (timer + periods) ──────────────────────────────────────────
// Each control action records an immutable audit entry in controlLog with the
// match timestamp captured client-side at the moment of the tap.

function controlEntry(type, period, matchTimestamp) {
  return { type, period: period ?? null, matchTimestamp: matchTimestamp ?? 0,
    clockTime: new Date().toISOString(), createdBy: uid(), createdAt: Date.now() }
}

export async function startMatch(id, { matchTimestamp = 0, periods } = {}) {
  const firstPeriod = periodLabels(periods)[0]
  // The "Start match" tap is the single moment a fixture becomes `tracked` — a
  // human is now live-scoring it. `tracked` drives the live disclaimer, exempts
  // the match from the daily sweep's auto-retire timer, and means any later
  // Awaiting-result hand-off carries the provisional live score (see §3).
  return updateDoc(doc(db, 'matches', id), {
    status: 'live', tracked: true, currentPeriod: firstPeriod,
    startedAt: serverTimestamp(), pausedAt: null, totalPausedMs: 0,
    nextPeriodIndex: 1,
    controlLog: arrayUnion(controlEntry('match_start', firstPeriod, matchTimestamp)),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

export async function pauseMatch(id, { matchTimestamp = 0 } = {}) {
  return updateDoc(doc(db, 'matches', id), {
    status: 'paused', pausedAt: serverTimestamp(),
    controlLog: arrayUnion(controlEntry('pause', null, matchTimestamp)),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Restart a match back to its un-started ("scheduled") state — for when "Start
// match" was tapped by mistake. Clears the clock, period progress, score, goals,
// cards, shootout and control log so it can be kicked off cleanly again.
export async function resetMatch(id) {
  const ref = doc(db, 'matches', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  if (m.competitionId) await assertCompetitionAdmin(m.competitionId)
  await updateDoc(ref, {
    status: 'scheduled', tracked: false,
    startedAt: null, pausedAt: null, totalPausedMs: 0, endedAt: null,
    currentPeriod: null, nextPeriodIndex: 1,
    homeScore: 0, awayScore: 0,
    goals: [], cards: [],
    shootoutHome: null, shootoutAway: null,
    controlLog: [],
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  if (m.competitionId) {
    await addCompetitionAuditEvent(m.competitionId, {
      eventType: 'match_reset', before: { status: m.status }, after: { status: 'scheduled' },
    }).catch(() => {})
  }
}

// Resume mid-period: fold the just-finished pause span into totalPausedMs.
export async function resumeMatch(id, { matchTimestamp = 0, pauseSpanMs = 0 } = {}) {
  return updateDoc(doc(db, 'matches', id), {
    status: 'live', pausedAt: null,
    totalPausedMs: increment(pauseSpanMs),
    controlLog: arrayUnion(controlEntry('resume', null, matchTimestamp)),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// End the current period → enter a break, freeze the clock.
export async function endPeriod(id, { matchTimestamp = 0, period, nextIndex } = {}) {
  return updateDoc(doc(db, 'matches', id), {
    status: 'paused', pausedAt: serverTimestamp(), currentPeriod: 'break',
    nextPeriodIndex: nextIndex ?? 1,
    controlLog: arrayUnion(controlEntry('period_end', period, matchTimestamp)),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Start the next period → resume the clock, folding the break into totalPausedMs.
export async function startPeriod(id, { matchTimestamp = 0, period, index, pauseSpanMs = 0 } = {}) {
  return updateDoc(doc(db, 'matches', id), {
    status: 'live', pausedAt: null, currentPeriod: period,
    totalPausedMs: increment(pauseSpanMs),
    nextPeriodIndex: (index ?? 1) + 1,
    controlLog: arrayUnion(controlEntry('period_start', period, matchTimestamp)),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// ── Goals ─────────────────────────────────────────────────────────────────
// First tap creates a complete, active goal event (Open Play default) and
// increments the score in a single atomic write. Enrichment follows.

export async function addGoal(matchId, side, { matchTimestamp = 0 } = {}) {
  const scoreField = side === 'home' ? 'homeScore' : 'awayScore'
  const id = eventId()
  const event = {
    id, side, matchTimestamp,
    goalType: 'open', scorerName: null, scorerPlayerId: null,
    assistName: null, assistPersonId: null,
    status: 'active', createdBy: uid(), createdAt: Date.now(),
  }
  await updateDoc(doc(db, 'matches', matchId), {
    [scoreField]: increment(1),
    goals: arrayUnion(event),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  return id
}

// Enrich an existing goal (type and/or scorer). Replaces the array entry by id.
export async function enrichGoal(matchId, eventId, patch, currentGoals) {
  const goals = (currentGoals ?? []).map(g => g.id === eventId ? { ...g, ...patch } : g)
  return updateDoc(doc(db, 'matches', matchId), { goals, updatedBy: uid(), updatedAt: serverTimestamp() })
}

// ── Cards ─────────────────────────────────────────────────────────────────
// Timestamp is captured on first tap (held in component state); a single write
// records the complete card once the colour is chosen. No pending events stored.

export async function addCard(matchId, side, { matchTimestamp = 0, cardType, playerName = null, playerPlayerId = null, durationMinutes = null } = {}) {
  const id = eventId()
  const event = {
    id, side, matchTimestamp, cardType,
    playerName, playerPlayerId, durationMinutes,
    status: 'active', createdBy: uid(), createdAt: Date.now(),
  }
  await updateDoc(doc(db, 'matches', matchId), {
    cards: arrayUnion(event),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  return id
}

export async function enrichCard(matchId, eventId, patch, currentCards) {
  const cards = (currentCards ?? []).map(c => c.id === eventId ? { ...c, ...patch } : c)
  return updateDoc(doc(db, 'matches', matchId), { cards, updatedBy: uid(), updatedAt: serverTimestamp() })
}

// ── Event reversal (never delete) ────────────────────────────────────────────
// Marks an event status='reversed' with audit fields. For goals, decrements the
// score. Reversed events are hidden from public/scorer views but kept for audit.

export async function reverseGoal(matchId, eventId, currentGoals) {
  const goals = currentGoals ?? []
  const target = goals.find(g => g.id === eventId)
  if (!target || target.status === 'reversed') return { ok: false, reason: 'not-found' }
  const scoreField = target.side === 'home' ? 'homeScore' : 'awayScore'

  // Data-integrity guard: a reversal must never drive a scoreline negative.
  // Read the authoritative current score (served from the offline cache when
  // disconnected) and abort if decrementing would produce an invalid value.
  const snap = await getDoc(doc(db, 'matches', matchId))
  const current = snap.exists() ? Number(snap.data()[scoreField] ?? 0) : 0
  if (current <= 0) {
    console.warn(
      `[reverseGoal] aborted: ${scoreField} is already ${current}; reversing goal ` +
      `${eventId} on match ${matchId} would produce a negative score. The score ` +
      `was left unchanged and the goal was not reversed.`
    )
    return { ok: false, reason: 'negative-score' }
  }

  const updated = goals.map(g => g.id === eventId
    ? { ...g, status: 'reversed', reversedBy: uid(), reversedAt: Date.now() }
    : g)
  await updateDoc(doc(db, 'matches', matchId), {
    goals: updated,
    [scoreField]: increment(-1),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  return { ok: true }
}

export async function reverseCard(matchId, eventId, currentCards) {
  const cards = currentCards ?? []
  const target = cards.find(c => c.id === eventId)
  if (!target || target.status === 'reversed') return { ok: false, reason: 'not-found' }
  const updated = cards.map(c => c.id === eventId
    ? { ...c, status: 'reversed', reversedBy: uid(), reversedAt: Date.now() }
    : c)
  await updateDoc(doc(db, 'matches', matchId), { cards: updated, updatedBy: uid(), updatedAt: serverTimestamp() })
  return { ok: true }
}

// Derived stats (competition slices + people career totals) are NOT written on
// the client. They are recomputed-from-history by privileged backend functions
// (functions/statsEngine.js): a scoped competition rebuild fires on every
// fixture finalisation/edit (recomputeCompetitionStatsOnFinal), and a wholesale
// career rebuild runs nightly (dailyCareerStatsRecompute). The client's only job
// is to record the result on the match doc; the trigger derives everything else.

// Live-scored finalisation: the scorer taps "End match / Finalise". Sets Final
// and audits the transition; the finalisation trigger recomputes the
// competition's stats from the match timeline.
export async function finalizeMatch(matchId) {
  const matchSnap = await getDoc(doc(db, 'matches', matchId))
  if (!matchSnap.exists()) throw new Error('Match not found')
  const m = matchSnap.data()
  const before = { status: m.status, homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null }

  await updateDoc(doc(db, 'matches', matchId), {
    status: 'final', endedAt: serverTimestamp(), pausedAt: null,
    resultSource: 'tracked',
    controlLog: arrayUnion(controlEntry('match_end', null, 0)),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })

  // Stats are recomputed from history by the finalisation trigger — no client write.

  await recordFixtureAudit(matchId, {
    eventType: 'result_set', method: 'tapped_finalise', before,
    after: { status: 'final', homeScore: m.homeScore ?? 0, awayScore: m.awayScore ?? 0 },
    competitionId: m.competitionId ?? null,
  }).catch(() => {})
}

// Resolve an Awaiting-result fixture (or a directly-submitted one, Path D) to
// Final with an explicit, human-entered score. The system NEVER invents this
// score — an authorised user types it. Standings recompute from scratch on read.
// `method` records HOW the result was reached for the audit trail:
//   'submitted'      — entered directly (Path D, or a never-tracked sweep)
//   'admin_approved' — confirmed from the awaiting-result queue
// Goal/card events supplied by the caller (§D: submit-result stat parity) are
// written to the match doc for untracked fixtures. Stats themselves are derived
// from that timeline by the finalisation trigger — the client writes no stats.
export async function submitFixtureResult(matchId, {
  homeScore, awayScore, method = 'submitted',
  goals: submittedGoals = null,
  cards: submittedCards = null,
} = {}) {
  const snap = await getDoc(doc(db, 'matches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  const hs = Number(homeScore), as = Number(awayScore)
  if (!Number.isFinite(hs) || !Number.isFinite(as) || hs < 0 || as < 0) {
    throw new Error('Enter a valid score for both teams.')
  }
  const before = { status: m.status, homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null }

  // Build normalised event objects from the caller-supplied stat arrays. Only
  // written when the caller provides them (untracked submissions); tracked
  // matches already carry a live-scored timeline and it must not be overwritten.
  // Submitted events carry NO matchTimestamp — the scorer is known but the
  // minute is not, and the platform never fabricates a time. Stats count them
  // (the stats engine reads names, not timestamps); the public timeline shows
  // them without a minute label.
  const goalEvents = (!m.tracked && submittedGoals)
    ? submittedGoals.map(g => ({
        id: eventId(), side: g.side, matchTimestamp: null,
        goalType: g.goalType || 'open',
        scorerName: g.scorerName || null,
        scorerPersonId: g.scorerPersonId || null,
        assistName: g.assistName || null,
        assistPersonId: g.assistPersonId || null,
        status: 'active', createdBy: uid(), createdAt: Date.now(),
      }))
    : null

  const cardEvents = (!m.tracked && submittedCards)
    ? submittedCards.map(c => ({
        id: eventId(), side: c.side, matchTimestamp: null,
        cardType: c.cardType,
        playerName: c.playerName || null, playerPlayerId: null, durationMinutes: null,
        status: 'active', createdBy: uid(), createdAt: Date.now(),
      }))
    : null

  await updateDoc(doc(db, 'matches', matchId), {
    status: 'final', homeScore: hs, awayScore: as,
    // An entered result stays labelled 'submitted' even when scorers were
    // attributed — only a live-scored match is 'tracked'. The public page uses
    // this to explain the absence of a minute-by-minute timeline.
    resultSource: m.tracked ? 'tracked' : 'submitted',
    endedAt: serverTimestamp(), pausedAt: null,
    controlLog: arrayUnion(controlEntry('match_end', null, 0)),
    ...(goalEvents ? { goals: goalEvents } : {}),
    ...(cardEvents ? { cards: cardEvents } : {}),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })

  // Stats are recomputed from the (now-written) timeline by the finalisation
  // trigger — no client write.

  await recordFixtureAudit(matchId, {
    eventType: 'result_set', method, before,
    after: { status: 'final', homeScore: hs, awayScore: as },
    competitionId: m.competitionId ?? null,
  }).catch(() => {})
}

// Edit the score of an already-Final fixture (spec §6 — results stay editable;
// the audit log is what makes open editing safe). Standings recompute on read,
// so an edit can never double-count.
export async function editFinalResult(matchId, { homeScore, awayScore } = {}) {
  const snap = await getDoc(doc(db, 'matches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  const hs = Number(homeScore), as = Number(awayScore)
  if (!Number.isFinite(hs) || !Number.isFinite(as) || hs < 0 || as < 0) {
    throw new Error('Enter a valid score for both teams.')
  }
  const before = { status: m.status, homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null }
  await updateDoc(doc(db, 'matches', matchId), {
    homeScore: hs, awayScore: as,
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  await recordFixtureAudit(matchId, {
    eventType: 'result_edited', method: 'edited', before,
    after: { status: m.status, homeScore: hs, awayScore: as },
    competitionId: m.competitionId ?? null,
  }).catch(() => {})
}

// Postpone a fixture (not terminal) or, when a new time is supplied, reschedule
// it straight back to Scheduled (spec §2 — setting a new time returns it to
// Scheduled). Passing no time parks it as Postponed (TBC).
export async function postponeFixture(matchId, { newScheduledAt = null } = {}) {
  const snap = await getDoc(doc(db, 'matches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  const before = { status: m.status, scheduledAt: m.scheduledAt ?? null }
  const patch = newScheduledAt
    ? { status: 'scheduled', tracked: false, scheduledAt: newScheduledAt }
    : { status: 'postponed' }
  await updateDoc(doc(db, 'matches', matchId), { ...patch, updatedBy: uid(), updatedAt: serverTimestamp() })
  await recordFixtureAudit(matchId, {
    eventType: newScheduledAt ? 'rescheduled' : 'postponed', method: 'status_change',
    before, after: { status: patch.status, scheduledAt: newScheduledAt ?? null },
    competitionId: m.competitionId ?? null,
  }).catch(() => {})
}

// Cancel a fixture (terminal — never counts, never returns).
export async function cancelFixture(matchId, { reason = null } = {}) {
  const snap = await getDoc(doc(db, 'matches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  const before = { status: m.status }
  await updateDoc(doc(db, 'matches', matchId), {
    status: 'cancelled', updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  await recordFixtureAudit(matchId, {
    eventType: 'cancelled', method: 'status_change', reason,
    before, after: { status: 'cancelled' },
    competitionId: m.competitionId ?? null,
  }).catch(() => {})
}

// ── Fixtures without a played result ──────────────────────────────────────────
// One score slot, one banner (match.outcome) above it. The banner's `flag`
// (awarded / frozen / final) tells standings and stats how to read the score —
// see src/lib/fixtureResult.js. Every action is reversible and audited to the
// per-competition audit log (competitions/{id}/auditLog).

async function readMatchForOutcome(matchId) {
  const ref = doc(db, 'matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()
  if (m.competitionId) await assertCompetitionAdmin(m.competitionId)
  return { ref, m }
}

function outcomeAudit(competitionId, matchId, eventType, before, after, reason) {
  if (!competitionId) return Promise.resolve()
  return addCompetitionAuditEvent(competitionId, { eventType, before, after, reason: reason ?? null, matchId: matchId ?? null }).catch(() => {})
}

// A snapshot of the current result state, stored on the outcome so a revert
// restores the fixture exactly.
function prevSnapshot(m) {
  return { status: m.status ?? null, homeScore: m.homeScore ?? 0, awayScore: m.awayScore ?? 0 }
}

// Not played — festival/friendly with no consequence. No score, no log, no stats.
export async function setFixtureNotPlayed(matchId, { reason = null } = {}) {
  const { ref, m } = await readMatchForOutcome(matchId)
  const outcome = { kind: 'not_played', flag: null, prev: prevSnapshot(m), reason: reason || null, by: uid(), at: Date.now() }
  await updateDoc(ref, { status: 'final', homeScore: 0, awayScore: 0, outcome, updatedBy: uid(), updatedAt: serverTimestamp() })
  await outcomeAudit(m.competitionId, matchId, 'fixture_not_played', prevSnapshot(m), { kind: 'not_played' }, reason)
}

// Walkover / withdrawal / no-show. The opponent is credited the awarded score
// (competition default, overridable). `awardedTo` is 'home' | 'away'.
export async function setFixtureWalkover(matchId, { kind = 'walkover', awardedTo, home, away, reason = null } = {}) {
  if (!['walkover', 'withdrawal', 'no_show'].includes(kind)) throw new Error('Invalid walkover kind.')
  if (awardedTo !== 'home' && awardedTo !== 'away') throw new Error('awardedTo must be home or away.')
  const { ref, m } = await readMatchForOutcome(matchId)
  const homeScore = Number(home) || 0
  const awayScore = Number(away) || 0
  const outcome = { kind, flag: 'awarded', awardedTo, prev: prevSnapshot(m), reason: reason || null, by: uid(), at: Date.now() }
  await updateDoc(ref, { status: 'final', homeScore, awayScore, outcome, updatedBy: uid(), updatedAt: serverTimestamp() })
  await outcomeAudit(m.competitionId, matchId, `fixture_${kind}`, prevSnapshot(m), { kind, awardedTo, homeScore, awayScore }, reason)
}

// Abandon — freeze the current score as a stopped-attempt record, flag the
// timeline's goals/cards as an abandoned attempt, reset the live slot to 0-0 and
// return the fixture to Scheduled to await a replay. Nothing counts until the
// replay finalises (or the frozen score is let-stand).
export async function abandonMatch(matchId, { minute = 0, reason = null } = {}) {
  const { ref, m } = await readMatchForOutcome(matchId)
  const frozen = { home: m.homeScore ?? 0, away: m.awayScore ?? 0, minute: Number(minute) || 0 }
  const goals = (m.goals ?? []).map(g => (g.status === 'reversed' ? g : { ...g, abandonedAttempt: true }))
  const cards = (m.cards ?? []).map(c => (c.status === 'reversed' ? c : { ...c, abandonedAttempt: true }))
  const outcome = { kind: 'abandoned', flag: 'frozen', frozen, prev: prevSnapshot(m), reason: reason || null, by: uid(), at: Date.now() }
  await updateDoc(ref, {
    status: 'scheduled', tracked: false,
    homeScore: 0, awayScore: 0,
    startedAt: null, pausedAt: null, totalPausedMs: 0, endedAt: null,
    currentPeriod: null, nextPeriodIndex: 1,
    goals, cards,
    controlLog: arrayUnion(controlEntry('abandoned', null, Number(minute) || 0)),
    outcome,
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  await outcomeAudit(m.competitionId, matchId, 'fixture_abandoned', prevSnapshot(m), { kind: 'abandoned', frozen }, reason)
}

// Let it stand — the frozen abandoned score becomes the real result. Restore the
// frozen score into the slot, flag Final; standings + stats now read it (and the
// abandoned-attempt goals count).
export async function letAbandonedStand(matchId, { reason = null } = {}) {
  const { ref, m } = await readMatchForOutcome(matchId)
  const o = m.outcome
  if (!o || o.kind !== 'abandoned' || o.flag !== 'frozen') throw new Error('Fixture is not a frozen abandoned attempt.')
  const home = o.frozen?.home ?? 0
  const away = o.frozen?.away ?? 0
  const outcome = { ...o, flag: 'final', standBy: uid(), standAt: Date.now(), reason: reason || o.reason || null }
  await updateDoc(ref, { status: 'final', homeScore: home, awayScore: away, outcome, updatedBy: uid(), updatedAt: serverTimestamp() })
  await outcomeAudit(m.competitionId, matchId, 'fixture_let_stand', { kind: 'abandoned', flag: 'frozen', frozen: o.frozen }, { flag: 'final', homeScore: home, awayScore: away }, reason)
}

// Revert any outcome — restore the fixture to its pre-outcome state. Un-flags any
// abandoned-attempt goals/cards. Organiser/admin only, audited.
export async function revertFixtureOutcome(matchId, { reason = null } = {}) {
  const { ref, m } = await readMatchForOutcome(matchId)
  const o = m.outcome
  if (!o || !o.kind) throw new Error('Fixture has no outcome to revert.')
  const prev = o.prev ?? { status: 'scheduled', homeScore: 0, awayScore: 0 }
  const patch = {
    status: prev.status ?? 'scheduled',
    homeScore: prev.homeScore ?? 0,
    awayScore: prev.awayScore ?? 0,
    outcome: deleteField(),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  }
  if (o.kind === 'abandoned') {
    patch.goals = (m.goals ?? []).map(({ abandonedAttempt, ...g }) => g)
    patch.cards = (m.cards ?? []).map(({ abandonedAttempt, ...c }) => c)
  }
  await updateDoc(ref, patch)
  await outcomeAudit(m.competitionId, matchId, 'fixture_outcome_reverted', { kind: o.kind, flag: o.flag }, prev, reason)
}

// ── Organisation staff ───────────────────────────────────────────────────────
// Staff membership lives in organizations/{orgId}/staff/{uid} and is mirrored
// onto users/{uid}.orgRoles for single-read access checks at sign-in.

export async function findUserByEmail(email) {
  const snap = await getDocs(query(collection(db, 'userProfiles'), where('email', '==', email.trim().toLowerCase())))
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// Appoint a member into a fixed role, optionally scoped to one team
// (teamId null = whole org). Appointment grants the role's natural permission
// set exactly — the appointer never edits the appointee's permissions (only
// a Master Admin can, via users/{uid}.permissionOverrides).
export async function setOrgStaff(orgId, userId, role, { teamId = null } = {}) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'organizations', orgId, 'staff', userId), {
    role, teamId: teamId || null, grantedBy: uid(), grantedAt: serverTimestamp(),
  })
  // Mirror the FULL grant (role + scope) so canDo() can resolve team scope
  // without reading the authoritative staff doc on every check. Use a field-path
  // update so this entry is merged into the existing map without replacing it.
  batch.update(doc(db, 'users', userId), {
    [`orgRoles.${orgId}`]: { role, teamId: teamId || null },
  })
  return batch.commit()
}

export async function removeOrgStaff(orgId, userId) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'organizations', orgId, 'staff', userId))
  // Atomically remove just this org's key from the mirrored map.
  batch.update(doc(db, 'users', userId), {
    [`orgRoles.${orgId}`]: deleteField(),
  })
  return batch.commit()
}

export async function fetchOrgStaff(orgId) {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'staff'))
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  // The staff subcollection only stores role/grant metadata. Join each user's
  // public profile so display names (not raw UIDs) can be shown.
  const profiles = await Promise.all(rows.map(r =>
    getDoc(doc(db, 'userProfiles', r.id))
      .then(u => (u.exists() ? u.data() : {}))
      .catch(() => ({}))
  ))
  return rows.map((r, i) => ({
    ...r,
    displayName: profiles[i].displayName ?? null,
    name:        profiles[i].name ?? null,
    email:       profiles[i].email ?? null,
  }))
}

// ── Competition staff (direct ownership, independent of any org) ──────────────
export async function setCompetitionStaff(compId, userId, role = 'admin') {
  const batch = writeBatch(db)
  batch.set(doc(db, 'competitions', compId, 'staff', userId), {
    role, grantedBy: uid(), grantedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'users', userId), {
    [`competitionRoles.${compId}`]: { role },
  })
  return batch.commit()
}

export async function removeCompetitionStaff(compId, userId) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'competitions', compId, 'staff', userId))
  batch.update(doc(db, 'users', userId), {
    [`competitionRoles.${compId}`]: deleteField(),
  })
  return batch.commit()
}

export async function fetchCompetitionStaff(compId) {
  const snap = await getDocs(collection(db, 'competitions', compId, 'staff'))
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  const profiles = await Promise.all(rows.map(r =>
    getDoc(doc(db, 'userProfiles', r.id))
      .then(u => (u.exists() ? u.data() : {}))
      .catch(() => ({}))
  ))
  return rows.map((r, i) => ({
    ...r,
    displayName: profiles[i].displayName ?? null,
    name:        profiles[i].name ?? null,
    email:       profiles[i].email ?? null,
  }))
}

// ── Master Admin (platform tier) ─────────────────────────────────────────────
// Master Admins sit above all organisations. They assign roles, add other
// Master Admins, and are the ONLY tier that can toggle individual permissions
// per person (users/{uid}.permissionOverrides). Firestore rules block everyone
// else from writing platformAdmin or permissionOverrides.

export async function fetchAllUsers() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('email')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Grant or revoke Master Admin status (masteradmin.add).
export async function setMasterAdmin(userId, isMaster) {
  return updateDoc(doc(db, 'users', userId), {
    platformAdmin: isMaster === true,
    updatedAt: serverTimestamp(),
  })
}

// Activate/deactivate a single permission for a single person
// (permission.toggle). value true forces on, false forces off, null clears
// the override so the natural role's default applies again.
export async function setUserPermissionOverride(userId, capability, value) {
  const snap = await getDoc(doc(db, 'users', userId))
  const overrides = { ...(snap.exists() ? snap.data().permissionOverrides ?? {} : {}) }
  if (value === null || value === undefined) delete overrides[capability]
  else overrides[capability] = value === true
  return updateDoc(doc(db, 'users', userId), {
    permissionOverrides: overrides,
    updatedAt: serverTimestamp(),
  })
}

// ── Player-profile guardianship & delegation ─────────────────────────────────
// Control fields on a people doc:
//   ownerUid     — the player themself (set on transfer, or at self-creation)
//   guardianUids — parents/guardians who created and control the profile
//   managerUids  — delegated coaches/managers (edit access, no control rights)

// Parent flow (player.profile.create): create a player profile on behalf of a
// child. The parent controls it via guardianUids until transfer.
// Create a player profile controlled by the current user, as a parent/guardian
// (default) or as a manager. Profiles are ALWAYS created by a controlling user —
// never by an org — so nothing lands in the system uncontrolled.
export async function createChildPlayerProfile(data, relationship = 'guardian', { consented = false } = {}) {
  const userId = uid()
  if (!userId) throw new Error('You must be signed in to create a profile.')
  // Consent is REQUIRED and also enforced by firestore.rules (a user create must
  // carry consentGiven == true, consentByUid == self, a version, and a timestamp).
  if (!consented) { const e = new Error('You must confirm the consent statement to create a profile.'); e.code = 'consent/required'; throw e }
  const slug = await generatePersonSlug(data.fullName ?? '')
  const control = relationship === 'manager'
    ? { ownerUid: null, guardianUids: [],       managerUids: [userId] }
    : { ownerUid: null, guardianUids: [userId],  managerUids: [] }
  return addDoc(collection(db, 'people'), {
    ...data,
    slug,
    roles: ['player'],
    ...control,
    careerCaps: 0, careerGoals: 0,
    careerCards: { green: 0, yellow: 0, red: 0 },
    // Consent record — immutable after creation (firestore.rules), queryable.
    consentGiven: true,
    consentTextVersion: PLAYER_CONSENT_VERSION,
    consentTimestamp: serverTimestamp(),
    consentByUid: userId,
    createdBy: userId, createdAt: serverTimestamp(),
  })
}

// Transfer (player.profile.transfer): hand the profile to the child. The
// child takes control (ownerUid); the parent's control ceases — they may be
// re-granted as a manager separately.
export async function transferPlayerProfile(personId, childEmail) {
  const childUser = await findUserByEmail(childEmail)
  if (!childUser) throw new Error('No MatchPulse account found for that email. The player must sign up first.')
  const snap = await getDoc(doc(db, 'people', personId))
  if (!snap.exists()) throw new Error('Player profile not found.')
  const guardians = (snap.data().guardianUids ?? []).filter(g => g !== uid())
  return updateDoc(doc(db, 'people', personId), {
    ownerUid: childUser.id,
    guardianUids: guardians,
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Delegated access (player.manager.grant): the profile's owner or guardian
// grants a coach/manager edit access. A manager may manage many players; a
// player may have many managers. This is a grant on the profile — NOT an
// organisation role and NOT a new profile type.
export async function grantPlayerManager(personId, managerEmail) {
  const managerUser = await findUserByEmail(managerEmail)
  if (!managerUser) throw new Error('No MatchPulse account found for that email.')
  return updateDoc(doc(db, 'people', personId), {
    managerUids: arrayUnion(managerUser.id),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

export async function revokePlayerManager(personId, managerUid) {
  const snap = await getDoc(doc(db, 'people', personId))
  if (!snap.exists()) return
  return updateDoc(doc(db, 'people', personId), {
    managerUids: (snap.data().managerUids ?? []).filter(m => m !== managerUid),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// A profile is "unclaimed" until a user takes it as owner (player) or guardian
// (parent). Managers alone do not count as claimed — a manager-created profile
// can still be claimed by the player/parent.
export function isProfileClaimed(person) {
  return !!(person && (person.ownerUid || (person.guardianUids ?? []).length > 0))
}

// Self-service claim: a signed-in user claims an UNCLAIMED profile as the player
// (owner) or a parent (guardian). Once claimed it locks — further changes go
// through the controller (transfer / manager grant) or a master admin. There is
// intentionally no identity verification; the master-admin reassignment tool
// (adminLinkProfileToUser) is the safety valve for mistakes.
export async function claimPlayerProfile(personId, relationship) {
  const userId = uid()
  if (!userId) throw new Error('You must be signed in to claim a profile.')
  if (relationship !== 'player' && relationship !== 'parent') {
    throw new Error('Choose whether you are the player or a parent/guardian.')
  }
  const ref = doc(db, 'people', personId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Profile not found.')
  if (isProfileClaimed(snap.data())) {
    const e = new Error('This profile has already been claimed. Ask a MatchPulse admin to reassign it if this is wrong.')
    e.code = 'profile/already-claimed'; throw e
  }
  const patch = relationship === 'parent'
    ? { guardianUids: [userId] }
    : { ownerUid: userId }
  await updateDoc(ref, { ...patch, updatedBy: userId, updatedAt: serverTimestamp() })
}

// Master-admin recovery / reassignment: link a user (by their account email) to
// a profile as owner (player), guardian (parent) or manager. Works even on an
// already-claimed profile, so it doubles as the fix for lost/changed emails and
// mis-claims. Platform-admin only (enforced by firestore.rules on the people doc).
export async function adminLinkProfileToUser(personId, email, relationship) {
  const target = await findUserByEmail(email)
  if (!target) throw new Error('No MatchPulse account found for that email. The person must sign up first.')
  const ref = doc(db, 'people', personId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Profile not found.')
  const patch = {}
  if (relationship === 'player')       patch.ownerUid    = target.id
  else if (relationship === 'parent')  patch.guardianUids = arrayUnion(target.id)
  else if (relationship === 'manager') patch.managerUids  = arrayUnion(target.id)
  else throw new Error('Pick a relationship: player, parent or manager.')
  await updateDoc(ref, { ...patch, updatedBy: uid(), updatedAt: serverTimestamp() })
  return { userId: target.id, email: target.email ?? email }
}

// People profiles controlled or managed by the current user (the parent's
// children, the player's own profile, a manager's assigned players).
export async function fetchMyPlayerProfiles() {
  const userId = uid()
  if (!userId) return []
  const [owned, guarded, managed] = await Promise.all([
    getDocs(query(collection(db, 'people'), where('ownerUid', '==', userId))),
    getDocs(query(collection(db, 'people'), where('guardianUids', 'array-contains', userId))),
    getDocs(query(collection(db, 'people'), where('managerUids', 'array-contains', userId))),
  ])
  const seen = new Set()
  const rows = []
  for (const snap of [owned, guarded, managed]) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      rows.push({ id: d.id, ...d.data() })
    }
  }
  return rows.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

// Self-removal (player.fixture.selfremove): a player — or their guardian or
// manager — removes the player from a fixture lineup they were added to.
// Verifies control of the person doc BEFORE writing (defence-in-depth; the
// tight Firestore rule enforces authority via controllerUids on the entry).
// Writes ONLY the single affected lineup array so the rule's affectedKeys()
// check passes — no lineupPersonIds, updatedAt, or updatedBy on this path.
export async function removeSelfFromFixture(matchId, personId) {
  const userId = uid()
  const personSnap = await getDoc(doc(db, 'people', personId))
  if (!personSnap.exists()) throw new Error('Player profile not found.')
  const p = personSnap.data()
  const authorised = p.ownerUid === userId
    || (p.guardianUids ?? []).includes(userId)
    || (p.managerUids ?? []).includes(userId)
  if (!authorised) throw new Error('You do not control this player profile.')

  const matchRef = doc(db, 'matches', matchId)
  const matchSnap = await getDoc(matchRef)
  if (!matchSnap.exists()) throw new Error('Fixture not found.')
  const m = matchSnap.data()

  if ((m.homeLineup ?? []).some(e => e.personId === personId)) {
    return updateDoc(matchRef, {
      homeLineup: m.homeLineup.filter(e => e.personId !== personId),
    })
  }
  if ((m.awayLineup ?? []).some(e => e.personId === personId)) {
    return updateDoc(matchRef, {
      awayLineup: m.awayLineup.filter(e => e.personId !== personId),
    })
  }
}


// ── Competition fixture membership ───────────────────────────────────────────

export async function addFixtureToCompetition(competitionId, match, options = {}) {
  const { countsTowardStandings = true, poolId = null } = options
  await setDoc(
    doc(db, 'competitions', competitionId, 'fixtures', match.id),
    {
      homeTeamId: match.homeTeamId ?? null,
      awayTeamId: match.awayTeamId ?? null,
      countsTowardStandings,
      ...(poolId ? { poolId } : {}),
      addedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

export async function removeFixtureFromCompetition(competitionId, matchId) {
  return deleteDoc(doc(db, 'competitions', competitionId, 'fixtures', matchId))
}

// Fetch helpers for competition sub-collections.

export async function fetchCompetitionFixtures(competitionId) {
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'fixtures'))
  return snap.docs.map(d => ({ matchId: d.id, ...d.data() }))
}

export async function fetchCompetitionTeams(competitionId) {
  const snap = await getDocs(collection(db, 'competitions', competitionId, 'teams'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function addTeamToCompetition(competitionId, teamId, teamData = {}) {
  await setDoc(doc(db, 'competitions', competitionId, 'teams', teamId), {
    ...teamData,
    addedAt: serverTimestamp(),
  }, { merge: true })
}

// Add a participating team to a competition BY NAME — no requirement that the
// team, or its organisation, exists on the platform. This is how a host (e.g. a
// league/festival organiser that fields no team of its own) enters entrants
// before any of them have an account.
//
// The membership doc IS the team record: it carries its own displaySnapshot
// (name + colour) under a generated id, so it never appears as one of any org's
// own club teams. `organizationId` is an OPTIONAL link to a real organisation
// (null = unclaimed); `claimed` mirrors `organizationId != null`. The link
// represents PARTICIPATION ONLY and never grants the linked org any control of
// the competition — control is gated solely on the competition's ownerOrgId.
export async function addNamedTeamToCompetition(competitionId, {
  teamName, primaryColor = null, organizationId = null, orgName = null,
} = {}) {
  await assertCompetitionAdmin(competitionId)
  const name = (teamName ?? '').trim()
  if (!name) { const e = new Error('Team name is required.'); e.code = 'team/name-required'; throw e }
  const ref = doc(collection(db, 'competitions', competitionId, 'teams'))
  await setDoc(ref, {
    teamId:         ref.id,
    organizationId: organizationId || null,
    claimed:        !!organizationId,
    status:         'admin_approved',
    displaySnapshot: {
      teamName:     name,
      orgName:      orgName || null,
      primaryColor: primaryColor || null,
    },
    addedAt: serverTimestamp(),
    addedBy: uid(),
  })
  return ref.id
}

export async function removeTeamFromCompetition(competitionId, teamId) {
  return deleteDoc(doc(db, 'competitions', competitionId, 'teams', teamId))
}

// Edit a participating team's display name within THIS competition (e.g. fix a
// typo). Updates the membership snapshot only — it does not rename the team
// globally. Standings, pool dropdowns and newly-created fixtures pick it up.
export async function updateCompetitionMemberName(competitionId, teamId, name) {
  await assertCompetitionAdmin(competitionId)
  const clean = (name ?? '').trim()
  if (!clean) { const e = new Error('Team name is required.'); e.code = 'team/name-required'; throw e }
  await updateDoc(doc(db, 'competitions', competitionId, 'teams', teamId), {
    'displaySnapshot.teamName': clean,
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'team_name_edited', after: { teamId, name: clean } })
}

export async function inviteTeamToCompetition(competitionId, teamId, data = {}) {
  await assertCompetitionAdmin(competitionId)
  return setDoc(doc(db, 'competitions', competitionId, 'teams', teamId), {
    teamId,
    organizationId: data.organizationId ?? null,
    status: 'invited',
    displaySnapshot: data.displaySnapshot ?? {},
    invitedAt: serverTimestamp(),
    invitedBy: uid(),
  }, { merge: false })
}

export async function acceptCompetitionInvite(competitionId, teamId, token) {
  const inviteSnap = await getDoc(doc(db, 'competitions', competitionId, 'invites', token))
  if (!inviteSnap.exists()) {
    const err = new Error('Invite not found'); err.code = 'invite/not-found'; throw err
  }
  const invite = inviteSnap.data()
  if (invite.status !== 'pending') {
    const err = new Error('Invite not open'); err.code = 'invite/not-pending'; throw err
  }
  if (invite.expiresAt && invite.expiresAt.toDate().getTime() < Date.now()) {
    const err = new Error('Invite expired'); err.code = 'invite/expired'; throw err
  }
  const batch = writeBatch(db)
  batch.update(doc(db, 'competitions', competitionId, 'teams', teamId), {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
    acceptedBy: uid(),
  })
  batch.update(doc(db, 'competitions', competitionId, 'invites', token), {
    status: 'consumed',
    consumedAt: serverTimestamp(),
    consumedBy: uid(),
  })
  await batch.commit()
}

export async function declineCompetitionInvite(competitionId, teamId, token) {
  const inviteSnap = await getDoc(doc(db, 'competitions', competitionId, 'invites', token))
  if (!inviteSnap.exists()) {
    const err = new Error('Invite not found'); err.code = 'invite/not-found'; throw err
  }
  const invite = inviteSnap.data()
  if (invite.status !== 'pending') {
    const err = new Error('Invite not open'); err.code = 'invite/not-pending'; throw err
  }
  const batch = writeBatch(db)
  batch.update(doc(db, 'competitions', competitionId, 'teams', teamId), {
    status: 'declined',
    declinedAt: serverTimestamp(),
    declinedBy: uid(),
  })
  batch.update(doc(db, 'competitions', competitionId, 'invites', token), {
    status: 'consumed',
    consumedAt: serverTimestamp(),
    consumedBy: uid(),
  })
  await batch.commit()
}

// Build all-vs-all pairs with a BALANCED home/away split. Orienting each pair by
// the parity of its index sum spreads hosting evenly — every team ends within one
// of an even home/away split (exactly even when the game count is even). A double
// round-robin plays each pair both ways, so it is perfectly balanced.
export function balancedRoundRobinPairs(items, doubleRoundRobin = false) {
  const out = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const homeFirst = (i + j) % 2 === 0
      const home = homeFirst ? items[i] : items[j]
      const away = homeFirst ? items[j] : items[i]
      out.push([home, away])
      if (doubleRoundRobin) out.push([away, home])
    }
  }
  return out
}

// Generate all-vs-all round-robin pairs for a competition.
// Returns array of created match IDs.
export async function generateRoundRobinFixtures(competitionId, teams, options = {}) {
  const {
    doubleRoundRobin = false,
    season = null,
    periods = DEFAULT_PERIODS,
    periodMinutes = DEFAULT_PERIOD_MINUTES,
    breakMinutes = DEFAULT_BREAK_MINUTES,
    poolId = null,
    ownerOrgId = null,
    competitionSlug = null,
    indoor = false,
  } = options

  const pairs = balancedRoundRobinPairs(teams, doubleRoundRobin)

  const seasonStr  = season ? String(season) : null
  const createdIds = []

  for (const [home, away] of pairs) {
    const baseSlug  = buildMatchSlug(home.displayName, away.displayName)
    const matchSlug = seasonStr
      ? await generateUniqueMatchSlug(seasonStr, baseSlug)
      : await generateUniqueMatchSlugGlobal(baseSlug)

    const ref = await addDoc(collection(db, 'matches'), {
      competitionId,
      ownerOrgId:        ownerOrgId ?? null,
      homeTeamId:        home.id,
      homeTeamName:      home.displayName,
      homeTeamShortCode: home.shortCode     || null,
      homeTeamColor:     home.primaryColor  || null,
      homeOrgId:         home.organizationId ?? null,
      homeOrgName:       home.orgName       || null,
      homeRegistered:    !!home.organizationId,
      awayTeamId:        away.id,
      awayTeamName:      away.displayName,
      awayTeamShortCode: away.shortCode     || null,
      awayTeamColor:     away.primaryColor  || null,
      awayOrgId:         away.organizationId ?? null,
      awayOrgName:       away.orgName       || null,
      awayRegistered:    !!away.organizationId,
      homeScore: 0, awayScore: 0,
      periods:       Number(periods)       || DEFAULT_PERIODS,
      periodMinutes: Number(periodMinutes) || DEFAULT_PERIOD_MINUTES,
      breakMinutes:  Array.isArray(breakMinutes) ? breakMinutes : DEFAULT_BREAK_MINUTES,
      goals: [], cards: [], controlLog: [],
      startedAt: null, pausedAt: null, totalPausedMs: 0,
      nextPeriodIndex: 1,
      scheduledAt: null, pitch: '', indoor: !!indoor, status: 'scheduled', tracked: false,
      matchSlug,
      ...(seasonStr ? { season: seasonStr } : {}),
      ...(competitionSlug && seasonStr ? { competitionSlug, competitionSeason: seasonStr } : {}),
      createdBy: uid(), createdAt: serverTimestamp(),
    })

    await addFixtureToCompetition(
      competitionId,
      { id: ref.id, homeTeamId: home.id, awayTeamId: away.id },
      { countsTowardStandings: true, ...(poolId ? { poolId } : {}) }
    )

    createdIds.push(ref.id)
  }

  return createdIds
}
export async function recordShootout(matchId, shootoutHome, shootoutAway) {
  return updateDoc(doc(db, 'matches', matchId), {
    shootoutHome: Number(shootoutHome),
    shootoutAway: Number(shootoutAway),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

export async function setPlayerOfMatch(matchId, player) {
  return updateDoc(doc(db, 'matches', matchId), {
    playerOfMatch: player ?? null,
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// ── Tournament structure: stages ─────────────────────────────────────────────
// Admins EXPLICITLY define structure; the platform never infers it. A stage is
// one of pool | knockout | single_match. Order is an integer for display.
const STRUCTURE_STAGE_TYPES = ['pool', 'knockout', 'single_match']

export async function createStage(competitionId, { type, name, order = 0 } = {}) {
  await assertCompetitionAdmin(competitionId)
  if (!STRUCTURE_STAGE_TYPES.includes(type)) {
    const err = new Error('Invalid stage type.'); err.code = 'stage/invalid-type'; throw err
  }
  const ref = await addDoc(collection(db, 'competitions', competitionId, 'stages'), {
    type, name: (name ?? '').trim() || type, order,
    createdBy: uid(), createdAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'stage_created', after: { stageId: ref.id, type, name } })
  return ref
}

export async function updateStage(competitionId, stageId, patch = {}) {
  await assertCompetitionAdmin(competitionId)
  const before = (await getDoc(doc(db, 'competitions', competitionId, 'stages', stageId))).data() ?? null
  await updateDoc(doc(db, 'competitions', competitionId, 'stages', stageId), { ...patch, updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, { eventType: 'stage_edited', before, after: { stageId, ...patch } })
}

export async function deleteStage(competitionId, stageId) {
  await assertCompetitionAdmin(competitionId)
  await deleteDoc(doc(db, 'competitions', competitionId, 'stages', stageId))
  await addCompetitionAuditEvent(competitionId, { eventType: 'stage_deleted', before: { stageId } })
}

// ── Pools ─────────────────────────────────────────────────────────────────────
// A pool holds named slots; each slot may hold an accepted/admin-approved team
// or remain a placeholder (teamId null). Slots are stored as an array on the
// pool document — pool.slots[].teamId is the source of truth for membership.
export async function createPool(competitionId, { stageId = null, name, order = 0, slotCount = 4 } = {}) {
  await assertCompetitionAdmin(competitionId)
  const slots = Array.from({ length: Math.max(0, slotCount) }, (_, i) => ({
    slotId: `s${i + 1}`, label: `Slot ${i + 1}`, teamId: null,
  }))
  const ref = await addDoc(collection(db, 'competitions', competitionId, 'pools'), {
    stageId, name: (name ?? '').trim() || 'Pool', order,
    slots,
    verified: false, verifiedAt: null, verifiedBy: null, verificationSnapshotId: null,
    manualOverrides: [],
    createdBy: uid(), createdAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'pool_created', after: { poolId: ref.id, name } })
  return ref
}

export async function updatePool(competitionId, poolId, patch = {}) {
  await assertCompetitionAdmin(competitionId)
  const before = (await getDoc(doc(db, 'competitions', competitionId, 'pools', poolId))).data() ?? null
  await updateDoc(doc(db, 'competitions', competitionId, 'pools', poolId), { ...patch, updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, { eventType: 'pool_edited', before, after: { poolId, ...patch } })
}

export async function deletePool(competitionId, poolId) {
  await assertCompetitionAdmin(competitionId)
  await deleteDoc(doc(db, 'competitions', competitionId, 'pools', poolId))
  await addCompetitionAuditEvent(competitionId, { eventType: 'pool_deleted', before: { poolId } })
}

// Append one empty slot to a pool. Lets organisers size pools unevenly
// (e.g. one pool of 7 and one of 6). The new slotId is unique within the pool.
export async function addPoolSlot(competitionId, poolId) {
  await assertCompetitionAdmin(competitionId)
  const ref = doc(db, 'competitions', competitionId, 'pools', poolId)
  const snap = await getDoc(ref)
  if (!snap.exists()) { const e = new Error('Pool not found.'); e.code = 'pool/not-found'; throw e }
  const slots = snap.data().slots ?? []
  const used = new Set(slots.map(s => s.slotId))
  let n = slots.length + 1
  let slotId = `s${n}`
  while (used.has(slotId)) { n += 1; slotId = `s${n}` }
  const newSlots = [...slots, { slotId, label: `Slot ${slots.length + 1}`, teamId: null }]
  await updateDoc(ref, { slots: newSlots, updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, { eventType: 'pool_slot_added', after: { poolId, slotId } })
}

// Remove a slot from a pool. Only EMPTY slots may be removed (unassign the team
// first). Refuses when the pool has already generated fixtures, since those
// fixtures reference slot ids — regenerate fixtures after resizing instead.
export async function removePoolSlot(competitionId, poolId, slotId) {
  await assertCompetitionAdmin(competitionId)
  const ref = doc(db, 'competitions', competitionId, 'pools', poolId)
  const snap = await getDoc(ref)
  if (!snap.exists()) { const e = new Error('Pool not found.'); e.code = 'pool/not-found'; throw e }
  const slots = snap.data().slots ?? []
  const target = slots.find(s => s.slotId === slotId)
  if (!target) return
  if (target.teamId) { const e = new Error('Unassign the team before removing this slot.'); e.code = 'pool/slot-occupied'; throw e }
  const fxSnap = await getDocs(
    query(collection(db, 'competitions', competitionId, 'fixtures'), where('poolId', '==', poolId))
  )
  if (fxSnap.docs.length > 0) {
    const e = new Error('Fixtures already generated for this pool — remove them before resizing the pool.')
    e.code = 'pool/has-fixtures'; throw e
  }
  await updateDoc(ref, { slots: slots.filter(s => s.slotId !== slotId), updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, { eventType: 'pool_slot_removed', before: { poolId, slotId } })
}

// Assign a team into a pool slot. The team MUST be an accepted/admin-approved
// member of the competition — pending/declined teams cannot be placed.
// When fixtures have already been generated for this pool, any match whose
// homeSlotId or awaySlotId matches this slot is updated to reflect the new
// team (or reverted to the placeholder name when teamId is null).
export async function assignTeamToPoolSlot(competitionId, poolId, slotId, teamId) {
  await assertCompetitionAdmin(competitionId)
  const poolRef = doc(db, 'competitions', competitionId, 'pools', poolId)
  const poolSnap = await getDoc(poolRef)
  if (!poolSnap.exists()) { const e = new Error('Pool not found.'); e.code = 'pool/not-found'; throw e }

  const poolData = poolSnap.data()
  const slotIndex = (poolData.slots ?? []).findIndex(s => s.slotId === slotId) + 1
  const placeholderName = `${poolData.name} #${slotIndex}`

  let memberSnapshot = {}
  if (teamId) {
    const memberSnap = await getDoc(doc(db, 'competitions', competitionId, 'teams', teamId))
    const status = memberSnap.exists() ? memberSnap.data().status : null
    if (status !== 'accepted' && status !== 'admin_approved') {
      const e = new Error('Only accepted or admin-approved teams can be assigned to a pool.')
      e.code = 'pool/team-not-eligible'; throw e
    }
    memberSnapshot = memberSnap.data()?.displaySnapshot ?? {}
  }

  const slots = (poolData.slots ?? []).map(s =>
    s.slotId === slotId ? { ...s, teamId: teamId ?? null } : s)
  await updateDoc(poolRef, { slots, updatedAt: serverTimestamp() })

  // Propagate into any placeholder fixtures already generated for this pool.
  const fxSnap = await getDocs(
    query(collection(db, 'competitions', competitionId, 'fixtures'), where('poolId', '==', poolId))
  )
  if (fxSnap.docs.length > 0) {
    const matchFetches = fxSnap.docs.map(d => getDoc(doc(db, 'matches', d.id)).catch(() => null))
    const matchSnaps = await Promise.all(matchFetches)

    const updateBatch = writeBatch(db)
    let updates = 0
    for (let i = 0; i < fxSnap.docs.length; i++) {
      const matchSnap = matchSnaps[i]
      if (!matchSnap?.exists()) continue
      const m = matchSnap.data()
      const patch = {}, fxPatch = {}

      if (m.homeSlotId === slotId) {
        patch.homeTeamId    = teamId ?? null
        patch.homeTeamName  = teamId ? (memberSnapshot.teamName ?? teamId) : placeholderName
        patch.homeTeamColor = teamId ? (memberSnapshot.colors?.primary ?? null) : null
        patch.homeRegistered = !!teamId
        fxPatch.homeTeamId  = teamId ?? null
      }
      if (m.awaySlotId === slotId) {
        patch.awayTeamId    = teamId ?? null
        patch.awayTeamName  = teamId ? (memberSnapshot.teamName ?? teamId) : placeholderName
        patch.awayTeamColor = teamId ? (memberSnapshot.colors?.primary ?? null) : null
        patch.awayRegistered = !!teamId
        fxPatch.awayTeamId  = teamId ?? null
      }

      if (Object.keys(patch).length > 0) {
        updateBatch.update(doc(db, 'matches', fxSnap.docs[i].id), { ...patch, updatedAt: serverTimestamp() })
        if (Object.keys(fxPatch).length > 0) {
          updateBatch.update(doc(db, 'competitions', competitionId, 'fixtures', fxSnap.docs[i].id),
            { ...fxPatch, updatedAt: serverTimestamp() })
        }
        updates++
      }
    }
    if (updates > 0) await updateBatch.commit()
  }

  await addCompetitionAuditEvent(competitionId, {
    eventType: 'team_assigned_to_pool', after: { poolId, slotId, teamId: teamId ?? null },
  })
}

// Group a fixture into a pool. Sets poolId on the fixture-membership record.
// Cross-pool fixtures do not count toward standings unless explicitly enabled.
export async function setFixturePool(competitionId, matchId, poolId, { crossPool = false } = {}) {
  await assertCompetitionAdmin(competitionId)
  const patch = { poolId: poolId ?? null, crossPool, updatedAt: serverTimestamp() }
  if (crossPool) patch.countsTowardStandings = false
  await updateDoc(doc(db, 'competitions', competitionId, 'fixtures', matchId), patch)
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'fixture_assigned_to_pool', after: { matchId, poolId: poolId ?? null, crossPool },
  })
}

// ── Pool verification ─────────────────────────────────────────────────────────
// Freezes a pool's standings into an immutable snapshot. The snapshot captures
// the exact inputs and rules so a historical decision can always be explained.
// The pool is marked verified and pointed at the snapshot.
export async function verifyPool(competitionId, poolId, {
  rows, inputFixtureIds = [], tieBreakerChain = [], rulesHash: ruleHashValue = null,
  manualOverrides = [],
} = {}) {
  await assertCompetitionAdmin(competitionId)
  const snapRef = await addDoc(collection(db, 'competitions', competitionId, 'snapshots'), {
    kind: 'pool_verification',
    poolId,
    rows: rows ?? [],
    inputFixtureIds,
    tieBreakerChain,
    rulesHash: ruleHashValue,
    manualOverrides,
    verifiedBy: uid(),
    verifiedAt: serverTimestamp(),
  })
  await updateDoc(doc(db, 'competitions', competitionId, 'pools', poolId), {
    verified: true, verifiedAt: serverTimestamp(), verifiedBy: uid(),
    verificationSnapshotId: snapRef.id,
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'pool_verified', after: { poolId, snapshotId: snapRef.id, manualOverrides },
  })
  return snapRef
}

// Reverse a pool verification — clears the verified flag and snapshot pointer so
// the pool returns to provisional and its team assignments can be corrected. The
// immutable verification snapshot document is intentionally LEFT in place as a
// historical record (Firestore rules make snapshots undeletable). Playoff
// holding fixtures auto-stamped from this pool are reset to placeholders by the
// caller so they re-resolve from whatever pools remain verified.
export async function unverifyPool(competitionId, poolId) {
  await assertCompetitionAdmin(competitionId)
  const poolRef  = doc(db, 'competitions', competitionId, 'pools', poolId)
  const poolSnap = await getDoc(poolRef)
  if (!poolSnap.exists()) { const e = new Error('Pool not found.'); e.code = 'pool/not-found'; throw e }
  if (!poolSnap.data().verified) { const e = new Error('This pool is not verified.'); e.code = 'pool/not-verified'; throw e }
  const prevSnapshotId = poolSnap.data().verificationSnapshotId ?? null
  await updateDoc(poolRef, {
    verified: false, verifiedAt: null, verifiedBy: null, verificationSnapshotId: null,
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'pool_unverified', before: { poolId, snapshotId: prevSnapshotId }, after: { poolId },
  })
}

// Record a manual placement override on a pool (used when the tie-breaker chain
// is exhausted and an administrator must decide the order). Reason is required
// and surfaced publicly on the pool page.
export async function setPoolManualPlacement(competitionId, poolId, { placements, reason } = {}) {
  await assertCompetitionAdmin(competitionId)
  if (!reason || reason.trim().length < 5) {
    const e = new Error('A reason is required for a manual placement.'); e.code = 'reason/required'; throw e
  }
  const override = {
    placements: placements ?? [],   // [{ teamId, position }]
    reason: reason.trim(),
    decidedBy: uid(),
    decidedAt: Date.now(),
  }
  const poolRef = doc(db, 'competitions', competitionId, 'pools', poolId)
  const before = (await getDoc(poolRef)).data()?.manualOverrides ?? []
  await updateDoc(poolRef, { manualOverrides: [...before, override], updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'manual_placement_override', after: { poolId, ...override }, reason: reason.trim(),
  })
}

// ── Knockout structure ──────────────────────────────────────────────────────
// Each knockout slot is filled from exactly one explicitly-configured source.
const ADVANCEMENT_SOURCE_KEYS = [
  'pool_position', 'best_runner_up', 'bracket_winner', 'bracket_loser', 'manual_selection', 'direct_team',
]

export async function createKnockoutSlot(competitionId, {
  stageId = null, name, roundLabel = null, order = 0, source = null,
} = {}) {
  await assertCompetitionAdmin(competitionId)
  if (source && !ADVANCEMENT_SOURCE_KEYS.includes(source.type)) {
    const e = new Error('Invalid advancement source.'); e.code = 'knockout/invalid-source'; throw e
  }
  const ref = await addDoc(collection(db, 'competitions', competitionId, 'knockout'), {
    stageId, name: (name ?? '').trim() || 'Slot', roundLabel, order,
    source: source ?? null,
    matchId: null, lockedTeamId: null,
    createdBy: uid(), createdAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'knockout_slot_created', after: { slotId: ref.id, name, source } })
  return ref
}

export async function updateKnockoutSlot(competitionId, slotId, patch = {}) {
  await assertCompetitionAdmin(competitionId)
  if (patch.source && !ADVANCEMENT_SOURCE_KEYS.includes(patch.source.type)) {
    const e = new Error('Invalid advancement source.'); e.code = 'knockout/invalid-source'; throw e
  }
  const before = (await getDoc(doc(db, 'competitions', competitionId, 'knockout', slotId))).data() ?? null
  await updateDoc(doc(db, 'competitions', competitionId, 'knockout', slotId), { ...patch, updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, { eventType: 'knockout_slot_edited', before, after: { slotId, ...patch } })
}

export async function deleteKnockoutSlot(competitionId, slotId) {
  await assertCompetitionAdmin(competitionId)
  await deleteDoc(doc(db, 'competitions', competitionId, 'knockout', slotId))
  await addCompetitionAuditEvent(competitionId, { eventType: 'knockout_slot_deleted', before: { slotId } })
}

// Lock advancement — freeze a resolved team into a knockout slot. Writes an
// immutable advancement record and stamps the slot. Only call once the source
// is resolved (verified pool / decided match / explicit choice).
export async function lockAdvancement(competitionId, slotId, teamId, { source = null } = {}) {
  await assertCompetitionAdmin(competitionId)
  if (!teamId) { const e = new Error('No team to lock.'); e.code = 'advancement/no-team'; throw e }
  await setDoc(doc(db, 'competitions', competitionId, 'advancement', slotId), {
    slotId, teamId, source: source ?? null,
    lockedBy: uid(), lockedAt: serverTimestamp(),
  })
  await updateDoc(doc(db, 'competitions', competitionId, 'knockout', slotId), {
    lockedTeamId: teamId, updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'advancement_locked', after: { slotId, teamId, source } })
}

// ── Organiser override (failsafe) ─────────────────────────────────────────────
// Real tournaments occasionally need the organiser to override a bracket slot
// (a team can't make a fixture, a withdrawal, a reinstatement). The system NEVER
// auto-assigns a replacement — the organiser decides. An override records who,
// when and an optional reason, and preserves the slot's original reference so it
// can be reverted. The `manualOverride` marker is surfaced on the admin AND
// public bracket; downstream slots recompute normally from source.

// Pick a specific team for a slot — sets the slot's source to direct_team.
export async function overrideSlotWithTeam(competitionId, slotId, teamId, { reason = '' } = {}) {
  await assertCompetitionAdmin(competitionId)
  if (!teamId) { const e = new Error('No team selected.'); e.code = 'override/no-team'; throw e }
  const ref = doc(db, 'competitions', competitionId, 'knockout', slotId)
  const before = (await getDoc(ref)).data() ?? null
  if (!before) { const e = new Error('Slot not found.'); e.code = 'override/no-slot'; throw e }
  // Preserve the original reference the first time only, so revert is faithful.
  const originalSource = before.originalSource ?? before.source ?? null
  await updateDoc(ref, {
    source: { type: 'direct_team', teamId },
    originalSource,
    manualOverride: { type: 'team', by: uid(), at: serverTimestamp(), reason: (reason ?? '').trim() || null },
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'slot_override_team', before, after: { slotId, teamId, reason: (reason ?? '').trim() || null },
    reason: (reason ?? '').trim() || null,
  })
}

// Mark a slot as "opponent advances" (walkover). NOTE: the broader walkover /
// withdrawal result + penalty mechanics live in the scoring engine (separate
// build). Here we only record the override marker and keep the hook clean so the
// scoring-engine work can plug in — we do NOT auto-resolve any result.
export async function setSlotWalkover(competitionId, slotId, { reason = '' } = {}) {
  await assertCompetitionAdmin(competitionId)
  const ref = doc(db, 'competitions', competitionId, 'knockout', slotId)
  const before = (await getDoc(ref)).data() ?? null
  if (!before) { const e = new Error('Slot not found.'); e.code = 'override/no-slot'; throw e }
  const originalSource = before.originalSource ?? before.source ?? null
  await updateDoc(ref, {
    originalSource,
    manualOverride: { type: 'walkover', by: uid(), at: serverTimestamp(), reason: (reason ?? '').trim() || null },
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'slot_override_walkover', before, after: { slotId, reason: (reason ?? '').trim() || null },
    reason: (reason ?? '').trim() || null,
  })
}

// Undo an override — restore the slot's original reference and clear the marker.
export async function revertSlotOverride(competitionId, slotId) {
  await assertCompetitionAdmin(competitionId)
  const ref = doc(db, 'competitions', competitionId, 'knockout', slotId)
  const before = (await getDoc(ref)).data() ?? null
  if (!before) { const e = new Error('Slot not found.'); e.code = 'override/no-slot'; throw e }
  await updateDoc(ref, {
    source: before.originalSource ?? before.source ?? null,
    originalSource: deleteField(),
    manualOverride: deleteField(),
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'slot_override_reverted', before, after: { slotId } })
}

// ── Playoff configuration ─────────────────────────────────────────────────────
// Playoff-level settings live on the competition document under `playoffConfig`,
// so they can be flipped later (even on match day) without rebuilding the
// bracket. First flag: `bronze` (3rd/4th play-off), default false.
export async function setPlayoffConfig(competitionId, patch = {}) {
  await assertCompetitionAdmin(competitionId)
  const ref = doc(db, 'competitions', competitionId)
  const before = (await getDoc(ref)).data()?.playoffConfig ?? {}
  const next = { ...before, ...patch }
  await updateDoc(ref, { playoffConfig: next, updatedAt: serverTimestamp() })
  await addCompetitionAuditEvent(competitionId, { eventType: 'playoff_config_updated', before, after: next })
  return next
}

// ── Playoff holding fixtures ──────────────────────────────────────────────────
// Each playoff game is turned into a REAL fixture (schedulable, scorable, listed
// in the Fixtures tab) that starts as a "holding card": placeholder positions
// ("Pool A Winner"), no teams yet, and a STABLE game-type URL slug ("final",
// "semi-final-1") that never changes when the teams resolve. The home slot's
// matchId is linked so the bracket reads the result and shows the schedule.
//
// games: [{ homeSlotId, awaySlotId, homeName, awayName, slug, roundLabel, gameName }]
// format: { periods, periodMinutes, breakMinutes } — the competition's default.
export async function createPlayoffHoldingFixtures(competition, games, format) {
  await assertCompetitionAdmin(competition.id)
  const seasonStr = competition.season ? String(competition.season) : null
  const compSlug  = competition.slug || null
  const created = []
  for (const g of games) {
    const matchSlug = seasonStr
      ? await generateUniqueMatchSlug(seasonStr, g.slug)
      : await generateUniqueMatchSlugGlobal(g.slug)
    const ref = await addDoc(collection(db, 'matches'), {
      competitionId: competition.id,
      ownerOrgId: competition.ownerOrgId || null,
      homeTeamId: null, homeTeamName: g.homeName, homeTeamShortCode: null, homeTeamColor: null,
      homeOrgId: null, homeOrgName: null, homeRegistered: false,
      awayTeamId: null, awayTeamName: g.awayName, awayTeamShortCode: null, awayTeamColor: null,
      awayOrgId: null, awayOrgName: null, awayRegistered: false,
      homeScore: 0, awayScore: 0,
      periods: Number(format.periods), periodMinutes: Number(format.periodMinutes),
      breakMinutes: Array.isArray(format.breakMinutes) ? format.breakMinutes : DEFAULT_BREAK_MINUTES,
      goals: [], cards: [], controlLog: [],
      startedAt: null, pausedAt: null, totalPausedMs: 0, nextPeriodIndex: 1,
      scheduledAt: null, pitch: '', status: 'scheduled', tracked: false,
      matchSlug,
      isPlayoffHolding: true,
      playoffHomeSlotId: g.homeSlotId, playoffAwaySlotId: g.awaySlotId,
      playoffRoundLabel: g.roundLabel || null, playoffGameName: g.gameName || null,
      ...(seasonStr ? { season: seasonStr } : {}),
      ...(compSlug && seasonStr ? { competitionSlug: compSlug, competitionSeason: seasonStr } : {}),
      createdAt: serverTimestamp(), createdBy: uid(),
    })
    // Playoff games never count toward pool standings.
    await addFixtureToCompetition(competition.id, { id: ref.id, homeTeamId: null, awayTeamId: null }, { countsTowardStandings: false })
    // Link the home slot so the bracket reads its result and shows its schedule.
    await updateDoc(doc(db, 'competitions', competition.id, 'knockout', g.homeSlotId), { matchId: ref.id, updatedAt: serverTimestamp() })
    created.push(ref.id)
  }
  await addCompetitionAuditEvent(competition.id, { eventType: 'playoff_fixtures_created', after: { count: created.length } })
  return created
}

// Stamp the resolved real teams onto a holding fixture once the source pools are
// verified. The match slug is intentionally NOT changed — the URL stays stable.
// home/away: { teamId, teamName, orgName, color, shortCode, orgId } | null
export async function stampPlayoffFixtureTeams(competitionId, fixtureId, home, away) {
  await assertCompetitionAdmin(competitionId)
  const patch = { updatedAt: serverTimestamp() }
  if (home) Object.assign(patch, {
    homeTeamId: home.teamId, homeTeamName: home.teamName ?? home.teamId,
    homeTeamColor: home.color ?? null, homeTeamShortCode: home.shortCode ?? null,
    homeOrgId: home.orgId ?? null, homeOrgName: home.orgName ?? null, homeRegistered: !!home.orgId,
  })
  if (away) Object.assign(patch, {
    awayTeamId: away.teamId, awayTeamName: away.teamName ?? away.teamId,
    awayTeamColor: away.color ?? null, awayTeamShortCode: away.shortCode ?? null,
    awayOrgId: away.orgId ?? null, awayOrgName: away.orgName ?? null, awayRegistered: !!away.orgId,
  })
  await updateDoc(doc(db, 'matches', fixtureId), patch)
  await addFixtureToCompetition(competitionId,
    { id: fixtureId, homeTeamId: home?.teamId ?? null, awayTeamId: away?.teamId ?? null },
    { countsTowardStandings: false })
}

// Inverse of stampPlayoffFixtureTeams — return a holding fixture's two sides to
// their placeholder positions (e.g. "Pool A Winner"), clearing the resolved
// teams. Used when a source pool is unverified so the fixture re-resolves from
// whatever remains verified. Never touches a fixture that has been played.
export async function resetPlayoffHoldingFixtureToPlaceholders(competitionId, fixtureId, homeName, awayName) {
  await assertCompetitionAdmin(competitionId)
  await updateDoc(doc(db, 'matches', fixtureId), {
    homeTeamId: null, homeTeamName: homeName ?? 'TBC', homeTeamColor: null, homeTeamShortCode: null,
    homeOrgId: null, homeOrgName: null, homeRegistered: false,
    awayTeamId: null, awayTeamName: awayName ?? 'TBC', awayTeamColor: null, awayTeamShortCode: null,
    awayOrgId: null, awayOrgName: null, awayRegistered: false,
    updatedAt: serverTimestamp(),
  })
  await addFixtureToCompetition(competitionId,
    { id: fixtureId, homeTeamId: null, awayTeamId: null },
    { countsTowardStandings: false }).catch(() => {})
}

// Set the date/time (and optional venue) of a playoff holding fixture.
export async function schedulePlayoffFixture(competitionId, fixtureId, { scheduledAt = null, pitch = null } = {}) {
  await assertCompetitionAdmin(competitionId)
  const patch = { scheduledAt: scheduledAt ?? null, status: 'scheduled', tracked: false, updatedBy: uid(), updatedAt: serverTimestamp() }
  if (pitch != null) patch.pitch = pitch
  await updateDoc(doc(db, 'matches', fixtureId), patch)
}

// ── Schedule configuration ────────────────────────────────────────────────────
// Stored on the competition document as `scheduleConfig`. Controls field
// availability, timing and constraints used by the pool fixture generator.
export async function updateScheduleConfig(competitionId, scheduleConfig) {
  await assertCompetitionAdmin(competitionId)
  await updateDoc(doc(db, 'competitions', competitionId), {
    scheduleConfig,
    updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'schedule_config_updated', after: { scheduleConfig },
  })
}

// ── Pool fixture generation (placeholder-aware) ──────────────────────────────
// Builds a full size-based round-robin from the pool's slot list — one fixture
// per pair. Slots without an assigned team use placeholder names
// (e.g. "Pool A #3"). When a scheduleConfig with a startDate is present,
// the scheduler assigns every fixture a field and time.
export async function generatePoolFixtures(competitionId, poolId, options = {}) {
  const {
    season        = null,
    periods       = DEFAULT_PERIODS,
    periodMinutes = DEFAULT_PERIOD_MINUTES,
    breakMinutes  = DEFAULT_BREAK_MINUTES,
    ownerOrgId    = null,
    scheduleConfig = null,
    indoor        = false,
  } = options

  const competition = await assertCompetitionAdmin(competitionId)

  const poolSnap = await getDoc(doc(db, 'competitions', competitionId, 'pools', poolId))
  if (!poolSnap.exists()) { const e = new Error('Pool not found.'); e.code = 'pool/not-found'; throw e }
  const pool  = { poolId: poolSnap.id, ...poolSnap.data() }
  const slots = pool.slots ?? []

  if (slots.length < 2) {
    const e = new Error('Pool needs at least 2 slots to generate fixtures.')
    e.code = 'pool/too-few-slots'; throw e
  }

  // Build all unique pairs with a balanced home/away split.
  const pairs = balancedRoundRobinPairs(slots, false)

  // Fetch displaySnapshots for every assigned team in one round-trip
  const assignedIds = [...new Set(slots.map(s => s.teamId).filter(Boolean))]
  const memberSnaps = await Promise.all(
    assignedIds.map(tid => getDoc(doc(db, 'competitions', competitionId, 'teams', tid)).catch(() => null))
  )
  const memberMap = {}
  for (const snap of memberSnaps) {
    if (snap?.exists()) memberMap[snap.id] = snap.data().displaySnapshot ?? {}
  }

  // Run the scheduler if a valid config + start date is provided
  const cfg = scheduleConfig ?? competition.scheduleConfig ?? null
  let sched = [], overflow = 0, warnings = []

  if (cfg?.fields?.length && cfg.startDate) {
    const result = schedulePoolFixtures(
      pairs.map(([h, a]) => [h.slotId, a.slotId]),
      poolId,
      { ...cfg }
    )
    sched    = result.assignments
    overflow = result.overflow
    warnings = result.warnings
  }

  // Batch-write all match docs + fixture membership docs atomically
  const seasonStr  = season ? String(season) : null
  const batchWrite = writeBatch(db)
  const createdIds = []

  for (let i = 0; i < pairs.length; i++) {
    const [homeSlot, awaySlot] = pairs[i]
    const homeIdx  = slots.findIndex(s => s.slotId === homeSlot.slotId) + 1
    const awayIdx  = slots.findIndex(s => s.slotId === awaySlot.slotId) + 1
    const homeSnap = memberMap[homeSlot.teamId] ?? {}
    const awaySnap = memberMap[awaySlot.teamId] ?? {}

    const homeTeamName  = homeSnap.teamName  ?? `${pool.name} #${homeIdx}`
    const awayTeamName  = awaySnap.teamName  ?? `${pool.name} #${awayIdx}`
    const homeTeamColor = homeSnap.colors?.primary ?? null
    const awayTeamColor = awaySnap.colors?.primary ?? null

    const assignment  = sched.find(s => s.pairIndex === i)
    const scheduledAt = assignment ? new Date(assignment.startMs) : null
    const pitch       = assignment?.fieldName ?? ''

    const matchRef = doc(collection(db, 'matches'))
    batchWrite.set(matchRef, {
      competitionId,
      ownerOrgId:        ownerOrgId ?? null,
      homeTeamId:        homeSlot.teamId ?? null,
      homeTeamName,
      homeTeamColor,
      homeTeamShortCode: homeSnap.shortCode ?? null,
      homeOrgId:         null,
      homeRegistered:    !!homeSlot.teamId,
      homeSlotId:        homeSlot.slotId,
      awayTeamId:        awaySlot.teamId ?? null,
      awayTeamName,
      awayTeamColor,
      awayTeamShortCode: awaySnap.shortCode ?? null,
      awayOrgId:         null,
      awayRegistered:    !!awaySlot.teamId,
      awaySlotId:        awaySlot.slotId,
      homeScore: 0, awayScore: 0,
      isBye: false,
      periods:       Number(periods)       || DEFAULT_PERIODS,
      periodMinutes: Number(periodMinutes) || DEFAULT_PERIOD_MINUTES,
      breakMinutes:  Array.isArray(breakMinutes) ? breakMinutes : DEFAULT_BREAK_MINUTES,
      goals: [], cards: [], controlLog: [],
      startedAt: null, pausedAt: null, totalPausedMs: 0, nextPeriodIndex: 1,
      scheduledAt,
      pitch,
      indoor: !!indoor,
      status: 'scheduled', tracked: false,
      ...(seasonStr ? { season: seasonStr } : {}),
      createdBy: uid(), createdAt: serverTimestamp(),
    })

    batchWrite.set(doc(db, 'competitions', competitionId, 'fixtures', matchRef.id), {
      homeTeamId:            homeSlot.teamId ?? null,
      awayTeamId:            awaySlot.teamId ?? null,
      poolId,
      crossPool:             false,
      countsTowardStandings: true,
      addedAt:               serverTimestamp(),
    })

    createdIds.push(matchRef.id)
  }

  await batchWrite.commit()
  await addCompetitionAuditEvent(competitionId, {
    eventType: 'pool_fixtures_generated',
    after: { poolId, count: createdIds.length, overflow },
  })

  return { ids: createdIds, overflow, warnings }
}

// ── Finalize pool ─────────────────────────────────────────────────────────────
// Locks the pool: marks it finalized and converts any fixtures whose home or
// away slot is still unassigned into bye records. The real team gets a free
// bye; placeholder-vs-placeholder fixtures are also marked as byes. Validates
// for same-time clashes among now-resolved teams and returns any warnings.
export async function finalizePool(competitionId, poolId) {
  await assertCompetitionAdmin(competitionId)

  const poolRef  = doc(db, 'competitions', competitionId, 'pools', poolId)
  const poolSnap = await getDoc(poolRef)
  if (!poolSnap.exists()) { const e = new Error('Pool not found.'); e.code = 'pool/not-found'; throw e }

  const pool     = poolSnap.data()
  const slots    = pool.slots ?? []
  const emptyIds = new Set(slots.filter(s => !s.teamId).map(s => s.slotId))

  // Fetch all fixture membership docs for this pool
  const fxSnap = await getDocs(
    query(collection(db, 'competitions', competitionId, 'fixtures'), where('poolId', '==', poolId))
  )

  let byeCount = 0
  const clashWarnings = []

  if (fxSnap.docs.length > 0) {
    const matchSnaps = await Promise.all(
      fxSnap.docs.map(d => getDoc(doc(db, 'matches', d.id)).catch(() => null))
    )

    // Convert unfilled-slot fixtures to byes
    const byeBatch = writeBatch(db)
    let batchDirty = false

    // Clash check: group scheduled matches by team × time-slot
    const teamSlots = {}
    for (const snap of matchSnaps) {
      if (!snap?.exists()) continue
      const m = snap.data()
      if (m.isBye || !m.scheduledAt) continue
      for (const tid of [m.homeTeamId, m.awayTeamId].filter(Boolean)) {
        const tMs = m.scheduledAt?.toMillis?.() ?? new Date(m.scheduledAt).getTime()
        const key = `${tid}|${tMs}`
        if (teamSlots[key]) clashWarnings.push(`Scheduling clash: a team appears in two fixtures at the same time.`)
        teamSlots[key] = snap.id
      }
    }

    for (let i = 0; i < fxSnap.docs.length; i++) {
      const snap = matchSnaps[i]
      if (!snap?.exists()) continue
      const m = snap.data()
      if (emptyIds.has(m.homeSlotId) || emptyIds.has(m.awaySlotId)) {
        byeBatch.update(doc(db, 'matches', fxSnap.docs[i].id), {
          isBye: true, status: 'bye', updatedAt: serverTimestamp(),
        })
        byeCount++
        batchDirty = true
      }
    }

    if (batchDirty) await byeBatch.commit()
  }

  await updateDoc(poolRef, {
    finalized: true, finalizedAt: serverTimestamp(), finalizedBy: uid(),
    updatedAt: serverTimestamp(),
  })

  await addCompetitionAuditEvent(competitionId, {
    eventType: 'pool_finalized', after: { poolId, byeCount },
  })

  return { byeCount, clashWarnings: [...new Set(clashWarnings)] }
}

// ── Per-competition stats recalculation (§C) ─────────────────────────────────
// Manual "Recalculate stats" trigger. Delegates to the privileged backend
// callable `recalculateCompetitionStats` (functions/index.js), which runs the
// SAME recompute-from-history engine the finalisation trigger uses — there is no
// separate client-side replay. The backend reads the competition's Final
// fixtures and rebuilds its `players` slices (caps/goals/cards) with idempotent
// SET writes. Career totals are cross-competition and are NOT touched here; they
// refresh on the nightly wholesale run (dailyCareerStatsRecompute).
// Returns { matchCount, playerCount }.
export async function recalculateCompetitionStats(competitionId) {
  const call = httpsCallable(functions, 'recalculateCompetitionStats')
  const res = await call({ competitionId })
  return res.data
}

// Wholesale career rebuild (platform-admin only). Delegates to the backend
// callable `rebuildAllCareerStats`, which runs the same engine as the nightly
// job across every competition: rebuilds all slices from history, then re-derives
// every person's career totals + competitionIds. For deploy-day population and
// operator use — authority is enforced backend-side. Returns
// { matchCount, sliceCount, personCount }.
export async function rebuildAllCareerStats() {
  const call = httpsCallable(functions, 'rebuildAllCareerStats')
  const res = await call({})
  return res.data
}

// ── Festival informational stats toggle ───────────────────────────────────────
export async function setFestivalStatsEnabled(competitionId, enabled) {
  const competition = await assertCompetitionAdmin(competitionId)
  const rules = competition.rules ?? {}
  const statsTable = { ...(rules.statsTable ?? {}), enabled: !!enabled }
  const nextRules = { ...rules, statsTable }
  await updateDoc(doc(db, 'competitions', competitionId), {
    rules: nextRules, rulesHash: rulesHash(nextRules), updatedAt: serverTimestamp(),
  })
  await addCompetitionAuditEvent(competitionId, { eventType: 'festival_stats_changed', after: { enabled: !!enabled } })
}

// ── Payment requests ──────────────────────────────────────────────────────────
// Manual invoice-based purchase flow. A request is created when the user
// submits the purchase form on /plans; the platform admin marks it paid and
// grants entitlement using markPaymentRequestPaid().

export async function createPaymentRequest({ plan, orgName, contactName, contactEmail, phone, eventName }) {
  const year = new Date().getFullYear()
  const rand = String(Math.floor(1000 + Math.random() * 9000))
  const invoiceNumber = `MP-${year}-${rand}`
  const amount = plan === 'pro' ? 15000 : 2000
  await addDoc(collection(db, 'paymentRequests'), {
    plan,
    orgName:      orgName?.trim() || null,
    contactName:  contactName.trim(),
    contactEmail: contactEmail.trim().toLowerCase(),
    phone:        phone?.trim() || null,
    eventName:    plan === 'event' ? (eventName?.trim() || null) : null,
    invoiceNumber,
    amount,
    currency: 'ZAR',
    status: 'pending',
    createdAt: serverTimestamp(),
    paidAt: null,
  })
  return invoiceNumber
}

export async function fetchPaymentRequests() {
  const snap = await getDocs(query(collection(db, 'paymentRequests'), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Mark a payment request as paid AND grant org entitlement in one batch.
// orgId must be provided; plan-specific entitlement fields are set on the org.
// Use issueEntitlementToken() instead when the org hasn't been created yet.
export async function markPaymentRequestPaid(requestId, orgId, plan) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'paymentRequests', requestId), {
    status: 'paid',
    paidAt: serverTimestamp(),
  })
  const now = serverTimestamp()
  if (plan === 'pro') {
    // Pro: unlimited competitions, 1-year subscription from today.
    const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
    batch.update(doc(db, 'organizations', orgId), {
      entitlement: 'pro',
      entitlementExpiresAt: expiry,
      updatedAt: now,
    })
  } else {
    // Event: add one credit (addDoc increment-safe via increment field value).
    batch.update(doc(db, 'organizations', orgId), {
      entitlement: 'event',
      eventCredits: increment(1),
      updatedAt: now,
    })
  }
  await batch.commit()
}

// ── Entitlement tokens ────────────────────────────────────────────────────────
// Tokens let admins confirm payment before the customer's org exists.
// Flow: admin confirms EFT → calls issueEntitlementToken() → sends code to
// customer → customer creates org → enters code in org Settings → entitlement
// granted via redeemEntitlementToken().

function _randomTokenCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const year = new Date().getFullYear()
  return `MP-${year}-${seg(4)}-${seg(4)}`
}

// Mark a payment request as paid and create an activation token in one atomic
// batch. Returns the activation code string.
export async function issueEntitlementToken(requestId) {
  const reqSnap = await getDoc(doc(db, 'paymentRequests', requestId))
  if (!reqSnap.exists()) throw new Error('Payment request not found.')
  const { plan, invoiceNumber, orgName, contactEmail } = reqSnap.data()

  const tokenCode = _randomTokenCode()
  const batch = writeBatch(db)
  batch.update(doc(db, 'paymentRequests', requestId), { status: 'paid', paidAt: serverTimestamp() })
  const tokenRef = doc(collection(db, 'entitlementTokens'))
  batch.set(tokenRef, {
    token:            tokenCode,
    plan,
    invoiceNumber:    invoiceNumber ?? null,
    orgName:          orgName?.trim() ?? '',
    contactEmail:     contactEmail?.trim().toLowerCase() ?? '',
    paymentRequestId: requestId,
    status:           'active',
    createdAt:        serverTimestamp(),
    redeemedAt:       null,
    redeemedOrgId:    null,
    redeemedByUid:    null,
  })
  await batch.commit()
  return tokenCode
}

export async function fetchEntitlementTokens() {
  const snap = await getDocs(query(collection(db, 'entitlementTokens'), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Validate and redeem an activation code. Grants entitlement to orgId.
// Throws a user-facing error if the code is invalid or already used.
export async function redeemEntitlementToken(tokenCode, orgId) {
  const snap = await getDocs(query(
    collection(db, 'entitlementTokens'),
    where('token', '==', tokenCode.trim().toUpperCase()),
    where('status', '==', 'active'),
  ))
  if (snap.empty) throw new Error('Activation code not found or already used. Check for typos and try again.')
  const tokenDoc = snap.docs[0]
  const { plan } = tokenDoc.data()
  const currentUid = uid()

  const batch = writeBatch(db)
  batch.update(tokenDoc.ref, {
    status:        'redeemed',
    redeemedAt:    serverTimestamp(),
    redeemedOrgId: orgId,
    redeemedByUid: currentUid,
  })
  const now = serverTimestamp()
  if (plan === 'pro') {
    const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1)
    batch.update(doc(db, 'organizations', orgId), {
      entitlement: 'pro', entitlementExpiresAt: expiry, updatedAt: now,
    })
  } else {
    batch.update(doc(db, 'organizations', orgId), {
      entitlement: 'event', eventCredits: increment(1), updatedAt: now,
    })
  }
  await batch.commit()
  return plan
}
