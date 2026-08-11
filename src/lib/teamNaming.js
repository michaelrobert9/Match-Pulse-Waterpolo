// Structured team-naming model — the single governance model shared by schools,
// clubs and associations.
//
//   School            >  Gender (from the school)  >  Level
//   Club / Association >  Division                  >  Level
//
// The LEVEL selector is IDENTICAL for every organisation type. A team is either:
//   • a senior side  — an ordinal, "1st Team" … "10th Team"  (ageGroup empty), or
//   • an age side    — an age group + a letter, "U14" + "A"  → "U14A".
//
// Schools take their gender FROM THE SCHOOL: a single-gender school applies its
// gender automatically and is never asked; a co-ed school chooses Boys or Girls
// per team (which is what lets a co-ed school hold both "Boys U14A" and
// "Girls U14A"). Clubs and associations instead pick a division (Men's, Ladies,
// Masters, Open, Boys, Girls…) that sits on top of the same level selector.
//
// Everything is stored as STRUCTURED FIELDS — there is no free-text path. Names
// are generated from the fields, never parsed back out of a label, so seniority
// ordering and duplicate detection read the fields directly.
//
//   School:  { gender, ageGroup, teamLevel }   girls + U16 + A     → "Girls U16A"
//   Club:    { division, ageGroup, teamLevel }  men + '' + 1st Team → "Men's 1st Team"
//
// CANONICAL — this file is shared byte-identical across netball, hockey, rugby
// and water polo. Keep it self-contained apart from the local slugify import.

import { slugify } from './slugify'

// ── School gender ─────────────────────────────────────────────────────────────
export const SCHOOL_GENDER_PROFILES = [
  { value: 'boys',  label: 'Boys only' },
  { value: 'girls', label: 'Girls only' },
  { value: 'coed',  label: 'Co-ed' },
]
// Gender word used inside a school team name.
export const SCHOOL_GENDER_LABEL = { boys: 'Boys', girls: 'Girls' }

// A school's stored gender profile, or null when it has not been set. There is
// NO default — an unset profile must block team creation rather than silently
// assume co-ed, so an unset school never ends up with the wrong-gender teams.
export function schoolGenderProfile(org) {
  const p = org?.genderProfile
  return (p === 'boys' || p === 'girls' || p === 'coed') ? p : null
}

// ── Club / association division ───────────────────────────────────────────────
// The selectable divisions. Masters and Open live here as first-class selector
// values (they are never free-typed level names).
export const CLUB_DIVISIONS = [
  { value: 'men',         label: "Men's"   },
  { value: 'ladies',      label: 'Ladies'  },
  { value: 'masters',     label: 'Masters' },
  { value: 'open',        label: 'Open'    },
  { value: 'juniorBoys',  label: 'Boys'    },
  { value: 'juniorGirls', label: 'Girls'   },
]
// Every value ever accepted on a club/association team, including the legacy
// 'mixed' division. Used only to RECOGNISE a division sitting in the legacy
// `gender` field — never rendered as a create option.
const CLUB_DIVISION_VALUES = new Set([
  ...CLUB_DIVISIONS.map(d => d.value), 'mixed',
])

// ── Level ─────────────────────────────────────────────────────────────────────
// Senior ordinals, 1st … 10th. Identical for schools, clubs and associations.
export const TEAM_LEVELS = [
  '1st Team', '2nd Team', '3rd Team', '4th Team', '5th Team',
  '6th Team', '7th Team', '8th Team', '9th Team', '10th Team',
]
// Age-side letters, A … J.
export const TEAM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
// Age groups. Schools stop at U19; clubs and associations may also field U21.
export const AGE_GROUPS_SCHOOL = ['U19', 'U18', 'U17', 'U16', 'U15', 'U14', 'U13', 'U12', 'U11', 'U10', 'U9', 'U8']
export const AGE_GROUPS_CLUB   = ['U21', ...AGE_GROUPS_SCHOOL]

// Age groups offered for an org type ('school' → up to U19, else up to U21).
export function ageGroupsFor(orgType) {
  return orgType === 'school' ? AGE_GROUPS_SCHOOL : AGE_GROUPS_CLUB
}

// ── Field readers (structured only, no parsing) ───────────────────────────────

// The division sitting on a team: the current `division` field, else a legacy
// division value stored in `gender`. Null for school teams.
export function teamDivision(fields = {}) {
  const { division, gender } = fields ?? {}
  if (division) return division
  if (gender && CLUB_DIVISION_VALUES.has(gender)) return gender
  return null
}

// Whether a team is an age side (has an age group) vs a senior side.
export function isAgeTeam(fields = {}) {
  return !!(fields?.ageGroup)
}

