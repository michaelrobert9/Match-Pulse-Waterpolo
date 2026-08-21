import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, startAt, endAt, limit,
  serverTimestamp, writeBatch, increment, arrayUnion, deleteField,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, identityDb, auth, functions } from '../firebase'
import { slugify, matchSlug as buildMatchSlug } from './slugify'
import { matchPath, competitionMatchPath, dedupeSlug } from './matchPaths'
import { redirectKey } from './queries'
import { periodLabels, DEFAULT_PERIODS, DEFAULT_PERIOD_MINUTES, DEFAULT_BREAK_MINUTES } from './matchClock'
import { generatedTeamName, teamStructuralKey, levelLabel, composeTeamDisplay } from './teamNaming'
import { defaultRulesForType, rulesHash } from './competitionRules'
import { assertCanAdministerCompetition } from './competitionAuth'
import { schedulePoolFixtures } from './scheduler'
import { PLAYER_CONSENT_VERSION } from './consent'
import { resolveSideLineup } from './lineupResolve'

function uid() { return auth?.currentUser?.uid ?? null }
function userEmail() { return auth?.currentUser?.email ?? null }

// Resolve the current user's authorisation state (platformAdmin + orgRoles)
// from their users/{uid} profile. Used by competition-admin guards in the data
// layer so authorisation is enforced at the source, not only in the UI.
async function currentAuthState() {
  const userId = uid()
  if (!userId) return { uid: null, isPlatformAdmin: false, orgRoles: {} }
  const snap = await getDoc(doc(identityDb, 'users', userId))
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
  // set(merge) rather than update: a brand-new database may not have this
  // user's profile doc yet, and update() throws on a missing document — which
  // would abort the batch and leave the org WITHOUT its owner (the exact cause
  // of "org created but can't add a team"). merge deep-merges the single new
  // entry into any existing orgRoles map without replacing it.
  batch.set(doc(identityDb, 'users', userId), {
    orgRoles: { [orgRef.id]: { role: 'owner', teamId: null } },
  }, { merge: true })
  await batch.commit()

  return orgRef
}

