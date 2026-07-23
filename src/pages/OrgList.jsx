import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOrganizationsByType } from '../lib/queries'
import { orgUrl } from '../lib/slugify'
import { monogram } from '../lib/names'
import { useSeoMeta } from '../lib/useSeoMeta'

const COPY = {
  school:      { title: 'Schools',      seoType: 'schools',      empty: 'No schools yet.',      sub: 'Schools will appear here once they are added.' },
  club:        { title: 'Clubs',        seoType: 'clubs',        empty: 'No clubs yet.',        sub: 'Clubs will appear here once they are added.' },
  association: { title: 'Associations', seoType: 'schools',      empty: 'No associations yet.', sub: 'Associations will appear here once they are added.' },
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse shadow-sm">
      <div className="aspect-video bg-slate-200" />
      <div className="px-4 py-3">
        <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
      </div>
    </div>
  )
}

function OrgCard({ org }) {
  const color    = org.primaryColor || '#334155'
  const hasLogo   = !!org.logoUrl
  const hasBanner = !!org.bannerUrl

  return (
    <Link to={orgUrl(org)}
      className="block bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-slate-300 hover:shadow-md transition-all duration-200 shadow-sm group">

      {/* Banner */}
      <div className="relative aspect-video overflow-hidden"
        style={hasBanner ? {} : { backgroundColor: color }}>
        {hasBanner
          ? <img src={org.bannerUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}bb 100%)` }} />
        }
        {/* Logo badge — bottom-left, half-overlapping the content area */}
        <div className="absolute bottom-3 left-4 w-12 h-12 rounded-xl bg-white shadow border border-white/80 flex items-center justify-center overflow-hidden shrink-0">
          {hasLogo
            ? <img src={org.logoUrl} alt="" className="w-full h-full object-contain p-1" />
            : <span className="text-sm font-black font-mono leading-none" style={{ color }}>{monogram(org.name)}</span>
          }
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-4">
        <div className="font-display font-bold text-slate-900 text-base leading-tight">{org.name}</div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {org.region && <span className="text-xs text-slate-500">{org.region}</span>}
          {org.region && <span className="text-slate-300 text-xs">·</span>}
          <span className="text-xs text-slate-400 capitalize">{org.type}</span>
        </div>
      </div>
    </Link>
  )
}

export default function OrgList({ type }) {
  const copy = COPY[type] ?? COPY.school
  const [orgs, setOrgs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  useSeoMeta({ type: copy.seoType })

  function load() {
    setLoading(true)
    setError(false)
    fetchOrganizationsByType(type)
      .then(setOrgs)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [type]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-5">
      <h1 className="font-display font-bold text-slate-900 text-2xl">{copy.title}</h1>

      {error ? (
        <div className="px-4 py-16 flex flex-col items-center gap-4">
          <p className="text-slate-500 text-sm">Failed to load {copy.title.toLowerCase()}.</p>
          <button onClick={load}
            className="text-sm text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm mb-1">{copy.empty}</p>
          <p className="text-slate-400 text-xs">{copy.sub}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {orgs.map(org => <OrgCard key={org.id} org={org} />)}
        </div>
      )}
    </div>
  )
}
