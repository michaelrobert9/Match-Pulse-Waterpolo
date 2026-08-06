// Player of the Match — single source of truth for reading the two storage
// shapes, matching a lineup entry to a POTM award, and resolving the display
// colour a competition organiser chose (some competitions award special POTM
// socks/shorts in a specific colour; the badge follows suit).

// amber-600 — historical POTM colour, kept as the fallback when no competition
// override exists (older matches, friendlies, or an organiser who never picked).
export const POTM_DEFAULT_COLOR = '#d97706'

export function POTMForSide(match, side) {
  const perTeam = match?.playersOfMatch?.[side]
  if (perTeam?.name) return perTeam
  const single = match?.playerOfMatch
  if (single?.name && single.side === side) return single
  return null
}

export function isLineupEntryPOTM(POTM, entry) {
  if (!POTM || !entry) return false
  if (POTM.personId && entry.personId) return POTM.personId === entry.personId
  if (POTM.name && entry.personName) return POTM.name === entry.personName
  return false
}

export function POTMColor(POTM) {
  return POTM?.color || POTM_DEFAULT_COLOR
}
export function POTMBgTint(POTM) {
  return POTMColor(POTM) + '1F'   // ~12% alpha
}
