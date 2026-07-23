#!/usr/bin/env node
//
// structuralKey backfill — audit and optional live migration.
//
// Computes the canonical `structuralKey` for every team document that lacks
// one, classifies each as `convertible` (safe to write) or `manual` (needs
// human review), detects duplicate (organizationId, structuralKey) groups, and
// writes a JSON report. Live writes only happen when APPLY=1 is set.
//
// Usage:
//   # Dry run (default — no writes):
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/backfill-team-structural-keys.mjs
//
//   # Live migration:
//   APPLY=1 FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//     node scripts/backfill-team-structural-keys.mjs
//
// Idempotent — teams that already have a structuralKey are skipped.
//
// The key function is replicated inline (not imported via Vite) so the script
// runs in plain Node.js. The logic is kept byte-for-byte identical to
// src/lib/teamNaming.js#teamStructuralKey.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore }        from 'firebase-admin/firestore'
import { writeFileSync }       from 'fs'

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })
const db    = getFirestore()
const APPLY = !!process.env.APPLY

// ── Key utilities (mirrors src/lib/teamNaming.js) ─────────────────────────────

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const CLUB_DIVISIONS = new Set([
  'men', 'ladies', 'mixed', 'masters', 'juniorBoys', 'juniorGirls',
])

function normalizeAgeGroup(input) {
  if (input == null || input === '') return ''
  const s = String(input).toLowerCase().replace(/\s+/g, '').replace(/^under/, 'u')
  const m = s.match(/u?(\d{1,2})/)
  return m ? `U${m[1]}` : String(input).trim().toUpperCase()
}

function normalizeTeamLevel(input) {
  if (input == null || input === '') return ''
  const s = String(input).trim().replace(/\s+/g, ' ')
  return /^[a-z]$/i.test(s) ? s.toUpperCase() : s
}

function splitLegacyLabel(teamLabel) {
  const s = String(teamLabel ?? '').trim()
  const m = s.match(/^u?\s*(\d{1,2})\s*([a-z])?$/i)
  if (m) return { age: `U${m[1]}`, level: (m[2] ?? '').toUpperCase() }
  return { age: '', level: '', raw: s }
}

function teamStructuralKey({ gender, ageGroup, teamLevel, teamLabel, division, custom } = {}) {
  const clubDivision = division ?? (CLUB_DIVISIONS.has(gender) ? gender : null)
  if (clubDivision) {
    const level = (teamLabel ?? teamLevel ?? '').trim()
    return slugify(`${clubDivision}-${level}`)
  }
  if (custom) return slugify(custom)
  let age   = normalizeAgeGroup(ageGroup)
  let level = normalizeTeamLevel(teamLevel)
  if (!age && !level && teamLabel) {
    const sp = splitLegacyLabel(teamLabel)
    if (sp.age) { age = sp.age; level = sp.level }
    else if (sp.raw) return slugify([gender, sp.raw].filter(Boolean).join('-'))
  }
  return slugify([gender, age, level].filter(Boolean).join('-'))
}

// ── Classification ────────────────────────────────────────────────────────────
// Returns { category: 'convertible'|'manual', reason?, key? }

