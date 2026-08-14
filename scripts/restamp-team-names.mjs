// One-off: re-stamp denormalised team-name copies in the NEW display format.
//
// WHY: match documents and competition-membership displaySnapshots carry a
// stored copy of the team (and org) name. After the naming restructure those
// copies still hold the OLD format ("Girls U16A", "Men's 1st Team"). This
// script rewrites them to the new format ("U16A Girls", "1st Team Men") —
// but ONLY where the stored value still matches what the system itself would
// have generated (old format, or the team's cached displayName). A stored
// name that differs was edited by an organiser and is LEFT ALONE.
//
// Covers, for REGISTERED sides only (a real teams/{id} doc):
//   - matches: homeTeamName/awayTeamName, and homeOrgName/awayOrgName where
//     the stored value equals the org's full name and a matchName now exists
//   - competitions/{id}/teams displaySnapshot.teamName / .orgName (the
//     snapshot mechanism itself is kept — this only refreshes system values)
//
// NEVER touched: manualOpponents, unregistered/manual match sides, any stored
// name that doesn't exactly match a system-generated candidate.
//
// Run AFTER migrate-club-divisions.mjs (either order works — candidates cover
// both pre- and post-split shapes — but that order keeps the report cleaner).
//
// USAGE (same convention as the other admin scripts):
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/restamp-team-names.mjs            # dry run
//   APPLY=1 FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/restamp-team-names.mjs            # write
//
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.env.APPLY === '1'
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
const app = initializeApp({ credential: cert(serviceAccount) })
const db  = getFirestore(app, 'waterpolo')

// ── Mirrors of src/lib/teamNaming.js (old AND new formats) ───────────────────
const GENDER_LABEL = { boys: 'Boys', girls: 'Girls', men: 'Men', women: 'Women', mixed: 'Mixed' }
const DIVISION_GENDER_WORD = {
  men: 'Men', ladies: 'Women', juniorBoys: 'Boys', juniorGirls: 'Girls',
  masters: 'Masters', open: 'Open', mixed: 'Mixed',
}
// OLD club rendering used the division label first: "Men's 1st Team".
const OLD_DIVISION_LABEL = {
  men: "Men's", ladies: 'Ladies', masters: 'Masters', open: 'Open',
  juniorBoys: 'Boys', juniorGirls: 'Girls', mixed: 'Mixed',
}
// Inverse of the split mapping, to reconstruct what a post-split team's OLD
// division-style name would have been.
const GENDER_TO_OLD_DIVISION = { men: 'men', women: 'ladies', boys: 'juniorBoys', girls: 'juniorGirls', mixed: 'mixed' }
const CLUB_DIVISION_VALUES = new Set(['men', 'ladies', 'masters', 'open', 'juniorBoys', 'juniorGirls', 'mixed'])

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()
function levelLabel(t) {
  if (t.ageGroup) return clean(`${t.ageGroup}${(t.teamLevel ?? '').trim()}`)
  return clean(t.teamLevel ?? '')
}
function teamDivision(t) {
  if (t.division) return t.division
  if (t.gender && CLUB_DIVISION_VALUES.has(t.gender)) return t.gender
  return null
}
// NEW format label (gender last; single-sex school omits the word).
function newName(t, org) {
  const level = levelLabel(t)
  const division = teamDivision(t)
  if (division) return clean(`${level} ${DIVISION_GENDER_WORD[division] ?? division}`)
  const p = org?.genderProfile
  if (p === 'boys' || p === 'girls') return level
  return clean(`${level} ${GENDER_LABEL[t.gender] ?? ''}`)
}
// Every name the SYSTEM could have stamped for this team under the old format
// (plus the current cache). A stored copy matching none of these was
// hand-edited and must not be touched.
function oldCandidates(t, org) {
  const out = new Set()
  const level = levelLabel(t)
  const p = org?.genderProfile
  // old school style: gender first, single-sex omitted
  if (p === 'boys' || p === 'girls') out.add(level)
  else out.add(clean(`${GENDER_LABEL[t.gender] ?? ''} ${level}`))
  // old club style from a stored division
  const division = teamDivision(t)
  if (division) out.add(clean(`${OLD_DIVISION_LABEL[division] ?? division} ${level}`))
  // old club style reconstructed from a post-split gender
  const oldDiv = GENDER_TO_OLD_DIVISION[t.gender]
  if (oldDiv) out.add(clean(`${OLD_DIVISION_LABEL[oldDiv]} ${level}`))
  // current cached displayName (covers legacy pre-structured teams verbatim)
  if (t.displayName) out.add(clean(t.displayName))
  out.delete('')
  return out
}

