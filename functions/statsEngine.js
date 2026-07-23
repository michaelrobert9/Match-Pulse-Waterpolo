// ── Stats engine: recompute-from-history (single source of truth) ─────────────
//
// One rebuild engine, two callers (functions/index.js):
//   1. recomputeCompetitionStats(competitionId) — scoped, runs on every fixture
//      finalisation (and the manual button). Rebuilds that ONE competition's
//      `players` slices (caps/goals/cards) from its final fixtures. Cheap and
//      immediate so competition views (standings are recompute-on-read; top
//      scorers + caps come from the slices) reflect a published result at once.
//   2. recomputeAllCareerStats() — wholesale, runs once daily at 03:00. Rebuilds
//      EVERY competition's slices from origin, then re-derives every person's
//      cross-competition career totals (careerCaps/careerGoals/careerCards) and
//      competitionIds as the sum / union of their freshly-rebuilt slices.
//
// PRINCIPLES
//   • Source of truth is match history (lineups, goals, cards, competitionId).
//     Match documents are NEVER modified — only the derived totals are rebuilt.
//   • Idempotent: clear-and-recompute with SET writes, never incremental add.
//     Running once or a hundred times yields identical totals.
//   • Caps = presence in a match lineup. No "did they take the field" inference
//     and no all-registered fallback. A submitted result with no lineup produces
//     no caps — correct, since there is no record of who played.
//   • Runs as the Admin SDK (privileged) so client Firestore rules never gate
//     these writes; the engine is the authority that keeps competitionIds correct.

const admin = require('firebase-admin')

// Mirror of src/lib/fixtureResult.js#fixtureContribution — how a fixture's
// outcome banner flag gates STATS. Keep in sync (CommonJS can't import the ESM).
//   stats          — count this match's timeline at all?
//   countsAllGoals — include goals/cards flagged as an abandoned attempt?
function fixtureContribution(m) {
  const o = m && m.outcome
  if (o && o.kind) {
    if (o.kind === 'not_played') return { stats: false, countsAllGoals: false }
    if (o.flag === 'awarded')    return { stats: false, countsAllGoals: false }
    if (o.flag === 'frozen')     return { stats: false, countsAllGoals: false }
    if (o.flag === 'final')      return { stats: true,  countsAllGoals: o.kind === 'abandoned' }
  }
  return { stats: m.status === 'final', countsAllGoals: false }
}

// Active goals from either schema: the Phase-1D `goals` array (preferred) or the
// legacy homeScorers/awayScorers arrays. A goal with scorerPersonId is keyed by
// id; otherwise by scorerName. Mirrors src/lib/adminQueries.js#readGoals.
// Goals flagged `abandonedAttempt` (scored in a stopped attempt that was later
// replayed) are excluded unless the abandoned attempt was let-stand.
function readGoals(m, countsAllGoals = false) {
  if (Array.isArray(m.goals) && m.goals.length) {
    return m.goals
      .filter(g => g.status !== 'reversed' && (countsAllGoals || !g.abandonedAttempt))
      .map(g => ({
        name: g.scorerName, side: g.side, personId: g.scorerPersonId ?? null,
        assistName: g.assistName ?? null, assistPersonId: g.assistPersonId ?? null,
      }))
  }
  return [
    ...(m.homeScorers ?? []).map(s => ({ name: s.name, side: 'home', personId: null, assistName: null, assistPersonId: null })),
    ...(m.awayScorers ?? []).map(s => ({ name: s.name, side: 'away', personId: null, assistName: null, assistPersonId: null })),
  ]
}

// Active cards (cards carry playerName only — no personId link anywhere in the
// schema, so card attribution is always a name match against the slice roster).
function readCards(m, countsAllGoals = false) {
  return (m.cards ?? []).filter(c => c.status !== 'reversed' && (countsAllGoals || !c.abandonedAttempt))
}

