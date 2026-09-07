// Season + record aggregation shared by the team page (TeamDetail) and the
// school/org overview (OrgDetail). Kept in one place so both read a match's
// season the same way and can never drift apart.
import { toDate } from './queries'

// A match's season: its explicit season field, else the calendar year of its
// scheduled date. Regular-season matches often carry no season field (only
// competition-linked matches inherit one from their competition), so without
// the date fallback they are silently dropped from season aggregates even
// though they count toward all-time.
export function matchSeason(m) {
  if (m?.season != null && String(m.season) !== '') return String(m.season)
  const d = toDate(m?.scheduledAt)
  return d ? String(d.getFullYear()) : null
}

// Win/loss/draw + score for/against for a team across an (optionally
// season-filtered) set of final matches. The score total is returned under
// sport-neutral scoreFor/scoreAgainst plus goalsFor/goalsAgainst and
// pointsFor/pointsAgainst aliases (same numbers), so each sport's stat grid can
// read whichever label it uses without this module needing to know the sport.
export function computeTeamStats(matches, teamId, season = null) {
  let played = 0, won = 0, lost = 0, drawn = 0, scoreFor = 0, scoreAgainst = 0
  for (const m of matches) {
    if (m.status !== 'final') continue
    if (season != null && matchSeason(m) !== String(season)) continue
    const isHome = m.homeTeamId === teamId
    const teamS  = isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0)
    const oppS   = isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0)
    played++; scoreFor += teamS; scoreAgainst += oppS
    if (teamS > oppS) won++
    else if (teamS < oppS) lost++
    else drawn++
  }
  return {
    played, won, lost, drawn,
    scoreFor, scoreAgainst,
    goalsFor: scoreFor, goalsAgainst: scoreAgainst,
    pointsFor: scoreFor, pointsAgainst: scoreAgainst,
  }
}

// The most recent season present in a set of final matches (string), or null.
export function latestSeason(matches) {
  const seasons = [...new Set(
    matches.filter(m => m.status === 'final').map(matchSeason).filter(Boolean)
  )]
  return seasons.sort().reverse()[0] ?? null
}
