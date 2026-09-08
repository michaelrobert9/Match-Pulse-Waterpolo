// Water-polo cap colour — a REPO-LOCAL extension to the shared naming model.
//
// Water polo commonly fields two teams of the same age group in one club,
// distinguished by cap colour (white vs blue) rather than by a squad letter.
// Colour is OPTIONAL: a team may be just "U14", or "U14 White" / "U14 Blue".
//
// This lives entirely in water-polo code. The canonical teamNaming.js stays
// byte-identical across netball, hockey, rugby and water polo and knows nothing
// about cap colour — everything here wraps its output. When a colour is set it
// is appended to the generated team label AND folded into the structural/band
// key, so two same-level teams of different colour are DISTINCT identities
// (distinct names, distinct match-day bands, distinct duplicate-detection).

import { generatedTeamName, teamStructuralKey } from './teamNaming'

export const TEAM_CAP_COLORS = [
  { value: 'white', label: 'White' },
  { value: 'blue',  label: 'Blue'  },
]
const CAP_COLOR_LABEL = { white: 'White', blue: 'Blue' }

// Human-readable cap-colour word for a stored value ('' when none/unknown).
export function capColorLabel(color) {
  return CAP_COLOR_LABEL[color] ?? ''
}

// Append the cap-colour word to a team label. A blank label or an unknown
// colour leaves it untouched — a colour alone is never a team name.
export function withCapColor(label, color) {
  const base = (label ?? '').replace(/\s+/g, ' ').trim()
  const word = CAP_COLOR_LABEL[color]
  return base && word ? `${base} ${word}` : base
}

// Colour-aware team label: the canonical generated name plus the optional
// colour word. Reads `teamColor` off the same structured fields object.
export function coloredTeamName(fields = {}) {
  return withCapColor(generatedTeamName(fields), fields?.teamColor)
}

// Colour-aware structural/band key: the canonical key plus a colour token, so
// "U14 White" and "U14 Blue" never collide. Falls back to the plain key when no
// colour is set, keeping existing colourless teams' keys unchanged.
export function coloredStructuralKey(fields = {}) {
  const base = teamStructuralKey(fields)
  const color = CAP_COLOR_LABEL[fields?.teamColor] ? fields.teamColor : ''
  return [base, color].filter(Boolean).join('-')
}
