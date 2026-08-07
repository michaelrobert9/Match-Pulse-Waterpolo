// Derived fixture line-ups (bulk team sheets brief §4).
//
// For tournaments and festivals, the fixture line-up is DERIVED, not stored:
// it equals the competition squad minus exceptions. Nothing is written per
// fixture unless something changes. On freeze (first tracked event or the
// transition to live) the resolved line-up is materialised into the match
// doc's homeLineup/awayLineup — this platform's frozenLineup equivalent —
// and lineupMode flips to 'frozen', after which historical fixtures never
// mutate. Leagues and standalone fixtures never enter this path.
//
// This platform's fixtures are two-sided (one match doc, home + away), so
// exceptions carry a `side` discriminator the brief's single-team model does
// not need: [{ playerId, side, type: 'absent' | 'added', capNumber?, name? }].
// An 'added' exception for a player already in the squad acts as the
// per-fixture cap-number override (§9) — same subtractive/additive model,
// no third exception type.

// True when this match takes its line-ups from the competition squad rather
// than the stored arrays. `competitionType` is the competition's type field.
export function isInheritedLineup(match, competitionType) {
  if (!match) return false
  if (match.lineupMode === 'frozen') return false
  if (!(competitionType === 'tournament' || competitionType === 'festival')) return false
  return true
}

// Resolve one side's line-up: squad − absent + added, sorted by cap number
// (blank caps last, then by name). Returns entries in the platform's lineup
// shape ({ id, personId, personName, shirtNumber, isCaptain, isStarter }) so
// every existing reader — scoring, stats, match page — works unchanged after
// freeze. shirtNumber CARRIES the cap number: the field name is legacy, every
// label says "cap".
export function resolveSideLineup({ squad = [], exceptions = [], side }) {
  const forSide = exceptions.filter(e => e && e.side === side)
  const absent = new Set(forSide.filter(e => e.type === 'absent').map(e => e.playerId))
  const added  = forSide.filter(e => e.type === 'added')
  const overrides = new Map(added.filter(e => e.playerId).map(e => [e.playerId, e]))

  const entries = []
  for (const s of squad) {
    if (!s || absent.has(s.playerId)) continue
    const override = overrides.get(s.playerId)
    entries.push({
      id: `sq-${s.playerId}`,
      personId: s.playerId,
      personName: s.name ?? '',
      shirtNumber: override?.capNumber ?? s.capNumber ?? null,
      isCaptain: s.isCaptain === true,
      isStarter: false,
    })
  }
  const inSquad = new Set(squad.filter(Boolean).map(s => s.playerId))
  for (const e of added) {
    if (!e.playerId || inSquad.has(e.playerId)) continue // squad overrides handled above
    entries.push({
      id: `sq-${e.playerId}`,
      personId: e.playerId,
      personName: e.name ?? '',
      shirtNumber: e.capNumber ?? null,
      isCaptain: false,
      isStarter: false,
    })
  }
  return sortByCap(entries)
}

// Rendered line-ups sort by cap number, the same order as the review grid
// (§9). Blank caps sort after numbered caps, alphabetically.
export function sortByCap(entries) {
  return [...entries].sort((a, b) => {
    const an = a.shirtNumber, bn = b.shirtNumber
    if (an != null && bn != null) return an - bn
    if (an != null) return -1
    if (bn != null) return 1
    return (a.personName ?? '').localeCompare(b.personName ?? '')
  })
}
