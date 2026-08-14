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
// Display format (gender LAST; the dash comes from composeTeamDisplay):
//
//   [name] – [age/level][letter] [gender]
//
//   School (co-ed):  { gender, ageGroup, teamLevel }  girls + U16 + A → "U16A Girls"
//   School (boys):   same fields, single-sex profile omits the word   → "U16A"
//   Club/assoc:      { gender, ageGroup, teamLevel }  men + 1st Team  → "1st Team Men"
//   Legacy division: { division, … } renders identically via clubTeamName
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

// ── Team gender (all organisation types) ─────────────────────────────────────
// Gender is a separate stored field on every team — never folded into a typed
// division string — because the co-ed rule needs to be able to omit it.
// Schools keep boys/girls (taken from the school's profile); clubs and
// associations select from this list.
export const TEAM_GENDERS = [
  { value: 'men',   label: 'Men'   },
  { value: 'women', label: 'Women' },
  { value: 'boys',  label: 'Boys'  },
  { value: 'girls', label: 'Girls' },
  { value: 'mixed', label: 'Mixed' },
]
// Gender word used inside a team name, for every stored gender value.
export const GENDER_LABEL = {
  boys: 'Boys', girls: 'Girls', men: 'Men', women: 'Women', mixed: 'Mixed',
}

// ── Legacy club / association divisions ──────────────────────────────────────
// RETIRED as a selector: club divisions are split into level + gender so all
// organisation types store gender the same way. Kept only to RECOGNISE and
// render division values still sitting on legacy team documents (and to drive
// the one-off split migration). Never rendered as a create option.
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
// Gender word for a legacy division value, used when rendering un-migrated
// teams: the gendered divisions map onto the shared gender vocabulary; the
// legacy masters/open divisions render their rank word until migrated (they
// are RANKS in the new model — see TEAM_LEVELS — with gender picked per team).
const DIVISION_GENDER_WORD = {
  men: 'Men', ladies: 'Women', juniorBoys: 'Boys', juniorGirls: 'Girls',
  masters: 'Masters', open: 'Open', mixed: 'Mixed',
}
// The division→gender mapping the split migration applies. Exported for the
// migration script and the lazy migrate-on-edit path. masters/open are absent
// because they are not genders — the migration moves them onto the level axis
// (DIVISION_TO_RANK) and the team's gender is picked per team as normal.
export const DIVISION_TO_GENDER = {
  men: 'men', ladies: 'women', juniorBoys: 'boys', juniorGirls: 'girls', mixed: 'mixed',
}
// Legacy masters/open divisions become rank values on the level axis.
export const DIVISION_TO_RANK = { masters: 'Masters', open: 'Open' }

// ── Level ─────────────────────────────────────────────────────────────────────
// Senior ordinals, 1st … 10th, plus the Masters and Open rank categories.
// Masters/Open are AGE/RANK values, not gender exceptions — a Masters or Open
// team still picks its gender as normal ("Riverside – Masters Men").
// Identical for schools, clubs and associations.
export const TEAM_LEVELS = [
  '1st Team', '2nd Team', '3rd Team', '4th Team', '5th Team',
  '6th Team', '7th Team', '8th Team', '9th Team', '10th Team',
  'Masters', 'Open',
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

// School team name: "[Level] [Gender]" e.g. "U16A Girls" — gender goes LAST.
// A single-gender school (orgGenderProfile boys/girls) omits the gender word —
// the school identity already carries it — so "U16A", not "U16A Girls". An
// unset profile falls through to showing the gender (default to showing).
// THE CO-ED GENDER RULE LIVES IN THIS GATE — do not change the condition.
export function schoolTeamName(gender, levelFields, orgGenderProfile = null) {
  const level = levelLabel(levelFields)
  if (orgGenderProfile === 'boys' || orgGenderProfile === 'girls') {
    return level.replace(/\s+/g, ' ').trim()
  }
  const g = GENDER_LABEL[gender] ?? ''
  return `${level} ${g}`.replace(/\s+/g, ' ').trim()
}

// Legacy club / association team name from an un-migrated division value:
// "[Level] [Gender word]" e.g. "1st Team Men". Same order as the shared rule
// so legacy and migrated teams read identically.
export function clubTeamName(division, levelFields) {
  const word  = DIVISION_GENDER_WORD[division] ?? divisionLabel(division)
  const level = levelLabel(levelFields)
  return `${level} ${word}`.replace(/\s+/g, ' ').trim()
}

// ── Display composition ───────────────────────────────────────────────────────
// The one place the display format lives:
//
//   [name] – [age/level][letter] [gender]
//
// The dash separates the name portion (team name → org match name → org full
// name) from the division part. If there is no division part, drop the dash
// and show the name alone; a division part with no name renders alone too.
export function composeTeamDisplay(namePortion, teamLabel) {
  const name  = (namePortion ?? '').trim()
  const label = (teamLabel ?? '').trim()
  if (!name)  return label
  if (!label) return name
  return `${name} – ${label}`
}

// Full competition-facing team label: "[Organisation] – [Team]" — e.g.
// "Coastal – U12 Girls". Org teams lead with the organisation name; named
// (non-org) entrants have no orgName and render as just the team name. Guards
// against doubling when the team name already starts with the org name.
export function competitionTeamLabel(snapshot) {
  const org  = (snapshot?.orgName  ?? '').trim()
  const team = (snapshot?.teamName ?? '').trim()
  if (team.toLowerCase().startsWith(org.toLowerCase()) && org) return team
  return composeTeamDisplay(org, team)
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
