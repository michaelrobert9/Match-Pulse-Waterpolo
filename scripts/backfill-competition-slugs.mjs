#!/usr/bin/env node
//
// Backfill competition slugs.
//
// Adds a frozen, globally-unique `slug` to any competition document that does
// not already have one. Slugs are derived from the competition name (which
// typically includes the season, e.g. "U13A Girls Ballito Festival 2026"
// → "u13a-girls-ballito-festival-2026"). Collisions get a -2, -3 … suffix.
// Existing slugs are never changed.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//   node scripts/backfill-competition-slugs.mjs
//
// Dry run (reports what would change, writes nothing):
//   DRY_RUN=1 FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//   node scripts/backfill-competition-slugs.mjs
//
// Idempotent — safe to re-run. Documents that already have a slug are skipped.

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
  const snap = await db.collection('competitions').get()

  // Seed the taken-set with slugs already in use so we stay globally unique.
  const taken = new Set(snap.docs.map(d => d.data().slug).filter(Boolean))

  let changed = 0
  let batch   = db.batch()
  let pending = 0

  for (const doc of snap.docs) {
    if (doc.data().slug) continue

    const name = doc.data().name || ''
    const base = slugify(name) || 'competition'
    let slug   = base
    let n      = 2
    while (taken.has(slug)) slug = `${base}-${n++}`
    taken.add(slug)

    const season = doc.data().season ?? ''
    console.log(`  competitions/${doc.id}: slug -> ${slug}  (${name}${season ? ' · season ' + season : ''})`)

    if (!DRY_RUN) {
      batch.update(doc.ref, { slug })
      if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0 }
    }
    changed++
  }

  if (!DRY_RUN && pending > 0) await batch.commit()
  console.log(`\n${changed} competition(s) ${DRY_RUN ? 'would be' : 'were'} backfilled.`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
