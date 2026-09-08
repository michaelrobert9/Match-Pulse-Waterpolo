import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ExternalLink, Trash2, Plus, Archive } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchAllMatches, fetchOrganizations, toDate } from '../../lib/queries'
import { deleteMatch } from '../../lib/adminQueries'
import { isScheduled } from '../../lib/fixtureStatus'
import { matchUrl } from '../../lib/slugify'
import { prefetchMatchTeams, resolveTeamSideSync } from '../../lib/teamIdentity'
import { MatchTeamIdentity } from '../../components/TeamIdentity'
import StatusBadge from '../../components/StatusBadge'

const SELECT_CLASS =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500 transition-colors'

// Org-type labels for the cascading team filter.
const ORG_TYPES = [
  ['school',      'Schools'],
  ['club',        'Clubs'],
  ['association', 'Associations'],
]

// Admin fixtures list. Every (non-deleted) match across the platform, most
// recent first, with client-side filters. The team filter cascades:
// type → organisation → team, so you narrow to one school/club and then one of
// its teams instead of scrolling one flat list of every team name.
export function FixturesList() {
  const [matches, setMatches] = useState([])
  const [orgs, setOrgs]       = useState([])
  const [loading, setLoading] = useState(true)

  const [fDate,   setFDate]   = useState('')   // '', 'today', 'week', 'past', 'future'
  const [fType,   setFType]   = useState('')   // '', 'school', 'club', 'association'
  const [fOrg,    setFOrg]    = useState('')   // organizationId
  const [fTeam,   setFTeam]   = useState('')   // teamId
  const [fGround, setFGround] = useState('')
  const [fLeague, setFLeague] = useState('')
  const [fSeason, setFSeason] = useState('')
  const [fStatus, setFStatus] = useState('')

  useEffect(() => {
    Promise.all([fetchAllMatches(), fetchOrganizations().catch(() => [])])
      .then(([list, orgList]) => { prefetchMatchTeams(list); setMatches(list); setOrgs(orgList) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Organisations that actually appear in matches, so every dropdown option
  // yields results. Filtered by the chosen type (school / club / association).
  const orgOptions = useMemo(() => {
    const inMatches = new Set()
    matches.forEach(m => { if (m.homeOrgId) inMatches.add(m.homeOrgId); if (m.awayOrgId) inMatches.add(m.awayOrgId) })
    return orgs
      .filter(o => inMatches.has(o.id))
      .filter(o => !fType || o.type === fType)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [orgs, matches, fType])

  // Teams of the selected organisation that have matches — the third cascade step.
  const teamOptions = useMemo(() => {
    if (!fOrg) return []
    const map = new Map()
    matches.forEach(m => {
      if (m.homeOrgId === fOrg && m.homeTeamId) map.set(m.homeTeamId, m.homeTeamName || m.homeTeamId)
      if (m.awayOrgId === fOrg && m.awayTeamId) map.set(m.awayTeamId, m.awayTeamName || m.awayTeamId)
    })
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }, [matches, fOrg])

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
      if (fOrg    && m.homeOrgId !== fOrg && m.awayOrgId !== fOrg) return false
      if (fTeam   && m.homeTeamId !== fTeam && m.awayTeamId !== fTeam) return false
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
  }, [matches, fDate, fOrg, fTeam, fGround, fLeague, fSeason, fStatus])

  const fmtWhen = val => {
    const d = toDate(val)
    return d
      ? d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Date TBD'
  }

  // Soft-delete: move the match to the recycle bin (restorable from Deleted
  // matches). Competition membership is kept so a restore rejoins cleanly.
  async function handleDelete(m) {
    if (!confirm(`Move "${resolveTeamSideSync(m, 'home').primary} vs ${resolveTeamSideSync(m, 'away').primary}" to the recycle bin? You can restore it from Deleted matches.`)) return
    try {
      await deleteMatch(m.id)
      setMatches(prev => prev.filter(x => x.id !== m.id))
    } catch (e) {
      alert(e.message || 'Delete failed.')
    }
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-slate-900 text-lg">Matches</h1>
          <span className="text-xs text-slate-400">{filtered.length} of {matches.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/matches/deleted"
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors">
            <Archive className="w-3.5 h-3.5" /> Deleted
          </Link>
          <Link to="/match/new"
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Create match
          </Link>
        </div>
      </div>

      {/* Cascading team finder: type → school/club/association → team */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <select value={fType}
          onChange={e => { setFType(e.target.value); setFOrg(''); setFTeam('') }}
          className={SELECT_CLASS}>
          <option value="">All types</option>
          {ORG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={fOrg}
          onChange={e => { setFOrg(e.target.value); setFTeam('') }}
          className={SELECT_CLASS}>
          <option value="">{fType ? `All ${fType}s` : 'All organisations'}</option>
          {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={fTeam} onChange={e => setFTeam(e.target.value)} disabled={!fOrg}
          className={`${SELECT_CLASS} disabled:opacity-50`}>
          <option value="">{fOrg ? 'All teams' : 'Select an organisation first'}</option>
          {teamOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      {/* Other filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <select value={fDate} onChange={e => setFDate(e.target.value)} className={SELECT_CLASS}>
          <option value="">All dates</option>
          <option value="today">Today</option>
          <option value="week">Next 7 days</option>
          <option value="future">Upcoming</option>
          <option value="past">Past</option>
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
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={`${SELECT_CLASS} col-span-2 md:col-span-4`}>
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
          <p className="text-slate-500 text-sm">No matches found for these filters.</p>
          <Link to="/match/new"
            className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Create a match
          </Link>
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
                    <MatchTeamIdentity match={m} side="home" hideIdentifier
                      nameClass="text-slate-900 text-sm font-semibold truncate" />
                    {(isLive || isFinal)
                      ? <span className="font-mono font-black text-slate-900 text-sm tabular-nums shrink-0">{m.homeScore ?? 0}–{m.awayScore ?? 0}</span>
                      : <span className="text-slate-400 text-xs shrink-0">vs</span>}
                    <MatchTeamIdentity match={m} side="away" hideIdentifier
                      nameClass="text-slate-900 text-sm font-semibold truncate" />
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

                {/* Delete → recycle bin (restorable from Deleted matches). */}
                <button onClick={() => handleDelete(m)}
                  className="shrink-0 text-slate-300 hover:text-red-600 transition-colors p-1"
                  title="Move to recycle bin">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
