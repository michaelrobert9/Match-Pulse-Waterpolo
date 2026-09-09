import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, ExternalLink, Trash2, Plus, Archive } from 'lucide-react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { fetchAllMatches, fetchOrganizations, toDate } from '../../lib/queries'
import { deleteMatch } from '../../lib/adminQueries'
import { isScheduled } from '../../lib/fixtureStatus'
import { matchUrl } from '../../lib/slugify'
import { prefetchMatchTeams, resolveTeamSideSync } from '../../lib/teamIdentity'
import { MatchTeamIdentity } from '../../components/TeamIdentity'
import StatusBadge from '../../components/StatusBadge'

const SELECT_CLASS =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500 transition-colors'

const ORG_TYPES = [
  ['school',      'Schools'],
  ['club',        'Clubs'],
  ['association', 'Associations'],
]

const TABS = [
  ['competitions', 'Competitions'],
  ['week',         'This week'],
  ['upcoming',     'Upcoming'],
  ['orphaned',     'Orphaned'],
]

// One match row, reused across every tab and the filtered list.
function MatchRow({ m, onDelete }) {
  const isLive  = m.status === 'live' || m.status === 'paused'
  const isFinal = m.status === 'final'
  const when = (() => {
    const d = toDate(m.scheduledAt)
    return d
      ? d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Date TBD'
  })()
  return (
    <div className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 shadow-sm ${isLive ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <MatchTeamIdentity match={m} side="home" hideIdentifier nameClass="text-slate-900 text-sm font-semibold truncate" />
          {(isLive || isFinal)
            ? <span className="font-mono font-black text-slate-900 text-sm tabular-nums shrink-0">{m.homeScore ?? 0}–{m.awayScore ?? 0}</span>
            : <span className="text-slate-400 text-xs shrink-0">vs</span>}
          <MatchTeamIdentity match={m} side="away" hideIdentifier nameClass="text-slate-900 text-sm font-semibold truncate" />
        </div>
        <div className="micro-label flex items-center gap-2 flex-wrap">
          <span>{when}</span>
          {m.pitch && <span className="text-slate-300">·</span>}
          {m.pitch && <span>{m.pitch}</span>}
          {(m.competitionName || m.competitionSlug) && <span className="text-slate-300">·</span>}
          {(m.competitionName || m.competitionSlug) && <span className="truncate">{m.competitionName || m.competitionSlug}</span>}
        </div>
      </div>
      <StatusBadge status={m.status} className="shrink-0" />
      <a href={matchUrl(m)} target="_blank" rel="noreferrer"
        className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors p-1" title="Open public page">
        <ExternalLink className="w-4 h-4" />
      </a>
      <Link to={`/score/${m.id}`}
        className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
        {isFinal ? 'Edit' : isLive ? 'Score' : 'Edit'}
        <ChevronRight className="w-4 h-4" />
      </Link>
      <button onClick={() => onDelete(m)}
        className="shrink-0 text-slate-300 hover:text-red-600 transition-colors p-1" title="Move to recycle bin">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

// Admin matches. Non-deleted matches across the platform, organised into tabs:
// Competitions (grouped, collapsible) · This week (next 7 days) · Upcoming
// (beyond) · Orphaned (no competition and no resolvable org/team — stray/old
// data to clear). The type→school/club/association→team filter searches ACROSS
// all matches when active, so any match is findable regardless of tab.
export function FixturesList() {
  const [matches, setMatches] = useState([])
  const [orgs, setOrgs]       = useState([])
  const [teamIds, setTeamIds] = useState(() => new Set())
  const [loading, setLoading] = useState(true)

  const [tab, setTab]         = useState('competitions')
  const [openComps, setOpenComps] = useState(() => new Set())

  const [fType,   setFType]   = useState('')
  const [fOrg,    setFOrg]    = useState('')
  const [fTeam,   setFTeam]   = useState('')
  const [fGround, setFGround] = useState('')
  const [fLeague, setFLeague] = useState('')
  const [fSeason, setFSeason] = useState('')
  const [fStatus, setFStatus] = useState('')

  useEffect(() => {
    Promise.all([
      fetchAllMatches(),
      fetchOrganizations().catch(() => []),
      getDocs(collection(db, 'teams')).then(s => new Set(s.docs.map(d => d.id))).catch(() => new Set()),
    ])
      .then(([list, orgList, tids]) => { prefetchMatchTeams(list); setMatches(list); setOrgs(orgList); setTeamIds(tids) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const orgIds = useMemo(() => new Set(orgs.map(o => o.id)), [orgs])

  const orgOptions = useMemo(() => {
    const inMatches = new Set()
    matches.forEach(m => { if (m.homeOrgId) inMatches.add(m.homeOrgId); if (m.awayOrgId) inMatches.add(m.awayOrgId) })
    return orgs
      .filter(o => inMatches.has(o.id))
      .filter(o => !fType || o.type === fType)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [orgs, matches, fType])

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

  const filterActive = !!(fType || fOrg || fTeam || fGround || fLeague || fSeason || fStatus)

  const passesFilters = m => {
    if (fOrg    && m.homeOrgId !== fOrg && m.awayOrgId !== fOrg) return false
    if (fTeam   && m.homeTeamId !== fTeam && m.awayTeamId !== fTeam) return false
    if (fGround && m.pitch !== fGround) return false
    if (fLeague && m.competitionId !== fLeague) return false
    if (fSeason && (m.competitionSeason || m.season) !== fSeason) return false
    if (fStatus === 'scheduled') { if (!isScheduled(m)) return false }
    else if (fStatus && m.status !== fStatus) return false
    return true
  }

  // A match is orphaned when it belongs to no competition and neither side
  // resolves to a live organisation or team — it appears on no public page.
  const isOrphan = m =>
    !m.competitionId
    && !(m.homeOrgId && orgIds.has(m.homeOrgId)) && !(m.awayOrgId && orgIds.has(m.awayOrgId))
    && !(m.homeTeamId && teamIds.has(m.homeTeamId)) && !(m.awayTeamId && teamIds.has(m.awayTeamId))

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAhead    = new Date(startOfToday); weekAhead.setDate(weekAhead.getDate() + 7)

  const byDateAsc  = (a, b) => (toDate(a.scheduledAt) ?? 0) - (toDate(b.scheduledAt) ?? 0)
  const byDateDesc = (a, b) => (toDate(b.scheduledAt) ?? 0) - (toDate(a.scheduledAt) ?? 0)

  // Filtered (cross-tab) results when any filter is active.
  const filteredList = useMemo(
    () => matches.filter(passesFilters).sort(byDateDesc),
    [matches, fOrg, fTeam, fGround, fLeague, fSeason, fStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tab counts.
  const counts = useMemo(() => {
    let comp = 0, week = 0, up = 0, orph = 0
    for (const m of matches) {
      if (m.competitionId) comp++
      const d = toDate(m.scheduledAt)
      if (d && d >= startOfToday && d <= weekAhead) week++
      else if (d && d > weekAhead) up++
      if (isOrphan(m)) orph++
    }
    return { competitions: comp, week, upcoming: up, orphaned: orph }
  }, [matches, orgIds, teamIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Competition groups for the Competitions tab.
  const compGroups = useMemo(() => {
    const map = new Map()
    for (const m of matches) {
      if (!m.competitionId) continue
      const g = map.get(m.competitionId) ?? { id: m.competitionId, label: m.competitionName || m.competitionSlug || m.competitionId, items: [] }
      g.items.push(m)
      map.set(m.competitionId, g)
    }
    return [...map.values()]
      .map(g => ({ ...g, items: g.items.sort(byDateDesc) }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [matches])

  const weekList = useMemo(
    () => matches.filter(m => { const d = toDate(m.scheduledAt); return d && d >= startOfToday && d <= weekAhead }).sort(byDateAsc),
    [matches]) // eslint-disable-line react-hooks/exhaustive-deps
  const upcomingList = useMemo(
    () => matches.filter(m => { const d = toDate(m.scheduledAt); return d && d > weekAhead }).sort(byDateAsc),
    [matches]) // eslint-disable-line react-hooks/exhaustive-deps
  const orphanList = useMemo(
    () => matches.filter(isOrphan).sort(byDateDesc),
    [matches, orgIds, teamIds]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(m) {
    if (!confirm(`Move "${resolveTeamSideSync(m, 'home').primary} vs ${resolveTeamSideSync(m, 'away').primary}" to the recycle bin? You can restore it from Deleted matches.`)) return
    try {
      await deleteMatch(m.id)
      setMatches(prev => prev.filter(x => x.id !== m.id))
    } catch (e) { alert(e.message || 'Delete failed.') }
  }

  function toggleComp(id) {
    setOpenComps(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const emptyNote = txt => (
    <div className="text-center py-12"><p className="text-slate-500 text-sm">{txt}</p></div>
  )

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-slate-900 text-lg">Matches</h1>
          <span className="text-xs text-slate-400">{matches.length} total</span>
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
        <select value={fType} onChange={e => { setFType(e.target.value); setFOrg(''); setFTeam('') }} className={SELECT_CLASS}>
          <option value="">All types</option>
          {ORG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={fOrg} onChange={e => { setFOrg(e.target.value); setFTeam('') }} className={SELECT_CLASS}>
          <option value="">{fType ? `All ${fType}s` : 'All organisations'}</option>
          {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={fTeam} onChange={e => setFTeam(e.target.value)} disabled={!fOrg} className={`${SELECT_CLASS} disabled:opacity-50`}>
          <option value="">{fOrg ? 'All teams' : 'Select an organisation first'}</option>
          {teamOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
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

      {filterActive ? (
        // Cross-tab filtered results — any match, regardless of tab.
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Filtered results · {filteredList.length}</p>
            <button onClick={() => { setFType(''); setFOrg(''); setFTeam(''); setFGround(''); setFLeague(''); setFSeason(''); setFStatus('') }}
              className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700">Clear filters</button>
          </div>
          {filteredList.length === 0 ? emptyNote('No matches for these filters.')
            : <div className="space-y-2">{filteredList.map(m => <MatchRow key={m.id} m={m} onDelete={handleDelete} />)}</div>}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  tab === id ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-700'
                }`}>
                {label} <span className={tab === id ? 'text-slate-300' : 'text-slate-400'}>{counts[id] ?? 0}</span>
              </button>
            ))}
          </div>

          {tab === 'competitions' && (
            compGroups.length === 0 ? emptyNote('No competition matches.') : (
              <div className="space-y-2">
                {compGroups.map(g => {
                  const open = openComps.has(g.id)
                  return (
                    <div key={g.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <button onClick={() => toggleComp(g.id)}
                        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
                        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                        <span className="flex-1 text-left text-sm font-semibold text-slate-900 truncate">{g.label}</span>
                        <span className="text-xs text-slate-400 shrink-0">{g.items.length} match{g.items.length === 1 ? '' : 'es'}</span>
                      </button>
                      {open && (
                        <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50/50">
                          {g.items.map(m => <MatchRow key={m.id} m={m} onDelete={handleDelete} />)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}

          {tab === 'week' && (
            weekList.length === 0 ? emptyNote('No matches in the next 7 days.')
              : <div className="space-y-2">{weekList.map(m => <MatchRow key={m.id} m={m} onDelete={handleDelete} />)}</div>
          )}

          {tab === 'upcoming' && (
            upcomingList.length === 0 ? emptyNote('No matches scheduled beyond the next 7 days.')
              : <div className="space-y-2">{upcomingList.map(m => <MatchRow key={m.id} m={m} onDelete={handleDelete} />)}</div>
          )}

          {tab === 'orphaned' && (
            <>
              <p className="text-xs text-slate-500 mb-3">
                Matches that belong to no competition and don’t resolve to a live organisation or team — usually stray or old test data. Review and move to the recycle bin.
              </p>
              {orphanList.length === 0 ? emptyNote('No orphaned matches — nothing to clean up.')
                : <div className="space-y-2">{orphanList.map(m => <MatchRow key={m.id} m={m} onDelete={handleDelete} />)}</div>}
            </>
          )}
        </>
      )}
    </div>
  )
}
