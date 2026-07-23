import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, Plus, Settings2, Building2, User, Trophy } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { fetchOrganization } from '../../lib/queries'
import { monogram } from '../../lib/names'
import { grantOf, grantLabel } from '../../lib/capabilities'
import { userEntitlementStatus } from '../../lib/entitlement'

function OrgCard({ orgId, role }) {
  const [org, setOrg] = useState(null)

  useEffect(() => {
    fetchOrganization(orgId).then(setOrg).catch(() => {})
  }, [orgId])

  if (!org) return (
    <div className="flex items-center gap-4 bg-white rounded-xl border border-slate-200 px-4 py-4 animate-pulse shadow-sm">
      <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-slate-200 rounded w-1/2" />
        <div className="h-2.5 bg-slate-200 rounded w-1/3" />
      </div>
    </div>
  )

  const color = org.primaryColor || '#555'
  const isOwner = grantOf(role)?.role === 'owner'

  return (
    <Link to={`/manage/orgs/${orgId}`}
      className="flex items-center gap-4 bg-white rounded-xl border border-slate-200 px-4 py-4 hover:border-slate-300 transition-colors group shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + '25', border: `2px solid ${color}` }}>
        {org.logoUrl
          ? <img src={org.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
          : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 font-semibold text-sm truncate">{org.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
            {org.type === 'school' ? 'School' : org.type === 'association' ? 'Association' : 'Club'}
          </span>
          <span className="text-slate-300">·</span>
          <span className={`text-[9px] font-bold uppercase tracking-widest ${isOwner ? 'text-emerald-600' : 'text-slate-500'}`}>
            {grantLabel(role) || (isOwner ? 'Owner' : 'Staff')}
          </span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
    </Link>
  )
}

export default function ManageHub() {
  const { user, isPlatformAdmin, orgRoles, canScore, userEntitlement } = useAuth()
  const navigate = useNavigate()

  const orgEntries = Object.entries(orgRoles ?? {})
  const hasOrgs = orgEntries.length > 0
  // A user who has bought a plan — or the platform master admin, who always has
  // full rights — can run their own (personal) competition without an org.
  const canRunPersonalComp = isPlatformAdmin || userEntitlementStatus(userEntitlement).canCreate

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)}
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
            with a personal plan. Create fixture needs an org. */}
        {(hasOrgs || canRunPersonalComp) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {hasOrgs && (
              <Link to="/fixtures/new"
                className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3.5 transition-colors">
                <Plus className="w-4 h-4" />
                Create fixture
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

        {/* My organisations */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {hasOrgs ? 'My organisations' : 'Get started'}
            </h2>
            <Link to="/manage/new-org"
              className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
              + New
            </Link>
          </div>

          {hasOrgs ? (
            <div className="space-y-2">
              {orgEntries.map(([orgId, role]) => (
                <OrgCard key={orgId} orgId={orgId} role={role} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
                <Building2 className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-slate-900 font-display font-bold text-base mb-1">No organisation yet</h3>
              <p className="text-slate-500 text-sm mb-6 leading-relaxed max-w-xs mx-auto">
                Create your school, club or association to start managing teams, fixtures and results.
              </p>
              <Link to="/manage/new-org"
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
                Create organisation
              </Link>
            </div>
          )}
        </section>

        {/* Quick links (contextual) */}
        {hasOrgs && (
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Quick links</h2>
            <div className="space-y-2">
              <Link to="/manage/new-org"
                className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <Plus className="w-4 h-4 text-slate-500" />
                </div>
                <span className="text-sm text-slate-700">Create another organisation</span>
                <ChevronRight className="w-4 h-4 text-slate-400 ml-auto shrink-0" />
              </Link>
              <Link to="/profile"
                className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-slate-500" />
                </div>
                <span className="text-sm text-slate-700">Profile &amp; account</span>
                <ChevronRight className="w-4 h-4 text-slate-400 ml-auto shrink-0" />
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
