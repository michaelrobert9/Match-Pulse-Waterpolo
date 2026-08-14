// One-off: re-derive team URL slugs from the STRUCTURED naming fields, so a
// team's URL follows the same rules as its display name.
//
// WHY: a team's slug was frozen at creation from free text (season, or the
// cached displayName, or the org slug). After the structured-naming change the
// display name is (org matchName/name) – (level + gender/division), but the
// slug can lag (e.g. a competition team got "{org}-{season}"). This rebuilds
// the slug as {orgSlug}-{team segment}, where the team segment is the team's
// own identity — its optional per-team name plus the level + gender/division
// label (the display name minus the org, which the URL already carries).
//
// SAFE FOR EXISTING LINKS: the old slug is appended to a `previousSlugs` array
// on the team doc, and the app resolvers (fetchTeamBySlug / fetchTeamByOrgPath)
// fall back to previousSlugs — so old bookmarks / shared links keep working.
// Denormalised homeTeamSlug / awayTeamSlug copies on match docs are updated too.
//
// USAGE (same convention as the other admin scripts):
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/backfill-team-slugs.mjs            # dry run
//   APPLY=1 FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/backfill-team-slugs.mjs            # write
//
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.env.APPLY === '1'
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
const app = initializeApp({ credential: cert(serviceAccount) })
const db  = getFirestore(app, 'waterpolo')

// ── Mirrors of src/lib/teamNaming.js + slugify.js (scripts can't import Vite) ──
const GENDER_LABEL = { boys: 'Boys', girls: 'Girls', men: 'Men', women: 'Women', mixed: 'Mixed' }
const DIVISION_GENDER_WORD = {
  men: 'Men', ladies: 'Women', juniorBoys: 'Boys', juniorGirls: 'Girls',
  masters: 'Masters', open: 'Open', mixed: 'Mixed',
}
const CLUB_DIVISION_VALUES = new Set(['men', 'ladies', 'masters', 'open', 'juniorBoys', 'juniorGirls', 'mixed'])

function slugify(str) {
  return String(str ?? '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function levelLabel({ ageGroup, teamLevel } = {}) {
  if (ageGroup) return `${ageGroup}${(teamLevel ?? '').trim()}`.trim()
  return (teamLevel ?? '').trim()
}
function teamDivision({ division, gender } = {}) {
  if (division) return division
  if (gender && CLUB_DIVISION_VALUES.has(gender)) return gender
  return null
}
function generatedTeamName(fields = {}) {
  const { gender, orgGenderProfile } = fields
  const division = teamDivision(fields)
  const level = levelLabel(fields)
  if (division) return `${level} ${DIVISION_GENDER_WORD[division] ?? division}`.replace(/\s+/g, ' ').trim()
  if (orgGenderProfile === 'boys' || orgGenderProfile === 'girls') return level
  return `${level} ${GENDER_LABEL[gender] ?? ''}`.replace(/\s+/g, ' ').trim()
}

// ── Load orgs + teams ─────────────────────────────────────────────────────────
const orgs = new Map()
for (const d of (await db.collection('organizations').get()).docs) orgs.set(d.id, d.data())
const teamDocs = (await db.collection('teams').get()).docs

// Reserve every current slug so we never collide with a team that isn't moving.
const reserved = new Set(teamDocs.map(d => d.data().slug).filter(Boolean))

let changed = 0, unchanged = 0, matchStamps = 0

for (const d of teamDocs) {
  const t = d.data()
  const org = orgs.get(t.organizationId) ?? {}
  const orgSlug = org.slug || slugify(org.name)
  const fields = {
    gender: t.gender ?? null, division: t.division ?? null,
    ageGroup: t.ageGroup ?? null, teamLevel: t.teamLevel ?? null,
    orgGenderProfile: org.genderProfile ?? null,
  }
  const segment = [t.teamName, generatedTeamName(fields)]
    .map(s => (s ?? '').trim()).filter(Boolean).join(' ')
    || t.displayName || t.competitionSeason || orgSlug
  let base = `${slugify(orgSlug)}-${slugify(segment)}`

  if (base === t.slug) { unchanged++; continue }

  // Dedupe against every reserved slug except this team's own current one.
  reserved.delete(t.slug)
  let candidate = base, n = 2
  while (reserved.has(candidate)) candidate = `${base}-${n++}`
  reserved.add(candidate)

  console.log(`TEAM  ${d.id}  "${t.displayName ?? ''}"  ${t.slug ?? '(none)'} → ${candidate}`)
  changed++

  if (APPLY) {
    await d.ref.update({
      slug: candidate,
      ...(t.slug ? { previousSlugs: FieldValue.arrayUnion(t.slug) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  // Propagate to denormalised match slug copies (both sides).
  for (const side of ['home', 'away']) {
    const snap = await db.collection('matches').where(`${side}TeamId`, '==', d.id).get()
    for (const m of snap.docs) {
      if (m.data()[`${side}TeamSlug`] === candidate) continue
      matchStamps++
      if (APPLY) await m.ref.update({ [`${side}TeamSlug`]: candidate })
    }
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${changed} team slugs re-derived (${unchanged} already correct); ${matchStamps} denormalised match slug copies updated.`)
if (!APPLY) console.log('Nothing was written. Re-run with APPLY=1 to apply.')
