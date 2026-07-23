import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileDown } from 'lucide-react'
import { isScheduled } from '../lib/fixtureStatus'
import { outcomeBanner } from '../lib/fixtureResult'
import { fetchCompetition, fetchCompetitionFixtures, toDate, fetchCompetitionByPath, fetchCompetitionBySlugSeason } from '../lib/queries'
import { matchUrl } from '../lib/slugify'
import CompetitionNav from '../components/CompetitionNav'
import { MatchTeamIdentity } from '../components/TeamIdentity'
import { prefetchMatchTeams } from '../lib/teamIdentity'

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

function dayKey(val) {
  const d = toDate(val)
  if (!d) return 'TBD'
  return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtTime(val) {
  const d = toDate(val)
  if (!d) return ''
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function groupByDay(fixtures) {
  const map = new Map()
  const live = fixtures.filter(m => m.status === 'live')
  if (live.length) map.set('__live__', live)

  for (const m of fixtures.filter(m => m.status !== 'live')) {
    const key = dayKey(m.scheduledAt)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(m)
  }
  return map
}

export default function CompetitionFixtures() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [competition, setCompetition] = useState(null)
  const [fixtures,    setFixtures]    = useState([])
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
      document.title = `${comp.name} · Fixtures · MatchPulse`
      return fetchCompetitionFixtures(comp.id)
    }).then(f => {
      if (f) { prefetchMatchTeams(f); setFixtures(f) }
    }).finally(() => setLoading(false))
  }, [id, series, ageGroup, season, competitionSlug])

  if (loading) return <Spinner />
  if (!competition) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  const groups = groupByDay(fixtures)

  function handleExport() {
    downloadCSV(`${competition.name} Fixtures.csv`, [
      ['Date', 'Time', 'Home', 'Away', 'Home Score', 'Away Score', 'Status', 'Venue'],
      ...fixtures.map(m => {
        const d = toDate(m.scheduledAt)
        return [
          d ? d.toLocaleDateString('en-ZA') : '',
          d ? d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '',
          m.homeTeamName, m.awayTeamName,
          isScheduled(m) ? '' : (m.homeScore ?? ''),
          isScheduled(m) ? '' : (m.awayScore ?? ''),
          m.status, m.pitch ?? '',
        ]
      }),
    ])
  }

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />

      {fixtures.length > 0 && (
        <div className="px-4 sm:px-6 lg:px-8 pt-4 flex justify-end">
          <button onClick={handleExport}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors">
            <FileDown className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Export CSV</span>
          </button>
        </div>
      )}

      <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-6">
        {fixtures.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-8">No fixtures scheduled yet.</p>
        ) : (
          Array.from(groups.entries()).map(([day, dayMatches]) => (
            <div key={day}>
              {/* Day heading */}
              {day === '__live__' ? (
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-red-600 text-[10px] font-bold uppercase tracking-widest">Live now</span>
                </div>
              ) : (
                <div className="micro-label text-slate-500 mb-3">{day}</div>
              )}

              <div className="space-y-2">
                {dayMatches.map(match => {
                  const isLive  = match.status === 'live'
                  const isFinal = match.status === 'final'

                  const banner = outcomeBanner(match)
                  return (
                    <Link key={match.id} to={matchUrl(match)}
                      className={`block bg-white rounded-xl border px-4 py-3 hover:border-slate-300 transition-colors shadow-sm ${
                        isLive ? 'border-red-200' : 'border-slate-200'
                      }`}>
                    <div className="flex items-start">
                      {/* Home team */}
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ backgroundColor: match.homeTeamColor }} />
                        <MatchTeamIdentity match={match} side="home" hideIdentifier
                          nameClass="text-sm font-semibold text-slate-900"
                        />
                      </div>

                      {/* Score / time */}
                      <div className="mx-3 text-center shrink-0 min-w-[56px] self-center">
                        {isFinal || isLive ? (
                          <span className={`font-mono font-black tabular-nums ${isLive ? 'text-red-600' : 'text-slate-900'}`}>
                            {match.homeScore}–{match.awayScore}
                          </span>
                        ) : (
                          <span className="font-mono text-slate-500 text-sm">{fmtTime(match.scheduledAt) || 'TBD'}</span>
                        )}
                        {/* Keep the scheduled kick-off visible on a live game so you
                            can still see when it was meant to start (and how far behind). */}
                        {isLive && fmtTime(match.scheduledAt) && (
                          <div className="micro-label mt-0.5 text-slate-400">KO {fmtTime(match.scheduledAt)}</div>
                        )}
                        {match.pitch && (
                          <div className="micro-label mt-0.5 text-slate-400">{match.pitch}</div>
                        )}
                      </div>

                      {/* Away team */}
                      <div className="flex items-start gap-2 flex-1 min-w-0 justify-end">
                        <MatchTeamIdentity match={match} side="away" hideIdentifier align="right"
                          nameClass="text-sm font-semibold text-slate-900"
                        />
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ backgroundColor: match.awayTeamColor }} />
                      </div>
                    </div>
                    {banner && (
                      <div className={`mt-1.5 text-center text-[10px] font-bold uppercase tracking-widest ${banner.tone === 'slate' ? 'text-slate-500' : 'text-red-600'}`}>
                        {banner.label}{banner.reason ? <span className="normal-case font-normal tracking-normal text-slate-400"> · {banner.reason}</span> : null}
                      </div>
                    )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
