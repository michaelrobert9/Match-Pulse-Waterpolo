import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchAllMatches, toDate } from '../../lib/queries'
import { isScheduled } from '../../lib/fixtureStatus'
import { matchUrl } from '../../lib/slugify'
import StatusBadge from '../../components/StatusBadge'

const SELECT_CLASS =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500 transition-colors'

// Admin fixtures list. Every match across the platform, most recent first,
// with client-side filters. Each row links straight to the scorer/edit screen
// (/score/:id) where platform admins have full edit control, including for
// finalised matches.
export function FixturesList() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  const [fDate,   setFDate]   = useState('')   // '', 'today', 'week', 'past', 'future'
  const [fTeam,   setFTeam]   = useState('')
  const [fGround, setFGround] = useState('')
  const [fLeague, setFLeague] = useState('')
  const [fSeason, setFSeason] = useState('')
  const [fStatus, setFStatus] = useState('')

  useEffect(() => {
    fetchAllMatches()
      .then(setMatches)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Distinct filter option sets, derived from the loaded matches.
  const teams = useMemo(() => {
    const s = new Set()
    matches.forEach(m => { if (m.homeTeamName) s.add(m.homeTeamName); if (m.awayTeamName) s.add(m.awayTeamName) })
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [matches])

  const grounds = useMemo(
    () => [...new Set(matches.map(m => m.pitch).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [matches])

  const leagues = useMemo(() => {
    const map = new Map()
    matches.forEach(m => {
      if (m.competitionId) {
        const label = m.competitionName || m.competitionSlug || m.competitionId
        if (!map.has(m.competitionId)) map.set(m.competitionId, label)
      }
    })
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }, [matches])

  const seasons = useMemo(
    () => [...new Set(matches.map(m => m.competitionSeason || m.season).filter(Boolean))].sort().reverse(),
    [matches])

  const filtered = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfToday   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    const weekAhead    = new Date(startOfToday); weekAhead.setDate(weekAhead.getDate() + 7)

    return matches.filter(m => {
      if (fTeam   && m.homeTeamName !== fTeam && m.awayTeamName !== fTeam) return false
      if (fGround && m.pitch !== fGround) return false
      if (fLeague && m.competitionId !== fLeague) return false
      if (fSeason && (m.competitionSeason || m.season) !== fSeason) return false
      // 'scheduled' matches legacy 'upcoming' docs too, until the migration runs.
      if (fStatus === 'scheduled') { if (!isScheduled(m)) return false }
      else if (fStatus && m.status !== fStatus) return false
      if (fDate) {
        const d = toDate(m.scheduledAt)
        if (!d) return false
        if (fDate === 'today'  && !(d >= startOfToday && d <= endOfToday)) return false
        if (fDate === 'week'   && !(d >= startOfToday && d <= weekAhead))  return false
        if (fDate === 'past'   && !(d <  startOfToday)) return false
        if (fDate === 'future' && !(d >  endOfToday))   return false
      }
      return true
    })
  }, [matches, fDate, fTeam, fGround, fLeague, fSeason, fStatus])

  const fmtWhen = val => {
    const d = toDate(val)
    return d
      ? d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Date TBD'
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-slate-900 text-lg">Fixtures</h1>
        <span className="text-xs text-slate-400">{filtered.length} of {matches.length}</span>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <select value={fDate} onChange={e => setFDate(e.target.value)} className={SELECT_CLASS}>
          <option value="">All dates</option>
          <option value="today">Today</option>
          <option value="week">Next 7 days</option>
          <option value="future">Upcoming</option>
          <option value="past">Past</option>
        </select>
        <select value={fTeam} onChange={e => setFTeam(e.target.value)} className={SELECT_CLASS}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={fGround} onChange={e => setFGround(e.target.value)} className={SELECT_CLASS}>
          <option value="">All grounds</option>
          {grounds.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={fLeague} onChange={e => setFLeague(e.target.value)} className={SELECT_CLASS}>
          <option value="">All competitions</option>
          {leagues.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select value={fSeason} onChange={e => setFSeason(e.target.value)} className={SELECT_CLASS}>
          <option value="">All seasons</option>
          {seasons.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={SELECT_CLASS}>
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="live">Live</option>
          <option value="paused">Paused</option>
          <option value="awaiting_result">Awaiting result</option>
          <option value="final">Final</option>
          <option value="postponed">Postponed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500 text-sm">No fixtures match these filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => {
            const isLive  = m.status === 'live' || m.status === 'paused'
            const isFinal = m.status === 'final'
            return (
              <div key={m.id}
                className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 shadow-sm ${
                  isLive ? 'border-red-200' : 'border-slate-200'
                }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-slate-900 text-sm font-semibold truncate">
                      {m.homeTeamName || 'Home'}
                    </span>
                    {(isLive || isFinal)
                      ? <span className="font-mono font-black text-slate-900 text-sm tabular-nums shrink-0">{m.homeScore ?? 0}–{m.awayScore ?? 0}</span>
                      : <span className="text-slate-400 text-xs shrink-0">vs</span>}
                    <span className="text-slate-900 text-sm font-semibold truncate">
                      {m.awayTeamName || 'Away'}
                    </span>
                  </div>
                  <div className="micro-label flex items-center gap-2 flex-wrap">
                    <span>{fmtWhen(m.scheduledAt)}</span>
                    {m.pitch && <span className="text-slate-300">·</span>}
                    {m.pitch && <span>{m.pitch}</span>}
                    {(m.competitionName || m.competitionSlug) && <span className="text-slate-300">·</span>}
                    {(m.competitionName || m.competitionSlug) && <span className="truncate">{m.competitionName || m.competitionSlug}</span>}
                  </div>
                </div>

                <StatusBadge status={m.status} className="shrink-0" />

                {/* View the public page (only meaningful once it has a slug). */}
                <a href={matchUrl(m)} target="_blank" rel="noreferrer"
                  className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors p-1"
                  title="Open public page">
                  <ExternalLink className="w-4 h-4" />
                </a>

                {/* Edit / score — full control for platform admins, even when final. */}
                <Link to={`/score/${m.id}`}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
                  {isFinal ? 'Edit' : isLive ? 'Score' : 'Edit'}
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
