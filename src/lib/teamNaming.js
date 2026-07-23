// Structured team-naming model.
//
//   School / Club  >  Gender or Division  >  Team
//
// Schools carry a `genderProfile` (boys / girls / coed). Single-gender schools
// apply their gender automatically; co-ed schools choose per team. Clubs choose
// a division. Names are generated from these structured fields rather than free
// text so they stay consistent and can be re-rendered.
//
// Structured fields (governance model):
//   School:  { gender, ageGroup, teamLevel }   e.g. girls + U16 + A  → "Girls U16A"
//   Club:    { division, teamLabel }            e.g. mens + 1st Team  → "Men's 1st Team"
//
// Legacy school teams stored a single fused `teamLabel` ("U16A") and clubs stored
// their division in the `gender` field. Both legacy shapes remain supported so
// existing teams continue to render and de-duplicate correctly.

import { slugify } from './slugify'

// ── School ───────────────────────────────────────────────────────────────────
export const SCHOOL_GENDER_PROFILES = [
  { value: 'boys',  label: 'Boys only' },
  { value: 'girls', label: 'Girls only' },
  { value: 'coed',  label: 'Co-ed' },
]
// Gender word used inside a school team name.
export const SCHOOL_GENDER_LABEL = { boys: 'Boys', girls: 'Girls' }

// ── Club ─────────────────────────────────────────────────────────────────────
export const CLUB_DIVISIONS = [
  { value: 'men',         label: "Men's"   },
  { value: 'ladies',      label: 'Ladies'  },
  { value: 'masters',     label: 'Masters' },
  { value: 'juniorBoys',  label: 'Boys'    },
  { value: 'juniorGirls', label: 'Girls'   },
]
export const TEAM_LEVELS = ['1st Team', '2nd Team', '3rd Team']

// A school's effective gender for team naming. Co-ed (or unset) means "ask".
export function schoolGenderProfile(org) {
  return org?.genderProfile ?? 'coed'
}

// Generate a school team name: "[Gender] [Team]" e.g. "Girls U16A".
// Single-gender schools (orgGenderProfile boys/girls) omit the gender prefix.
export function schoolTeamName(gender, teamLabel, orgGenderProfile = 'coed') {
  if (orgGenderProfile === 'boys' || orgGenderProfile === 'girls') {
    return (teamLabel ?? '').replace(/\s+/g, ' ').trim()
  }
  const g = SCHOOL_GENDER_LABEL[gender] ?? ''
  return `${g} ${teamLabel ?? ''}`.replace(/\s+/g, ' ').trim()
}

// Generate a club team name: "[Division] [Team]" e.g. "Men's 1st Team".
export function clubTeamName(division, teamLevel, customLevel) {
  const dLabel = CLUB_DIVISIONS.find(d => d.value === division)?.label ?? ''
  const tLabel = teamLevel === 'custom' ? (customLevel ?? '').trim() : (teamLevel ?? '')
  return `${dLabel} ${tLabel}`.replace(/\s+/g, ' ').trim()
}

// Full competition-facing team label: "[Organisation] [Team]" — e.g.
// "Coastal Girls U12". Org teams always lead with the organisation name; named
// (non-org) entrants have no orgName and render as just the team name. Guards
// against doubling when the team name already starts with the org name.
export function competitionTeamLabel(snapshot) {
  const org  = (snapshot?.orgName  ?? '').trim()
  const team = (snapshot?.teamName ?? '').trim()
  if (!org)  return team
  if (!team) return org
  if (team.toLowerCase().startsWith(org.toLowerCase())) return team
  return `${org} ${team}`
}

// Human-readable label for a stored division/gender value (school or club).
export function divisionLabel(value) {
  return (
    CLUB_DIVISIONS.find(d => d.value === value)?.label ??
    SCHOOL_GENDER_LABEL[value] ??
    value
  )
}

