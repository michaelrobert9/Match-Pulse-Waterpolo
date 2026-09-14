// Bulk fixture/result importer — parse an .xlsx of a season's fixtures (and
// optional results), match every row to EXISTING organisations/teams, and let
// the caller preview before committing. Nothing is created until commit, and any
// row that can't be matched exactly is rejected (never guessed) and recorded.
//
// SheetJS (xlsx) is loaded dynamically so it stays out of the main bundle.
//
// Column layout (row 1 = headers, matched case-insensitively):
//   Date | Time | Home Organisation | Home Team | Away Organisation |
//   Away Team | Home Score | Away Score | Venue | Pool
//
// Both scores filled → imported as a completed RESULT (status 'final').
// Both scores blank  → imported as an upcoming FIXTURE.
// Exactly one score  → rejected (incomplete result).

import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { fetchOrganizations, fetchTeamsForOrganization, fetchCompetitionPools } from './queries'
import {
  createMatch, addFixtureToCompetition, addTeamToCompetition, submitFixtureResult, fetchCompetitionTeams,
} from './adminQueries'

export const TEMPLATE_COLUMNS = [
  'Date', 'Time', 'Home Organisation', 'Home Team',
  'Away Organisation', 'Away Team', 'Home Score', 'Away Score', 'Venue', 'Pool',
]

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// ── Template ──────────────────────────────────────────────────────────────────
export async function downloadTemplate(filename = 'matchpulse-fixtures-template.xlsx') {
  const XLSX = await import('xlsx')
  const example = {
    Date: '2026-05-09', Time: '10:00',
    'Home Organisation': 'Example School', 'Home Team': 'U14A',
    'Away Organisation': 'Rival School', 'Away Team': 'U14A',
    'Home Score': '', 'Away Score': '', Venue: 'Main Field', Pool: '',
  }
  const ws = XLSX.utils.json_to_sheet([example], { header: TEMPLATE_COLUMNS })
  ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: Math.max(12, c.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fixtures')
  XLSX.writeFile(wb, filename)
}

// ── Parse ─────────────────────────────────────────────────────────────────────
// Returns { rows } where each row is the raw values keyed by our canonical names.
export async function parseFixtureFile(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('The spreadsheet has no sheets.')
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
  // Map each row's headers (case-insensitive) onto our canonical column names.
  const canonical = Object.fromEntries(TEMPLATE_COLUMNS.map(c => [norm(c), c]))
  const rows = raw.map((r) => {
    const out = {}
    for (const [k, v] of Object.entries(r)) {
      const ck = canonical[norm(k)]
      if (ck) out[ck] = v
    }
    return out
  }).filter(r => Object.values(r).some(v => String(v ?? '').trim() !== ''))
  return { rows }
}

// ── Date/score helpers ────────────────────────────────────────────────────────
function parseDateTime(dateVal, timeVal) {
  if (dateVal instanceof Date && !isNaN(dateVal)) {
    const d = new Date(dateVal)
    applyTime(d, timeVal)
    return d
  }
  const s = String(dateVal ?? '').trim()
  if (!s) return { error: 'Missing date' }
  let d = null
  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // DD/MM/YYYY or DD-MM-YYYY (SA convention)
  if (!d) { m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) }
  if (!d || isNaN(d)) return { error: `Unrecognised date "${s}" (use YYYY-MM-DD)` }
  applyTime(d, timeVal)
  return d
}
function applyTime(d, timeVal) {
  const t = String(timeVal ?? '').trim()
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  else d.setHours(0, 0, 0, 0)
}
function parseScore(v) {
  const s = String(v ?? '').trim()
  if (s === '') return { blank: true }
  const n = Number(s)
  if (!Number.isInteger(n) || n < 0) return { error: true }
  return { value: n }
}

