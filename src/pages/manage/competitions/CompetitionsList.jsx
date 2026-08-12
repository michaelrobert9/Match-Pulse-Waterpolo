import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plus, Trophy, ListOrdered, Sparkles, Lock, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { fetchCompetitionsForOrg, fetchCompetitionsForUser, fetchAllCompetitions } from '../../../lib/adminQueries'
import { fetchOrganization } from '../../../lib/queries'
import { orgEntitlementStatus, userEntitlementStatus, bestEntitlement } from '../../../lib/entitlement'
import { competitionStatus } from '../../../lib/competitionRules'
import { plansUrl } from '../../../lib/mainSite'
import CompetitionStatusBadge from '../../../components/CompetitionStatusBadge'

const TYPE_ICON = { league: Trophy, tournament: ListOrdered, festival: Sparkles }

// Status filter options. Keys are the effective competitionStatus() values;
// labels mirror the StatusBadge wording exactly (note: 'upcoming' shows as
// "Scheduled") so a chip and the badge it filters on always read the same.
const STATUS_FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'live',        label: 'Live' },
  { key: 'upcoming',    label: 'Scheduled' },
  { key: 'completed',   label: 'Completed' },
  { key: 'unpublished', label: 'Unpublished' },
]

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
}

export default function CompetitionsManageList() {
  const { orgRoles, uid, userEntitlement, isPlatformAdmin } = useAuth()
  const [comps,   setComps]   = useState([])
  const [loading, setLoading] = useState(true)
  // entitlementStatus: best entitlement across the user and all orgs they own
  const [entitlement, setEntitlement] = useState(null)
  const [query,        setQuery]        = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    let alive = true

    // Platform admin sees EVERY competition on the platform; everyone else sees
    // the competitions run by their orgs plus their own personal ones. This is
    // the single competitions list — the old /admin/competitions redirects here.
    if (isPlatformAdmin) {
      fetchAllCompetitions()
        .then(all => {
          if (!alive) return
          all.sort((a, b) => String(b.season ?? '').localeCompare(String(a.season ?? '')) || String(a.name).localeCompare(String(b.name)))
          setComps(all)
          setEntitlement({ tier: 'admin', canCreate: true })
          setLoading(false)
        })
        .catch(() => { if (alive) { setEntitlement({ tier: 'admin', canCreate: true }); setLoading(false) } })
      return () => { alive = false }
    }

    const orgIds = Object.keys(orgRoles ?? {})
    Promise.all([
      Promise.all(orgIds.map(id => fetchCompetitionsForOrg(id).catch(() => []))),
      Promise.all(orgIds.map(id => fetchOrganization(id).catch(() => null))),
      uid ? fetchCompetitionsForUser(uid).catch(() => []) : Promise.resolve([]),
    ]).then(([lists, orgs, personal]) => {
      if (!alive) return
      const seen = new Set()
      const flat = [...lists.flat(), ...personal]
        .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
      flat.sort((a, b) => String(b.season ?? '').localeCompare(String(a.season ?? '')) || String(a.name).localeCompare(String(b.name)))
      setComps(flat)
      // Best entitlement across the user's own plan and all managed orgs.
      setEntitlement(bestEntitlement([userEntitlementStatus(userEntitlement), ...orgs.filter(Boolean).map(orgEntitlementStatus)]))
      setLoading(false)
    })
    return () => { alive = false }
  }, [orgRoles, uid, userEntitlement, isPlatformAdmin])

  // Text search on name + status filter. Both are pure client-side narrowing of
  // the already-fetched list, so they apply uniformly to the admin's
  // platform-wide list and an organiser's own scoped list.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return comps.filter(c => {
      if (statusFilter !== 'all' && competitionStatus(c) !== statusFilter) return false
      if (q && !String(c.name ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [comps, query, statusFilter])

  const filtersActive = query.trim() !== '' || statusFilter !== 'all'
  const clearFilters = () => { setQuery(''); setStatusFilter('all') }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* No in-page "Back": the shell's left nav is always present. */}
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">Competitions</h1>
            <p className="text-slate-500 text-sm mt-1">
              {isPlatformAdmin ? 'Every competition on the platform.' : 'Competitions run by your schools & clubs.'}
            </p>
          </div>
          {entitlement?.canCreate ? (
            <Link to="/manage/competitions/new"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-colors text-white text-sm font-bold shrink-0">
              <Plus className="w-4 h-4" /> New
            </Link>
          ) : (
            <a href={plansUrl({ uid, ref: 'competitions-list' })} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors text-slate-500 text-sm font-bold shrink-0">
              <Lock className="w-4 h-4" /> New
            </a>
          )}
        </div>

        {/* Upgrade prompt for free-tier orgs */}
        {!loading && entitlement && !entitlement.canCreate && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Hosting a competition is a Plus or Pro feature.{' '}
              <a href={plansUrl({ uid, ref: 'competitions-list' })} target="_blank" rel="noopener noreferrer" className="font-semibold underline hover:text-amber-900">See Plans</a>
              {' '}to host your first tournament, league or festival.
            </p>
          </div>
        )}

        {loading ? <Spinner /> : comps.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-12 text-center shadow-sm">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
              <Trophy className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="text-slate-900 font-display font-bold text-base mb-1">No competitions yet</h3>
            {entitlement?.canCreate ? (
              <>
                <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto leading-relaxed">Create a league, tournament or festival to get started.</p>
                <Link to="/manage/competitions/new"
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
                  <Plus className="w-4 h-4" /> New competition
                </Link>
              </>
            ) : (
              <>
                <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto leading-relaxed">Hosting a competition requires a Plus or Pro plan.</p>
                <a href={plansUrl({ uid, ref: 'competitions-list' })} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
                  See Plans
                </a>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Search + status filter. Shown once there's more than one
                competition to sift — a single-row list needs no filter. */}
            {comps.length > 1 && (
              <div className="mb-4 space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search competitions by name…"
                    aria-label="Search competitions by name"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-300"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_FILTERS.map(f => (
                    <button key={f.key} type="button" onClick={() => setStatusFilter(f.key)}
                      aria-pressed={statusFilter === f.key}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${statusFilter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
                <p className="text-slate-500 text-sm">No competitions match {filtersActive ? 'your filters' : 'your search'}.</p>
                <button type="button" onClick={clearFilters}
                  className="mt-3 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                  Clear filters
                </button>
              </div>
            ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const Icon = TYPE_ICON[c.type] ?? Trophy
              return (
                <Link key={c.id} to={`/manage/competitions/${c.id}`}
                  className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 text-sm font-semibold truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {(c.type ?? 'league')[0].toUpperCase() + (c.type ?? 'league').slice(1)}
                      {c.season ? ` · ${c.season}` : ''}
                      {!c.published ? ' · Unpublished' : ''}
                    </div>
                  </div>
                  <CompetitionStatusBadge competition={c} className="shrink-0" />
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </Link>
              )
            })}
          </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
