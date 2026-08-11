// Day-tally computation for a fixture group (fixture-groups brief §"Day tally"
// and §"Derived, not stored"). Computed on read from the child fixtures — never
// stored on the group document. Same discipline as standings.
//
// CANONICAL — authored by netball and copied VERBATIM into hockey, rugby and
// water polo, like teamAccent.js and pom.js. Self-contained: no imports. Keep
// byte-identical across the four repos.
//
// Each child is read from the GROUP's orientation: `homeScore` is the group
// home school's score (the create flow always writes children with the group's
// home school as the fixture home). A child is:
//   { status, homeScore, awayScore }
//   status: 'scheduled' | 'live' | 'paused' | 'final' | 'postponed' | 'cancelled'
// The noun for a scoreline / aggregate, by sport. Sport vocabulary is a
// parameter, never a fork: this keeps MatchGroupPage byte-identical across all
// four repos while rugby reads "Points" and the goal sports read "Goals".
export function scoreNoun(sport) {
  return sport === 'rugby' ? 'Points' : 'Goals'
}

export function computeTally(children = []) {
  let homeWins = 0, draws = 0, awayWins = 0, played = 0, live = 0
  let goalsFor = 0, goalsAgainst = 0, counting = 0

  for (const f of children) {
    const status = f?.status
    if (status === 'live' || status === 'paused') live++
    // Postponed / cancelled children don't count toward the day, but a
    // scheduled one still does (it's "to play").
    if (status === 'postponed' || status === 'cancelled') continue
    counting++
    if (status !== 'final') continue
    played++
    const hs = Number(f.homeScore ?? 0)
    const as = Number(f.awayScore ?? 0)
    goalsFor += hs
    goalsAgainst += as
    if (hs > as) homeWins++
    else if (hs < as) awayWins++
    else draws++
  }

  const toPlay = counting - played
  // Group status: live if any child is live; final only once every counting
  // child has been played; otherwise scheduled.
  const status = live > 0
    ? 'live'
    : (counting > 0 && played === counting ? 'final' : 'scheduled')

  return {
    total: counting,   // children that count toward the day (excludes postponed/cancelled)
    played,
    toPlay,
    homeWins,
    draws,
    awayWins,
    goalsFor,
    goalsAgainst,
    live,
    status,
  }
}
