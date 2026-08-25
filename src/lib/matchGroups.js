// Pairing engine for a "match day" (match group) between two schools/clubs.
//
// It bands teams using the CANONICAL structured model (teamNaming.teamStructuralKey,
// off the team's discrete gender/division + ageGroup + teamLevel fields) and
// orders them with the CANONICAL seniority sort — it NEVER parses display names.
// Repo-local, because the pairing UX is a P3 concern, but the band key and order
// it emits are the canonical ones.

import { teamStructuralKey, schoolGenderProfile, seniorityDescriptor, levelLabel } from './teamNaming'
import { compareSeniority } from './seniority'
import { slugify, ageLabel, matchPath } from './matchPaths'
import { computeTally } from './matchTally'

const isActive = t => t && t.active !== false

// A team's gender/division axis for banding: its own value (co-ed schools and
// clubs store it), else a single-gender school's profile. '' when unknown.
function teamGender(team, org) {
  if (team?.division) return team.division
  if (team?.gender) return team.gender
  if (org?.type === 'school') {
    const p = schoolGenderProfile(org)
    if (p === 'boys' || p === 'girls') return p
  }
  return ''
}

// Canonical band key for a team ("girls-u16-a", "men-1st-team"). Empty when the
// team carries no structured level (a not-yet-migrated legacy team), so it is
// paired manually rather than mis-banded on its gender/division alone.
export function teamBandKey(team, org) {
  if (!team?.ageGroup && !team?.teamLevel) return ''
  return teamStructuralKey({ ...team, gender: teamGender(team, org) })
}

// The age/level token used in the child URL and for ordering. Built from the
// structured level ("u14a", "1st-team"), then gender/division-prefixed ONLY when
// the day spans more than one axis value (so girls-u14a and boys-u14a stay
// distinct within one group, and a single-axis day never carries a prefix).
function bandAgeSlug(team, org, mixedGender) {
  const base = slugify(levelLabel(team))
  if (!base) return ''
  const g = teamGender(team, org)
  return mixedGender && g ? `${slugify(g)}-${base}` : base
}

