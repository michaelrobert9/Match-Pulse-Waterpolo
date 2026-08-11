#!/usr/bin/env node
//
// Team governance migration — audit and optional live migration to the
// STRUCTURED naming standard.
//
// The standard (see src/lib/teamNaming.js):
//   • Level is either a senior ordinal (1st Team … 10th Team) OR an age group
//     (U8…U19, plus U21 for clubs/associations) + a letter (A…J).
//   • Schools carry a gender (boys/girls); clubs/associations carry a division.
//   • No free-text team names.
//
// For every team it derives the discrete fields { gender | division, ageGroup,
// teamLevel } from whatever the team currently stores, and classifies each as:
//   • convertible — maps cleanly onto the standard (safe to write), or
//   • manual      — cannot be mapped without a human decision (Masters/Open/
//                   custom sides, bare age groups with no letter, unparseable
//                   labels, co-ed teams with no stored gender, …).
//
// Authentication — Google Application Default Credentials (ADC). Run it from
// Cloud Shell (or anywhere `gcloud auth application-default login` has run); no
// service-account key file is needed.
//
// Teams AND organizations live together in this sport's NAMED Firestore
// database (users/profiles live in (default); this script never touches those).
// The database is selected automatically per repo via DB_ID below — waterpolo
// here — so there is nothing to point by hand. Run it once PER REPO to cover
// all four `teams` collections. Override with FIRESTORE_DB=<name> if ever needed.
//
// Dry run (default — NO writes) prints the counts and the full manual list, and
// writes team-governance-report-<db>.json:
//
//   node scripts/migrate-team-governance.mjs
//
// Live migration — writes structured fields to convertible teams and flags the
// manual ones with needsGovernanceReview:true (which the in-app resolution
// screen queries). Nothing is dropped and nothing is guessed:
//
//   APPLY=1 node scripts/migrate-team-governance.mjs
//
// Idempotent — a convertible team already carrying governanceMigrated:true is
// skipped; a manual team already flagged is left flagged.

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore }                      from 'firebase-admin/firestore'
import { writeFileSync }                     from 'fs'

const PROJECT = process.env.GCLOUD_PROJECT || 'match-pulse-4560e'
const DB_ID   = process.env.FIRESTORE_DB    || 'waterpolo'   // this repo's named database
const APPLY   = !!process.env.APPLY

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT })
const db  = getFirestore(app, DB_ID)

// ── Standard vocabulary (mirrors src/lib/teamNaming.js) ───────────────────────
const TEAM_LEVELS = ['1st Team','2nd Team','3rd Team','4th Team','5th Team','6th Team','7th Team','8th Team','9th Team','10th Team']
const LETTERS     = new Set(['A','B','C','D','E','F','G','H','I','J'])
const AGE_MIN = 8, AGE_MAX_SCHOOL = 19, AGE_MAX_CLUB = 21
const CLUB_DIVISION_VALUES = new Set(['men','ladies','masters','open','juniorBoys','juniorGirls','mixed'])