// ── Load teams + orgs ─────────────────────────────────────────────────────────
const orgs = new Map()
for (const d of (await db.collection('organizations').get()).docs) orgs.set(d.id, d.data())
const teams = new Map()
for (const d of (await db.collection('teams').get()).docs) teams.set(d.id, d.data())

let matchStamps = 0, snapStamps = 0, orgStamps = 0, skippedEdited = 0

// ── 1. Match docs, per registered team ───────────────────────────────────────
for (const [teamId, t] of teams) {
  const org = orgs.get(t.organizationId) ?? {}
  const fresh = newName(t, org)
  if (!fresh) continue
  const candidates = oldCandidates(t, org)
  for (const side of ['home', 'away']) {
    const snap = await db.collection('matches').where(`${side}TeamId`, '==', teamId).get()
    for (const m of snap.docs) {
      const stored = clean(m.data()[`${side}TeamName`])
      if (!stored || stored === fresh) continue
      if (!candidates.has(stored)) { skippedEdited++; continue }   // organiser edit — leave
      console.log(`MATCH  ${m.id} ${side}TeamName "${stored}" → "${fresh}"`)
      matchStamps++
      if (APPLY) await m.ref.update({ [`${side}TeamName`]: fresh })
    }
  }
}

// ── 2. Org name copies → matchName (only where stored === full name) ─────────
for (const [orgId, o] of orgs) {
  const short = clean(o.matchName)
  const full  = clean(o.name)
  if (!short || short === full) continue
  for (const side of ['home', 'away']) {
    const snap = await db.collection('matches').where(`${side}OrgId`, '==', orgId).get()
    for (const m of snap.docs) {
      const stored = clean(m.data()[`${side}OrgName`])
      if (stored !== full) { if (stored && stored !== short) skippedEdited++; continue }
      console.log(`MATCH  ${m.id} ${side}OrgName "${stored}" → "${short}"`)
      orgStamps++
      if (APPLY) await m.ref.update({ [`${side}OrgName`]: short })
    }
  }
}

// ── 3. Competition membership displaySnapshots ───────────────────────────────
const memberDocs = (await db.collectionGroup('teams').get()).docs
  .filter(d => d.ref.path.startsWith('competitions/'))
for (const d of memberDocs) {
  const data = d.data()
  const snapName = clean(data.displaySnapshot?.teamName)
  const teamId = data.teamId ?? d.id
  const t = teams.get(teamId)
  if (!t || !snapName) continue                       // name-only entrant — leave
  const org = orgs.get(t.organizationId) ?? {}
  const fresh = newName(t, org)
  const patch = {}
  if (fresh && snapName !== fresh) {
    if (oldCandidates(t, org).has(snapName)) patch['displaySnapshot.teamName'] = fresh
    else skippedEdited++
  }
  const snapOrg = clean(data.displaySnapshot?.orgName)
  const short = clean(org.matchName)
  if (short && snapOrg && snapOrg === clean(org.name) && snapOrg !== short) {
    patch['displaySnapshot.orgName'] = short
  }
  if (Object.keys(patch).length === 0) continue
  console.log(`SNAP   ${d.ref.path} ${JSON.stringify(patch)}`)
  snapStamps++
  if (APPLY) await d.ref.update(patch)
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${matchStamps} match team names, ${orgStamps} match org names, ${snapStamps} snapshots re-stamped; ${skippedEdited} stored names left alone (organiser-edited).`)
if (!APPLY) console.log('Nothing was written. Re-run with APPLY=1 to apply.')
