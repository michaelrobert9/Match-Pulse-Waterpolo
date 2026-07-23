#!/usr/bin/env node
//
// Phase 1A data migration.
//
// Brings existing production Firestore data in line with the Phase 1A schema:
//   1. Sets platformAdmin:true on the primary administrator user document.
//   2. Renames match / competition statuses and remaps deprecated org & comp types.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//   ADMIN_EMAIL=michael@robertfamily.co.za \
//   node scripts/migrate-phase1a.mjs
//
// Dry run (reports changes, writes nothing):
//   DRY_RUN=1 FIREBASE_SERVICE_ACCOUNT=... ADMIN_EMAIL=... node scripts/migrate-phase1a.mjs
//
// The script is idempotent — safe to re-run.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })

const db      = getFirestore()
const auth    = getAuth()
const DRY_RUN = !!process.env.DRY_RUN
const ADMIN_EMAIL = process.env.ADMIN_EMAIL

// ── Mapping tables ───────────────────────────────────────────────────────────
// Deprecated org types collapse onto the V3.1 school|club model. Both default
// to 'club'; review the per-document log below and adjust any that are schools.
const ORG_TYPE_MAP = { union: 'club', national: 'club' }
// Deprecated competition type. Choose 'tournament' or 'festival'.
const COMP_TYPE_MAP = { interprovincial: 'tournament' }
const MATCH_STATUS_MAP = { scheduled: 'upcoming', completed: 'final' }
const COMP_STATUS_MAP  = { completed: 'final' }

// ── Helpers ──────────────────────────────────────────────────────────────────
async function migrateField(collection, field, map, label) {
  const snap = await db.collection(collection).get()
  let changed = 0
  let batch = db.batch()
  let pending = 0
  for (const doc of snap.docs) {
    const cur = doc.data()[field]
    if (cur != null && map[cur] != null) {
      const next = map[cur]
      console.log(`  ${collection}/${doc.id}: ${field} ${cur} -> ${next}`)
      if (!DRY_RUN) {
        batch.update(doc.ref, { [field]: next })
        if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0 }
      }
      changed++
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit()
  console.log(`${label}: ${changed} document(s) ${DRY_RUN ? 'would change' : 'updated'}`)
  return changed
}

async function setPlatformAdmin() {
  if (!ADMIN_EMAIL) { console.log('ADMIN_EMAIL not set — skipping platformAdmin step'); return }
  const userRecord = await auth.getUserByEmail(ADMIN_EMAIL)
  const ref  = db.collection('users').doc(userRecord.uid)
  const snap = await ref.get()
  if (snap.exists && snap.data().platformAdmin === true) {
    console.log(`platformAdmin already true for ${ADMIN_EMAIL} (${userRecord.uid})`)
    return
  }
  console.log(`  users/${userRecord.uid}: platformAdmin -> true  (${ADMIN_EMAIL})`)
  if (!DRY_RUN) {
    // merge:true creates the doc if the admin never signed in under the new model.
    await ref.set({ platformAdmin: true, updatedAt: new Date() }, { merge: true })
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(DRY_RUN ? '=== DRY RUN — no writes ===' : '=== LIVE migration ===')

  console.log('\n[1] Primary administrator')
  await setPlatformAdmin()

  console.log('\n[2] Match statuses')
  await migrateField('matches', 'status', MATCH_STATUS_MAP, 'matches.status')

  console.log('\n[3] Competition statuses')
  await migrateField('competitions', 'status', COMP_STATUS_MAP, 'competitions.status')

  console.log('\n[4] Competition types')
  await migrateField('competitions', 'type', COMP_TYPE_MAP, 'competitions.type')

  console.log('\n[5] Organisation types')
  await migrateField('organizations', 'type', ORG_TYPE_MAP, 'organizations.type')

  console.log('\nDone.')
  process.exit(0)
}
run().catch(err => { console.error(err); process.exit(1) })
