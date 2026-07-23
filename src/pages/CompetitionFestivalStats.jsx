import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Info } from 'lucide-react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import {
  fetchCompetition, fetchCompetitionByPath, fetchCompetitionBySlugSeason,
  fetchCompetitionMembers, fetchCompetitionFixtureMembers,
} from '../lib/queries'
import { computeFestivalStats } from '../lib/standings'
import CompetitionNav from '../components/CompetitionNav'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

// Fixed canonical column order. No position column, no sorting.
const COLS = [
  { key: 'P', label: 'P' }, { key: 'W', label: 'W' }, { key: 'D', label: 'D' },
  { key: 'L', label: 'L' }, { key: 'GF', label: 'GF' }, { key: 'GA', label: 'GA' },
  { key: 'GD', label: 'GD' },
]

export default function CompetitionFestivalStats() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [competition, setCompetition] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    let unsub = null

    const compPromise = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : series ? fetchCompetitionByPath(`${series}/${ageGroup}/${season}`)
      : fetchCompetition(id)

    compPromise.then(async comp => {
      if (!comp) { setLoading(false); return }
      setCompetition(comp)
      document.title = `${comp.name} · Stats · MatchPulse`
      if (comp.rules?.statsTable?.enabled !== true) { setLoading(false); return }

      const [members, fxMembers] = await Promise.all([
        fetchCompetitionMembers(comp.id),
        fetchCompetitionFixtureMembers(comp.id),
      ])

      let first = true
      unsub = onSnapshot(
        query(collection(db, 'matches'), where('competitionId', '==', comp.id)),
        snapshot => {
          const matches = {}
          snapshot.docs.forEach(d => { matches[d.id] = { id: d.id, ...d.data() } })
          setRows(computeFestivalStats(comp, members, fxMembers, matches))
          if (first) { first = false; setLoading(false) }
        },
        () => { if (first) setLoading(false) },
      )
    }).catch(() => setLoading(false))

    return () => { if (unsub) unsub() }
  }, [id, series, ageGroup, season, competitionSlug])

  if (loading) return <Spinner />
  if (!competition) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  const enabled = competition.rules?.statsTable?.enabled === true

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />
      <div className="mt-4 px-4 sm:px-6 lg:px-8">
        {!enabled ? (
          <p className="text-center text-slate-500 text-sm py-12">No statistics are published for this festival.</p>
        ) : (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[12px] text-slate-500">Informational stats only — this is not a standings table.</span>
            </div>
            <div>
              {/* Column headers share the exact column widths used by the data
                  rows below, so each label always sits above its number. */}
              <div className="flex items-center px-3 py-2 mb-1">
                <div className="flex-1 min-w-0" />
                <div className="flex shrink-0">
                  {COLS.map(c => (
                    <div key={c.key} className="w-8 text-center text-[9px] font-bold uppercase tracking-widest text-slate-500">{c.label}</div>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                {rows.map(r => (
                  <div key={r.teamId} className="flex items-center bg-white rounded-xl border border-slate-200 px-3 shadow-sm">
                    {/* Name zone — wraps freely, with a hard right boundary the
                        data zone can never cross. */}
                    <div className="flex-1 min-w-0 py-3 pr-3">
                      <span className="text-slate-900 text-sm font-semibold break-words">{r.orgName ? `${r.orgName} ${r.teamName}` : r.teamName}</span>
                    </div>
                    {/* Data zone — fixed-width block of centred, tabular numbers. */}
                    <div className="flex shrink-0">
                      {COLS.map(c => (
                        <div key={c.key} className="w-8 text-center font-mono text-xs text-slate-500 tabular-nums py-3">{r[c.key]}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