// The level portion of a team's label, from its structured fields:
//   age side    → "U14A"  (ageGroup + letter)
//   senior side → "1st Team" (ordinal)
export function levelLabel(fields = {}) {
  const { ageGroup, teamLevel } = fields ?? {}
  if (ageGroup) return `${ageGroup}${(teamLevel ?? '').trim()}`.trim()
  return (teamLevel ?? '').trim()
}

// ── Name generation ───────────────────────────────────────────────────────────

// School team name: "[Gender] [Level]" e.g. "Girls U16A". A single-gender school
// (orgGenderProfile boys/girls) omits the gender word — the school identity
// already carries it — so "U16A", not "Girls U16A".
export function schoolTeamName(gender, levelFields, orgGenderProfile = null) {
  const level = levelLabel(levelFields)
  if (orgGenderProfile === 'boys' || orgGenderProfile === 'girls') {
    return level.replace(/\s+/g, ' ').trim()
  }
  const g = SCHOOL_GENDER_LABEL[gender] ?? ''
  return `${g} ${level}`.replace(/\s+/g, ' ').trim()
}

// Club / association team name: "[Division] [Level]" e.g. "Men's 1st Team".
export function clubTeamName(division, levelFields) {
  const dLabel = divisionLabel(division)
  const level  = levelLabel(levelFields)
  return `${dLabel} ${level}`.replace(/\s+/g, ' ').trim()
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

// Human-readable label for a stored division/gender value.
export function divisionLabel(value) {
  return (
    CLUB_DIVISIONS.find(d => d.value === value)?.label ??
    SCHOOL_GENDER_LABEL[value] ??
    (value ?? '')
  )
}

// Generate a team's display label ("Girls U16A", "Men's 1st Team") from its
// structured fields, auto-detecting school vs club/association. Returns '' when
// there is nothing structured to work with — callers fall back to the stored
// displayName so any not-yet-migrated team still renders.
export function generatedTeamName(fields = {}) {
  const { gender, orgGenderProfile } = fields ?? {}
  const division = teamDivision(fields)
  if (division) return clubTeamName(division, fields)
  return schoolTeamName(gender, fields, orgGenderProfile)
}

// ── Structural key (duplicate prevention) ─────────────────────────────────────
// Deterministic key scoped per organisation (one team per organizationId +
// structuralKey). Built from the structured fields only.
//
//   School:  girls + U16 + A   → "girls-u16-a"
//   Club:    men + 1st Team    → "men-1st-team"
export function teamStructuralKey(fields = {}) {
  const { gender, ageGroup, teamLevel } = fields ?? {}
  const division = teamDivision(fields)
  const axis = division || gender || ''
  const level = ageGroup
    ? `${ageGroup}-${(teamLevel ?? '').trim()}`
    : (teamLevel ?? '').trim()
  return slugify([axis, level].filter(Boolean).join('-'))
}

// ── Seniority descriptor ──────────────────────────────────────────────────────
// A fully-numeric descriptor for the CANONICAL seniority sort (see seniority.js).
// Built here, where the level vocabulary lives, so seniority.js never parses a
// string. Order intent, most senior first:
//   1. Senior ordinals ascending (1st, 2nd, …)
//   2. Age bands descending (U19, U18, …)
//   3. Within a band, letters ascending (A, B, …)
//
//   group 0 = senior side, `number` = ordinal (1..10)
//   group 1 = age side,    `age` = years, `letter` = 1..10 (A=1)
//   group 2 = unrecognised (sorts last)
export function seniorityDescriptor(fields = {}) {
  const { gender, ageGroup, teamLevel } = fields ?? {}
  const g = teamDivision(fields) || gender || ''

  if (ageGroup) {
    const age = ageToNumber(ageGroup)
    const letter = letterToIndex(teamLevel)
    if (age) return { group: 1, number: 0, age, letter, gender: g }
  } else {
    const number = ordinalToNumber(teamLevel)
    if (number) return { group: 0, number, age: 0, letter: 0, gender: g }
  }
  return { group: 2, number: 0, age: 0, letter: 0, gender: g }
}

// Years from a canonical age group ("U14" → 14). Enum-only, not a display parse.
function ageToNumber(ageGroup) {
  const m = /^u(\d{1,2})$/i.exec(String(ageGroup ?? '').trim())
  return m ? parseInt(m[1], 10) : 0
}
// Letter index ("A" → 1, "B" → 2 … "J" → 10). 0 when absent/unknown.
function letterToIndex(letter) {
  const i = TEAM_LETTERS.indexOf(String(letter ?? '').trim().toUpperCase())
  return i < 0 ? 0 : i + 1
}
// Ordinal number from a level ("1st Team" → 1 … "10th Team" → 10). 0 when unknown.
function ordinalToNumber(teamLevel) {
  const i = TEAM_LEVELS.indexOf(String(teamLevel ?? '').trim())
  return i < 0 ? 0 : i + 1
}
