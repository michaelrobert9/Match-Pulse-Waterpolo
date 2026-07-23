#!/usr/bin/env node
//
// Phase 1B — backfill organisation slugs.
//
// Adds a frozen, globally-unique `slug` to any organisation document that does
// not already have one. Slugs are derived from the org name; collisions get a
// numeric suffix (-2, -3, …). Existing slugs are never changed.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//   node scripts/backfill-org-slugs.mjs
//
// Dry run (reports, writes nothing):
//   DRY_RUN=1 FIREBASE_SERVICE_ACCOUNT=... node scripts/backfill-org-slugs.mjs
//
// Idempotent — safe to re-run. The app also resolves legacy slug-less orgs by a
// name-derived slug at read time, so running this is optional cleanup.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })

const db      = getFirestore()
const DRY_RUN = !!process.env.DRY_RUN

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function run() {
  console.log(DRY_RUN ? '=== DRY RUN — no writes ===' : '=== LIVE backfill ===')
  const snap = await db.collection('organizations').get()

  // Seed the taken-set with slugs that already exist so we stay globally unique.
  const taken = new Set(snap.docs.map(d => d.data().slug).filter(Boolean))

  let changed = 0
  let batch = db.batch()
  let pending = 0

  for (const doc of snap.docs) {
    if (doc.data().slug) continue
    const base = slugify(doc.data().name) || 'org'
    let slug = base
    let n = 2
    while (taken.has(slug)) slug = `${base}-${n++}`
    taken.add(slug)
    console.log(`  organizations/${doc.id}: slug -> ${slug}  (${doc.data().name})`)
    if (!DRY_RUN) {
      batch.update(doc.ref, { slug })
      if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0 }
    }
    changed++
  }

  if (!DRY_RUN && pending > 0) await batch.commit()
  console.log(`\n${changed} organisation(s) ${DRY_RUN ? 'would be' : ''} backfilled.`)
  process.exit(0)
}
run().catch(err => { console.error(err); process.exit(1) })
