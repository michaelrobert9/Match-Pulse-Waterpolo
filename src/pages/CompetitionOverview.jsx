import { useEffect, useState } from 'react'
import { ChevronRight, Star, Trophy } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchCompetition, fetchCompetitionTeams,
  fetchCompetitionFixtures, fetchCompetitionTopScorers, fetchCompetitionTopPOTM, toDate,
  fetchCompetitionByPath, fetchCompetitionBySlugSeason,
  fetchCompetitionPools, fetchCompetitionKnockout,
  fetchCompetitionMembers, fetchCompetitionFixtureMembers, fetchCompetitionAdvancement,
} from '../lib/queries'
import { isScheduled } from '../lib/fixtureStatus'
import { computeStandings, computePoolStandings } from '../lib/standings'
import { resolveBracket, computeBestPlacedAtPosition, bracketPodium, knockoutResult } from '../lib/competitionStructure'
import { BRONZE_ROUND_LABEL } from '../lib/playoffs'
import { competitionTeamLabel } from '../lib/teamNaming'
import { matchUrl, competitionUrl } from '../lib/slugify'
import { prefetchMatchTeams } from '../lib/teamIdentity'
import { MatchTeamIdentity, MatchTeamCrest } from '../components/TeamIdentity'
import CompetitionNav from '../components/CompetitionNav'
import { useSeoMeta } from '../lib/useSeoMeta'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