// PURE derivation. Given a competition's `players` slices and the final matches
// relevant to them, return { [sliceId]: { caps, goals, green, yellow, red } }.
// A slice only accumulates from matches its team played in (teamId match), so
// the caller MUST pass slices and matches from the SAME competition — a teamId
// can recur across competitions and would otherwise bleed.
function deriveSliceTotals(slices, matches) {
  const acc = {}
  for (const p of slices) acc[p.id] = { caps: 0, goals: 0, assists: 0, green: 0, yellow: 0, red: 0 }

  for (const m of matches) {
    // Awarded (walkover) / frozen (abandoned, replay pending) / not-played
    // fixtures contribute nothing to stats — no real play counted.
    const contrib = fixtureContribution(m)
    if (!contrib.stats) continue

    const teamIds = new Set([m.homeTeamId, m.awayTeamId].filter(Boolean))
    const lineup  = [...(m.homeLineup ?? []), ...(m.awayLineup ?? [])]
    // Cap = presence in the lineup. Trust BOTH the structured entries' personId
    // AND the flat `lineupPersonIds` array — the latter is what fetchMatchesForPlayer
    // queries, so a fixture that shows on the profile but whose structured entry
    // lost its personId (edit path / legacy import) still scores its cap here.
    const lineupPersonIds = new Set([
      ...lineup.map(e => e.personId).filter(Boolean),
      ...(Array.isArray(m.lineupPersonIds) ? m.lineupPersonIds : []),
    ])
    const lineupNames     = new Set(lineup.map(e => e.personName).filter(Boolean))

    const goalCountsById = {}, goalCountsByName = {}
    const assistCountsById = {}, assistCountsByName = {}
    for (const g of readGoals(m, contrib.countsAllGoals)) {
      if (g.personId) goalCountsById[g.personId] = (goalCountsById[g.personId] ?? 0) + 1
      else if (g.name && g.name !== 'Unknown scorer' && g.name !== 'Unknown') {
        goalCountsByName[g.name] = (goalCountsByName[g.name] ?? 0) + 1
      }
      if (g.assistPersonId) assistCountsById[g.assistPersonId] = (assistCountsById[g.assistPersonId] ?? 0) + 1
      else if (g.assistName) assistCountsByName[g.assistName] = (assistCountsByName[g.assistName] ?? 0) + 1
    }

    const cardCounts = {}
    for (const c of readCards(m, contrib.countsAllGoals)) {
      if (c.playerName && c.playerName !== 'Unknown' && c.cardType) {
        const rec = cardCounts[c.playerName] ?? { green: 0, yellow: 0, red: 0 }
        rec[c.cardType] = (rec[c.cardType] ?? 0) + 1
        cardCounts[c.playerName] = rec
      }
    }

    for (const p of slices) {
      if (!teamIds.has(p.teamId)) continue
      const a = acc[p.id]
      const inLineup   = (p.personId && lineupPersonIds.has(p.personId)) ||
                         (p.personName && lineupNames.has(p.personName))
      const goalsTotal = (p.personId   ? (goalCountsById[p.personId]   ?? 0) : 0) +
                         (p.personName ? (goalCountsByName[p.personName] ?? 0) : 0)
      const assistsTotal = (p.personId   ? (assistCountsById[p.personId]   ?? 0) : 0) +
                           (p.personName ? (assistCountsByName[p.personName] ?? 0) : 0)
      const cc = p.personName ? (cardCounts[p.personName] ?? null) : null
      if (inLineup) a.caps++            // cap = presence in lineup, nothing more
      a.goals += goalsTotal
      a.assists += assistsTotal
      if (cc) { a.green += cc.green ?? 0; a.yellow += cc.yellow ?? 0; a.red += cc.red ?? 0 }
    }
  }
  return acc
}

