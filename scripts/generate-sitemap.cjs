#!/usr/bin/env node
// Build-time sitemap generator. Writes public/sitemap.xml BEFORE `vite build`,
// so Vite copies it into dist/ and Firebase Hosting serves it directly from the
// CDN as an exact-match static file — which Hosting resolves BEFORE any rewrite,
// so the sitemap works with a plain hosting deploy and needs no Cloud Function.
//
// It REUSES functions/sitemap.js#buildSitemap — the single source of the URL
// shapes and the publish gate — so the static file can never drift from what the
// live app (and the fallback sitemap function) would produce. CommonJS (.cjs) so
// it loads regardless of the app's ESM "type": "module".
//
// Requires a service account (FIREBASE_SERVICE_ACCOUNT) to read Firestore. With
// none set it skips quietly (exit 0, no file) — the /sitemap.xml function
// rewrite in firebase.json then serves as the fallback. Any failure is
// non-fatal: a sitemap problem must never fail the deploy.

const { writeFileSync } = require('fs')
const { join } = require('path')

const OUTPUT = join(__dirname, '..', 'public', 'sitemap.xml')
// This repo's named Firestore database (sport data + people live here).
const DB_ID = process.env.FIRESTORE_DB || 'waterpolo'

async function run() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!sa) {
    console.log('generate-sitemap: FIREBASE_SERVICE_ACCOUNT not set — skipping (function rewrite is the fallback).')
    return
  }
  const { initializeApp, cert } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const { buildSitemap } = require('../functions/sitemap')

  const app = initializeApp({ credential: cert(JSON.parse(sa)) })
  const db = getFirestore(app, DB_ID)
  const xml = await buildSitemap(db, console)
  writeFileSync(OUTPUT, xml, 'utf8')
  const count = (xml.match(/<url>/g) || []).length
  console.log(`generate-sitemap: wrote ${count} URLs to ${OUTPUT} (database=${DB_ID})`)
}

run().catch((err) => {
  // Non-fatal: never fail the build over the sitemap.
  console.error('generate-sitemap: failed (non-fatal):', err.message)
  process.exit(0)
})