function slugify(str) {
  return String(str).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function levelLabel({ ageGroup, teamLevel }) {
  if (ageGroup) return `${ageGroup}${(teamLevel ?? '').trim()}`.trim()
  return (teamLevel ?? '').trim()
}
function structuralKey({ gender, division, ageGroup, teamLevel }) {
  const axis  = division || gender || ''
  const level = ageGroup ? `${ageGroup}-${(teamLevel ?? '').trim()}` : (teamLevel ?? '').trim()
  return slugify([axis, level].filter(Boolean).join('-'))
}
function displayName({ gender, division, ageGroup, teamLevel, orgGenderProfile }) {
  const level = levelLabel({ ageGroup, teamLevel })
  if (division) {
    const dl = { men:"Men's", ladies:'Ladies', masters:'Masters', open:'Open', juniorBoys:'Boys', juniorGirls:'Girls', mixed:'Mixed' }[division] ?? division
    return `${dl} ${level}`.replace(/\s+/g,' ').trim()
  }
  if (orgGenderProfile === 'boys' || orgGenderProfile === 'girls') return level
  const g = { boys:'Boys', girls:'Girls' }[gender] ?? ''
  return `${g} ${level}`.replace(/\s+/g,' ').trim()
}

// ── Level parsing (legitimate one-time legacy parse) ──────────────────────────
// Returns { ageGroup, teamLevel } or null when it isn't a clean standard level.
function parseLevel(label, maxAge) {
  const s = String(label ?? '').trim()
  if (!s) return null

  // Age + letter: "U16A", "u16 a", "U16-A".
  let m = s.match(/^u\s*-?\s*(\d{1,2})\s*-?\s*([a-z])$/i)
  if (m) {
    const age = parseInt(m[1], 10)
    const letter = m[2].toUpperCase()
    if (age >= AGE_MIN && age <= maxAge && LETTERS.has(letter)) {
      return { ageGroup: `U${age}`, teamLevel: letter }
    }
    return null
  }

  // Senior ordinal: "1st Team", "1st XI", "1st XV", "1st", "First Team".
  const words = { first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10 }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:team|xi|xv|side))?$/i)
  let n = m ? parseInt(m[1], 10) : null
  if (n == null) {
    const w = s.match(/^([a-z]+)(?:\s+(?:team|xi|xv|side))?$/i)
    if (w && words[w[1].toLowerCase()]) n = words[w[1].toLowerCase()]
  }
  if (n != null && n >= 1 && n <= 10) return { ageGroup: null, teamLevel: TEAM_LEVELS[n - 1] }

  return null
}

