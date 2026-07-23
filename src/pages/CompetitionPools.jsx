import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import {
  fetchCompetition, fetchCompetitionByPath, fetchCompetitionBySlugSeason,
  fetchCompetitionMembers, fetchCompetitionFixtureMembers, fetchMatch,
  fetchCompetitionPools,
} from '../lib/queries'
import { computePoolStandings } from '../lib/standings'
import CompetitionNav from '../components/CompetitionNav'
import StandingsTable from '../components/StandingsTable'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

export default function CompetitionPools() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [competition, setCompetition] = useState(null)
  const [pools, setPools] = useState([])
  const [standings, setStandings] = useState({})
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
      document.title = `${comp.name} · Pools · MatchPulse`
      const [members, fxMembers, poolDocs] = await Promise.all([
        fetchCompetitionMembers(comp.id),
        fetchCompetitionFixtureMembers(comp.id),
        fetchCompetitionPools(comp.id),
      ])
      const matchIds = [...new Set(fxMembers.map(f => f.matchId).filter(Boolean))]
      const matchDocs = await Promise.all(matchIds.map(mid => fetchMatch(mid).catch(() => null)))
      const matches = {}
      matchDocs.forEach(m => { if (m) matches[m.id] = m })
      const st = {}
      for (const pool of poolDocs) {
        const pf = fxMembers.filter(f => f.poolId === pool.poolId)
        const poolTeamIds = (pool.slots ?? []).map(s => s.teamId).filter(Boolean)
        st[pool.poolId] = computePoolStandings(comp, members, pf, matches, {
          poolTeamIds, manualOverrides: pool.manualOverrides ?? [],
        })
      }
      setPools(poolDocs); setStandings(st)
    }).finally(() => setLoading(false))
  }, [id, series, ageGroup, season, competitionSlug])

  if (loading) return <Spinner />
  if (!competition) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />
      <div className="mt-4 px-4 sm:px-6 lg:px-8 space-y-6">
        {pools.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">No pools have been set up yet.</p>
        ) : pools.map(pool => (
          <div key={pool.poolId}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-display font-bold text-slate-900 text-base">{pool.name}</h2>
              {pool.verified
                ? <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Verified</span>
                : <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Provisional</span>}
            </div>
            <StandingsTable rows={standings[pool.poolId]?.rows ?? []} />
            {(pool.manualOverrides ?? []).map((o, i) => (
              <div key={i} className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[11px] text-amber-700">
                  <span className="font-bold uppercase tracking-widest">Manual placement</span> — {o.reason}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