// SET each slice's totals in batch-sized chunks (Firestore limit 500/op).
async function writeSliceTotals(db, slices, totals) {
  const ids = slices.map(s => s.id)
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch()
    for (const id of ids.slice(i, i + 400)) {
      const t = totals[id] ?? { caps: 0, goals: 0, assists: 0, green: 0, yellow: 0, red: 0 }
      batch.update(db.doc(`players/${id}`), {
        caps: t.caps, goals: t.goals, assists: t.assists ?? 0,
        'cards.green': t.green, 'cards.yellow': t.yellow, 'cards.red': t.red,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }
}

// Totals for no-competition (team roster) slices from standalone fixtures.
// Season-scoped: an entry stamped `season: '2026'` only absorbs 2026 fixtures;
// an unstamped (legacy) entry absorbs all of the team's standalone fixtures.
// deriveSliceTotals already scopes by teamId within the pool it is given.
function deriveNoCompTotals(noCompSlices, noCompMatches) {
  const totals = {}
  const bySeason = {}
  for (const p of noCompSlices) (bySeason[p.season ? String(p.season) : ''] ??= []).push(p)
  for (const season of Object.keys(bySeason)) {
    const pool = season
      ? noCompMatches.filter(m => String(m.season ?? '') === season)
      : noCompMatches
    Object.assign(totals, deriveSliceTotals(bySeason[season], pool))
  }
  return totals
}

// Scoped friendly recompute — fired when a standalone (no-competition) fixture
// finalises. Rebuilds the no-competition roster slices of the two teams involved
// from all their standalone final fixtures. Cheap: a handful of reads.
async function recomputeFriendlyStatsForTeams(teamIds, db) {
  const ids = [...new Set((teamIds ?? []).filter(Boolean))]
  if (!ids.length) return { sliceCount: 0, matchCount: 0 }

  const [sliceSnaps, matchSnaps] = await Promise.all([
    Promise.all(ids.map(tid =>
      db.collection('players').where('teamId', '==', tid).get())),
    Promise.all(ids.flatMap(tid => [
      db.collection('matches').where('homeTeamId', '==', tid).where('status', '==', 'final').get(),
      db.collection('matches').where('awayTeamId', '==', tid).where('status', '==', 'final').get(),
    ])),
  ])
  const slices = sliceSnaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    .filter(p => !p.competitionId)
  const seen = new Set()
  const matches = matchSnaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    .filter(m => !m.competitionId)
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))

  // Self-heal FIRST: players who appear in these friendlies' lineups but have no
  // roster entry get one — even when the team had no slices at all yet.
  const created = await ensureSlicesFromLineups(db, matches, slices)
  slices.push(...created)
  if (!slices.length) return { sliceCount: 0, matchCount: matches.length, createdCount: 0 }

  const totals = deriveNoCompTotals(slices, matches)
  await writeSliceTotals(db, slices, totals)
  return { sliceCount: slices.length, matchCount: matches.length, createdCount: created.length }
}