// ── Classification ────────────────────────────────────────────────────────────
// { category:'convertible'|'manual', reason?, fields? }
function classify(team, org) {
  const orgType = org?.type ?? null
  const profile = org?.genderProfile ?? null

  // Axis: division (club/assoc) or gender (school).
  const rawDivision = team.division ?? (CLUB_DIVISION_VALUES.has(team.gender) ? team.gender : null)
  const isClub = orgType === 'club' || orgType === 'association' || !!rawDivision
  const isSchool = orgType === 'school' || (!isClub && (team.gender === 'boys' || team.gender === 'girls'))

  const maxAge = isClub ? AGE_MAX_CLUB : AGE_MAX_SCHOOL
  // Prefer already-discrete fields; else fall back to the fused teamLabel.
  const source = (team.ageGroup || team.teamLevel)
    ? levelLabel({ ageGroup: team.ageGroup, teamLevel: team.teamLevel })
    : (team.teamLabel ?? '')
  const level = parseLevel(source, maxAge)

  // Free-text custom sides never map automatically.
  if (team.custom) return { category: 'manual', reason: 'custom-side' }
  if (!level) {
    if (source && /^u\s*-?\s*\d{1,2}$/i.test(String(source).trim())) return { category: 'manual', reason: 'age-missing-letter' }
    if (!source) return { category: 'manual', reason: 'no-level' }
    return { category: 'manual', reason: 'unparseable-level' }
  }

  if (isClub) {
    if (!rawDivision) return { category: 'manual', reason: 'club-missing-division' }
    const division = rawDivision === 'mixed' ? 'open' : rawDivision   // fold legacy 'mixed' → Open
    if (rawDivision === 'mixed') return { category: 'manual', reason: 'legacy-mixed-division' }
    const fields = { division, ageGroup: level.ageGroup, teamLevel: level.teamLevel }
    return { category: 'convertible', fields }
  }

  if (isSchool) {
    let gender = team.gender
    if (gender !== 'boys' && gender !== 'girls') {
      if (profile === 'boys' || profile === 'girls') gender = profile
      else return { category: 'manual', reason: profile == null ? 'school-gender-profile-unset' : 'coed-team-missing-gender' }
    }
    const fields = { gender, ageGroup: level.ageGroup, teamLevel: level.teamLevel, orgGenderProfile: profile }
    return { category: 'convertible', fields }
  }

  return { category: 'manual', reason: 'org-type-unknown' }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`project=${PROJECT} database=${DB_ID}`)
  console.log(APPLY ? '=== LIVE migration — writes enabled ===' : '=== DRY RUN — no writes ===')

  const [teamSnap, orgSnap] = await Promise.all([
    db.collection('teams').get(),
    db.collection('organizations').get(),
  ])
  const orgs = new Map(orgSnap.docs.map(d => [d.id, d.data()]))
  console.log(`Loaded ${teamSnap.size} team(s), ${orgSnap.size} organisation(s).`)

  const convertible = []
  const manual      = []
  const skipped     = []
  const byReason    = {}

  for (const d of teamSnap.docs) {
    const team = { id: d.id, ...d.data() }
    if (team.governanceMigrated) { skipped.push(team.id); continue }
    const org = orgs.get(team.organizationId) ?? null
    const res = classify(team, org)
    const row = {
      id: team.id, orgId: team.organizationId ?? null, orgType: org?.type ?? null,
      displayName: team.displayName ?? null,
      was: { gender: team.gender ?? null, division: team.division ?? null, ageGroup: team.ageGroup ?? null, teamLevel: team.teamLevel ?? null, teamLabel: team.teamLabel ?? null },
    }
    if (res.category === 'convertible') {
      const f = res.fields
      convertible.push({ ...row, to: { ...f, teamLabel: levelLabel(f), structuralKey: structuralKey(f), displayName: displayName(f) } })
    } else {
      byReason[res.reason] = (byReason[res.reason] ?? 0) + 1
      manual.push({ ...row, reason: res.reason })
    }
  }

  console.log('\n─────────────────────────────────────')
  console.log(`  Total teams        : ${teamSnap.size}`)
  console.log(`  Already migrated   : ${skipped.length}`)
  console.log(`  Convertible (auto) : ${convertible.length}`)
  console.log(`  Manual (screen)    : ${manual.length}`)
  console.log('─────────────────────────────────────')
  if (manual.length) {
    console.log('\nManual review, by reason:')
    for (const [r, n] of Object.entries(byReason).sort((a,b) => b[1]-a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`)
    console.log('\nTeams needing manual resolution:')
    for (const t of manual) console.log(`  [${t.reason}]  ${t.id}  "${t.displayName}"  (org: ${t.orgId})`)
  }

  const reportFile = `team-governance-report-${DB_ID}.json`
  writeFileSync(reportFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    project: PROJECT, database: DB_ID,
    mode: APPLY ? 'live' : 'dry-run',
    totals: { teams: teamSnap.size, alreadyMigrated: skipped.length, convertible: convertible.length, manual: manual.length },
    byReason, convertible, manual,
  }, null, 2))
  console.log(`\nReport written → ${reportFile}`)

  if (!APPLY) { console.log('\nDry run complete — no writes.'); process.exit(0) }

  // ── Live writes ──
  let batch = db.batch(), pending = 0, wrote = 0
  const flush = async () => { if (pending) { await batch.commit(); batch = db.batch(); pending = 0 } }
  for (const t of convertible) {
    const { orgGenderProfile, ...store } = t.to  // orgGenderProfile is a derivation input, not stored
    batch.update(db.collection('teams').doc(t.id), {
      gender: store.gender ?? null, division: store.division ?? null,
      ageGroup: store.ageGroup ?? null, teamLevel: store.teamLevel ?? null,
      teamLabel: store.teamLabel ?? null, structuralKey: store.structuralKey ?? null,
      displayName: store.displayName, searchName: String(store.displayName).toLowerCase(),
      governanceMigrated: true, needsGovernanceReview: false,
    })
    if (++pending >= 400) await flush()
    wrote++
  }
  for (const t of manual) {
    batch.update(db.collection('teams').doc(t.id), { needsGovernanceReview: true, governanceReviewReason: t.reason })
    if (++pending >= 400) await flush()
  }
  await flush()
  console.log(`\nDone. ${wrote} team(s) converted, ${manual.length} flagged for the resolution screen.`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
