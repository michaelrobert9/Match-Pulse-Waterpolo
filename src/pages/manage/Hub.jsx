import { ChevronLeft, ChevronRight, Plus, Settings2, Building2, Trophy } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { userEntitlementStatus } from '../../lib/entitlement'

// The Manage landing is deliberately light: the left nav now carries the org
// browsing (My schools / My clubs / My associations), competitions, matches and
// profile, so this page is just a greeting plus the few primary actions — and,
// for someone with no organisation yet, the get-started prompt.
export default function ManageHub() {
  const { user, isPlatformAdmin, orgRoles, canScore, userEntitlement } = useAuth()
  const navigate = useNavigate()

  const hasOrgs = Object.keys(orgRoles ?? {}).length > 0
  // A user who has bought a plan — or the platform master admin, who always has
  // full rights — can run their own (personal) competition without an org.
  const canRunPersonalComp = isPlatformAdmin || userEntitlementStatus(userEntitlement).canCreate

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate('/')}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-6">
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">Manage</h1>
              <p className="text-slate-500 text-sm mt-1">
                {user?.displayName || user?.email?.split('@')[0]}
              </p>
            </div>
            {canScore && (
              <Link to="/score"
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-colors text-white text-sm font-bold shrink-0">
                <span className="w-2 h-2 rounded-full bg-white" />
                Score matches
              </Link>
            )}
          </div>
        </div>

        {/* Platform admin quick-access */}
        {isPlatformAdmin && (
          <Link to="/admin"
            className="flex items-center gap-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 hover:bg-amber-100 transition-colors mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
              <Settings2 className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-amber-700">Platform Admin Dashboard</div>
              <div className="text-[11px] text-amber-600 mt-0.5">Competitions · People · All organisations</div>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-500 shrink-0" />
          </Link>
        )}

        {/* Primary actions. Competitions is shown to org members AND to anyone
            with a personal plan. Create match needs an org. */}
        {(hasOrgs || canRunPersonalComp) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {hasOrgs && (
              <Link to="/match/new"
                className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3.5 transition-colors">
                <Plus className="w-4 h-4" />
                Create match
              </Link>
            )}
            <Link to="/manage/competitions"
              className={`flex items-center justify-center gap-2 w-full font-bold text-sm uppercase tracking-wider rounded-xl py-3.5 transition-colors ${
                hasOrgs
                  ? 'bg-white border border-slate-200 hover:border-slate-300 text-slate-700'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white sm:col-span-2'
              }`}>
              <Trophy className={`w-4 h-4 ${hasOrgs ? 'text-slate-500' : ''}`} />
              {hasOrgs ? 'Competitions' : 'My competitions'}
            </Link>
          </div>
        )}

        {/* Get started — only when the user has no organisation yet. Once they
            do, the left nav (My schools / clubs / associations) is where orgs
            live, so this landing stays uncluttered. */}
        {!hasOrgs && (
          <section className="mt-6">
            <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
                <Building2 className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-slate-900 font-display font-bold text-base mb-1">No organisation yet</h3>
              <p className="text-slate-500 text-sm mb-6 leading-relaxed max-w-xs mx-auto">
                Create your school, club or association to start managing teams, matches and results.
              </p>
              <Link to="/manage/new-org"
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
                Create organisation
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