// ── Build the preview plan ──────────────────────────────────────────────────
// Loads orgs + the referenced orgs' teams + the competition's pools, then
// resolves every row. Pure matching is exact + normalised; ambiguous or not
// found → the row is flagged, never guessed. Returns { rows: [...] }.
export async function buildImportPlan(rawRows, competition) {
  const orgs = await fetchOrganizations()
  const orgIndex = new Map()
  for (const o of orgs) {
    for (const key of [o.name, o.matchName, o.slug].filter(Boolean)) {
      const k = norm(key)
      if (!orgIndex.has(k)) orgIndex.set(k, o)
    }
  }

  // Which orgs are referenced? Load each one's teams once.
  const referenced = new Set()
  for (const r of rawRows) {
    for (const key of [r['Home Organisation'], r['Away Organisation']]) {
      const o = orgIndex.get(norm(key)); if (o) referenced.add(o.id)
    }
  }
  const teamsByOrg = new Map()
  await Promise.all([...referenced].map(async (orgId) => {
    const teams = await fetchTeamsForOrganization(orgId).catch(() => [])
    const idx = new Map()
    for (const t of teams) {
      const k = norm(t.displayName || t.name)
      if (!idx.has(k)) idx.set(k, [])
      idx.get(k).push(t)
    }
    teamsByOrg.set(orgId, idx)
  }))

  // Pools (tournament) for optional Pool column.
  let poolIndex = null
  if (rawRows.some(r => String(r.Pool ?? '').trim() !== '')) {
    const pools = await fetchCompetitionPools(competition.id).catch(() => [])
    poolIndex = new Map(pools.map(p => [norm(p.name), p.poolId]))
  }

  const resolveSide = (orgName, teamName, errors, side) => {
    const org = orgIndex.get(norm(orgName))
    if (!org) { errors.push(`${side} organisation "${orgName}" not found on MatchPulse`); return null }
    const idx = teamsByOrg.get(org.id)
    const matches = idx?.get(norm(teamName)) ?? []
    if (matches.length === 0) { errors.push(`${side} team "${teamName}" not found under ${org.name}`); return null }
    if (matches.length > 1) { errors.push(`${side} team "${teamName}" is ambiguous under ${org.name}`); return null }
    return { team: matches[0], orgName: org.name }
  }

  const rows = rawRows.map((r, i) => {
    const errors = []
    const home = resolveSide(r['Home Organisation'], r['Home Team'], errors, 'Home')
    const away = resolveSide(r['Away Organisation'], r['Away Team'], errors, 'Away')
    if (home && away && home.team.id === away.team.id) errors.push('Home and away teams are the same')

    const dt = parseDateTime(r.Date, r.Time)
    const scheduledAt = dt instanceof Date ? dt : null
    if (!scheduledAt) errors.push(dt.error || 'Invalid date')

    const hs = parseScore(r['Home Score'])
    const as = parseScore(r['Away Score'])
    let isResult = false, homeScore = null, awayScore = null
    if (hs.error || as.error) errors.push('Scores must be whole numbers (0 or more)')
    else if (hs.blank !== as.blank) errors.push('A result needs BOTH scores (leave both blank for an upcoming fixture)')
    else if (!hs.blank) { isResult = true; homeScore = hs.value; awayScore = as.value }

    let poolId = null
    const poolName = String(r.Pool ?? '').trim()
    if (poolName) {
      poolId = poolIndex?.get(norm(poolName)) ?? null
      if (!poolId) errors.push(`Pool "${poolName}" not found in this competition`)
    }

    return {
      rowNum: i + 2, // header is row 1
      raw: r,
      ok: errors.length === 0,
      errors,
      resolved: (home && away) ? {
        home, away, scheduledAt, isResult, homeScore, awayScore, poolId, poolName,
      } : null,
    }
  })
  return { rows }
}

// ── Commit ────────────────────────────────────────────────────────────────────
// Creates the ready rows (match doc + fixture membership + result), auto-adding
// any matched team that isn't yet a competition member, then saves an import
// report. Returns { imported, rejected, reportId }.
export async function commitImportPlan(plan, competition) {
  // Existing members, so we only add teams that aren't already in.
  const existing = new Set((await fetchCompetitionTeams(competition.id).catch(() => [])).map(m => m.teamId))

  async function ensureMember(team, orgName) {
    if (existing.has(team.id)) return
    await addTeamToCompetition(competition.id, team.id, {
      status: 'accepted',
      organizationId: team.organizationId ?? null,
      claimed: team.organizationId != null,
      displaySnapshot: {
        teamName: team.displayName || team.name || '',
        orgName: orgName || null,
        primaryColor: team.primaryColor ?? null,
      },
    })
    existing.add(team.id)
  }

  const teamObj = (team, orgName) => ({
    id: team.id,
    displayName: team.displayName || team.name || '',
    orgName,
    slug: team.slug || null,
    primaryColor: team.primaryColor ?? null,
    organizationId: team.organizationId ?? null,
  })

  const imported = []
  const rejected = []
  for (const row of plan.rows) {
    if (!row.ok || !row.resolved) {
      rejected.push({ rowNum: row.rowNum, data: row.raw, reason: row.errors.join('; ') || 'Could not match' })
      continue
    }
    const { home, away, scheduledAt, isResult, homeScore, awayScore, poolId } = row.resolved
    try {
      await ensureMember(home.team, home.orgName)
      await ensureMember(away.team, away.orgName)
      const ref = await createMatch(competition.id, teamObj(home.team, home.orgName), teamObj(away.team, away.orgName), {
        scheduledAt: scheduledAt || null,
        season: competition.season,
        competitionSlug: competition.slug,
      })
      await addFixtureToCompetition(competition.id, {
        id: ref.id, homeTeamId: home.team.id, awayTeamId: away.team.id,
      }, { countsTowardStandings: true, ...(poolId ? { poolId } : {}) })
      if (isResult) await submitFixtureResult(ref.id, { homeScore, awayScore })
      imported.push({
        rowNum: row.rowNum, matchId: ref.id,
        home: home.orgName + ' ' + (home.team.displayName || ''),
        away: away.orgName + ' ' + (away.team.displayName || ''),
        result: isResult ? `${homeScore}–${awayScore}` : null,
      })
    } catch (e) {
      rejected.push({ rowNum: row.rowNum, data: row.raw, reason: e?.message || 'Failed to create' })
    }
  }

  let reportId = null
  try {
    const ref = await addDoc(collection(db, 'competitions', competition.id, 'importReports'), {
      createdAt: serverTimestamp(),
      createdBy: auth?.currentUser?.uid ?? null,
      totals: { imported: imported.length, rejected: rejected.length, rows: plan.rows.length },
      imported, rejected,
    })
    reportId = ref.id
  } catch { /* report is best-effort */ }

  return { imported, rejected, reportId }
}

// Download the rejected rows as an .xlsx the organiser can fix and re-import.
export async function downloadRejected(rejected, filename = 'matchpulse-not-imported.xlsx') {
  const XLSX = await import('xlsx')
  const data = rejected.map(r => ({ Row: r.rowNum, ...r.data, 'Why not imported': r.reason }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Not imported')
  XLSX.writeFile(wb, filename)
}