// ── Self-heal: create missing slices from lineup appearances ──────────────────
// A slice is the ONLY stat container — a lineup appearance with no matching
// slice contributes nothing (the player shows fixtures but zero career stats).
// This scans final matches' lineups and creates any missing slice, so an
// appearance always accrues. Competition matches target a (person, team,
// competition) slice; standalone fixtures target the (person, team, season)
// roster entry — a legacy unstamped roster entry satisfies any season.
// Returns the created slice objects (with ids) so callers can derive over them
// without re-reading.
async function ensureSlicesFromLineups(db, matches, slices) {
  const exact = new Set()
  const unstampedRoster = new Set()
  for (const p of slices) {
    exact.add(`${p.personId}|${p.teamId}|${p.competitionId || ''}|${p.competitionId ? '' : (p.season ? String(p.season) : '')}`)
    if (!p.competitionId && !p.season) unstampedRoster.add(`${p.personId}|${p.teamId}`)
  }

  const missing = new Map()
  for (const m of matches) {
    if (!fixtureContribution(m).stats) continue   // awarded/frozen never accrue
    for (const side of ['home', 'away']) {
      const teamId = side === 'home' ? m.homeTeamId : m.awayTeamId
      if (!teamId) continue
      for (const e of (m[`${side}Lineup`] ?? [])) {
        if (!e.personId) continue
        const compId = m.competitionId || ''
        const season = compId ? '' : (m.season ? String(m.season) : '')
        const key = `${e.personId}|${teamId}|${compId}|${season}`
        if (exact.has(key)) continue
        if (!compId && unstampedRoster.has(`${e.personId}|${teamId}`)) continue
        if (!missing.has(key)) missing.set(key, {
          personId: e.personId, personName: e.personName ?? null,
          teamId, competitionId: compId || null, season: season || null,
        })
      }
    }
  }
  if (!missing.size) return []

  // Denormalised context for the new slices — one read per distinct team/comp.
  const teamIds = [...new Set([...missing.values()].map(x => x.teamId))]
  const compIds = [...new Set([...missing.values()].map(x => x.competitionId).filter(Boolean))]
  const [teamDocs, compDocs] = await Promise.all([
    Promise.all(teamIds.map(id => db.collection('teams').doc(id).get())),
    Promise.all(compIds.map(id => db.collection('competitions').doc(id).get())),
  ])
  const teams = {}; teamDocs.forEach(d => { if (d.exists) teams[d.id] = d.data() })
  const comps = {}; compDocs.forEach(d => { if (d.exists) comps[d.id] = d.data() })

  const created = []
  const items = [...missing.values()]
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch()
    for (const x of items.slice(i, i + 400)) {
      const t = teams[x.teamId] ?? {}
      const c = x.competitionId ? (comps[x.competitionId] ?? {}) : {}
      const ref = db.collection('players').doc()
      const docData = {
        personId: x.personId, personName: x.personName,
        teamId: x.teamId, competitionId: x.competitionId,
        season: x.season,
        organizationId: t.organizationId ?? null,
        personSlug: null, shirtNumber: null, position: null, isCaptain: false,
        caps: 0, goals: 0, assists: 0, cards: { green: 0, yellow: 0, red: 0 },
        competitionName: c.name ?? null,
        competitionSeason: c.season ?? null,
        competitionStatus: c.status ?? null,
        teamDisplayName: t.displayName ?? null,
        teamShortCode: t.shortCode ?? null,
        teamPrimaryColor: t.primaryColor ?? null,
        createdBy: 'system:stats-selfheal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      batch.set(ref, docData)
      created.push({ id: ref.id, ...docData })
    }
    await batch.commit()
  }
  return created
}

// ── Caller 1: scoped competition recompute (finalisation + manual button) ──────
// Rebuilds ONLY this competition's slices. Does NOT touch career counters —
// those are cross-competition and belong to the daily wholesale run. Idempotent.
async function recomputeCompetitionStats(competitionId, db) {
  const [matchesSnap, slicesSnap] = await Promise.all([
    db.collection('matches')
      .where('competitionId', '==', competitionId)
      .where('status', '==', 'final').get(),
    db.collection('players')
      .where('competitionId', '==', competitionId).get(),
  ])
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const slices  = slicesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Self-heal: anyone in a lineup without a slice gets one, then accrues.
  const created = await ensureSlicesFromLineups(db, matches, slices)
  slices.push(...created)

  const totals = deriveSliceTotals(slices, matches)
  await writeSliceTotals(db, slices, totals)

  return { matchCount: matches.length, playerCount: slices.length, createdCount: created.length }
}