// Normalise an age-group input to canonical form: "U16".
// Accepts variations: "u16", "u 16", "u 16 a", "under 16", "16", "U16 A".
// Any trailing team-level letter is ignored here (it belongs to teamLevel).
export function normalizeAgeGroup(input) {
  if (input == null || input === '') return ''
  const s = String(input).toLowerCase().replace(/\s+/g, '').replace(/^under/, 'u')
  const m = s.match(/u?(\d{1,2})/)
  return m ? `U${m[1]}` : String(input).trim().toUpperCase()
}

// Normalise a team level. A single letter ("a") becomes uppercase ("A"); a
// worded level ("1st Team") is kept with collapsed whitespace.
export function normalizeTeamLevel(input) {
  if (input == null || input === '') return ''
  const s = String(input).trim().replace(/\s+/g, ' ')
  return /^[a-z]$/i.test(s) ? s.toUpperCase() : s
}

// Split a legacy fused school label ("U16A") into structured { age, level }.
// Returns { raw } when it does not look like an age+level label.
function splitLegacyLabel(teamLabel) {
  const s = String(teamLabel ?? '').trim()
  const m = s.match(/^u?\s*(\d{1,2})\s*([a-z])?$/i)
  if (m) return { age: `U${m[1]}`, level: (m[2] ?? '').toUpperCase() }
  return { age: '', level: '', raw: s }
}

// Generate a team's display label ("Girls U16A", "Men's 1st Team") from its
// structured fields, auto-detecting school vs club. Club division may live in
// `division` (current) or `gender` (legacy). School name is built from gender +
// structured ageGroup/teamLevel (current) or the fused teamLabel (legacy).
// Single-gender schools (orgGenderProfile boys/girls) omit the gender prefix.
// Returns '' when there is nothing structured to work with — callers fall back
// to the stored displayName so legacy teams continue to render.
export function generatedTeamName(fields = {}) {
  const { gender, ageGroup, teamLevel, teamLabel, division, orgGenderProfile } = fields ?? {}

  // Club — division (current) or legacy division stored in `gender`.
  const clubDivision = division ?? (CLUB_DIVISIONS.some(d => d.value === gender) ? gender : null)
  if (clubDivision) {
    const level = (teamLabel ?? teamLevel ?? '').trim()
    return clubTeamName(clubDivision, level || null, null)
  }

  // School — build the structured label from ageGroup+teamLevel or legacy fused teamLabel.
  const structured = (ageGroup || teamLevel)
    ? `${normalizeAgeGroup(ageGroup)}${normalizeTeamLevel(teamLevel)}`
    : (teamLabel ?? '').trim()

  // Single-gender schools omit the gender prefix — "U16A" not "Girls U16A".
  if (orgGenderProfile === 'boys' || orgGenderProfile === 'girls') {
    return structured
  }

  const g = SCHOOL_GENDER_LABEL[gender] ?? ''
  if (!g && !structured) return ''
  return `${g} ${structured}`.replace(/\s+/g, ' ').trim()
}

// Deterministic structural key for duplicate prevention. Two inputs that
// describe the same team — regardless of spacing/casing variations ("u16a",
// "U16 A", "under 16 a") — produce the same key. The key is scoped per
// organisation by the caller (one team per organizationId + structuralKey).
//
//   School:  girls + U16 + A      → "girls-u16-a"
//   Club:    mens + 1st Team      → "mens-1st-team"
//   Custom:  "Open Girls"         → "open-girls"
export function teamStructuralKey(fields = {}) {
  const { gender, ageGroup, teamLevel, teamLabel, division, custom } = fields ?? {}

  const clubDivision = division ?? (CLUB_DIVISIONS.some(d => d.value === gender) ? gender : null)
  if (clubDivision) {
    const level = (teamLabel ?? teamLevel ?? '').trim()
    return slugify(`${clubDivision}-${level}`)
  }

  if (custom) return slugify(custom)

  let age = normalizeAgeGroup(ageGroup)
  let level = normalizeTeamLevel(teamLevel)
  if (!age && !level && teamLabel) {
    const sp = splitLegacyLabel(teamLabel)
    if (sp.age) { age = sp.age; level = sp.level }
    else if (sp.raw) return slugify([gender, sp.raw].filter(Boolean).join('-'))
  }
  return slugify([gender, age, level].filter(Boolean).join('-'))
}
