#!/usr/bin/env node
//
// Backfill competition fixture-membership records.
//
// Finds matches that carry a competitionId but have NO corresponding join
// record at competitions/{competitionId}/fixtures/{matchId} — the artefact of
// legacy creation paths that wrote only match.competitionId. Reports each one
// with the competition name, match id, teams, and the membership document that
// would be created.
//
// Dry run by default — reports, writes nothing:
//   FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
//   node scripts/backfill-fixture-memberships.mjs
//
// Live run (writes the proposed membership docs):
//   APPLY=1 FIREBASE_SERVICE_ACCOUNT=... node scripts/backfill-fixture-memberships.mjs
//
// Membership docs are created with countsTowardStandings: false — a backfilled
// fixture must be explicitly reviewed by the competition admin before it can
// affect standings. Idempotent: existing join records are never touched.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })

const db    = getFirestore()
const APPLY = process.env.APPLY === '1'

async function run() {
  console.log(APPLY ? '=== LIVE backfill — writing membership docs ===' : '=== DRY RUN — no writes (set APPLY=1 to write) ===')

  const matchSnap = await db.collection('matches').get()
  const withComp = matchSnap.docs.filter(d => d.data().competitionId)
  console.log(`Matches scanned: ${matchSnap.size}; with competitionId: ${withComp.length}`)

  // Cache competitions + their existing fixture-membership ids.
  const compCache = {}
  async function compInfo(competitionId) {
    if (compCache[competitionId]) return compCache[competitionId]
    const [compDoc, fixturesSnap] = await Promise.all([
      db.collection('competitions').doc(competitionId).get(),
      db.collection('competitions').doc(competitionId).collection('fixtures').get(),
    ])
    const info = {
      exists: compDoc.exists,
      name: compDoc.exists ? (compDoc.data().name ?? competitionId) : null,
      fixtureIds: new Set(fixturesSnap.docs.map(d => d.id)),
    }
    compCache[competitionId] = info
    return info
  }

  const missing = []
  const orphaned = []   // competitionId points to a competition that does not exist

  for (const doc of withComp) {
    const m = doc.data()
    const info = await compInfo(m.competitionId)
    if (!info.exists) {
      orphaned.push({ matchId: doc.id, competitionId: m.competitionId, home: m.homeTeamName, away: m.awayTeamName })
      continue
    }
    if (info.fixtureIds.has(doc.id)) continue
    missing.push({
      matchId: doc.id,
      competitionId: m.competitionId,
      competitionName: info.name,
      home: m.homeTeamName ?? m.homeTeamId ?? '?',
      away: m.awayTeamName ?? m.awayTeamId ?? '?',
      proposed: {
        matchId: doc.id,
        phase: null, poolId: null, roundLabel: null,
        crossPool: false,
        // Backfilled fixtures NEVER silently count toward standings — an
        // admin must review and enable each one.
        countsTowardStandings: false,
        homeTeamId: m.homeTeamId ?? null,
        awayTeamId: m.awayTeamId ?? null,
        addedBy: 'backfill-script',
        backfilled: true,
      },
    })
  }

  console.log(`\nMatches missing a membership record: ${missing.length}`)
  for (const x of missing) {
    console.log(`\n  Competition: ${x.competitionName} (${x.competitionId})`)
    console.log(`  Match:       ${x.matchId}`)
    console.log(`  Teams:       ${x.home} v ${x.away}`)
    console.log(`  Proposed:    competitions/${x.competitionId}/fixtures/${x.matchId}`)
    console.log(`               ${JSON.stringify(x.proposed)}`)
  }

  if (orphaned.length) {
    console.log(`\nOrphaned (competitionId points to a missing competition) — NOT touched: ${orphaned.length}`)
    for (const o of orphaned) {
      console.log(`  ${o.matchId}: ${o.home} v ${o.away} → competition ${o.competitionId} not found`)
    }
  }

  if (!APPLY) {
    console.log(`\nDry run complete. ${missing.length} membership doc(s) would be created.`)
    return
  }

  let written = 0
  for (const x of missing) {
    await db.collection('competitions').doc(x.competitionId)
      .collection('fixtures').doc(x.matchId)
      .set({ ...x.proposed, addedAt: FieldValue.serverTimestamp() })
    written++
  }
  console.log(`\nLive backfill complete. ${written} membership doc(s) created.`)
}

run().catch(err => { console.error(err); process.exit(1) })
