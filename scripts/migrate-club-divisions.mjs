// One-off: split legacy club/association DIVISIONS into level + GENDER.
//
// WHY: gender is now a separate stored field on every team, for every
// organisation type, so the co-ed display rule can decide whether to show it.
// Clubs and associations previously encoded gender inside a division value
// ("men", "ladies", "juniorBoys", "juniorGirls"). This script maps those onto
// the shared gender vocabulary and clears the division, then re-derives the
// cached displayName/searchName in the current display format (gender last).
//
//   men → men · ladies → women · juniorBoys → boys · juniorGirls → girls
//   mixed → mixed
//
// masters/open have NO gender equivalent and are deliberately NOT migrated —
// they are listed in the report for a human decision. They keep rendering
// correctly via the legacy division path in teamNaming.js either way.
//
// School teams are untouched (their gender field is already correct); their
// cached displayName is still re-derived so stored caches match the new
// gender-last format.
//
// AUTH: same convention as the other admin scripts — a service-account JSON in
// the FIREBASE_SERVICE_ACCOUNT env var. Targets the `waterpolo` named database.
//
// USAGE:
//   # 1. DRY RUN (default — writes nothing, prints every planned change):
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/migrate-club-divisions.mjs
//
//   # 2. APPLY (only after reading the dry run):
//   APPLY=1 FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/migrate-club-divisions.mjs

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.env.APPLY === '1'
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
const app = initializeApp({ credential: cert(serviceAccount) })
const db  = getFirestore(app, 'waterpolo')

// ── Mirrors of src/lib/teamNaming.js (kept in step by hand — scripts cannot
//    import Vite-resolved modules). If teamNaming changes, update these. ──────
const DIVISION_TO_GENDER = {
  men: 'men', ladies: 'women', juniorBoys: 'boys', juniorGirls: 'girls', mixed: 'mixed',
}
const GENDER_LABEL = { boys: 'Boys', girls: 'Girls', men: 'Men', women: 'Women', mixed: 'Mixed' }
const DIVISION_GENDER_WORD = {
  men: 'Men', ladies: 'Women', juniorBoys: 'Boys', juniorGirls: 'Girls',
  masters: 'Masters', open: 'Open', mixed: 'Mixed',
}
const CLUB_DIVISION_VALUES = new Set(['men', 'ladies', 'masters', 'open', 'juniorBoys', 'juniorGirls', 'mixed'])

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

// ── Run ───────────────────────────────────────────────────────────────────────
const orgs = new Map()
for (const d of (await db.collection('organizations').get()).docs) orgs.set(d.id, d.data())

const teams = await db.collection('teams').get()
let migrated = 0, renamedOnly = 0, needsDecision = 0, untouched = 0

for (const doc of teams.docs) {
  const t = doc.data()
  const org = orgs.get(t.organizationId) ?? {}
  const division = teamDivision(t)
  const patch = {}

  if (division && DIVISION_TO_GENDER[division]) {
    // Gendered division → shared gender field; clear the division.
    patch.gender   = DIVISION_TO_GENDER[division]
    patch.division = FieldValue.delete()
  } else if (division) {
    // masters / open — no gender equivalent. Human decision required.
    needsDecision++
    console.log(`NEEDS DECISION  teams/${doc.id}  "${t.displayName ?? ''}"  division=${division} (org: ${org.name ?? t.organizationId})`)
    continue
  }

  // Re-derive the cached display name in the current (gender-last) format.
  const fields = {
    gender:   patch.gender ?? t.gender ?? null,
    division: null,
    ageGroup: t.ageGroup ?? null,
    teamLevel: t.teamLevel ?? null,
    orgGenderProfile: org.genderProfile ?? null,
  }
  const name = generatedTeamName(fields)
  if (name && name !== t.displayName) {
    patch.displayName = name
    patch.searchName  = name.toLowerCase()
  }

  if (Object.keys(patch).length === 0) { untouched++; continue }
  const kind = patch.gender ? 'SPLIT ' : 'RENAME'
  console.log(`${kind}  teams/${doc.id}  "${t.displayName ?? ''}" → gender=${fields.gender ?? '-'} name="${name}"`)
  patch.gender ? migrated++ : renamedOnly++
  if (APPLY) await doc.ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() })
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${migrated} divisions split, ${renamedOnly} display names re-derived, ${needsDecision} need a decision (masters/open), ${untouched} untouched of ${teams.size} teams.`)
if (!APPLY) console.log('Nothing was written. Re-run with APPLY=1 to apply.')