// Repair helper: if the signed-in user CREATED this org but has no owner staff
// doc (e.g. the two-step self-create was interrupted after step 1, or the data
// was created against a different Firestore database), write the owner staff
// doc and orgRoles mirror. The bootstrap rule permits this precisely because
// the org's createdBy == the caller.
//
// The caller must only invoke this when the user is NOT already a member — the
// staff doc is unreadable to a non-member, so we cannot check existence first;
// we simply (re)assert the bootstrap create. Returns true when the write ran.
export async function ensureCreatorOwnership(orgId, org) {
  const userId = uid()
  if (!userId || !org || org.createdBy !== userId) return false
  const batch = writeBatch(db)
  batch.set(doc(db, 'organizations', orgId, 'staff', userId), {
    role: 'owner', teamId: null, grantedBy: userId, grantedAt: serverTimestamp(),
  })
  batch.set(doc(identityDb, 'users', userId), {
    orgRoles: { [orgId]: { role: 'owner', teamId: null } },
  }, { merge: true })
  await batch.commit()
  return true
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

// ── Merge duplicate player records (master admin) ───────────────────────────
// The system can end up with two `people` records for one person. Merge folds
// a SOURCE (the duplicate) into a TARGET (the record to keep): every match the
// source appears in, its goals, and its stat slices repoint to the target,
// org links are unioned onto the target, and the source is tombstoned
// (mergedInto) so it drops out of lists/search but stays for audit. Career
// totals self-heal on the next stats recompute from the repointed slices.
// Master-admin only (enforced by the rules on the match/people/players writes).

async function matchesWithPerson(personId) {
  const snap = await getDocs(query(collection(db, 'matches'), where('lineupPersonIds', 'array-contains', personId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// What a merge WOULD touch — shown to the admin before they commit.
export async function previewMergePeople(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('Pick two different players.')
  const [source, target, matches, slices] = await Promise.all([
    getDoc(doc(db, 'people', sourceId)),
    getDoc(doc(db, 'people', targetId)),
    matchesWithPerson(sourceId),
    getDocs(query(collection(db, 'players'), where('personId', '==', sourceId))),
  ])
  return {
    source: source.exists() ? { id: source.id, ...source.data() } : null,
    target: target.exists() ? { id: target.id, ...target.data() } : null,
    matchCount: matches.length,
    sliceCount: slices.size,
  }
}

export async function mergePeople(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('Pick two different players.')
  const [srcSnap, tgtSnap] = await Promise.all([
    getDoc(doc(db, 'people', sourceId)),
    getDoc(doc(db, 'people', targetId)),
  ])
  if (!tgtSnap.exists()) throw new Error('Target player not found.')
  const source = { id: srcSnap.id, ...srcSnap.data() }
  const target = { id: tgtSnap.id, ...tgtSnap.data() }
  const tName = target.fullName ?? null
  const tSlug = target.slug ?? null
  const squadCtx = new Set()   // `${competitionId}|${teamId}` the source belonged to

  // 1. Repoint every match the source appears in.
  for (const m of await matchesWithPerson(sourceId)) {
    if (m.competitionId) {
      if (m.homeTeamId) squadCtx.add(`${m.competitionId}|${m.homeTeamId}`)
      if (m.awayTeamId) squadCtx.add(`${m.competitionId}|${m.awayTeamId}`)
    }
    const patch = {}
    for (const field of ['homeLineup', 'awayLineup']) {
      const arr = m[field]
      if (!Array.isArray(arr) || !arr.some(e => e.personId === sourceId)) continue
      const hasTarget = arr.some(e => e.personId === targetId)
      patch[field] = arr
        .filter(e => !(hasTarget && e.personId === sourceId))   // drop dup if target already listed
        .map(e => e.personId === sourceId
          ? { ...e, personId: targetId, personName: tName ?? e.personName, personSlug: tSlug ?? e.personSlug ?? null }
          : e)
    }
    patch.lineupPersonIds = [...new Set((m.lineupPersonIds ?? []).map(x => x === sourceId ? targetId : x))]
    if (Array.isArray(m.goals) && m.goals.some(g => g.scorerPersonId === sourceId || g.assistPersonId === sourceId)) {
      patch.goals = m.goals.map(g => ({
        ...g,
        ...(g.scorerPersonId === sourceId ? { scorerPersonId: targetId, scorerName: tName ?? g.scorerName } : {}),
        ...(g.assistPersonId === sourceId ? { assistPersonId: targetId, assistName: tName ?? g.assistName } : {}),
      }))
    }
    await updateDoc(doc(db, 'matches', m.id), patch).catch(() => {})
  }

  // 2. Repoint stat slices; fold into the target's slice when one already exists
  //    for the same team+competition+season (avoids a duplicate slice).
  const [srcSlices, tgtSlices] = await Promise.all([
    getDocs(query(collection(db, 'players'), where('personId', '==', sourceId))),
    getDocs(query(collection(db, 'players'), where('personId', '==', targetId))),
  ])
  const sliceKey = s => `${s.teamId}|${s.competitionId ?? ''}|${s.season ?? ''}`
  const tgtByKey = new Map(tgtSlices.docs.map(d => [sliceKey(d.data()), { id: d.id, ...d.data() }]))
  for (const d of srcSlices.docs) {
    const s = d.data()
    if (s.teamId && s.competitionId) squadCtx.add(`${s.competitionId}|${s.teamId}`)
    const dup = tgtByKey.get(sliceKey(s))
    if (dup) {
      await updateDoc(doc(db, 'players', dup.id), {
        caps: (dup.caps ?? 0) + (s.caps ?? 0),
        goals: (dup.goals ?? 0) + (s.goals ?? 0),
        assists: (dup.assists ?? 0) + (s.assists ?? 0),
        cards: {
          green: (dup.cards?.green ?? 0) + (s.cards?.green ?? 0),
          yellow: (dup.cards?.yellow ?? 0) + (s.cards?.yellow ?? 0),
          red: (dup.cards?.red ?? 0) + (s.cards?.red ?? 0),
        },
      }).catch(() => {})
      await deleteDoc(doc(db, 'players', d.id)).catch(() => {})
    } else {
      await updateDoc(doc(db, 'players', d.id), { personId: targetId, personName: tName, personSlug: tSlug }).catch(() => {})
    }
  }

  // 3. Union the source's representative orgs onto the target.
  const orgs = [...(target.representativeOrgs ?? [])]
  for (const o of (source.representativeOrgs ?? [])) if (o?.orgId && !orgs.some(x => x.orgId === o.orgId)) orgs.push(o)
  await updateDoc(doc(db, 'people', targetId), {
    representativeOrgs: orgs, representativeOrgIds: orgs.map(o => o.orgId), updatedAt: serverTimestamp(),
  }).catch(() => {})

  // 3b. Repoint the source out of every squad it sits in — the team-sheet squad
  //     and the registered competition squad. Without this a later re-seed would
  //     re-create a slice for the merged-away duplicate and it would reappear.
  const repointSquad = async (ref, idField) => {
    const snap = await getDoc(ref).catch(() => null)
    if (!snap || !snap.exists()) return
    const arr = snap.data().squad ?? []
    if (!arr.some(e => e[idField] === sourceId)) return
    const hasTarget = arr.some(e => e[idField] === targetId)
    const next = arr
      .filter(e => !(hasTarget && e[idField] === sourceId))
      .map(e => e[idField] === sourceId
        ? { ...e, [idField]: targetId,
            ...(e.playerName !== undefined ? { playerName: tName ?? e.playerName } : {}),
            ...(e.personName !== undefined ? { personName: tName ?? e.personName } : {}) }
        : e)
    await updateDoc(ref, { squad: next, updatedAt: serverTimestamp() }).catch(() => {})
  }
  for (const key of squadCtx) {
    const [compId, teamId] = key.split('|')
    if (!compId || !teamId) continue
    await repointSquad(doc(db, 'competitions', compId, 'teams', teamId), 'playerId')     // team sheet
    await repointSquad(doc(db, 'competitions', compId, 'squads', teamId), 'personId')     // registered squad
  }

  // 4. Tombstone the source: hidden from lists/search, its org links cleared so
  //    it drops out of every organisation view, kept only for audit.
  await updateDoc(doc(db, 'people', sourceId), {
    mergedInto: targetId, claimStatus: 'merged', slug: null,
    representativeOrgs: [], representativeOrgIds: [],
    updatedAt: serverTimestamp(),
  })
}

// ── Link a player to the org they represent (for stats roll-up) ─────────────
// When a player is pasted into / added to a team, they represent that team's
// school / club / association. representativeOrgIds powers the org's player-
// rollup query; representativeOrgs carries the display name. Append-only and
// idempotent — an org already listed is left untouched.
//
// Best-effort: writing a person doc is permitted for a platform admin (the
// operator) and swallowed otherwise, so a permission gap never blocks the
// paste. The nightly stats engine is the eventual backstop for coverage.
export async function linkPersonToOrg(personId, orgId, orgName = null) {
  if (!personId || !orgId) return
  const ref = doc(db, 'people', personId)
  const snap = await getDoc(ref).catch(() => null)
  if (!snap || !snap.exists()) return
  const orgs = snap.data().representativeOrgs ?? []
  if (orgs.some(o => o.orgId === orgId)) return
  let name = orgName
  if (!name) {
    const o = await getDoc(doc(db, 'organizations', orgId)).catch(() => null)
    name = o && o.exists() ? (o.data().name ?? null) : null
  }
  const next = [...orgs, { orgId, orgName: name ?? null }]
  await updateDoc(ref, {
    representativeOrgs: next,
    representativeOrgIds: next.map(o => o.orgId),
    updatedAt: serverTimestamp(),
  }).catch(() => {})
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
    personSlug: pd.slug ?? null,   // carry the slug so the entry links straight to /player/{slug}
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

  // Auto-link the player to the org they turned out for, so their appearance
  // rolls up to that school / club / association. Uses the match's own org
  // fields when present, otherwise linkPersonToOrg fetches the org name.
  // Prefer the org denormalised on the match; fall back to the TEAM's own
  // organisation (authoritative) when the match doc doesn't carry one.
  let _orgId   = side === 'home' ? data.homeOrgId   : data.awayOrgId
  let _orgName = side === 'home' ? data.homeOrgName : data.awayOrgName
  if (!_orgId) {
    const _tid = side === 'home' ? data.homeTeamId : data.awayTeamId
    const _tSnap = _tid ? await getDoc(doc(db, 'teams', _tid)).catch(() => null) : null
    if (_tSnap && _tSnap.exists()) { _orgId = _tSnap.data().organizationId ?? null; _orgName = null }
  }
  if (_orgId) await linkPersonToOrg(personId, _orgId, _orgName ?? null).catch(() => {})
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
    teamPrimaryColor: t.primaryColor ?? null,
    createdBy: uid(), createdAt: serverTimestamp(),
  })
}

// Ensure a competition stat slice exists for EVERY player in a team's sheet the
// moment it is saved — so a pasted player has a proper, linked record on the
// players list right away, not only once a fixture is played. One slice per
// (person, team, competition); caps start at 0 and the stats engine fills them
// in from played fixtures. Idempotent — existing slices are left untouched.
export async function ensureCompetitionSquadSlices(competitionId, teamId, squad = []) {
  if (!competitionId || !teamId || !squad.length) return
  const [existingSnap, teamSnap, compSnap] = await Promise.all([
    getDocs(query(collection(db, 'players'),
      where('teamId', '==', teamId), where('competitionId', '==', competitionId))),
    getDoc(doc(db, 'teams', teamId)),
    getDoc(doc(db, 'competitions', competitionId)),
  ])
  const have = new Set(existingSnap.docs.map(d => d.data().personId).filter(Boolean))
  const t = teamSnap.exists() ? teamSnap.data() : {}
  const c = compSnap.exists() ? compSnap.data() : {}
  for (const s of squad) {
    const personId = s.playerId ?? s.personId
    if (!personId || have.has(personId)) continue
    have.add(personId)
    await addDoc(collection(db, 'players'), {
      personId,
      personName: s.playerName ?? s.personName ?? null,
      personSlug: s.personSlug ?? null,
      teamId, competitionId, season: null,
      organizationId: t.organizationId ?? null,
      shirtNumber: s.shirtNumber ?? null, position: null, isCaptain: s.isCaptain === true,
      caps: 0, goals: 0, assists: 0, cards: { green: 0, yellow: 0, red: 0 },
      competitionName: c.name ?? null,
      competitionSeason: c.season ?? null,
      competitionStatus: c.status ?? null,
      teamDisplayName: t.displayName ?? null,
      teamPrimaryColor: t.primaryColor ?? null,
      createdBy: uid(), createdAt: serverTimestamp(),
    }).catch(() => {})
  }
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

// Every competition on the platform — the platform-admin scope of the unified
// competitions list. Ordinary organisers use the org/user-scoped fetchers above.
export async function fetchAllCompetitions() {
  const snap = await getDocs(query(collection(db, 'competitions'), orderBy('name')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
  const {
    competitionId = null, season = null,
    ageGroup = null, gender = null, division = null, teamLevel = null,
    teamName = null,
  } = options
  const orgSlug = orgData.slug || slugify(orgData.name)
  const name = displayName || orgData.name
  // Structured naming fields are the source of truth: gender (school) OR
  // division (club/association), plus ageGroup + teamLevel (a letter for age
  // sides, an ordinal for senior sides). `teamLabel` and `structuralKey` are
  // DERIVED here and stored for display / duplicate-detection — never parsed
  // back into structure.
  const fields = { ageGroup, gender, division, teamLevel }
  const teamLabel     = levelLabel(fields) || null
  const structuralKey = teamStructuralKey(fields) || null
  // The slug follows the SAME structured rules as the display name. The URL
  // already carries the org (/{orgSlug}/…), so the team segment is the team's
  // own identity: the optional per-team name (associations/leagues) plus the
  // level + gender/division label — i.e. the display name minus the org. Falls
  // back to the display name / season so every team still gets a unique URL.
  const slugSegment = [teamName, generatedTeamName({ ...fields, orgGenderProfile: orgData.genderProfile })]
    .map(s => (s ?? '').trim()).filter(Boolean).join(' ') || name || season || orgSlug
  const slug = await generateUniqueTeamSlug(orgSlug, slugSegment)
  return addDoc(collection(db, 'teams'), {
    organizationId: orgData.id,
    orgName:        orgData.name,
    displayName:    name,
    searchName:     name.toLowerCase(),
    // Firestore rejects `undefined`; orgs need not carry a shortCode/primary
    // colour, so coalesce every optional org-derived field to null (or a
    // sensible default) rather than passing undefined straight through.
    logoUrl:        orgData.logoUrl || null,
    primaryColor:   orgData.primaryColor ?? null,
    secondaryColor: orgData.secondaryColor || '#FFFFFF',
    ...(ageGroup      ? { ageGroup }      : {}),
    ...(gender        ? { gender }        : {}),
    ...(division      ? { division }      : {}),
    ...(teamLevel     ? { teamLevel }     : {}),
    // Optional per-team name (associations/leagues): replaces the org's match
    // name in the display — "Durban Panthers – U13 Boys".
    ...(teamName?.trim() ? { teamName: teamName.trim() } : {}),
    ...(teamLabel     ? { teamLabel }     : {}),
    ...(structuralKey ? { structuralKey } : {}),
    ...(slug          ? { slug }          : {}),
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
    type:                 data.type || 'unknown',
    primaryColor:         data.primaryColor || null,
    orgName:              data.orgName || null,
    orgGenderProfile:     data.orgGenderProfile || null,
    gender:               data.gender || null,
    division:             data.division || null,
    ageGroup:             data.ageGroup || null,
    teamLevel:            data.teamLevel || null,
    teamLabel:            levelLabel(data) || null,
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
  // Any change to a structural field re-derives the display name, level label
  // and structural key from the discrete fields.
  const structuralChange = ['gender', 'division', 'ageGroup', 'teamLevel', 'orgGenderProfile']
    .some(k => k in patch)
  if (structuralChange) {
    const fields = {
      gender:           patch.gender    ?? null,
      division:         patch.division   ?? null,
      ageGroup:         patch.ageGroup   ?? null,
      teamLevel:        patch.teamLevel  ?? null,
      orgGenderProfile: patch.orgGenderProfile,
    }
    const name = generatedTeamName(fields)
    if (name) {
      patch.displayName = name
      patch.searchName  = name.toLowerCase()
    }
    patch.teamLabel     = levelLabel(fields) || null
    patch.structuralKey = teamStructuralKey(fields) || null
    delete patch.orgGenderProfile   // derivation input only, not a stored field
  }
  return updateDoc(doc(db, 'teams', id), { ...patch, updatedAt: serverTimestamp() })
}

// Teams the governance migration could not map automatically (Masters/Open/
// custom sides, bare age groups, co-ed teams missing a gender, …). The admin
// resolution screen lists these so each can be mapped onto the structured model
// by hand. Flagged by scripts/migrate-team-governance.mjs (needsGovernanceReview).
export async function fetchTeamsNeedingGovernanceReview() {
  const snap = await getDocs(query(collection(db, 'teams'), where('needsGovernanceReview', '==', true)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
  const newHomeDisplay = m.awayDisplay ?? composeTeamDisplay(m.awayOrgName, m.awayTeamName)
  const newAwayDisplay = m.homeDisplay ?? composeTeamDisplay(m.homeOrgName, m.homeTeamName)
  // Re-derive slug + path from the swapped H1 and redirect the old URL.
  const restamp   = await computeMatchRestamp(m, { homeDisplay: newHomeDisplay, awayDisplay: newAwayDisplay })
  const matchSlug = restamp?.patch.matchSlug ?? m.matchSlug

  const patch = {
    homeTeamId: m.awayTeamId ?? null, homeTeamName: m.awayTeamName ?? null, homeTeamColor: m.awayTeamColor ?? null,
    homeTeamSlug: m.awayTeamSlug ?? null,
    homeOrgId: m.awayOrgId ?? null, homeOrgName: m.awayOrgName ?? null, homeRegistered: !!m.awayRegistered,
    awayTeamId: m.homeTeamId ?? null, awayTeamName: m.homeTeamName ?? null, awayTeamColor: m.homeTeamColor ?? null,
    awayTeamSlug: m.homeTeamSlug ?? null,
    awayOrgId: m.homeOrgId ?? null, awayOrgName: m.homeOrgName ?? null, awayRegistered: !!m.homeRegistered,
    homeDisplay: newHomeDisplay, awayDisplay: newAwayDisplay,
    homeScore: m.awayScore ?? 0, awayScore: m.homeScore ?? 0,
    goals: flipSide(m.goals ?? []), cards: flipSide(m.cards ?? []),
    matchSlug,
    ...(restamp?.patch.path ? { path: restamp.patch.path } : {}),
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
  if (restamp?.redirect) {
    await writeMatchRedirect(restamp.redirect.from, restamp.redirect.to, m.homeOrgId ?? null, m.competitionId ?? null).catch(() => {})
  }
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

// Set (or clear) a person's profile photo. Same permission surface as the
// banner (owner/guardians/managers and platform admins) — photoUrl is a
// non-control field on people/{id}.
export async function updatePersonPhoto(personId, photoUrl) {
  return updateDoc(doc(db, 'people', personId), {
    photoUrl: photoUrl || null,
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

// The URL date segment (YYYY-MM-DD) for a STANDALONE match, in SAST (UTC+2, no
// DST) so an evening match never lands on the wrong calendar day. Accepts a Date,
// a Firestore Timestamp, or an ISO string; returns null when nothing is derivable.
export function toMatchDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : (value?.toDate ? value.toDate() : new Date(value))
  if (isNaN(d?.getTime?.())) return null
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// ONE namespace for a date's top-level slugs. A standalone match at
// /match/{date}/{slug} and a match GROUP at /match/{date}/{slug} cannot both
// exist, so uniqueness on (matchDate, slug) is checked across BOTH collections
// together — matches (matchSlug) and matchGroups (slug) — never within one.
// Group CHILDREN are excluded: they live one level deeper (they carry a
// matchGroupId and their slug is the group's), so they never compete for a
// top-level slug.
async function takenTopLevelSlugsForDate(matchDate) {
  const [matchSnap, groupSnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'), where('matchDate', '==', matchDate))),
    getDocs(query(collection(db, 'matchGroups'), where('matchDate', '==', matchDate))).catch(() => ({ forEach() {} })),
  ])
  const taken = new Set()
  matchSnap.forEach(d => { const m = d.data(); if (!m.matchGroupId && m.matchSlug) taken.add(m.matchSlug) })
  groupSnap.forEach(d => { const s = d.data().slug; if (s) taken.add(s) })
  return taken
}

// Slug uniqueness for a STANDALONE match is scoped to its date, across the whole
// (matchDate, slug) namespace — matches AND groups (see takenTopLevelSlugsForDate).
async function generateUniqueStandaloneMatchSlug(matchDate, base) {
  return dedupeSlug(base, await takenTopLevelSlugsForDate(matchDate))
}

// Slug uniqueness for a COMPETITION match is scoped to its competition: the URL
// is /competitions/{season}/{competition-slug}/match/{slug} (dateless — the
// competition owns the timing), so two matches in one competition can't collide.
async function generateUniqueCompetitionMatchSlug(competitionId, base) {
  const snap = await getDocs(query(collection(db, 'matches'), where('competitionId', '==', competitionId)))
  const taken = new Set(snap.docs.map(d => d.data().matchSlug).filter(Boolean))
  return dedupeSlug(base, taken)
}

// Re-derive a match's URL identity (matchSlug + path) from its current team
// displays (the H1) and date, returning the fields to patch plus an old→new
// redirect pair when the path actually moved. Standalone matches keep the date
// in the path; competition matches are dateless. Knockout/playoff fixtures use a
// stable round-name slug and must NOT be re-stamped through here. Returns null
// when nothing meaningful changed or a standalone path can't be built (no date).
async function computeMatchRestamp(m, { homeDisplay, awayDisplay, matchDate } = {}) {
  const hd = (homeDisplay ?? m.homeDisplay ?? composeTeamDisplay(m.homeOrgName, m.homeTeamName)) || 'home'
  const ad = (awayDisplay ?? m.awayDisplay ?? composeTeamDisplay(m.awayOrgName, m.awayTeamName)) || 'away'
  const base = buildMatchSlug(hd, ad)
  const seasonStr = m.competitionSeason ? String(m.competitionSeason) : (m.season ? String(m.season) : null)
  let matchSlug, path
  if (m.competitionId && m.competitionSlug && seasonStr) {
    matchSlug = await generateUniqueCompetitionMatchSlug(m.competitionId, base)
    path      = competitionMatchPath(seasonStr, m.competitionSlug, matchSlug)
  } else {
    const date = matchDate ?? m.matchDate
    if (!date) return null
    matchSlug = await generateUniqueStandaloneMatchSlug(date, base)
    path      = matchPath(date, matchSlug)
  }
  const patch = { homeDisplay: hd, awayDisplay: ad, matchSlug, path }
  const redirect = (m.path && m.path !== path) ? { from: m.path, to: path } : null
  return { patch, redirect }
}

export async function createMatch(competitionId, homeTeam, awayTeam, {
  matchDate, scheduledAt = null, pitch = '', season, competitionSlug = null,
  periods = DEFAULT_PERIODS, periodMinutes = DEFAULT_PERIOD_MINUTES,
  breakMinutes = DEFAULT_BREAK_MINUTES,
  indoor = false,
}) {
  const seasonStr = season ? String(season) : null
  const homeDisplay = composeTeamDisplay(homeTeam.teamName || homeTeam.orgName, homeTeam.displayName)
  const awayDisplay = composeTeamDisplay(awayTeam.teamName || awayTeam.orgName, awayTeam.displayName)
  const baseSlug  = buildMatchSlug(homeDisplay, awayDisplay)

  // The canonical URL depends on whether this match belongs to a competition.
  // Competition matches are competition-scoped and dateless
  // (/competitions/{season}/{slug}/match/{matchSlug}); standalone matches carry
  // their own date (/match/{matchDate}/{matchSlug}). scheduledAt (the exact time)
  // is optional either way and shows as TBC until set.
  let matchSlug, path, matchDateField
  if (competitionId) {
    if (!competitionSlug || !seasonStr) {
      throw new Error('A competition match needs the competition slug and season to build its URL.')
    }
    matchSlug      = await generateUniqueCompetitionMatchSlug(competitionId, baseSlug)
    path           = competitionMatchPath(seasonStr, competitionSlug, matchSlug)
    matchDateField = null
  } else {
    const date = matchDate ?? toMatchDate(scheduledAt)
    if (!date) throw new Error('matchDate is required for a standalone match (no date could be derived)')
    matchSlug      = await generateUniqueStandaloneMatchSlug(date, baseSlug)
    path           = matchPath(date, matchSlug)
    matchDateField = date
  }

  // A team may be a registered MatchPulse team (has .id) or a manual/unregistered
  // opponent (id is null). Both are supported; only registered teams earn stats.
  const homeRegistered = homeTeam.id != null
  const awayRegistered = awayTeam.id != null

  const ref = await addDoc(collection(db, 'matches'), {
    competitionId,
    homeTeamId:        homeRegistered ? homeTeam.id : null,
    homeTeamName:      homeTeam.displayName,
    homeDisplay,
    homeOrgName:       homeTeam.orgName       || null,
    homeTeamSlug:      homeTeam.slug          || null,
    homeTeamColor:     homeTeam.primaryColor  || null,
    homeOrgId:         homeTeam.organizationId ?? null,
    homeRegistered,
    ...(homeTeam.manualOpponentId ? { manualHomeOpponentId: homeTeam.manualOpponentId } : {}),
    awayTeamId:        awayRegistered ? awayTeam.id : null,
    awayTeamName:      awayTeam.displayName,
    awayDisplay,
    awayOrgName:       awayTeam.orgName       || null,
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
    ...(matchDateField ? { matchDate: matchDateField } : {}),
    matchSlug,
    path,
    ...(seasonStr ? { season: seasonStr } : {}),
    ...(competitionId && competitionSlug && seasonStr ? { competitionSlug, competitionSeason: seasonStr } : {}),
    createdBy: uid(), createdAt: serverTimestamp(),
  })
  // Seed line-ups from both teams' registered competition squads (best-effort,
  // idempotent) so a squad set up front carries into fixtures added later.
  if (competitionId) {
    seedMatchLineupsFromSquads({
      id: ref.id, competitionId,
      homeTeamId: homeRegistered ? homeTeam.id : null,
      awayTeamId: awayRegistered ? awayTeam.id : null,
    }).catch(() => {})
  }
  return ref
}

export async function updateMatch(id, data) {
  const patch = { ...data }
  // Keep the URL truthful: if the teams or the match day change, re-derive the
  // slug/path from the new H1 and redirect the old URL — UNLESS the caller
  // supplied its own slug/path (an explicit manual rename). Match-day children
  // (group slug + ageSlug) and knockout fixtures (stable round-name slug) keep
  // their URL and are never auto re-stamped.
  const touchesTeams = ['homeTeamName', 'awayTeamName', 'homeOrgName', 'awayOrgName',
    'homeTeamId', 'awayTeamId', 'homeDisplay', 'awayDisplay'].some(k => k in data)
  const touchesTime  = ('scheduledAt' in data) || ('matchDate' in data)
  const explicitPath = ('matchSlug' in data) || ('path' in data) || ('ageSlug' in data)
  if ((touchesTeams || touchesTime) && !explicitPath) {
    const snap = await getDoc(doc(db, 'matches', id))
    if (snap.exists()) {
      const cur = snap.data()
      const stableUrl = cur.matchGroupId || cur.isPlayoffHolding || cur.playoffGameSlug
      if (!stableUrl) {
        const m = { ...cur, ...patch }
        let slug = cur.matchSlug
        if (touchesTeams) {
          const hd = composeTeamDisplay(m.homeOrgName, m.homeTeamName) || m.homeDisplay || 'home'
          const ad = composeTeamDisplay(m.awayOrgName, m.awayTeamName) || m.awayDisplay || 'away'
          patch.homeDisplay = hd; patch.awayDisplay = ad
          const base = buildMatchSlug(hd, ad)
          if (base !== cur.matchSlug) {   // teams actually renamed the fixture
            const seasonStr = m.competitionSeason ? String(m.competitionSeason) : (m.season ? String(m.season) : null)
            slug = (m.competitionId && m.competitionSlug && seasonStr)
              ? await generateUniqueCompetitionMatchSlug(m.competitionId, base)
              : await generateUniqueStandaloneMatchSlug(m.matchDate, base)
          }
        }
        // Standalone reschedule to a new DAY moves the date segment.
        let newDate = cur.matchDate
        if (!m.competitionId) {
          if ('matchDate' in data) newDate = data.matchDate
          else if ('scheduledAt' in data) { const d = toMatchDate(patch.scheduledAt); if (d) newDate = d }
        }
        let newPath = cur.path
        const seasonStr = m.competitionSeason ? String(m.competitionSeason) : (m.season ? String(m.season) : null)
        if (m.competitionId && m.competitionSlug && seasonStr) newPath = competitionMatchPath(seasonStr, m.competitionSlug, slug)
        else if (newDate) newPath = matchPath(newDate, slug)
        if (slug !== cur.matchSlug) patch.matchSlug = slug
        if (!m.competitionId && newDate && newDate !== cur.matchDate) patch.matchDate = newDate
        if (newPath && newPath !== cur.path) {
          patch.path = newPath
          await writeMatchRedirect(cur.path, newPath, cur.homeOrgId ?? null, cur.competitionId ?? null).catch(() => {})
        }
      }
    }
  }
  return updateDoc(doc(db, 'matches', id), { ...patch, updatedBy: uid(), updatedAt: serverTimestamp() })
}
export async function deleteMatch(id) {
  return deleteDoc(doc(db, 'matches', id))
}

// ── Match groups (a "match day" between two schools) ──────────────────────────
// A matchGroup owns identity + display only. Its children are ORDINARY standalone
// matches (competitionId null) carrying matchGroupId, groupOrder (from the
// canonical seniority sort) and ageSlug; each child's path is
// matchPath(date, groupSlug, ageSlug). Nothing in scoring / line-up / stats
// changes. The day tally is DERIVED on read from the children — no counters are
// stored on the group document (same discipline as standings).
//
// `rows` are already paired + ordered by the caller (create wizard), each:
//   { ageSlug, groupOrder, home: teamLike, away: teamLike,
//     scheduledAt?: Date|null, venue?: string }
// where teamLike is a registered team (has .id) or a manual opponent.
export async function createMatchGroup({
  home, away, matchDate, venue = '', sport = null, ownerOrgId = null,
  periods = DEFAULT_PERIODS, periodMinutes = DEFAULT_PERIOD_MINUTES,
  breakMinutes = DEFAULT_BREAK_MINUTES, indoor = false,
  rows = [],
}) {
  if (!matchDate) throw new Error('A date is required to create a match day.')
  if (!rows.length) throw new Error('Pick at least one match to create.')
  // One namespace: the group's slug is unique on (matchDate, slug) across BOTH
  // matchGroups and matches (see takenTopLevelSlugsForDate).
  const groupSlug = dedupeSlug(buildMatchSlug(home.name, away.name), await takenTopLevelSlugsForDate(matchDate))

  const batch = writeBatch(db)
  const groupRef = doc(collection(db, 'matchGroups'))
  batch.set(groupRef, {
    slug: groupSlug,
    matchDate,
    homeName: home.name,
    awayName: away.name,
    homeOrgId: home.id ?? null,   // a group's "sides" are ORGS (schools/clubs), not
    awayOrgId: away.id ?? null,   // single teams — named like /matches for by-school queries
    venue: venue || '',
    sport: sport ?? null,
    ownerOrgId: ownerOrgId ?? null,
    createdBy: uid(), createdAt: serverTimestamp(),
  })

  // Data-integrity backstop: two children must never share an ageSlug, or their
  // paths (/match/{date}/{groupSlug}/{ageSlug}) collide and one shadows the other.
  // The wizard's finalizeRows already gender-prefixes and de-dupes, but enforce it
  // here too so a bad caller can't create an unreachable child.
  const usedAge = new Set()
  const childIds = []
  for (const r of rows) {
    const childRef = doc(collection(db, 'matches'))
    const h = r.home, a = r.away
    const hReg = h.id != null, aReg = a.id != null
    const ageSlug = dedupeSlug(r.ageSlug, usedAge)
    usedAge.add(ageSlug)
    batch.set(childRef, {
      competitionId: null,
      matchGroupId: groupRef.id,
      groupOrder:   r.groupOrder ?? 0,
      ageSlug,
      ...(r.gender ? { gender: r.gender } : {}),
      matchDate,
      matchSlug:    groupSlug,        // children share the group's top-level slug
      path:         matchPath(matchDate, groupSlug, ageSlug),
      homeTeamId:        hReg ? h.id : null,
      homeTeamName:      h.displayName ?? h.name ?? null,
      homeOrgName:       h.orgName ?? null,
      homeTeamSlug:      h.slug ?? null,
      homeTeamColor:     h.primaryColor ?? null,
      homeOrgId:         h.organizationId ?? null,
      homeRegistered:    hReg,
      ...(h.manualOpponentId ? { manualHomeOpponentId: h.manualOpponentId } : {}),
      awayTeamId:        aReg ? a.id : null,
      awayTeamName:      a.displayName ?? a.name ?? null,
      awayOrgName:       a.orgName ?? null,
      awayTeamSlug:      a.slug ?? null,
      awayTeamColor:     a.primaryColor ?? null,
      awayOrgId:         a.organizationId ?? null,
      awayRegistered:    aReg,
      ...(a.manualOpponentId ? { manualAwayOpponentId: a.manualOpponentId } : {}),
      homeScore: 0, awayScore: 0,
      periods:       Number(periods) || DEFAULT_PERIODS,
      periodMinutes: Number(periodMinutes) || DEFAULT_PERIOD_MINUTES,
      breakMinutes:  Array.isArray(breakMinutes) ? breakMinutes : DEFAULT_BREAK_MINUTES,
      goals: [], cards: [], controlLog: [],
      startedAt: null, pausedAt: null, totalPausedMs: 0, nextPeriodIndex: 1,
      scheduledAt: r.scheduledAt ?? null,   // blank is expected and valid
      pitch:       r.venue || venue || '',
      // Whether THIS child's venue was set explicitly (its own row venue) rather
      // than inherited from the group default. A later group-venue cascade must
      // not overwrite an explicit one (P4).
      venueOverride: !!r.venue,
      indoor:      !!indoor,
      status: 'scheduled', tracked: false,
      createdBy: uid(), createdAt: serverTimestamp(),
    })
    childIds.push(childRef.id)
  }
  await batch.commit()
  return { id: groupRef.id, slug: groupSlug, matchDate, childIds }
}

// Set scheduled time (and optional venue) on many matches at once — backs the
// "times grid" screen. patches: [{ matchId, scheduledAt: Date|null, venue?: string }].
// Blank time is valid (clears to null); nothing else on the match is touched.
export async function setMatchTimes(patches = []) {
  const list = patches.filter(p => p && p.matchId)
  if (!list.length) return
  const batch = writeBatch(db)
  for (const p of list) {
    const patch = { scheduledAt: p.scheduledAt ?? null, updatedBy: uid(), updatedAt: serverTimestamp() }
    if (p.venue !== undefined) {
      patch.pitch = p.venue || ''
      // Setting a venue here is an explicit choice → it now wins over a later
      // group-venue cascade; clearing it lets the group default flow back in.
      patch.venueOverride = !!(p.venue && String(p.venue).trim())
    }
    batch.update(doc(db, 'matches', p.matchId), patch)
  }
  await batch.commit()
}

// ── Match-group edit / delete (P4) ────────────────────────────────────────────

// Move a stored time to a new calendar day, KEEPING its SAST wall-clock time
// (UTC+2, no DST). A group date move shifts the day; each match's explicit
// kickoff time is preserved, not reset.
function shiftScheduledToDate(scheduledAt, newDate) {
  const d = scheduledAt?.toDate ? scheduledAt.toDate() : (scheduledAt ? new Date(scheduledAt) : null)
  if (!d || isNaN(d.getTime())) return null
  const sast = new Date(d.getTime() + 2 * 60 * 60 * 1000)
  const hh = String(sast.getUTCHours()).padStart(2, '0')
  const mm = String(sast.getUTCMinutes()).padStart(2, '0')
  const shifted = new Date(`${newDate}T${hh}:${mm}:00+02:00`)
  return isNaN(shifted.getTime()) ? d : shifted
}

// Write a batch of path redirects so links shared before a move keep resolving
// (NotFound.jsx resolves them). Scoped to /match/ paths and stamped with the
// owning org so the (broadened) rule can authorise a non-admin owner's write.
async function writePathRedirects(pairs, ownerOrgId, competitionId = null) {
  const clean = pairs.filter(p => p.from && p.to && p.from !== p.to)
  if (!clean.length) return
  const batch = writeBatch(db)
  for (const { from, to } of clean) {
    batch.set(doc(db, 'redirects', redirectKey(from)), {
      fromPath: from, toPath: to, ownerOrgId: ownerOrgId ?? null,
      competitionId: competitionId ?? null,
      createdBy: uid(), createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
}

// Edit a match group's DATE and/or default VENUE, cascading to its children:
//   • date  — the day moved: every child's matchDate + path change, each kickoff
//             time is preserved, and the group + every child path is redirected
//             from old → new so shared links survive.
//   • venue — the group default flows to children that DID NOT set their own
//             venue (venueOverride); an explicit child venue is never overwritten.
// Returns a summary for the UI. The confirm dialog computes its preview from the
// children directly (see fetchMatchGroupChildren) — this performs the write.
export async function updateMatchGroup(groupId, { matchDate, venue } = {}) {
  const gRef  = doc(db, 'matchGroups', groupId)
  const gSnap = await getDoc(gRef)
  if (!gSnap.exists()) throw new Error('Match day not found.')
  const g = gSnap.data()
  const kids = (await getDocs(query(collection(db, 'matches'), where('matchGroupId', '==', groupId)))).docs

  const dateChanged  = !!matchDate && matchDate !== g.matchDate
  const venueChanged = venue !== undefined && venue !== (g.venue ?? '')
  if (!dateChanged && !venueChanged) return { dateChanged: false, venueChanged: false, childCount: kids.length }
  const newDate = dateChanged ? matchDate : g.matchDate

  const batch = writeBatch(db)
  const redirects = []

  const gPatch = { updatedBy: uid(), updatedAt: serverTimestamp() }
  if (dateChanged)  gPatch.matchDate = newDate
  if (venueChanged) gPatch.venue = venue
  batch.update(gRef, gPatch)
  if (dateChanged) redirects.push({ from: matchPath(g.matchDate, g.slug), to: matchPath(newDate, g.slug) })

  let cascaded = 0, kept = 0
  for (const cSnap of kids) {
    const c = cSnap.data()
    const patch = {}
    if (dateChanged) {
      patch.matchDate = newDate
      const newPath = matchPath(newDate, g.slug, c.ageSlug)
      patch.path = newPath
      const shifted = shiftScheduledToDate(c.scheduledAt, newDate)
      if (shifted) patch.scheduledAt = shifted
      if (c.path && c.path !== newPath) redirects.push({ from: c.path, to: newPath })
    }
    if (venueChanged) {
      if (c.venueOverride) kept++
      else { patch.pitch = venue || ''; cascaded++ }
    }
    if (Object.keys(patch).length) {
      patch.updatedBy = uid(); patch.updatedAt = serverTimestamp()
      batch.update(cSnap.ref, patch)
    }
  }

  await batch.commit()
  await writePathRedirects(redirects, g.ownerOrgId).catch(() => {})
  return { dateChanged, venueChanged, childCount: kids.length, venueCascaded: cascaded, venueKept: kept, redirects: redirects.length }
}

// Delete a match group WITHOUT orphaning children. Two modes:
//   • 'cascade' — delete the group and every child (one batch).
//   • 'detach'  — keep the matches but make them ordinary STANDALONE matches:
//                 clear matchGroupId/groupOrder/ageSlug, give each its own
//                 /match/{date}/{home-vs-away} slug+path (unique per date, across
//                 matches AND groups), and redirect the old child path → the new
//                 standalone path. Then delete the group.
export async function deleteMatchGroup(groupId, mode = 'cascade') {
  const gRef = doc(db, 'matchGroups', groupId)
  const kids = (await getDocs(query(collection(db, 'matches'), where('matchGroupId', '==', groupId)))).docs

  if (mode === 'detach') {
    // Seed per-date taken slug sets so new standalone slugs don't collide with
    // existing matches/groups on that date.
    const dates = [...new Set(kids.map(d => d.data().matchDate).filter(Boolean))]
    const takenByDate = new Map()
    await Promise.all(dates.map(async d => { takenByDate.set(d, await takenTopLevelSlugsForDate(d)) }))

    const batch = writeBatch(db)
    const redirects = []
    for (const cSnap of kids) {
      const c = cSnap.data()
      const taken = takenByDate.get(c.matchDate) ?? new Set()
      const slug = dedupeSlug(buildMatchSlug(
        c.homeDisplay ?? composeTeamDisplay(c.homeOrgName, c.homeTeamName ?? 'home'),
        c.awayDisplay ?? composeTeamDisplay(c.awayOrgName, c.awayTeamName ?? 'away')), taken)
      taken.add(slug)
      const newPath = matchPath(c.matchDate, slug)
      batch.update(cSnap.ref, {
        matchGroupId: deleteField(), groupOrder: deleteField(), ageSlug: deleteField(),
        matchSlug: slug, path: newPath, updatedBy: uid(), updatedAt: serverTimestamp(),
      })
      if (c.path && c.path !== newPath) redirects.push({ from: c.path, to: newPath })
    }
    batch.delete(gRef)
    await batch.commit()
    await writePathRedirects(redirects, gSnapOwner(kids)).catch(() => {})
    return { mode: 'detach', count: kids.length }
  }

  // cascade: remove children then the group (batch limit 500 — a match day is
  // tens of matches at most).
  const batch = writeBatch(db)
  for (const cSnap of kids) batch.delete(cSnap.ref)
  batch.delete(gRef)
  await batch.commit()
  return { mode: 'cascade', count: kids.length }
}

// The owning org for a detach's redirects — read off any child (all share it).
function gSnapOwner(kids) {
  for (const c of kids) { const o = c.data().homeOrgId; if (o) return o }
  return null
}

// Write a single path redirect (old → new). Used by the scorer slug edit so a
// renamed match's old link keeps resolving. /match/-scoped + org-stamped.
export async function writeMatchRedirect(fromPath, toPath, ownerOrgId = null, competitionId = null) {
  return writePathRedirects([{ from: fromPath, to: toPath }], ownerOrgId, competitionId)
}


// ── Match control (timer + periods) ──────────────────────────────────────────
// Each control action records an immutable audit entry in controlLog with the
// match timestamp captured client-side at the moment of the tap.

function controlEntry(type, period, matchTimestamp) {
  return { type, period: period ?? null, matchTimestamp: matchTimestamp ?? 0,
    clockTime: new Date().toISOString(), createdBy: uid(), createdAt: Date.now() }
}

export async function startMatch(id, { matchTimestamp = 0, periods } = {}) {
  // Tournament/festival fixtures with a pasted squad freeze their derived
  // line-up at the moment scoring starts (brief §4). Best-effort: a freeze
  // failure must never block the scorer from starting the match.
  await freezeFixtureLineupIfNeeded(id).catch(() => {})
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
    playerOfMatch: null, playersOfMatch: null,
    controlLog: [],
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
  if (m.competitionId) {
    await addCompetitionAuditEvent(m.competitionId, {
      eventType: 'match_reset', before: { status: m.status }, after: { status: 'scheduled' },
    }).catch(() => {})
    // Rebuild the competition's player slices now that this match is no longer
    // final — the finalisation trigger only fires on the way INTO final, so a
    // reset would otherwise leave this match's goals/cards/caps stuck on the
    // players and in the top-scorer table. The engine rebuilds from the
    // remaining Final fixtures, so the reset match simply drops out.
    await recalculateCompetitionStats(m.competitionId).catch(() => {})
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

  // An entered result also freezes a derived line-up (brief §4: freeze on the
  // first tracked event or transition to live — result entry is the terminal
  // equivalent for fixtures nobody live-scored). Best-effort, never blocks.
  await freezeFixtureLineupIfNeeded(matchId, m).catch(() => {})

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
  const snap = await getDocs(query(collection(identityDb, 'userProfiles'), where('email', '==', email.trim().toLowerCase())))
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
  batch.update(doc(identityDb, 'users', userId), {
    [`orgRoles.${orgId}`]: { role, teamId: teamId || null },
  })
  return batch.commit()
}

export async function removeOrgStaff(orgId, userId) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'organizations', orgId, 'staff', userId))
  // Atomically remove just this org's key from the mirrored map.
  batch.update(doc(identityDb, 'users', userId), {
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
    getDoc(doc(identityDb, 'userProfiles', r.id))
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
  batch.update(doc(identityDb, 'users', userId), {
    [`competitionRoles.${compId}`]: { role },
  })
  return batch.commit()
}

export async function removeCompetitionStaff(compId, userId) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'competitions', compId, 'staff', userId))
  batch.update(doc(identityDb, 'users', userId), {
    [`competitionRoles.${compId}`]: deleteField(),
  })
  return batch.commit()
}

export async function fetchCompetitionStaff(compId) {
  const snap = await getDocs(collection(db, 'competitions', compId, 'staff'))
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  const profiles = await Promise.all(rows.map(r =>
    getDoc(doc(identityDb, 'userProfiles', r.id))
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
  const snap = await getDocs(query(collection(identityDb, 'users'), orderBy('email')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Grant or revoke Master Admin status (masteradmin.add).
export async function setMasterAdmin(userId, isMaster) {
  return updateDoc(doc(identityDb, 'users', userId), {
    platformAdmin: isMaster === true,
    updatedAt: serverTimestamp(),
  })
}

// Activate/deactivate a single permission for a single person
// (permission.toggle). value true forces on, false forces off, null clears
// the override so the natural role's default applies again.
export async function setUserPermissionOverride(userId, capability, value) {
  const snap = await getDoc(doc(identityDb, 'users', userId))
  const overrides = { ...(snap.exists() ? snap.data().permissionOverrides ?? {} : {}) }
  if (value === null || value === undefined) delete overrides[capability]
  else overrides[capability] = value === true
  return updateDoc(doc(identityDb, 'users', userId), {
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

// "This isn't me" (A4): anyone — signed in or not — can flag a profile. A
// parent or coach who spots a wrong claim should not have to register to say
// so. Reports land in profileReports for the master-admin queue.
export async function reportProfileMismatch(personId, { personName = '', message = '', contact = '' } = {}) {
  await addDoc(collection(db, 'profileReports'), {
    personId,
    personName: (personName ?? '').slice(0, 200),
    message:    (message ?? '').slice(0, 1000),
    contact:    (contact ?? '').slice(0, 200),
    reporterUid: uid(),                      // null when signed out — that's fine
    status: 'open',
    createdAt: serverTimestamp(),
  })
}

export async function fetchProfileReports(personId = null) {
  const base = collection(db, 'profileReports')
  const q = personId ? query(base, where('personId', '==', personId)) : base
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
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

// ── Bulk team sheets (tournaments & festivals) ───────────────────────────────
// The competition squad lives on the membership doc
// (competitions/{id}/teams/{teamId}.squad) — this platform's equivalent of the
// brief's competitionTeams record. Fixture line-ups are DERIVED from it
// (squad − exceptions) until frozen; see src/lib/lineupResolve.js.

// Create an OWNERLESS player profile from a pasted team sheet (ownerless
// profiles addendum, Part A). No manager, no consent record, no relationship
// asserted between the confirmer and the player — nobody is claiming rights
// over anyone. createdByUid / createdInCompetitionId are AUDIT ONLY: no rule
// may ever read them to grant access. The profile is claimable later by the
// player (or a parent) via the email-verified claim transition.
export async function createTeamSheetPerson({ firstName, lastName, fullName }, competitionId, teamId = null) {
  const userId = uid()
  if (!userId) throw new Error('You must be signed in.')
  const name = (fullName ?? `${firstName ?? ''} ${lastName ?? ''}`).trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('A player name is required.')
  const slug = await generatePersonSlug(name)
  return addDoc(collection(db, 'people'), {
    // Display name stays in this repo's existing field, `fullName` (Q3). The
    // B6 rename to `name` is ON HOLD (resolution round Part 1b) — do NOT
    // dual-write a second name field. firstName/lastName are canonical.
    fullName: name,
    firstName: (firstName ?? '').trim() || null,
    lastName:  (lastName ?? '').trim() || null,
    slug,
    roles: ['player'],
    ownerUid: null, guardianUids: [], managerUids: [],   // empty at creation, always
    claimStatus: 'unclaimed',
    createdVia: 'teamSheet',
    createdByUid: userId,                                 // audit only
    createdInCompetitionId: competitionId ?? null,        // audit only
    createdInCompetitionTeamId: teamId,                   // audit + rules scoping for coach creates
    careerCaps: 0, careerGoals: 0,
    careerCards: { green: 0, yellow: 0, red: 0 },
    createdBy: userId, createdAt: serverTimestamp(),
  })
}

// A player claims their own unclaimed team-sheet profile (relationship
// 'player' → ownerUid), or a parent claims for an under-18 (relationship
// 'parent' → guardianUids). managerUids is NEVER written by a claim — the
// addendum's first flat-managerUids model was wrong; ownership and
// guardianship transfer normally through the existing flows. Verification is
// the account's verified email and nothing more. A pre-claim snapshot is
// stored so a master-admin revocation can restore it.
export async function claimTeamSheetProfile(personId, relationship = 'player') {
  const user = auth?.currentUser
  if (!user) throw new Error('You must be signed in to claim a profile.')
  if (!user.emailVerified) {
    const e = new Error('Verify your email address first — check your inbox for the confirmation link.')
    e.code = 'claim/email-unverified'; throw e
  }
  const ref = doc(db, 'people', personId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Profile not found.')
  const d = snap.data()
  if (d.claimStatus !== 'unclaimed') {
    const e = new Error('This profile has already been claimed.')
    e.code = 'profile/already-claimed'; throw e
  }
  if ((d.claimBlockedUids ?? []).includes(user.uid)) {
    const e = new Error('This profile cannot be claimed from this account.')
    e.code = 'claim/blocked'; throw e
  }
  // Snapshot the fields a claimer could later edit, so revocation restores them.
  const preClaimSnapshot = {
    fullName: d.fullName ?? null,
    firstName: d.firstName ?? null, lastName: d.lastName ?? null,
    photoUrl: d.photoUrl ?? null, bio: d.bio ?? null, dateOfBirth: d.dateOfBirth ?? null,
    position: d.position ?? null, nationality: d.nationality ?? null,
  }
  const controlPatch = relationship === 'parent'
    ? { guardianUids: [user.uid] }
    : { ownerUid: user.uid }
  return updateDoc(ref, {
    ...controlPatch,
    claimStatus: 'claimed',
    preClaimSnapshot,
    claimedBy: user.uid, claimedAt: serverTimestamp(),
    updatedBy: user.uid, updatedAt: serverTimestamp(),
  })
}

// Master-admin revocation of a claim (addendum A4): returns the profile to
// unclaimed, blocks the revoked uid from re-claiming, restores the pre-claim
// snapshot so nothing the wrong claimer added survives, and audits the event.
// ownerUid and guardianUids empty out; managerUids is untouched — claims
// never write it, so revocation never strips it.
export async function revokeProfileClaim(personId) {
  const ref = doc(db, 'people', personId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Profile not found.')
  const d = snap.data()
  const revokedUid = d.claimedBy ?? d.ownerUid ?? (d.guardianUids ?? [])[0] ?? null
  const restore = d.preClaimSnapshot ?? {}
  return updateDoc(ref, {
    ...restore,
    ownerUid: null, guardianUids: [],
    claimStatus: 'unclaimed',
    ...(revokedUid ? { claimBlockedUids: arrayUnion(revokedUid) } : {}),
    claimRevokedAt: serverTimestamp(), claimRevokedBy: uid(),
    preClaimSnapshot: deleteField(), claimedBy: deleteField(), claimedAt: deleteField(),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Does this account already control a claimed profile? Drives the one-time
// session claim search (addendum A4 step 2): it fires on the first
// authenticated session where the account holds NO claimed profile — on the
// session, not the sign-up form, so Google/other provider sign-ins that never
// pass through sign-up still get it.
export async function userHoldsClaimedProfile(userId) {
  const [owned, guarded] = await Promise.all([
    getDocs(query(collection(db, 'people'), where('ownerUid', '==', userId), limit(1))),
    getDocs(query(collection(db, 'people'), where('guardianUids', 'array-contains', userId), limit(1))),
  ])
  return !owned.empty || !guarded.empty
}

// Unclaimed team-sheet profiles matching a name — the sign-up claim search
// (addendum A4 step 3, not optional). Name-only matching, same bias as the
// review grid. Never lists; only answers a direct name query.
export async function searchUnclaimedProfiles(name) {
  const target = (name ?? '').trim().toLowerCase()
  if (!target) return []
  const snap = await getDocs(query(collection(db, 'people'), where('claimStatus', '==', 'unclaimed')))
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  const exact = all.filter(p => (p.fullName ?? '').trim().toLowerCase() === target)
  if (exact.length > 0) return exact
  const parts = target.split(/\s+/)
  const surname = parts[parts.length - 1] ?? ''
  if (!surname || parts.length < 2) return []
  return all.filter(p => {
    const pp = (p.fullName ?? '').trim().toLowerCase().split(/\s+/)
    return pp.length > 1 && pp[pp.length - 1] === surname && pp[0][0] === parts[0][0]
  })
}

// Save the pasted-and-confirmed squad + optional staff onto the membership
// doc. squad: [{ playerId, playerName, capNumber, isCaptain, photoUrl }]
// (playerName and photoUrl are display snapshots so line-ups render without N
// person reads — closing round item 2 fixes the field name to playerName).
// staff: [{ role, name }] — names only, no accounts, no linking (§8).
export async function saveCompetitionTeamSheet(competitionId, teamId, { squad = [], staff = [] } = {}) {
  await setDoc(doc(db, 'competitions', competitionId, 'teams', teamId), {
    squad, staff,
    squadUpdatedAt: serverTimestamp(),
    squadUpdatedBy: uid(),
  }, { merge: true })
  // competitionIds maintenance — committed here so the stats chain's
  // before-state check passes when a career stat is later written for these
  // players (same maintenance addPersonToMatchLineup does one at a time).
  await Promise.all(squad.map(s =>
    s.playerId
      ? updateDoc(doc(db, 'people', s.playerId), { competitionIds: arrayUnion(competitionId) }).catch(() => {})
      : Promise.resolve()
  ))

  // Give every pasted player a proper linked record right away: a competition
  // stat slice (so they show on the players list and accrue stats as fixtures
  // play) and a link to the team's org for the roll-up. Best-effort, idempotent.
  await ensureCompetitionSquadSlices(competitionId, teamId, squad ?? []).catch(() => {})
  const _teamSnap = await getDoc(doc(db, 'teams', teamId)).catch(() => null)
  const _teamOrgId = _teamSnap && _teamSnap.exists() ? (_teamSnap.data().organizationId ?? null) : null
  if (_teamOrgId) {
    for (const s of (squad ?? [])) {
      const pid = s.playerId ?? s.personId
      if (pid) await linkPersonToOrg(pid, _teamOrgId).catch(() => {})
    }
  }

  // Link every pasted player into the team's actual fixtures (real lineups +
  // lineupPersonIds), so their profile lists those matches and the merge tool
  // can move them — the standard behaviour, not the derived-only sheet.
  await seedFixturesFromTeamSheet(competitionId, teamId, squad ?? []).catch(() => {})
}

export async function fetchCompetitionTeamSheet(competitionId, teamId) {
  const snap = await getDoc(doc(db, 'competitions', competitionId, 'teams', teamId))
  if (!snap.exists()) return { squad: [], staff: [] }
  const d = snap.data()
  return { squad: d.squad ?? [], staff: d.staff ?? [] }
}

// Mark a player absent (or present again) for ONE fixture. Stored as an
// exception on the match doc — the squad and every other fixture are
// untouched. A skipped/absent player is an explicit record, not an omission.
export async function setFixtureAbsence(matchId, { playerId, side, absent }) {
  const snap = await getDoc(doc(db, 'matches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const current = (snap.data().exceptions ?? [])
    .filter(e => !(e.playerId === playerId && e.side === side && e.type === 'absent'))
  const exceptions = absent
    ? [...current, { playerId, side, type: 'absent' }]
    : current
  return updateDoc(doc(db, 'matches', matchId), {
    exceptions, updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Per-fixture cap override (§9): stored as its OWN exception type — addendum
// B2; never encoded as an 'added' entry. capNumber null clears the override.
// Caps are usually stable across a festival.
export async function setFixtureCapOverride(matchId, { playerId, side, capNumber }) {
  const snap = await getDoc(doc(db, 'matches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const current = (snap.data().exceptions ?? [])
    .filter(e => !(e.playerId === playerId && e.side === side && e.type === 'override'))
  const exceptions = capNumber != null
    ? [...current, { playerId, side, type: 'override', capNumber }]
    : current
  return updateDoc(doc(db, 'matches', matchId), {
    exceptions, updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Freeze: materialise the derived line-ups into the match doc and flip
// lineupMode to 'frozen'. Runs on the transition to live (startMatch) and on
// result entry (submitFixtureResult); a no-op for leagues, standalone
// fixtures, already-frozen matches and teams without a pasted squad — so
// legacy behaviour is untouched. After freezing, every existing reader
// (scoring, stats engine, match page) sees a normal stored line-up, and
// historical fixtures never mutate when the squad is edited later (§4).
export async function freezeFixtureLineupIfNeeded(matchId, matchData = null) {
  const m = matchData ?? (await getDoc(doc(db, 'matches', matchId))).data()
  if (!m || !m.competitionId || m.lineupMode === 'frozen') return
  const compSnap = await getDoc(doc(db, 'competitions', m.competitionId))
  if (!compSnap.exists()) return
  const type = compSnap.data().type
  if (type !== 'tournament' && type !== 'festival') return

  const [homeMem, awayMem] = await Promise.all([
    m.homeTeamId ? getDoc(doc(db, 'competitions', m.competitionId, 'teams', m.homeTeamId)).catch(() => null) : null,
    m.awayTeamId ? getDoc(doc(db, 'competitions', m.competitionId, 'teams', m.awayTeamId)).catch(() => null) : null,
  ])
  const homeSquad = homeMem?.exists() ? (homeMem.data().squad ?? []) : []
  const awaySquad = awayMem?.exists() ? (awayMem.data().squad ?? []) : []
  if (homeSquad.length === 0 && awaySquad.length === 0) return

  const exceptions = m.exceptions ?? []
  // A side without a squad keeps whatever was added manually — the resolver
  // only replaces sides that actually inherit.
  const homeResolved = homeSquad.length > 0
    ? resolveSideLineup({ squad: homeSquad, exceptions, side: 'home' }) : (m.homeLineup ?? [])
  const awayResolved = awaySquad.length > 0
    ? resolveSideLineup({ squad: awaySquad, exceptions, side: 'away' }) : (m.awayLineup ?? [])

  // Best-effort person snapshots: controllerUids power self-removal rules,
  // photoUrl powers avatars on non-line-up surfaces (e.g. the POTM sheet).
  const ids = [...new Set([...homeResolved, ...awayResolved].map(e => e.personId).filter(Boolean))]
  const peopleById = {}
  await Promise.all(ids.map(async pid => {
    try {
      const p = await getDoc(doc(db, 'people', pid))
      if (p.exists()) peopleById[pid] = p.data()
    } catch { /* snapshot stays minimal */ }
  }))
  const enrich = e => {
    const pd = peopleById[e.personId]
    if (!pd) return { ...e, photoUrl: null, controllerUids: [] }
    return {
      ...e,
      photoUrl: pd.photoUrl ?? null,
      controllerUids: [pd.ownerUid, ...(pd.guardianUids ?? []), ...(pd.managerUids ?? [])].filter(Boolean),
    }
  }

  const homeLineup = homeResolved.map(enrich)
  const awayLineup = awayResolved.map(enrich)
  const lineupPersonIds = [...new Set([
    ...(m.lineupPersonIds ?? []),
    ...ids,
  ])]
  await updateDoc(doc(db, 'matches', matchId), {
    // The CANONICAL fields every reader consumes (stats engine, goal
    // attribution, public renderer) — addendum B3 — plus a frozenLineup copy
    // for the cross-sport contract.
    homeLineup, awayLineup, lineupPersonIds,
    frozenLineup: { home: homeLineup, away: awayLineup },
    lineupMode: 'frozen', lineupFrozenAt: serverTimestamp(),
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })
}

// Write a whole side's fixture line-up directly from a confirmed team sheet —
// leagues and standalone fixtures (team-sheets-everywhere §3). The paste grid
// is the confirmed source for THIS fixture, so this REPLACES that side's
// line-up wholesale. It never touches the competition squad, the other side,
// or the exceptions array. It deliberately does NOT set lineupMode:'frozen' —
// freeze stays the "a human was present at the match" signal (§4), applied at
// start/result. `squad` rows are { playerId, playerName, capNumber, isCaptain,
// photoUrl }, the same shape the editor builds for a competition squad.
export async function saveFixtureLineup(matchId, side, squad = []) {
  const matchRef = doc(db, 'matches', matchId)
  const snap = await getDoc(matchRef)
  if (!snap.exists()) throw new Error('Match not found')
  const m = snap.data()

  // Map squad rows → line-up entries through the SAME resolver a freeze uses,
  // so a directly-pasted line-up is identical in shape to an inherited one.
  const resolved = resolveSideLineup({ squad, exceptions: [], side })

  // Enrich with photo + controllerUids (self-removal rules / avatars), exactly
  // as freezeFixtureLineupIfNeeded does.
  const ids = [...new Set(resolved.map(e => e.personId).filter(Boolean))]
  const peopleById = {}
  await Promise.all(ids.map(async pid => {
    try { const p = await getDoc(doc(db, 'people', pid)); if (p.exists()) peopleById[pid] = p.data() }
    catch { /* snapshot stays minimal */ }
  }))
  const entries = resolved.map(e => {
    const pd = peopleById[e.personId]
    return {
      ...e,
      photoUrl: pd?.photoUrl ?? e.photoUrl ?? null,
      controllerUids: pd ? [pd.ownerUid, ...(pd.guardianUids ?? []), ...(pd.managerUids ?? [])].filter(Boolean) : [],
    }
  })

  const field = side === 'home' ? 'homeLineup' : 'awayLineup'
  const otherField = side === 'home' ? 'awayLineup' : 'homeLineup'
  const other = m[otherField] ?? []
  const lineupPersonIds = [...new Set([...entries, ...other].map(e => e.personId).filter(Boolean))]
  await updateDoc(matchRef, {
    [field]: entries,
    lineupPersonIds,
    updatedBy: uid(), updatedAt: serverTimestamp(),
  })

  // Auto-link every pasted player to the side's org for stats roll-up.
  const _orgId = side === 'home' ? m.homeOrgId : m.awayOrgId
  const _orgName = side === 'home' ? m.homeOrgName : m.awayOrgName
  if (_orgId) {
    for (const _e of entries) {
      if (_e.personId) await linkPersonToOrg(_e.personId, _orgId, _orgName ?? null).catch(() => {})
    }
  }
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

// ── Competition squads ────────────────────────────────────────────────────────
// A team's registered squad for ONE competition, stored at
// competitions/{compId}/squads/{teamId}. Players in the squad are assigned to
// EVERY match the team plays in the competition (past and future), by default:
// editing the squad fans out to existing matches immediately, and a competition
// fixture created later seeds its line-up from both teams' squads. Editable by a
// competition admin or the team's own org staff (firestore rules enforce this);
// the lineup writes it triggers are authorised by the match rule (competition or
// team-side authority), so no extra grant is needed.

// Every match the team plays in a competition, tagged with the side it is on.
async function competitionTeamMatchesForSquad(competitionId, teamId) {
  const [homeSnap, awaySnap] = await Promise.all([
    getDocs(query(collection(db, 'matches'),
      where('competitionId', '==', competitionId), where('homeTeamId', '==', teamId))),
    getDocs(query(collection(db, 'matches'),
      where('competitionId', '==', competitionId), where('awayTeamId', '==', teamId))),
  ])
  return [
    ...homeSnap.docs.map(d => ({ id: d.id, side: 'home', ...d.data() })),
    ...awaySnap.docs.map(d => ({ id: d.id, side: 'away', ...d.data() })),
  ]
}

export async function fetchCompetitionSquad(competitionId, teamId) {
  const snap = await getDoc(doc(db, 'competitions', competitionId, 'squads', teamId))
  return snap.exists() ? (snap.data().squad ?? []) : []
}

// The team's TEAM-SHEET squad (stored on the competition membership doc) as its
// raw squad array. Used by the competition Teams page to list every player in
// the team's squad, however they were added.
export async function fetchCompetitionTeamSheetSquad(competitionId, teamId) {
  if (!competitionId || !teamId) return []
  const snap = await getDoc(doc(db, 'competitions', competitionId, 'teams', teamId))
  return snap.exists() ? (snap.data().squad ?? []) : []
}

// Add a player to a team's competition squad, then assign them to every match
// the team plays in this competition. Idempotent per match.
// Register a whole pasted team-sheet squad into the competition and link every
// player to all the team's fixtures the STANDARD way: merge them into the
// registered competition squad AND write each into every fixture's real lineup
// (homeLineup / awayLineup + lineupPersonIds, plus a stat slice and org link,
// via addPersonToMatchLineup). This makes pasted players first-class — their
// profile's match list finds them (lineupPersonIds), the merge tool can move
// them, and their stats accrue — the same as a player added one at a time.
// Idempotent.
export async function seedFixturesFromTeamSheet(competitionId, teamId, squad = []) {
  if (!competitionId || !teamId || !squad.length) return
  const players = squad
    .map(s => ({
      personId:   s.playerId ?? s.personId ?? null,
      personName: s.playerName ?? s.personName ?? null,
      personSlug: s.personSlug ?? null,
      shirtNumber: s.shirtNumber ?? null,
    }))
    .filter(p => p.personId)
  if (!players.length) return

  const ref = doc(db, 'competitions', competitionId, 'squads', teamId)
  const snap = await getDoc(ref).catch(() => null)
  const existing = snap && snap.exists() ? (snap.data().squad ?? []) : []
  const byId = new Map(existing.map(s => [s.personId, s]))
  for (const p of players) if (!byId.has(p.personId)) byId.set(p.personId, p)
  await setDoc(ref, { teamId, squad: [...byId.values()], updatedAt: serverTimestamp(), updatedBy: uid() }, { merge: true }).catch(() => {})

  // Link every player to the team's own organisation (authoritative) so
  // their stats roll up. Done directly here — not only via
  // addPersonToMatchLineup — so a RE-RUN still links players already in the
  // lineup (that helper returns early for those and would skip the org link).
  const teamSnap = await getDoc(doc(db, 'teams', teamId)).catch(() => null)
  const teamOrgId = teamSnap && teamSnap.exists() ? (teamSnap.data().organizationId ?? null) : null
  if (teamOrgId) {
    for (const p of players) await linkPersonToOrg(p.personId, teamOrgId).catch(() => {})
  }

  // 3. Ensure each player has a competition stat slice (so they show on the
  //    players list and accrue stats), even when this runs from the backfill.
  await ensureCompetitionSquadSlices(competitionId, teamId, squad).catch(() => {})

  // 4. Maintain lineupPersonIds — the flat reverse-index that powers a player's
  //    match list, the merge tool, and the stats self-heal — WITHOUT populating
  //    the real homeLineup/awayLineup. The team-sheet renderer/editor treats a
  //    side as "derived" (and editable via the paste-and-review grid) only while
  //    its lineup array is empty, so writing real entries here would disable that
  //    editor. We therefore keep the array empty (reverting any earlier seed that
  //    wrongly populated it) and just index the personIds. Frozen (played)
  //    fixtures are historical and never touched.
  const personIds = players.map(p => p.personId).filter(Boolean)
  const matches = await competitionTeamMatchesForSquad(competitionId, teamId)
  for (const m of matches) {
    if (m.lineupMode === 'frozen') continue
    const field = m.side === 'home' ? 'homeLineup' : 'awayLineup'
    const patch = {}
    if ((m[field] ?? []).length) patch[field] = []   // revert to derived
    const existingIds = m.lineupPersonIds ?? []
    const nextIds = [...new Set([...existingIds, ...personIds])]
    if (patch[field] !== undefined || nextIds.length !== existingIds.length) {
      patch.lineupPersonIds = nextIds
      await updateDoc(doc(db, 'matches', m.id), patch).catch(() => {})
    }
  }
}

export async function addToCompetitionSquad(competitionId, teamId, { personId, personName, personSlug = null, shirtNumber = null }) {
  if (!personId) throw new Error('No player selected.')
  const ref = doc(db, 'competitions', competitionId, 'squads', teamId)
  const snap = await getDoc(ref)
  const squad = snap.exists() ? (snap.data().squad ?? []) : []
  if (!squad.some(s => s.personId === personId)) {
    const entry = { personId, personName: personName ?? null, personSlug: personSlug ?? null, shirtNumber: shirtNumber || null }
    await setDoc(ref, { teamId, squad: [...squad, entry], updatedAt: serverTimestamp(), updatedBy: uid() }, { merge: true })
  }

  // Link the player to the team's org up front, so the roll-up holds even
  // before the team has any fixtures.
  const _teamSnap = await getDoc(doc(db, 'teams', teamId)).catch(() => null)
  const _teamOrgId = _teamSnap && _teamSnap.exists() ? (_teamSnap.data().organizationId ?? null) : null
  if (_teamOrgId) await linkPersonToOrg(personId, _teamOrgId).catch(() => {})

  const matches = await competitionTeamMatchesForSquad(competitionId, teamId)
  for (const m of matches) {
    await addPersonToMatchLineup(m.id, { personId, personName, side: m.side, shirtNumber }).catch(() => {})
  }
}

// Remove a player from a team's competition squad and from the team's match
// line-ups in this competition.
export async function removeFromCompetitionSquad(competitionId, teamId, personId) {
  const ref = doc(db, 'competitions', competitionId, 'squads', teamId)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    const squad = (snap.data().squad ?? []).filter(s => s.personId !== personId)
    await setDoc(ref, { squad, updatedAt: serverTimestamp(), updatedBy: uid() }, { merge: true })
  }
  const matches = await competitionTeamMatchesForSquad(competitionId, teamId)
  for (const m of matches) {
    const field = m.side === 'home' ? 'homeLineup' : 'awayLineup'
    const entry = (m[field] ?? []).find(e => e.personId === personId)
    if (entry) await removePersonFromMatchLineup(m.id, entry.id, m.side).catch(() => {})
  }
}

// Seed a competition match's line-ups from both teams' registered squads, so a
// squad set up front carries into fixtures created later. Idempotent and
// best-effort — a permission gap for one team never blocks the other.
export async function seedMatchLineupsFromSquads(match) {
  if (!match?.id || !match.competitionId) return
  for (const side of ['home', 'away']) {
    const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId
    if (!teamId) continue
    const squad = await fetchCompetitionSquad(match.competitionId, teamId).catch(() => [])
    for (const p of squad) {
      await addPersonToMatchLineup(match.id, {
        personId: p.personId, personName: p.personName, side, shirtNumber: p.shirtNumber,
      }).catch(() => {})
    }
  }
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
    const baseSlug  = buildMatchSlug(
      composeTeamDisplay(home.teamName || home.orgName, home.displayName),
      composeTeamDisplay(away.teamName || away.orgName, away.displayName))
    const matchSlug = seasonStr
      ? await generateUniqueMatchSlug(seasonStr, baseSlug)
      : await generateUniqueMatchSlugGlobal(baseSlug)

    const ref = await addDoc(collection(db, 'matches'), {
      competitionId,
      ownerOrgId:        ownerOrgId ?? null,
      homeTeamId:        home.id,
      homeTeamName:      home.displayName,
      homeTeamColor:     home.primaryColor  || null,
      homeOrgId:         home.organizationId ?? null,
      homeOrgName:       home.orgName       || null,
      homeRegistered:    !!home.organizationId,
      awayTeamId:        away.id,
      awayTeamName:      away.displayName,
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

// Per-team Player of the Match. When rules.potm.perTeam is on, awards are
// captured per side and stored here instead of `playerOfMatch`. Legacy single-
// POTM matches are read from `playerOfMatch`; the two are never migrated so no
// historical award is lost. See src/lib/POTM.js#POTMForSide.
export async function setPlayersOfMatch(matchId, { home = null, away = null } = {}) {
  return updateDoc(doc(db, 'matches', matchId), {
    playersOfMatch: { home: home ?? null, away: away ?? null },
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

    const sideDisplay = teamId
      ? composeTeamDisplay(memberSnapshot.orgName, memberSnapshot.teamName ?? teamId)
      : placeholderName
    const updateBatch = writeBatch(db)
    const redirects = []
    let updates = 0
    for (let i = 0; i < fxSnap.docs.length; i++) {
      const matchSnap = matchSnaps[i]
      if (!matchSnap?.exists()) continue
      const m = matchSnap.data()
      const patch = {}, fxPatch = {}
      let newHomeDisplay, newAwayDisplay

      if (m.homeSlotId === slotId) {
        patch.homeTeamId    = teamId ?? null
        patch.homeTeamName  = teamId ? (memberSnapshot.teamName ?? teamId) : placeholderName
        patch.homeOrgName   = teamId ? (memberSnapshot.orgName ?? null) : null
        patch.homeTeamColor = teamId ? (memberSnapshot.colors?.primary ?? null) : null
        patch.homeRegistered = !!teamId
        patch.homeDisplay   = sideDisplay
        newHomeDisplay      = sideDisplay
        fxPatch.homeTeamId  = teamId ?? null
      }
      if (m.awaySlotId === slotId) {
        patch.awayTeamId    = teamId ?? null
        patch.awayTeamName  = teamId ? (memberSnapshot.teamName ?? teamId) : placeholderName
        patch.awayOrgName   = teamId ? (memberSnapshot.orgName ?? null) : null
        patch.awayTeamColor = teamId ? (memberSnapshot.colors?.primary ?? null) : null
        patch.awayRegistered = !!teamId
        patch.awayDisplay   = sideDisplay
        newAwayDisplay      = sideDisplay
        fxPatch.awayTeamId  = teamId ?? null
      }

      if (Object.keys(patch).length > 0) {
        // Re-stamp the fixture URL from the new H1 and redirect the old path.
        const rs = await computeMatchRestamp(m, { homeDisplay: newHomeDisplay, awayDisplay: newAwayDisplay })
        if (rs) {
          patch.matchSlug = rs.patch.matchSlug
          patch.path = rs.patch.path
          if (rs.redirect) redirects.push(rs.redirect)
        }
        updateBatch.update(doc(db, 'matches', fxSnap.docs[i].id), { ...patch, updatedAt: serverTimestamp() })
        if (Object.keys(fxPatch).length > 0) {
          updateBatch.update(doc(db, 'competitions', competitionId, 'fixtures', fxSnap.docs[i].id),
            { ...fxPatch, updatedAt: serverTimestamp() })
        }
        updates++
      }
    }
    if (updates > 0) await updateBatch.commit()
    await writePathRedirects(redirects, null, competitionId).catch(() => {})
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
      homeTeamId: null, homeTeamName: g.homeName, homeTeamColor: null,
      homeOrgId: null, homeOrgName: null, homeRegistered: false,
      awayTeamId: null, awayTeamName: g.awayName, awayTeamColor: null,
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
// home/away: { teamId, teamName, orgName, color, orgId } | null
export async function stampPlayoffFixtureTeams(competitionId, fixtureId, home, away) {
  await assertCompetitionAdmin(competitionId)
  const patch = { updatedAt: serverTimestamp() }
  if (home) Object.assign(patch, {
    homeTeamId: home.teamId, homeTeamName: home.teamName ?? home.teamId,
    homeTeamColor: home.color ?? null,
    homeOrgId: home.orgId ?? null, homeOrgName: home.orgName ?? null, homeRegistered: !!home.orgId,
  })
  if (away) Object.assign(patch, {
    awayTeamId: away.teamId, awayTeamName: away.teamName ?? away.teamId,
    awayTeamColor: away.color ?? null,
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
  await updateDoc(doc(db, 'matches', matchId), {
    homeTeamId: null, homeTeamName: homeName ?? 'TBC', homeTeamColor: null,
    homeOrgId: null, homeOrgName: null, homeRegistered: false,
    awayTeamId: null, awayTeamName: awayName ?? 'TBC', awayTeamColor: null,
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
  const seasonStr  = season ? String(season) : (competition.season ? String(competition.season) : null)
  const compSlug   = competition.slug || null
  // URL identity: every generated fixture gets a matchSlug (unique within the
  // competition, including within this batch) and — when the competition has a
  // slug + season — the competitionSlug/Season fields and the canonical path.
  // Without these, matchUrl() falls through to '/' and the fixture card links
  // to the home page, and MatchDetail (which resolves by stored `path`) can
  // never find the match.
  const slugSnap   = await getDocs(query(collection(db, 'matches'), where('competitionId', '==', competitionId)))
  const takenSlugs = new Set(slugSnap.docs.map(d => d.data().matchSlug).filter(Boolean))
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

    const matchSlug = dedupeSlug(buildMatchSlug(
      composeTeamDisplay(homeSnap.orgName, homeTeamName),
      composeTeamDisplay(awaySnap.orgName, awayTeamName)), takenSlugs)
    takenSlugs.add(matchSlug)

    const matchRef = doc(collection(db, 'matches'))
    batchWrite.set(matchRef, {
      competitionId,
      matchSlug,
      ...(compSlug && seasonStr ? {
        competitionSlug:   compSlug,
        competitionSeason: seasonStr,
        path: competitionMatchPath(seasonStr, compSlug, matchSlug),
      } : {}),
      ownerOrgId:        ownerOrgId ?? null,
      homeTeamId:        homeSlot.teamId ?? null,
      homeTeamName,
      homeTeamColor,
      homeOrgId:         null,
      homeRegistered:    !!homeSlot.teamId,
      homeSlotId:        homeSlot.slotId,
      awayTeamId:        awaySlot.teamId ?? null,
      awayTeamName,
      awayTeamColor,
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
  const call = httpsCallable(functions, 'waterpoloRecalculateCompetitionStats')
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
  const call = httpsCallable(functions, 'waterpoloRebuildAllCareerStats')
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

// ── Payment requests / entitlement tokens: REMOVED ────────────────────────────
// Purchase, plan grants and entitlement tokens are CENTRAL (platform brief §2,
// §7a). This app must never write entitlement / eventCredits /
// entitlementExpiresAt — the central rules reject it. Users are sent to the
// main site to buy or manage a plan; the resulting claim arrives on the Auth
// token via syncUserClaims and is read in AuthContext.
