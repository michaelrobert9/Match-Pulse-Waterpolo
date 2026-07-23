#!/usr/bin/env node
//
// Migrate fixture (match) status from the legacy 'upcoming' value to the
// canonical 'scheduled', and seed the `tracked` flag on every match.
//
// Part of the fixture-lifecycle redesign. The app already TOLERATES legacy
// 'upcoming' docs on read (see src/lib/fixtureStatus.js), so this migration is
// not load-bearing for correctness — it is the cleanup that lets the legacy
// alias eventually be removed. Safe to run at any time.
//
//   - status 'upcoming'  → 'scheduled'
//   - tracked missing    → seeded: true for any match that has ever been
//                          started (a 'match_start' control-log entry exists or
//                          startedAt is set), false otherwise. This keeps the
//                          sweep's auto-retire logic correct for in-flight data.
//
// Dry run by default — reports, writes nothing:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//   node scripts/migrate-fixture-status.mjs
//
// Live run:
//   APPLY=1 FIREBASE_SERVICE_ACCOUNT=... node scripts/migrate-fixture-status.mjs
//
// Idempotent: a second run finds nothing to change.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })

const db    = getFirestore()
const APPLY = process.env.APPLY === '1'

function hasBeenStarted(m) {
  if (m.startedAt) return true
  const log = Array.isArray(m.controlLog) ? m.controlLog : []
  return log.some(e => e?.type === 'match_start')
}

async function run() {
  console.log(APPLY ? '=== LIVE migration — writing match docs ===' : '=== DRY RUN — no writes (set APPLY=1 to write) ===')

  const snap = await db.collection('matches').get()
  console.log(`Matches scanned: ${snap.size}`)

  const updates = []
  for (const doc of snap.docs) {
    const m = doc.data()
    const patch = {}

    if (m.status === 'upcoming') patch.status = 'scheduled'
    if (typeof m.tracked !== 'boolean') patch.tracked = hasBeenStarted(m)

    if (Object.keys(patch).length > 0) {
      updates.push({ id: doc.id, home: m.homeTeamName ?? '?', away: m.awayTeamName ?? '?', from: m.status, patch })
    }
  }

  console.log(`\nMatches needing migration: ${updates.length}`)
  for (const u of updates) {
    console.log(`  ${u.id}  (${u.home} v ${u.away})  ${u.from} → ${JSON.stringify(u.patch)}`)
  }

  if (!APPLY) {
    console.log(`\nDry run complete. ${updates.length} match doc(s) would be updated.`)
    return
  }

  let written = 0
  // Chunk into batches of 400 (Firestore limit is 500 writes per batch).
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch()
    for (const u of updates.slice(i, i + 400)) {
      batch.update(db.collection('matches').doc(u.id), {
        ...u.patch,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
    written += Math.min(400, updates.length - i)
  }
  console.log(`\nLive migration complete. ${written} match doc(s) updated.`)
}

run().catch(err => { console.error(err); process.exit(1) })
