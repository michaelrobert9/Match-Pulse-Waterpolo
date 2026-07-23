import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trophy, ListOrdered, Sparkles, Lock } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { fetchCompetitionsForOrg, fetchCompetitionsForUser } from '../../../lib/adminQueries'
import { fetchOrganization } from '../../../lib/queries'
import { orgEntitlementStatus, userEntitlementStatus } from '../../../lib/entitlement'
import CompetitionStatusBadge from '../../../components/CompetitionStatusBadge'

const TYPE_ICON = { league: Trophy, tournament: ListOrdered, festival: Sparkles }

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
}

export default function CompetitionsManageList() {
  const navigate = useNavigate()
  const { orgRoles, uid, userEntitlement, isPlatformAdmin } = useAuth()
  const [comps,   setComps]   = useState([])
  const [loading, setLoading] = useState(true)
  // entitlementStatus: best entitlement across the user and all orgs they own
  const [entitlement, setEntitlement] = useState(null)

  useEffect(() => {
    let alive = true
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
      // The platform master admin always has full rights. Otherwise pick the best
      // entitlement across the user's own plan and all managed orgs.
      const statuses = [userEntitlementStatus(userEntitlement), ...orgs.filter(Boolean).map(orgEntitlementStatus)]
      const best = isPlatformAdmin
        ? { tier: 'admin', canCreate: true }
        : (statuses.find(s => s.tier === 'pro' && s.canCreate)
          ?? statuses.find(s => s.tier === 'event' && s.canCreate)
          ?? statuses[0]
          ?? { tier: 'none', canCreate: false })
      setEntitlement(best)
      setLoading(false)
    })
    return () => { alive = false }
  }, [orgRoles, uid, userEntitlement, isPlatformAdmin])

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={() => navigate('/manage')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm mb-6">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">Competitions</h1>
            <p className="text-slate-500 text-sm mt-1">Competitions run by your schools &amp; clubs.</p>
          </div>
          {entitlement?.canCreate ? (
            <Link to="/manage/competitions/new"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-colors text-white text-sm font-bold shrink-0">
              <Plus className="w-4 h-4" /> New
            </Link>
          ) : (
            <Link to="/plans"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors text-slate-500 text-sm font-bold shrink-0">
              <Lock className="w-4 h-4" /> New
            </Link>
          )}
        </div>

        {/* Upgrade prompt for free-tier orgs */}
        {!loading && entitlement && !entitlement.canCreate && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Hosting a competition is a Plus or Pro feature.{' '}
              <Link to="/plans" className="font-semibold underline hover:text-amber-900">See Plans</Link>
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
                <Link to="/plans"
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
                  See Plans
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {comps.map(c => {
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
      </div>
    </div>
  )
}