function classify(team) {
  const { gender, ageGroup, teamLevel, teamLabel, division, custom } = team

  if (custom) {
    return { category: 'convertible', key: teamStructuralKey(team) }
  }

  const clubDivision = division ?? (CLUB_DIVISIONS.has(gender) ? gender : null)
  if (clubDivision) {
    if (!teamLabel && !teamLevel) return { category: 'manual', reason: 'club-missing-team-label' }
    return { category: 'convertible', key: teamStructuralKey(team) }
  }

  // School path
  if (ageGroup || teamLevel) {
    return { category: 'convertible', key: teamStructuralKey(team) }
  }

  if (teamLabel) {
    const sp = splitLegacyLabel(teamLabel)
    if (sp.age) return { category: 'convertible', key: teamStructuralKey(team) }
    if (sp.raw) {
      // Has a label but not a clean age/level pattern — produce a key but flag for review.
      return { category: 'manual', reason: 'unparseable-legacy-label', key: teamStructuralKey(team) }
    }
  }

  if (gender === 'boys' || gender === 'girls') {
    return { category: 'manual', reason: 'gender-only' }
  }

  return { category: 'manual', reason: 'no-structured-signal' }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(APPLY ? '=== LIVE migration — writes enabled ===' : '=== DRY RUN — no writes ===')

  const snap = await db.collection('teams').get()
  console.log(`Loaded ${snap.size} team document(s).`)

  const convertible  = []
  const manual       = []
  const alreadyKeyed = []
  const duplicates   = []
  const keyIndex     = {}   // "orgId::key" → [teamId, ...]

  for (const d of snap.docs) {
    const team = { id: d.id, ...d.data() }

    if (team.structuralKey) {
      alreadyKeyed.push(team.id)
      // Register so we can detect existing duplicates too.
      const ik = `${team.organizationId}::${team.structuralKey}`
      ;(keyIndex[ik] = keyIndex[ik] ?? []).push(team.id)
      continue
    }

    const { category, reason, key } = classify(team)
    const entry = {
      id:          team.id,
      orgId:       team.organizationId ?? null,
      displayName: team.displayName    ?? null,
      gender:      team.gender         ?? null,
      ageGroup:    team.ageGroup       ?? null,
      teamLevel:   team.teamLevel      ?? null,
      teamLabel:   team.teamLabel      ?? null,
      division:    team.division       ?? null,
      key:         key ?? null,
      reason:      reason ?? null,
    }

    if (category === 'convertible' && key) {
      const ik = `${team.organizationId}::${key}`
      ;(keyIndex[ik] = keyIndex[ik] ?? []).push(team.id)
      convertible.push(entry)
    } else {
      manual.push(entry)
    }
  }

  // Detect duplicate groups.
  for (const [ik, ids] of Object.entries(keyIndex)) {
    if (ids.length > 1) duplicates.push({ orgKey: ik, teamIds: ids })
  }

  // ── Console summary ──
  console.log('\n─────────────────────────────────────')
  console.log(`  Total checked     : ${snap.size}`)
  console.log(`  Already keyed     : ${alreadyKeyed.length}`)
  console.log(`  Convertible       : ${convertible.length}`)
  console.log(`  Manual review     : ${manual.length}`)
  console.log(`  Duplicate groups  : ${duplicates.length}`)
  console.log('─────────────────────────────────────')

  if (manual.length) {
    console.log('\nTeams requiring manual review:')
    for (const t of manual) {
      console.log(`  [${t.reason}]  ${t.id}  "${t.displayName}"  (org: ${t.orgId})`)
    }
  }

  if (duplicates.length) {
    console.log('\nDuplicate (org, structuralKey) groups found:')
    for (const g of duplicates) {
      console.log(`  ${g.orgKey}  →  ${g.teamIds.join(', ')}`)
    }
  }

  // ── Write JSON report ──
  const report = {
    generatedAt: new Date().toISOString(),
    mode:        APPLY ? 'live' : 'dry-run',
    totals: {
      checked:         snap.size,
      alreadyKeyed:    alreadyKeyed.length,
      convertible:     convertible.length,
      manual:          manual.length,
      duplicateGroups: duplicates.length,
    },
    convertible,
    manual,
    duplicates,
  }
  writeFileSync('team-structural-key-report.json', JSON.stringify(report, null, 2))
  console.log('\nReport written → team-structural-key-report.json')

  // ── Live writes ──
  if (APPLY && convertible.length > 0) {
    console.log(`\nWriting structuralKey to ${convertible.length} team(s)…`)
    let batch   = db.batch()
    let pending = 0
    let written = 0
    for (const entry of convertible) {
      batch.update(db.collection('teams').doc(entry.id), { structuralKey: entry.key })
      if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0 }
      written++
    }
    if (pending > 0) await batch.commit()
    console.log(`Done. ${written} team(s) updated.`)
  } else if (APPLY) {
    console.log('Nothing to write.')
  }

  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
