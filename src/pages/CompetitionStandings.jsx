import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileDown, Info } from 'lucide-react'
import {
  fetchCompetition, fetchCompetitionByPath, fetchCompetitionBySlugSeason,
  fetchCompetitionMembers, fetchCompetitionFixtureMembers, fetchMatch,
} from '../lib/queries'
import { computeStandings } from '../lib/standings'
import CompetitionNav from '../components/CompetitionNav'
import StandingsTable from '../components/StandingsTable'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function NeutralMessage({ heading, body }) {
  return (
    <div className="px-4 py-16 flex flex-col items-center text-center gap-3">
      <Info className="w-8 h-8 text-slate-300" />
      <p className="text-slate-700 text-sm font-semibold">{heading}</p>
      <p className="text-slate-500 text-sm max-w-xs">{body}</p>
    </div>
  )
}

export default function CompetitionStandings() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [competition, setCompetition] = useState(null)
  const [standingsRows, setStandingsRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const compPromise = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : series
      ? fetchCompetitionByPath(`${series}/${ageGroup}/${season}`)
      : fetchCompetition(id)

    compPromise.then(async comp => {
      if (!comp) return
      setCompetition(comp)
      document.title = `${comp.name} · Standings · MatchPulse`

      if (comp.type === 'tournament' || comp.type === 'festival') return

      const [members, fixtures] = await Promise.all([
        fetchCompetitionMembers(comp.id),
        fetchCompetitionFixtureMembers(comp.id),
      ])

      const matchIds = [...new Set(fixtures.map(f => f.matchId).filter(Boolean))]
      const matchDocs = await Promise.all(matchIds.map(mid => fetchMatch(mid).catch(() => null)))
      const matches = Object.fromEntries(
        matchDocs.filter(Boolean).map(m => [m.id, m])
      )

      const { rows } = computeStandings(comp, members, fixtures, matches)
      setStandingsRows(rows)
    }).finally(() => setLoading(false))
  }, [id, series, ageGroup, season, competitionSlug])

  function handleExport() {
    if (!competition || standingsRows.length === 0) return
    downloadCSV(`${competition.name} Standings.csv`, [
      ['Pos', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'],
      ...standingsRows.map(r => [
        r.pos, r.teamName,
        r.P, r.W, r.D, r.L,
        r.GF, r.GA, r.GD, r.Pts,
      ]),
    ])
  }

  if (loading) return <Spinner />
  if (!competition) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  if (competition.type === 'tournament') {
    return (
      <div className="max-w-4xl mx-auto pb-8">
        <CompetitionNav competition={competition} />
        <NeutralMessage
          heading="Pool standings"
          body="This tournament uses pool-based standings. Individual pool tables are shown on the Pools tab."
        />
      </div>
    )
  }

  if (competition.type === 'festival') {
    return (
      <div className="max-w-4xl mx-auto pb-8">
        <CompetitionNav competition={competition} />
        <NeutralMessage
          heading="No rankings"
          body="Festivals are non-competitive — there are no ranked standings for this event."
        />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />

      <div className="mt-4 px-4 sm:px-6 lg:px-8">
        {standingsRows.length > 0 && (
          <div className="flex justify-end mb-3">
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors">
              <FileDown className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Export CSV</span>
            </button>
          </div>
        )}
        <StandingsTable rows={standingsRows} />
      </div>
    </div>
  )
}