// ── Caller 2: wholesale career recompute (daily 03:00 safety net) ──────────────
// Reads every final match and every slice once. Rebuilds all slices from origin
// (grouped by competition so teamId never bleeds across competitions), then
// re-derives each person's career totals as the sum of their fresh slices and
// competitionIds as the set of competitions those slices belong to. Idempotent.
async function recomputeAllCareerStats(db) {
  const [matchesSnap, slicesSnap, compsSnap] = await Promise.all([
    db.collection('matches').where('status', '==', 'final').get(),
    db.collection('players').get(),
    db.collection('competitions').get(),
  ])
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  let slices    = slicesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Prune orphan slices: a competition slice whose competition was deleted keeps
  // showing an empty team block on the player's profile. Delete those first so
  // they neither display nor feed the career rollup. (Season/roster slices, which
  // have no competitionId, are always kept.)
  const liveComps = new Set(compsSnap.docs.map(d => d.id))
  const orphans = slices.filter(p => p.competitionId && !liveComps.has(p.competitionId))
  for (let i = 0; i < orphans.length; i += 400) {
    const batch = db.batch()
    for (const p of orphans.slice(i, i + 400)) batch.delete(db.doc(`players/${p.id}`))
    await batch.commit()
  }
  const orphanIds = new Set(orphans.map(p => p.id))
  slices = slices.filter(p => !orphanIds.has(p.id))

  // Self-heal: create missing slices for every lineup appearance in history, so
  // players who were only ever added to match lineups still get career stats.
  const createdSlices = await ensureSlicesFromLineups(db, matches, slices)
  slices.push(...createdSlices)

  // Group by competition so a slice only accumulates from its own competition.
  const matchesByComp = {}, slicesByComp = {}
  for (const m of matches) { if (m.competitionId) (matchesByComp[m.competitionId] ??= []).push(m) }
  for (const p of slices)  { if (p.competitionId) (slicesByComp[p.competitionId]  ??= []).push(p) }

  // 1 — Rebuild every slice from origin.
  const sliceTotals = {}
  for (const compId of Object.keys(slicesByComp)) {
    Object.assign(sliceTotals, deriveSliceTotals(slicesByComp[compId], matchesByComp[compId] ?? []))
  }

  // 1b — No-competition bucket: team roster entries (slices without a
  // competitionId) accumulate from their team's standalone fixtures — friendlies
  // count toward player stats, not just competition games. Entries stamped with
  // a season only absorb that season's fixtures; legacy unstamped entries absorb
  // all of the team's standalone fixtures.
  Object.assign(sliceTotals, deriveNoCompTotals(
    slices.filter(p => !p.competitionId),
    matches.filter(m => !m.competitionId),
  ))

  await writeSliceTotals(db, slices, sliceTotals)

  // 2 — Sum each person's freshly-rebuilt slices → career totals + competitionIds.
  const personAgg = {}
  for (const p of slices) {
    if (!p.personId) continue
    const t = sliceTotals[p.id] ?? { caps: 0, goals: 0, assists: 0, green: 0, yellow: 0, red: 0 }
    const agg = (personAgg[p.personId] ??= { caps: 0, goals: 0, assists: 0, green: 0, yellow: 0, red: 0, comps: new Set() })
    agg.caps += t.caps; agg.goals += t.goals; agg.assists += t.assists ?? 0
    agg.green += t.green; agg.yellow += t.yellow; agg.red += t.red
    if (p.competitionId) agg.comps.add(p.competitionId)
  }

  const personIds = Object.keys(personAgg)
  for (let i = 0; i < personIds.length; i += 400) {
    const batch = db.batch()
    for (const pid of personIds.slice(i, i + 400)) {
      const a = personAgg[pid]
      batch.set(db.doc(`people/${pid}`), {
        careerCaps: a.caps, careerGoals: a.goals, careerAssists: a.assists,
        careerCards: { green: a.green, yellow: a.yellow, red: a.red },
        competitionIds: [...a.comps],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    await batch.commit()
  }

  return {
    matchCount: matches.length, sliceCount: slices.length,
    personCount: personIds.length, createdCount: createdSlices.length,
  }
}

module.exports = { recomputeCompetitionStats, recomputeAllCareerStats, recomputeFriendlyStatsForTeams, deriveSliceTotals }
