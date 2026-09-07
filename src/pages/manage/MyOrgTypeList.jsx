import { Link } from 'react-router-dom'
import { ChevronRight, Plus, GraduationCap, Building2, Landmark } from 'lucide-react'
import { useMyOrgs } from '../../lib/useMyOrgs'
import { monogram } from '../../lib/names'
import { grantLabel } from '../../lib/capabilities'

// The organiser-side per-type list: the schools / clubs / associations the
// signed-in user belongs to. Backs the "My schools / My clubs / My
// associations" nav items (each locked to one type), replacing the single
// long org list on the Manage hub.
const TYPE_META = {
  school:      { plural: 'schools',      title: 'My schools',      Icon: GraduationCap, single: 'school' },
  club:        { plural: 'clubs',        title: 'My clubs',        Icon: Building2,     single: 'club' },
  association: { plural: 'associations', title: 'My associations', Icon: Landmark,      single: 'association' },
}

function matchesType(org, type) {
  if (type === 'school')      return org.type === 'school'
  if (type === 'association') return org.type === 'association'
  return org.type !== 'school' && org.type !== 'association'   // club (default)
}

export default function MyOrgTypeList({ type = 'school' }) {
  const meta = TYPE_META[type] ?? TYPE_META.school
  const { orgs, loading } = useMyOrgs()
  const mine = orgs.filter(o => matchesType(o, type))
  const Icon = meta.Icon

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-emerald-600" />
            </div>
            <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">{meta.title}</h1>
          </div>
          <Link to="/manage/new-org"
            className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
            + New
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : mine.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
              <Icon className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="text-slate-900 font-display font-bold text-base mb-1">No {meta.plural} yet</h3>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed max-w-xs mx-auto">
              You don’t manage any {meta.plural} yet. Create one to start managing its teams, matches and results.
            </p>
            <Link to="/manage/new-org"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
              <Plus className="w-4 h-4" /> Create {meta.single}
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {mine.map(org => {
              const color = org.primaryColor || '#555'
              return (
                <Link key={org.id} to={`/manage/orgs/${org.id}`}
                  className="flex items-center gap-4 bg-white rounded-xl border border-slate-200 px-4 py-4 hover:border-slate-300 transition-colors group shadow-sm">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: color + '25', border: `2px solid ${color}` }}>
                    {org.logoUrl
                      ? <img src={org.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
                      : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 font-semibold text-sm truncate">{org.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{meta.single}</span>
                      {org.role && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                            {grantLabel(org.role) || org.role}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