function indexByBand(teams, org) {
  const map = new Map()
  const unbandable = []
  for (const t of teams) {
    const key = teamBandKey(t, org)
    if (!key) { unbandable.push(t); continue }
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return { map, unbandable }
}

// A greyed one-sided row's label — band-only (no group gender context).
function bandLabel(team, org) {
  return ageLabel(bandAgeSlug(team, org, false) || teamBandKey(team, org) || (team?.displayName ?? 'Team'))
}

// Assign final ageSlugs to a set of paired rows. The gender prefix is ONE
// GROUP-LEVEL decision (a collision fix, not a label choice): if the paired rows
// span both boys and girls, EVERY child is prefixed (boys-u14a / girls-u16a) so a
// co-ed day's boys U14A and girls U14A can't collapse onto the same u14a; if the
// rows share a single gender, none is prefixed. ageSlugs are then made unique and
// the rows ordered most-senior-first. Never mixes prefixed and unprefixed rows.
function assignRows(pairs, homeOrg, awayOrg) {
  const genders = new Set(pairs.map(p => teamGender(p.home, homeOrg)).filter(Boolean))
  const mixedGender = genders.size > 1
  const seen = new Set()
  const rows = pairs.map(p => {
    const gender = teamGender(p.home, homeOrg) || teamGender(p.away, awayOrg) || ''
    const want = bandAgeSlug(p.home, homeOrg, mixedGender)
      || bandAgeSlug(p.away, awayOrg, mixedGender)
      || teamBandKey(p.home, homeOrg) || 'match'
    let ageSlug = want, n = 2
    while (seen.has(ageSlug)) ageSlug = `${want}-${n++}`
    seen.add(ageSlug)
    const band = p.home ?? p.away
    return {
      key: `${p.home?.id ?? 'h'}-${p.away?.id ?? 'a'}`,
      ageSlug, ageLabel: ageLabel(ageSlug), gender,
      seniority: seniorityDescriptor({ ...band, gender: teamGender(band, band === p.home ? homeOrg : awayOrg) }),
      home: p.home, away: p.away,
      scheduledAt: p.scheduledAt ?? null,
      // Venue trio kept together through pairing so a per-row link survives.
      venue: p.venue, venueId: p.venueId ?? null, venueSlug: p.venueSlug ?? null,
    }
  })
  rows.sort((a, b) => compareSeniority(a.seniority, b.seniority))
  rows.forEach((r, i) => { r.groupOrder = i })
  return { rows, mixedGender }
}

// Auto-pair two orgs' teams like-for-like by band. Returns:
//   rows:     paired bands (both sides), most senior first, each with groupOrder,
//             ageSlug, ageLabel, gender, and home/away team objects.
//   oneSided: bands on ONE side only, plus unbandable teams — shown greyed with a
//             short reason rather than hidden.
//   mixedGender: whether the PAIRED rows span more than one gender.
export function autoPairTeams(homeTeams = [], awayTeams = [], { homeOrg, awayOrg } = {}) {
  const h = indexByBand(homeTeams.filter(isActive), homeOrg)
  const a = indexByBand(awayTeams.filter(isActive), awayOrg)

  const pairs = []
  const oneSided = []
  for (const key of new Set([...h.map.keys(), ...a.map.keys()])) {
    const homeTeam = h.map.get(key)?.[0]
    const awayTeam = a.map.get(key)?.[0]
    if (homeTeam && awayTeam) pairs.push({ home: homeTeam, away: awayTeam })
    else if (homeTeam) oneSided.push({ key, side: 'home', team: homeTeam, ageLabel: bandLabel(homeTeam, homeOrg), reason: `${awayOrg?.name ?? 'Away'} has no matching team` })
    else if (awayTeam) oneSided.push({ key, side: 'away', team: awayTeam, ageLabel: bandLabel(awayTeam, awayOrg), reason: `${homeOrg?.name ?? 'Home'} has no matching team` })
  }
  for (const t of h.unbandable) oneSided.push({ key: `unbandable-home-${t.id}`, side: 'home', team: t, ageLabel: t.displayName ?? t.teamLabel ?? 'Team', reason: 'No age/level band — pair manually' })
  for (const t of a.unbandable) oneSided.push({ key: `unbandable-away-${t.id}`, side: 'away', team: t, ageLabel: t.displayName ?? t.teamLabel ?? 'Team', reason: 'No age/level band — pair manually' })

  const { rows, mixedGender } = assignRows(pairs, homeOrg, awayOrg)
  return { rows, oneSided, mixedGender }
}

// Re-key the FINAL selected rows just before creation, so the group-level gender
// decision reflects exactly what is being created (e.g. after the user unticks
// every girls row, the day is boys-only and DROPS the prefix). Preserves each
// row's chosen scheduledAt / venue, and re-derives ageSlug, gender and groupOrder.
export function finalizeRows(selected = [], { homeOrg, awayOrg } = {}) {
  return assignRows(
    selected.map(r => ({ home: r.home, away: r.away, scheduledAt: r.scheduledAt ?? null, venue: r.venue, venueId: r.venueId ?? null, venueSlug: r.venueSlug ?? null })),
    homeOrg, awayOrg,
  ).rows
}

// Collapse a flat list of matches so each match DAY (children sharing a
// matchGroupId) becomes ONE item, while standalone matches pass through. Order
// follows first appearance. Use this ONLY where the audience is the organisation
// (org pages, org/platform feeds) — never on a team page, player profile, or a
// scorer list, where the specific match is the point.
//
// A group item summarises the day for a collapsed row: date, both org
// names/colours + ids, the group URL, child count, and the DERIVED tally (from
// the children, in the group's home/away orientation). `sortAt` is the earliest
// child kickoff (ms) for time-ordering alongside standalone matches.
export function collapseMatchDays(matches = []) {
  const byGroup = new Map()
  const items = []
  const millis = ts => ts?.toMillis?.() ?? (ts ? +new Date(ts) : null)

  for (const m of matches) {
    if (!m?.matchGroupId) {
      items.push({ kind: 'match', match: m, sortAt: millis(m?.scheduledAt) })
      continue
    }
    let g = byGroup.get(m.matchGroupId)
    if (!g) { g = { kind: 'group', matchGroupId: m.matchGroupId, kids: [] }; byGroup.set(m.matchGroupId, g); items.push(g) }
    g.kids.push(m)
  }

  for (const it of items) {
    if (it.kind !== 'group') continue
    const first = it.kids[0] ?? {}
    it.matchDate = first.matchDate ?? null
    it.slug      = first.matchSlug ?? null
    it.path      = (it.matchDate && it.slug) ? matchPath(it.matchDate, it.slug) : '/'
    it.homeOrgId = first.homeOrgId ?? null
    it.awayOrgId = first.awayOrgId ?? null
    it.homeName  = first.homeOrgName ?? first.homeTeamName ?? 'Home'
    it.awayName  = first.awayOrgName ?? first.awayTeamName ?? 'Away'
    it.homeColor = first.homeTeamColor ?? null
    it.awayColor = first.awayTeamColor ?? null
    it.count     = it.kids.length
    it.tally     = computeTally(it.kids)
    it.sortAt    = it.kids.reduce((acc, k) => {
      const t = millis(k.scheduledAt)
      return (t != null && (acc == null || t < acc)) ? t : acc
    }, null)
  }
  return items
}

// Re-key a manually re-paired row for interim display: swap the away team, keep
// the home band. The authoritative ageSlug/gender is re-derived by finalizeRows
// at create, so this only needs to be good enough to show.
export function rowFromManualPair(homeTeam, awayTeam, homeOrg, awayOrg, mixedGender, groupOrder) {
  const ageSlug = bandAgeSlug(homeTeam, homeOrg, mixedGender) || slugify(levelLabel(homeTeam) || homeTeam?.displayName || 'match')
  return {
    key: `${homeTeam.id}-${awayTeam.id}`, ageSlug, ageLabel: ageLabel(ageSlug),
    gender: teamGender(homeTeam, homeOrg) || '',
    seniority: seniorityDescriptor({ ...homeTeam, gender: teamGender(homeTeam, homeOrg) }),
    home: homeTeam, away: awayTeam, groupOrder,
  }
}
