#!/usr/bin/env node
//
// Match URL backfill — move standalone matches onto the dated URL model and
// stamp a resolved `path` on every match, seeding redirects so links shared
// under the old season-namespaced scheme keep resolving.
//
// The new URL model (see src/lib/matchPaths.js):
//   • standalone   /match/{YYYY-MM-DD}/{matchSlug}     (dated; matchDate required)
//   • competition  /competitions/{season}/{slug}/match/{matchSlug}   (dateless)
// Every match stores its resolved `path`; matchUrl reads it first.
//
// For each match this script:
//   • competition match — ensures competitionSlug/competitionSeason are present
//     (derived from the competition doc when missing) and sets
//     path = /competitions/{season}/{slug}/match/{matchSlug}. Seeds a redirect
//     from the old plural ".../matches/{matchSlug}" form.
//   • standalone match — sets matchDate = existing ?? date-of(scheduledAt) in
//     SAST, and path = /match/{matchDate}/{matchSlug}. Seeds redirects from the
//     old "/matches/{season}/{matchSlug}", "/matches/{matchSlug}" and
//     "/match/{slug}" forms. A standalone match with no date to derive (no
//     scheduledAt) is reported as manual — it cannot get a dated URL.
//   • group child (matchGroupId) — already created with a path; skipped.
//
// Authentication is Google Application Default Credentials (ADC) — run it from
// Cloud Shell, no service-account key. The sport's named Firestore database is
// selected automatically (this repo's default below); teams/matches live there.
// Run once PER REPO. Override with GCLOUD_PROJECT / FIRESTORE_DB if needed.
//
//   node scripts/backfill-match-paths.mjs            # dry run, no writes
//   APPLY=1 node scripts/backfill-match-paths.mjs    # live
//
// Idempotent — a match already carrying the correct path is left untouched.

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore }                      from 'firebase-admin/firestore'
import { writeFileSync }                     from 'fs'

const PROJECT = process.env.GCLOUD_PROJECT || 'match-pulse-4560e'
const DB_ID   = process.env.FIRESTORE_DB    || 'waterpolo'   // this repo's named database
const APPLY   = !!process.env.APPLY

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT })
const db  = getFirestore(app, DB_ID)

