import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  fetchCompetition, fetchCompetitionByPath, fetchCompetitionBySlugSeason,
  fetchCompetitionMembers, fetchCompetitionFixtureMembers, fetchMatch,
  fetchCompetitionPools, fetchCompetitionKnockout, fetchCompetitionAdvancement, toDate,
} from '../lib/queries'
import { competitionTeamLabel } from '../lib/teamNaming'
import { computePoolStandings } from '../lib/standings'
import {
  resolveBracket, computeBestPlacedAtPosition, knockoutResult, knockoutWinnerSide, SLOT_STATUS,
} from '../lib/competitionStructure'
import { matchUrl } from '../lib/slugify'
import CompetitionNav from '../components/CompetitionNav'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

export default function CompetitionKnockout() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [competition, setCompetition] = useState(null)
  const [slots, setSlots] = useState([])
  const [resolved, setResolved] = useState({})
  const [teamNames, setTeamNames] = useState({})
  const [matches, setMatches] = useState({})
  const [provisional, setProvisional] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const compPromise = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : series ? fetchCompetitionByPath(`${series}/${ageGroup}/${season}`)
      : fetchCompetition(id)

    compPromise.then(async comp => {
      if (!comp) return
      setCompetition(comp)
      document.title = `${comp.name} · Knockout · MatchPulse`
      const [members, fxMembers, pools, knockout, advancement] = await Promise.all([
        fetchCompetitionMembers(comp.id),
        fetchCompetitionFixtureMembers(comp.id),
        fetchCompetitionPools(comp.id),
        fetchCompetitionKnockout(comp.id),
        fetchCompetitionAdvancement(comp.id),
      ])
      const matchIds = [...new Set(fxMembers.map(f => f.matchId).filter(Boolean))]
      const matchDocs = await Promise.all(matchIds.map(mid => fetchMatch(mid).catch(() => null)))
      const matches = {}
      matchDocs.forEach(m => { if (m) matches[m.id] = m })

      const names = {}
      members.forEach(m => { names[m.teamId] = competitionTeamLabel(m.displaySnapshot) || m.teamId })

      const poolsCtx = {}
      const poolStandings = {}
      for (const pool of pools) {
        const pf = fxMembers.filter(f => f.poolId === pool.poolId)
        const poolTeamIds = (pool.slots ?? []).map(s => s.teamId).filter(Boolean)
        poolStandings[pool.poolId] = computePoolStandings(comp, members, pf, matches, {
          poolTeamIds, manualOverrides: pool.manualOverrides ?? [],
        })
        poolsCtx[pool.poolId] = { rows: poolStandings[pool.poolId].rows, verified: !!pool.verified }
      }
      // Cross-pool best-placed rankings. The ceiling is derived from the actual
      // pools and the positions the bracket references (NOT a hard-coded 1–6) so
      // "rank everyone" playoffs and pools of 7+ resolve correctly.
      const maxPoolSize = Math.max(0, ...pools.map(p => (poolStandings[p.poolId]?.rows?.length ?? (p.slots ?? []).length ?? 0)))
      const maxRefPos   = Math.max(0, ...knockout.map(s => Number(s.source?.position) || 0))
      const maxPos = Math.max(maxPoolSize, maxRefPos, 1)
      const bestPlaced = {}
      for (let pos = 1; pos <= maxPos; pos++) {
        bestPlaced[pos] = computeBestPlacedAtPosition(
          pools.map(p => ({ poolId: p.poolId, verified: !!p.verified, rows: poolStandings[p.poolId].rows })),
          pos, comp.rules?.tieBreakers ?? [],
        )
      }
      const bracketResults = {}
      for (const slot of knockout) {
        if (slot.matchId && matches[slot.matchId]) {
          const r = knockoutResult(matches[slot.matchId])
          if (r) bracketResults[slot.slotId] = r
        }
      }
      const lockedTeams = {}
      advancement.forEach(a => { lockedTeams[a.slotId] = a.teamId })

      const res = resolveBracket(knockout, { pools: poolsCtx, bestPlaced, bracketResults, lockedTeams })
      setSlots(knockout); setResolved(res); setTeamNames(names); setMatches(matches)
      setProvisional(Object.values(res).some(r => r.status === SLOT_STATUS.provisional))
    }).finally(() => setLoading(false))
  }, [id, series, ageGroup, season, competitionSlug])

  if (loading) return <Spinner />
  if (!competition) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  // Group slots into ROUNDS, then pair consecutive slots into GAMES (home/away)
  // so each match shows as one card with its score — not two disconnected rows.
  const nameOf = (slot) => {
    const r = resolved[slot?.slotId] ?? {}
    return r.teamId ? (teamNames[r.teamId] ?? r.teamId) : (slot?.name ?? 'TBC')
  }
  const rounds = []
  {
    const byRound = new Map()
    for (const slot of slots) {
      const key = slot.roundLabel ?? 'Knockout'
      if (!byRound.has(key)) byRound.set(key, [])
      byRound.get(key).push(slot)
    }
    for (const [label, ss] of byRound) {
      const games = []
      for (let i = 0; i < ss.length; i += 2) games.push([ss[i], ss[i + 1]].filter(Boolean))
      rounds.push({ label, games })
    }
  }

  // The linked match for a game is carried by the slot that has a matchId
  // (the home slot by convention). Returns { match, result } or null.
  const gameMatch = (pair) => {
    const withMatch = pair.find(s => s.matchId && matches[s.matchId])
    if (!withMatch) return null
    const match = matches[withMatch.matchId]
    return { match, anchor: withMatch, result: knockoutResult(match) }
  }

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />
      <div className="mt-4 px-4 sm:px-6 lg:px-8 space-y-6">
        {provisional && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-500">
            Knockout positions are based on current pool standings and have not yet been verified.
          </div>
        )}

        {slots.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">No knockout structure has been defined yet.</p>
        ) : rounds.map(({ label, games }) => (
          <div key={label}>
            <div className="micro-label text-slate-500 mb-2">{label}</div>
            <div className="space-y-2">
              {games.map((pair, gi) => {
                const [home, away] = pair
                const gm      = gameMatch(pair)
                const match   = gm?.match
                const played  = match?.status === 'final'
                const winSide = played ? knockoutWinnerSide(match) : null   // by score, not team id
                const hId = resolved[home?.slotId]?.teamId ?? null
                const aId = resolved[away?.slotId]?.teamId ?? null
                const Row = ({ slot, teamId, side }) => {
                  const won = played && winSide === side
                  return (
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${
                        won ? 'font-bold text-slate-900'
                          : teamId ? 'font-semibold text-slate-700' : 'text-slate-300 italic'}`}>
                        {nameOf(slot)}
                      </span>
                      {played && (
                        <span className={`ml-auto font-mono font-black tabular-nums shrink-0 ${won ? 'text-slate-900' : 'text-slate-400'}`}>
                          {side === 'home' ? (match.homeScore ?? 0) : (match.awayScore ?? 0)}
                        </span>
                      )}
                    </div>
                  )
                }
                const card = (
                  <div className={`bg-white rounded-xl border px-4 py-3 shadow-sm ${played ? 'border-slate-200' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-slate-400">{(home?.name || away?.name || 'Game').replace(/\s+(Home|Away)$/i, '')}</span>
                      {played
                        ? <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Full time</span>
                        : match?.scheduledAt
                        ? <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{toDate(match.scheduledAt)?.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</span>
                        : <span className="text-[9px] font-bold uppercase tracking-widest text-slate-300">TBC</span>}
                    </div>
                    <div className="space-y-1">
                      <Row slot={home} teamId={hId} side="home" />
                      <Row slot={away} teamId={aId} side="away" />
                    </div>
                    {pair.some(s => s.manualOverride) && (
                      <div className="text-[10px] text-violet-600 mt-1.5">Set by organiser</div>
                    )}
                  </div>
                )
                return match ? (
                  <Link key={home?.slotId ?? gi} to={matchUrl(match)} className="block hover:opacity-90 transition-opacity">{card}</Link>
                ) : (
                  <div key={home?.slotId ?? gi}>{card}</div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
