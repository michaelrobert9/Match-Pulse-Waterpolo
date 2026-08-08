// Player of the Match — single source of truth for reading the two storage
// shapes, matching a lineup entry to a POM award, and resolving the display
// colour a competition organiser chose (some competitions award special POM
// socks/shorts in a specific colour; the badge follows suit).

// amber-600 — historical POM colour, kept as the fallback when no competition
// override exists (older matches, friendlies, or an organiser who never picked).
export const POM_DEFAULT_COLOR = '#d97706'

export function pomForSide(match, side) {
  const perTeam = match?.playersOfMatch?.[side]
  if (perTeam?.name) return perTeam
  const single = match?.playerOfMatch
  if (single?.name && single.side === side) return single
  return null
}

export function isLineupEntryPOM(pom, entry) {
  if (!pom || !entry) return false
  if (pom.personId && entry.personId) return pom.personId === entry.personId
  if (pom.name && entry.personName) return pom.name === entry.personName
  return false
}

// Colour resolution order: a competition-configured POM colour wins; otherwise
// the caller may pass the awarded player's TEAM colour as the fallback (general
// fixtures take the team's identity rather than one platform-wide gold); the
// historical amber remains the last resort for legacy data with neither.
export function pomColor(pom, fallback) {
  return pom?.color || fallback || POM_DEFAULT_COLOR
}

export function pomBgTint(pom, fallback) {
  return pomColor(pom, fallback) + '1F'   // ~12% alpha
}
