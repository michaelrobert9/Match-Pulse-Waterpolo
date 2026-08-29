import { useEffect, useState } from 'react'
import { Star, Trophy } from 'lucide-react'
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
import { resolveBracket, computeBestPlacedAtPosition, bracketPodium, bracketFinalStandings, knockoutResult } from '../lib/competitionStructure'
import { BRONZE_ROUND_LABEL } from '../lib/playoffs'
import { competitionTeamLabel } from '../lib/teamNaming'
import { matchUrl, competitionUrl } from '../lib/slugify'
import { prefetchMatchTeams } from '../lib/teamIdentity'
import { MatchTeamIdentity, MatchTeamCrest } from '../components/TeamIdentity'
import CompetitionNav from '../components/CompetitionNav'
import { useSeoMeta } from '../lib/useSeoMeta'
import { useAuth } from '../contexts/AuthContext'
import { competitionViewableBy } from '../lib/competitionRules'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

function ordinalLabel(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function fmtShortDate(val) {
  const d = toDate(val)
  if (!d) return 'TBD'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

export default function CompetitionOverview() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const auth = useAuth()
  const [competition, setCompetition] = useState(null)
  useSeoMeta({ type: 'competition', entity: competition })
  const [teams,       setTeams]       = useState([])
  const [scorers,     setScorers]     = useState([])
  const [potmLeaders, setPotmLeaders] = useState([])
  const [showAllScorers, setShowAllScorers] = useState(false)
  const [showAllPotm,    setShowAllPotm]    = useState(false)
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
        comp.type !== 'festival' ? fetchCompetitionTopScorers(comp.id, Infinity) : Promise.resolve([]),
        fetchCompetitionFixtures(comp.id),
        comp.rules?.potm?.enabled ? fetchCompetitionTopPOTM(comp.id, Infinity) : Promise.resolve([]),
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
  if (!competition || !competitionViewableBy(competition, auth))
    return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  const isFestival = competition.type === 'festival'
  const color = competition.primaryColor || '#059669'
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
  // A player represents their ORGANISATION (the name it plays under) — the bare
  // team label is not what we surface. Map teamId → org match-name for the
  // top-scorer subtitle; fall back to the team label only when a team has no org.
  const orgNameById = Object.fromEntries(teams.map(t => [t.id, t.orgName || null]))

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
  const koFinal = (() => {
    if (isFestival || knockout.length === 0) return { podium: [], ranking: null, rankingDecided: 0 }
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
      const nameColor = tid => {
        const t = teams.find(x => x.id === tid)
        const m = members.find(x => x.teamId === tid)
        const name = t ? (t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName)
          : (m ? competitionTeamLabel(m.displaySnapshot) : tid)
        return { teamId: tid, name: name || tid, color: t?.primaryColor ?? m?.displaySnapshot?.primaryColor ?? null }
      }
      // Champion podium (used for a true single-elimination knockout).
      const podiumRaw = bracketPodium({ knockout, resolved, matches: matchesById, bronzeLabel: BRONZE_ROUND_LABEL })
      const podium = podiumRaw ? [
        { ...nameColor(podiumRaw.first),  caption: 'Champions' },
        { ...nameColor(podiumRaw.second), caption: 'Runner-up' },
        ...(podiumRaw.third ? [{ ...nameColor(podiumRaw.third), caption: '3rd place' }] : []),
      ].filter(r => r.teamId) : []
      // Full final placings for a ranking-playoff tournament (Final, 3rd/4th,
      // 5th/6th, …): every place, filled in as its game is decided, placeholder
      // otherwise. null when the bracket isn't a pure ranking structure.
      const fs = bracketFinalStandings({ knockout, resolved, matches: matchesById })
      const ranking = fs ? fs.ranking.map(r => ({
        place: r.place,
        ...(r.teamId ? nameColor(r.teamId) : { teamId: null, name: null, color: null }),
      })) : null
      return { podium, ranking, rankingDecided: fs ? fs.decidedCount : 0 }
    } catch {
      return { podium: [], ranking: null, rankingDecided: 0 }
    }
  })()

  return (
    <div className="max-w-4xl mx-auto pb-8" style={{ '--ca': color }}>
      <CompetitionNav competition={competition} />

      <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-6">

        {/* Final standings — a ranking-playoff tournament (Final, 3rd/4th, 5th/6th,
            …). The FULL placings are listed, each filling in the moment its game is
            decided; places still to be played show a "To be decided" placeholder.
            Shown once at least one final position is confirmed. */}
        {koFinal.ranking && koFinal.rankingDecided > 0 ? (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <div className="micro-label text-slate-500">Final standings</div>
            </div>
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-500" />
              {koFinal.ranking.map(row => {
                const decided = !!row.teamId
                const tier = PODIUM[row.place - 1] || null
                const champ = row.place === 1 && decided
                return (
                  <div key={row.place}
                    className={`flex items-center gap-3 px-5 border-t border-slate-100 first:border-t-0 ${champ ? 'py-5 bg-gradient-to-b from-amber-50 to-white' : 'py-3'}`}>
                    <span className={`rounded-full flex items-center justify-center shrink-0 font-mono font-black ${
                      champ ? 'w-11 h-11 text-lg bg-amber-100 text-amber-700'
                        : tier ? `w-7 h-7 text-[11px] ${tier.bg} ${tier.text}`
                        : 'w-7 h-7 text-[11px] bg-slate-100 text-slate-500'}`}
                      style={{ border: champ ? '2px solid #f59e0b' : tier ? `1.5px solid ${tier.ring}` : '1.5px solid #cbd5e1' }}>
                      {row.place}
                    </span>
                    {decided ? (
                      <>
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: row.color }} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-slate-900 truncate ${champ ? 'font-black text-xl leading-tight' : 'text-sm font-semibold'}`}>{row.name}</div>
                          <div className={`text-[10px] font-bold uppercase tracking-widest ${tier ? tier.text : 'text-slate-400'}`}>
                            {row.place === 1 ? 'Champions' : row.place === 2 ? 'Runner-up' : `${ordinalLabel(row.place)} place`}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-400 text-sm italic truncate">To be decided</div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{ordinalLabel(row.place)} place</div>
                      </div>
                    )}
                  </div>
                )
              })}
              <Link to={competitionUrl(competition) + '/knockout'}
                className="block text-center text-[11px] text-[color:var(--ca)] hover:opacity-80 py-2.5 border-t border-slate-100 transition-colors">
                Full bracket →
              </Link>
            </div>
          </div>
        ) : koFinal.podium.length > 0 && (
          /* Champion podium — a true single-elimination knockout (no fixed
             place-ranking games). Shown the moment the final is decided. */
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
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: koFinal.podium[0].color }} />
                    <span className="text-slate-900 font-black text-xl leading-tight truncate">{koFinal.podium[0].name}</span>
                  </div>
                </div>
              </div>
              {/* Runner-up (silver) + 3rd — existing sizing */}
              {koFinal.podium.slice(1).map((row, idx) => {
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
                  className="block text-center text-[11px] text-[color:var(--ca)] hover:opacity-80 py-2.5 border-t border-slate-100 transition-colors">
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
                    <span className="font-mono font-black text-[color:var(--ca)] text-lg tabular-nums shrink-0">{row.Pts ?? 0}<span className="text-[10px] font-normal text-slate-400 ml-0.5">pts</span></span>
                  </div>
                )
                return (
                  <div key={row.teamId} className="flex items-center gap-3 px-5 py-3 border-t border-slate-100">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-mono font-black text-[11px] ${p.bg} ${p.text}`}
                      style={{ border: `1.5px solid ${p.ring}` }}>{i + 1}</span>
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: teamColorById[row.teamId] }} />
                    <div className="flex-1 min-w-0 text-slate-900 text-sm font-semibold truncate">{name}</div>
                    <span className="font-mono font-black text-[color:var(--ca)] text-sm tabular-nums shrink-0">{row.Pts ?? 0}<span className="text-[10px] font-normal text-slate-400 ml-0.5">pts</span></span>
                  </div>
                )
              })}
              <Link to={competitionUrl(competition) + '/standings'}
                className="block text-center text-[11px] text-[color:var(--ca)] hover:opacity-80 py-2.5 border-t border-slate-100 transition-colors">
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
                <div className="font-mono font-black text-2xl text-[color:var(--ca)] tabular-nums">{value}</div>
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
              {(showAllScorers ? scorers : scorers.slice(0, 5)).map((player, i) => (
                <div key={player.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
                  <span className="font-mono font-bold text-slate-400 text-xs w-4 shrink-0 text-right">{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: player.teamPrimaryColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 text-sm font-semibold truncate">{player.personName}</div>
                    <div className="micro-label">{(orgNameById[player.teamId] || player.teamDisplayName)}{player.position ? ` · ${player.position}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-black text-[color:var(--ca)] text-xl tabular-nums">{player.goals}</div>
                    <div className="micro-label">goals</div>
                  </div>
                </div>
              ))}
            </div>
            {scorers.length > 5 && (
              <div className="flex justify-end mt-2">
                <button type="button" onClick={() => setShowAllScorers(v => !v)} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                  {showAllScorers ? 'Show less' : 'See more'}
                </button>
              </div>
            )}
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
              {(showAllPotm ? potmLeaders : potmLeaders.slice(0, 5)).map((leader, i) => (
                <div key={leader.key} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
                  <span className="font-mono font-bold text-slate-400 text-xs w-4 shrink-0 text-right">{i + 1}</span>
                  {leader.teamColor && (
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: leader.teamColor }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 text-sm font-semibold truncate">{leader.name}</div>
                    {(leader.orgName || leader.teamName) && <div className="micro-label">{leader.orgName || leader.teamName}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-black text-amber-500 text-xl tabular-nums">{leader.count}</div>
                    <div className="micro-label">{leader.count === 1 ? 'award' : 'awards'}</div>
                  </div>
                </div>
              ))}
            </div>
            {potmLeaders.length > 5 && (
              <div className="flex justify-end mt-2">
                <button type="button" onClick={() => setShowAllPotm(v => !v)} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                  {showAllPotm ? 'Show less' : 'See more'}
                </button>
              </div>
            )}
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
            <Link to={competitionUrl(competition) + '/matches'}
              className="block text-center text-[11px] text-[color:var(--ca)] hover:opacity-80 mt-3 transition-colors">
              All matches →
            </Link>
          </div>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div>
            <div className="micro-label text-slate-500 mb-3">{isFestival ? 'Next match' : 'Coming up'}</div>
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

      </div>
    </div>
  )
}