function fmtShortDate(val) {
  const d = toDate(val)
  if (!d) return 'TBD'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

export default function CompetitionOverview() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [competition, setCompetition] = useState(null)
  useSeoMeta({ type: 'competition', entity: competition })
  const [teams,       setTeams]       = useState([])
  const [scorers,     setScorers]     = useState([])
  const [potmLeaders, setPotmLeaders] = useState([])
  const [fixtures,    setFixtures]    = useState([])
  const [pools,       setPools]       = useState([])
  const [knockout,    setKnockout]    = useState([])
  const [members,     setMembers]     = useState([])
  const [fxMembers,   setFxMembers]   = useState([])
  const [advancement, setAdvancement] = useState([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    const compPromise = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : series
      ? fetchCompetitionByPath(`${series}/${ageGroup}/${season}`)
      : fetchCompetition(id)

    compPromise.then(comp => {
      if (!comp) { setLoading(false); return }
      setCompetition(comp)
      return Promise.all([
        fetchCompetitionTeams(comp.id),
        comp.type !== 'festival' ? fetchCompetitionTopScorers(comp.id, 5) : Promise.resolve([]),
        fetchCompetitionFixtures(comp.id),
        comp.rules?.potm?.enabled ? fetchCompetitionTopPOTM(comp.id, 5) : Promise.resolve([]),
        comp.type !== 'festival' ? fetchCompetitionPools(comp.id) : Promise.resolve([]),
        comp.type !== 'festival' ? fetchCompetitionKnockout(comp.id) : Promise.resolve([]),
        comp.type !== 'festival' ? fetchCompetitionMembers(comp.id) : Promise.resolve([]),
        comp.type !== 'festival' ? fetchCompetitionFixtureMembers(comp.id) : Promise.resolve([]),
        comp.type !== 'festival' ? fetchCompetitionAdvancement(comp.id) : Promise.resolve([]),
      ])
    }).then(results => {
      if (!results) return
      const [t, s, f, p, pl, ko, mem, fxm, adv] = results
      prefetchMatchTeams(f)
      setTeams(t); setScorers(s); setFixtures(f); setPotmLeaders(p)
      setPools(pl ?? []); setKnockout(ko ?? [])
      setMembers(mem ?? []); setFxMembers(fxm ?? []); setAdvancement(adv ?? [])
    }).finally(() => setLoading(false))
  }, [id, series, ageGroup, season, competitionSlug])

  if (loading) return <Spinner />
  if (!competition) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  const isFestival = competition.type === 'festival'
  // Festivals show a focused snapshot: one most-recent result + one next fixture.
  const recentN   = isFestival ? 1 : 3
  const upcomingN = isFestival ? 1 : 3
  const live     = fixtures.filter(m => m.status === 'live')
  const recent   = fixtures.filter(m => m.status === 'final').slice(-recentN).reverse()
  const upcoming = fixtures.filter(isScheduled).slice(0, upcomingN)

  // Standings preview — computed from scratch off the Final fixtures via the
  // single standings engine (spec §9), NOT read from incremental team-doc
  // counters (which have been removed). We adapt the already-loaded teams +
  // match docs into the engine's member/fixture shapes — no extra fetches.
  const previewRows = (() => {
    if (isFestival || teams.length === 0) return []
    const members = teams.map(t => ({
      teamId: t.id, status: 'accepted',
      displaySnapshot: { teamName: t.displayName, orgName: t.orgName },
    }))
    const fxShim = fixtures.map(m => ({
      matchId: m.id, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
      countsTowardStandings: true,
    }))
    try {
      return computeStandings(competition, members, fxShim, fixtures).rows
    } catch {
      return []
    }
  })()
  const teamColorById = Object.fromEntries(teams.map(t => [t.id, t.primaryColor]))

  // Final positions are only "official" once every pool has been VERIFIED — the
  // organiser's explicit "these standings are final" action (which itself now
  // requires every fixture scored). A competition whose final placings are
  // decided by a playoff bracket is NOT shown here — its winner lives on the
  // Playoffs page — so we require no knockout. Until then the provisional
  // preview (below) is shown instead, never a "final" result.
  const positionsFinal = !isFestival && knockout.length === 0 &&
    pools.length > 0 && pools.every(p => p.verified) && previewRows.length > 0

  const PODIUM = [
    { label: '1st', ring: '#f59e0b', bg: 'bg-amber-50',   text: 'text-amber-700'  },
    { label: '2nd', ring: '#94a3b8', bg: 'bg-slate-100',  text: 'text-slate-600'  },
    { label: '3rd', ring: '#f97316', bg: 'bg-orange-50',  text: 'text-orange-700' },
  ]

  // Knockout champion podium — resolve the bracket exactly like the Playoffs
  // page (from pool standings + played results), then read the final placings
  // from the RESOLVED slots. This names the champion even when the final fixture
  // has no teams stamped on it, and appears the moment the final is decided.
  const koRows = (() => {
    if (isFestival || knockout.length === 0) return []
    try {
      const matchesById = Object.fromEntries(fixtures.map(f => [f.id, f]))
      const poolsCtx = {}, poolStandings = {}
      for (const pool of pools) {
        const pf = fxMembers.filter(f => f.poolId === pool.poolId)
        const poolTeamIds = (pool.slots ?? []).map(s => s.teamId).filter(Boolean)
        poolStandings[pool.poolId] = computePoolStandings(competition, members, pf, matchesById, { poolTeamIds, manualOverrides: pool.manualOverrides ?? [] })
        poolsCtx[pool.poolId] = { rows: poolStandings[pool.poolId].rows, verified: !!pool.verified }
      }
      const maxPoolSize = Math.max(0, ...pools.map(p => (poolStandings[p.poolId]?.rows?.length ?? (p.slots ?? []).length ?? 0)))
      const maxRefPos   = Math.max(0, ...knockout.map(s => Number(s.source?.position) || 0))
      const maxPos = Math.max(maxPoolSize, maxRefPos, 1)
      const bestPlaced = {}
      for (let pos = 1; pos <= maxPos; pos++) {
        bestPlaced[pos] = computeBestPlacedAtPosition(
          pools.map(p => ({ poolId: p.poolId, verified: !!p.verified, rows: poolStandings[p.poolId]?.rows ?? [] })),
          pos, competition.rules?.tieBreakers ?? [])
      }
      const bracketResults = {}
      for (const slot of knockout) {
        if (slot.matchId && matchesById[slot.matchId]) {
          const r = knockoutResult(matchesById[slot.matchId])
          if (r) bracketResults[slot.slotId] = r
        }
      }
      const lockedTeams = {}
      for (const a of advancement) lockedTeams[a.slotId] = a.teamId
      const resolved = resolveBracket(knockout, { pools: poolsCtx, bestPlaced, bracketResults, lockedTeams })
      const podium = bracketPodium({ knockout, resolved, matches: matchesById, bronzeLabel: BRONZE_ROUND_LABEL })
      if (!podium) return []
      const nameColor = tid => {
        const t = teams.find(x => x.id === tid)
        const m = members.find(x => x.teamId === tid)
        const name = t ? (t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName)
          : (m ? competitionTeamLabel(m.displaySnapshot) : tid)
        return { teamId: tid, name: name || tid, color: t?.primaryColor ?? m?.displaySnapshot?.primaryColor ?? null }
      }
      return [
        { ...nameColor(podium.first),  caption: 'Champions' },
        { ...nameColor(podium.second), caption: 'Runner-up' },
        ...(podium.third ? [{ ...nameColor(podium.third), caption: '3rd place' }] : []),
      ].filter(r => r.teamId)
    } catch {
      return []
    }
  })()

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />

      <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-6">

        {/* Champions — knockout final positions, shown the moment the final is
            decided (3rd place fills in when its play-off is decided). */}
        {koRows.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <div className="micro-label text-slate-500">Final positions</div>
            </div>
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-500" />
              {/* Champion — pronounced, gold */}
              <div className="flex items-center gap-3.5 px-5 py-5 bg-gradient-to-b from-amber-50 to-white">
                <span className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 font-mono font-black text-lg"
                  style={{ border: '2px solid #f59e0b' }}>1</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-amber-600">Champions</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: koRows[0].color }} />
                    <span className="text-slate-900 font-black text-xl leading-tight truncate">{koRows[0].name}</span>
                  </div>
                </div>
              </div>
              {/* Runner-up (silver) + 3rd — existing sizing */}
              {koRows.slice(1).map((row, idx) => {
                const i = idx + 1
                const p = PODIUM[i]
                return (
                  <div key={row.teamId} className="flex items-center gap-3 px-5 py-3 border-t border-slate-100">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-mono font-black text-[11px] ${p.bg} ${p.text}`}
                      style={{ border: `1.5px solid ${p.ring}` }}>{i + 1}</span>
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: row.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-900 text-sm font-semibold truncate">{row.name}</div>
                      <div className={`text-[10px] font-bold uppercase tracking-widest ${p.text}`}>{row.caption}</div>
                    </div>
                  </div>
                )
              })}
              {knockout.length > 0 && (
                <Link to={competitionUrl(competition) + '/knockout'}
                  className="block text-center text-[11px] text-emerald-600 hover:text-emerald-500 py-2.5 border-t border-slate-100 transition-colors">
                  Full bracket →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Final standings — shown ONLY once positions are official (all pools
            verified, no playoff pending). A celebratory podium of the top three. */}
        {positionsFinal && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <div className="micro-label text-slate-500">Final standings</div>
            </div>
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-500" />
              {previewRows.slice(0, 3).map((row, i) => {
                const p = PODIUM[i]
                const name = row.orgName ? `${row.orgName} ${row.teamName}` : row.teamName
                if (i === 0) return (
                  <div key={row.teamId} className="flex items-center gap-3.5 px-5 py-5 bg-gradient-to-b from-amber-50 to-white">
                    <span className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 font-mono font-black text-lg"
                      style={{ border: '2px solid #f59e0b' }}>1</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-amber-600">Champions</span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: teamColorById[row.teamId] }} />
                        <span className="text-slate-900 font-black text-xl leading-tight truncate">{name}</span>
                      </div>
                    </div>
                    <span className="font-mono font-black text-emerald-600 text-lg tabular-nums shrink-0">{row.Pts ?? 0}<span className="text-[10px] font-normal text-slate-400 ml-0.5">pts</span></span>
                  </div>
                )
                return (
                  <div key={row.teamId} className="flex items-center gap-3 px-5 py-3 border-t border-slate-100">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-mono font-black text-[11px] ${p.bg} ${p.text}`}
                      style={{ border: `1.5px solid ${p.ring}` }}>{i + 1}</span>
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: teamColorById[row.teamId] }} />
                    <div className="flex-1 min-w-0 text-slate-900 text-sm font-semibold truncate">{name}</div>
                    <span className="font-mono font-black text-emerald-600 text-sm tabular-nums shrink-0">{row.Pts ?? 0}<span className="text-[10px] font-normal text-slate-400 ml-0.5">pts</span></span>
                  </div>
                )
              })}
              <Link to={competitionUrl(competition) + '/standings'}
                className="block text-center text-[11px] text-emerald-600 hover:text-emerald-500 py-2.5 border-t border-slate-100 transition-colors">
                Full final standings →
              </Link>
            </div>
          </div>
        )}

        {/* Live alert */}
        {live.map(match => (
          <Link key={match.id} to={matchUrl(match)}
            className="block bg-red-50 border border-red-200 rounded-xl p-4 hover:border-red-300 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-red-600 text-[10px] font-bold uppercase tracking-widest">Live</span>
              {match.pitch && <span className="text-slate-500 text-[10px]">· {match.pitch}</span>}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <MatchTeamCrest match={match} side="home" size={28} />
                <MatchTeamIdentity match={match} side="home" hideIdentifier
                  nameClass="text-slate-900 text-sm font-semibold" />
              </div>
              <span className="font-mono font-black text-slate-900 text-lg tabular-nums shrink-0">
                {match.homeScore}–{match.awayScore}
              </span>
              <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                <MatchTeamIdentity match={match} side="away" hideIdentifier align="right"
                  nameClass="text-slate-900 text-sm font-semibold" />
                <MatchTeamCrest match={match} side="away" size={28} />
              </div>
            </div>
          </Link>
        ))}

        {/* Quick stats — hidden for festivals (informational-only, no counts card) */}
        {!isFestival && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: teams.length, label: 'Teams' },
              { value: fixtures.filter(m => m.status === 'final').length, label: 'Played' },
              { value: fixtures.filter(isScheduled).length, label: 'Remaining' },
            ].map(({ value, label }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                <div className="font-mono font-black text-2xl text-emerald-600 tabular-nums">{value}</div>
                <div className="micro-label mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Top scorers */}
        {scorers.length > 0 && competition.type !== 'festival' && (
          <div>
            <div className="micro-label text-slate-500 mb-3">Top scorers</div>
            <div className="space-y-2">
              {scorers.map((player, i) => (
                <div key={player.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
                  <span className="font-mono font-bold text-slate-400 text-xs w-4 shrink-0 text-right">{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: player.teamPrimaryColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 text-sm font-semibold truncate">{player.personName}</div>
                    <div className="micro-label">{player.teamDisplayName} · {player.position}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-black text-emerald-600 text-xl tabular-nums">{player.goals}</div>
                    <div className="micro-label">goals</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top POTM — only shown when feature enabled and there are results */}
        {competition.rules?.potm?.enabled && potmLeaders.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              <div className="micro-label text-slate-500">Player of the Match</div>
            </div>
            <div className="space-y-2">
              {potmLeaders.map((leader, i) => (
                <div key={leader.key} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
                  <span className="font-mono font-bold text-slate-400 text-xs w-4 shrink-0 text-right">{i + 1}</span>
                  {leader.teamColor && (
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: leader.teamColor }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 text-sm font-semibold truncate">{leader.name}</div>
                    {leader.teamName && <div className="micro-label">{leader.teamName}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-black text-amber-500 text-xl tabular-nums">{leader.count}</div>
                    <div className="micro-label">{leader.count === 1 ? 'award' : 'awards'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent results */}
        {recent.length > 0 && (
          <div>
            <div className="micro-label text-slate-500 mb-3">{isFestival ? 'Latest result' : 'Recent results'}</div>
            <div className="space-y-2">
              {recent.map(match => (
                <Link key={match.id} to={matchUrl(match)}
                  className="flex items-stretch gap-2 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
                  <div className="flex items-start gap-1.5 flex-1 min-w-0">
                    <MatchTeamCrest match={match} side="home" size={24} className="mt-0.5" />
                    <MatchTeamIdentity match={match} side="home" hideIdentifier
                      nameClass="text-slate-900 text-sm font-semibold" />
                  </div>
                  <div className="shrink-0 w-16 flex flex-col items-center justify-center text-center">
                    <span className="font-mono font-black text-slate-900 tabular-nums">{match.homeScore}–{match.awayScore}</span>
                    <span className="micro-label mt-0.5">{fmtShortDate(match.scheduledAt)}</span>
                  </div>
                  <div className="flex items-start gap-1.5 flex-1 min-w-0 justify-end">
                    <MatchTeamIdentity match={match} side="away" hideIdentifier align="right"
                      nameClass="text-slate-900 text-sm font-semibold" />
                    <MatchTeamCrest match={match} side="away" size={24} className="mt-0.5" />
                  </div>
                </Link>
              ))}
            </div>
            <Link to={competitionUrl(competition) + '/fixtures'}
              className="block text-center text-[11px] text-emerald-600 hover:text-emerald-500 mt-3 transition-colors">
              All fixtures →
            </Link>
          </div>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div>
            <div className="micro-label text-slate-500 mb-3">{isFestival ? 'Next fixture' : 'Coming up'}</div>
            <div className="space-y-2">
              {upcoming.map(match => (
                <Link key={match.id} to={matchUrl(match)}
                  className="flex items-stretch gap-2 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
                  <div className="flex items-start gap-1.5 flex-1 min-w-0">
                    <MatchTeamCrest match={match} side="home" size={24} className="mt-0.5" />
                    <MatchTeamIdentity match={match} side="home" hideIdentifier
                      nameClass="text-slate-900 text-sm font-semibold" />
                  </div>
                  <div className="shrink-0 w-16 flex flex-col items-center justify-center text-center">
                    <span className="font-mono font-bold text-slate-400 text-sm">vs</span>
                    <span className="micro-label mt-0.5">{fmtShortDate(match.scheduledAt)}</span>
                  </div>
                  <div className="flex items-start gap-1.5 flex-1 min-w-0 justify-end">
                    <MatchTeamIdentity match={match} side="away" hideIdentifier align="right"
                      nameClass="text-slate-900 text-sm font-semibold" />
                    <MatchTeamCrest match={match} side="away" size={24} className="mt-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Standings preview — provisional, shown WHILE the competition is still
            being decided (positions not yet final). Never for festivals. */}
        {!positionsFinal && koRows.length === 0 && previewRows.length > 0 && (
          <Link to={competitionUrl(competition) + '/standings'}
            className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-4 hover:border-slate-300 transition-colors shadow-sm">
            <div className="flex-1 space-y-1.5">
              {previewRows.slice(0, 3).map((row, i) => (
                <div key={row.teamId} className="flex items-center gap-2">
                  <span className="micro-label w-3 text-right shrink-0">{i + 1}</span>
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: teamColorById[row.teamId] }} />
                  <span className="text-slate-900 text-xs flex-1 truncate">{row.orgName ? `${row.orgName} ${row.teamName}` : row.teamName}</span>
                  <span className="font-mono font-bold text-emerald-600 text-xs">{row.Pts ?? 0}pts</span>
                </div>
              ))}
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
          </Link>
        )}

      </div>
    </div>
  )
}