// ── Path builders (mirror src/lib/matchPaths.js) ──────────────────────────────
function matchPath(date, slug, child = null) {
  return child ? `/match/${date}/${slug}/${child}` : `/match/${date}/${slug}`
}
function competitionMatchPath(season, competitionSlug, matchSlug) {
  return `/competitions/${season}/${competitionSlug}/match/${matchSlug}`
}
// SAST (UTC+2, no DST) calendar day for a Firestore Timestamp / Date / ISO string.
function toMatchDate(value) {
  if (!value) return null
  const d = value?.toDate ? value.toDate() : (value instanceof Date ? value : new Date(value))
  if (isNaN(d?.getTime?.())) return null
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
const redirectKey = path => String(path ?? '').replace(/^\/+/, '').replace(/\//g, '~') || 'root'

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`project=${PROJECT} database=${DB_ID}`)
  console.log(APPLY ? '=== LIVE backfill — writes enabled ===' : '=== DRY RUN — no writes ===')

  const [matchSnap, compSnap] = await Promise.all([
    db.collection('matches').get(),
    db.collection('competitions').get(),
  ])
  const comps = new Map(compSnap.docs.map(d => [d.id, d.data()]))
  console.log(`Loaded ${matchSnap.size} match(es), ${compSnap.size} competition(s).`)

  const updates   = []   // { id, path, matchDate?, competitionSlug?, competitionSeason?, redirects: [] }
  const skipped   = []   // already correct or a group child
  const manual    = []   // standalone with no derivable date
  let redirectCount = 0

  for (const d of matchSnap.docs) {
    const m = { id: d.id, ...d.data() }
    if (m.matchGroupId) { skipped.push({ id: m.id, reason: 'group-child' }); continue }
    if (!m.matchSlug)   { manual.push({ id: m.id, reason: 'no-matchSlug', name: m.homeTeamName }); continue }

    const redirects = []
    let patch = {}

    if (m.competitionId) {
      const comp = comps.get(m.competitionId) ?? {}
      const slug   = m.competitionSlug   ?? comp.slug   ?? null
      const season = m.competitionSeason ?? m.season ?? comp.season ?? null
      if (!slug || !season) { manual.push({ id: m.id, reason: 'competition-missing-slug-or-season', name: m.homeTeamName }); continue }
      const path = competitionMatchPath(season, slug, m.matchSlug)
      if (m.competitionSlug !== slug)     patch.competitionSlug   = slug
      if (m.competitionSeason !== season) patch.competitionSeason = season
      if (m.path !== path) {
        patch.path = path
        // Old plural competition form → new singular.
        redirects.push({ from: `/competitions/${season}/${slug}/matches/${m.matchSlug}`, to: path })
      }
    } else {
      const date = m.matchDate ?? toMatchDate(m.scheduledAt)
      if (!date) { manual.push({ id: m.id, reason: 'standalone-no-date', name: m.homeTeamName }); continue }
      const path = matchPath(date, m.matchSlug)
      if (m.matchDate !== date) patch.matchDate = date
      if (m.path !== path) {
        patch.path = path
        // Old season-namespaced + unseasoned + single-segment forms.
        if (m.season) redirects.push({ from: `/matches/${m.season}/${m.matchSlug}`, to: path })
        redirects.push({ from: `/matches/${m.matchSlug}`, to: path })
        if (m.slug) redirects.push({ from: `/match/${m.slug}`, to: path })
      }
    }

    if (!Object.keys(patch).length) { skipped.push({ id: m.id, reason: 'already-correct' }); continue }
    redirectCount += redirects.length
    updates.push({ id: m.id, patch, redirects, ownerOrgId: m.homeOrgId ?? null })
  }

  console.log('\n─────────────────────────────────────')
  console.log(`  Total matches      : ${matchSnap.size}`)
  console.log(`  To update          : ${updates.length}`)
  console.log(`  Redirects to seed  : ${redirectCount}`)
  console.log(`  Skipped            : ${skipped.length}`)
  console.log(`  Manual review      : ${manual.length}`)
  console.log('─────────────────────────────────────')
  if (manual.length) {
    console.log('\nMatches needing manual attention:')
    for (const t of manual) console.log(`  [${t.reason}]  ${t.id}  "${t.name ?? ''}"`)
  }

  const reportFile = `match-path-backfill-report-${DB_ID}.json`
  writeFileSync(reportFile, JSON.stringify({
    generatedAt: new Date().toISOString(), project: PROJECT, database: DB_ID,
    mode: APPLY ? 'live' : 'dry-run',
    totals: { matches: matchSnap.size, toUpdate: updates.length, redirects: redirectCount, skipped: skipped.length, manual: manual.length },
    updates, manual,
  }, null, 2))
  console.log(`\nReport written → ${reportFile}`)

  if (!APPLY) { console.log('\nDry run complete — no writes.'); process.exit(0) }

  let batch = db.batch(), pending = 0
  const flush = async () => { if (pending) { await batch.commit(); batch = db.batch(); pending = 0 } }
  for (const u of updates) {
    batch.update(db.collection('matches').doc(u.id), u.patch)
    if (++pending >= 400) await flush()
    for (const r of u.redirects) {
      if (r.from === r.to) continue
      batch.set(db.collection('redirects').doc(redirectKey(r.from)), {
        fromPath: r.from, toPath: r.to, ownerOrgId: u.ownerOrgId ?? null,
        createdBy: 'backfill', createdAt: new Date().toISOString(),
      })
      if (++pending >= 400) await flush()
    }
  }
  await flush()
  console.log(`\nDone. ${updates.length} match(es) updated, ${redirectCount} redirect(s) seeded.`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
