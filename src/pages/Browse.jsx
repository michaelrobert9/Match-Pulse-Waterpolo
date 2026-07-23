import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { fetchOrganizationsByType, fetchAllCompetitions } from '../lib/queries'
import { orgUrl, competitionUrl } from '../lib/slugify'
import CompetitionStatusBadge from '../components/CompetitionStatusBadge'
import { monogram } from '../lib/names'

function CompLogoBadge({ comp }) {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [comp.logoUrl])
  const logo = comp.logoUrl
  const abbr = monogram(comp.name)
  if (logo && ok) {
    return (
      <div className="w-10 h-10 rounded-xl shrink-0 overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
        <img src={logo} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center bg-emerald-50 border border-emerald-100">
      <span className="text-[11px] font-black font-display text-emerald-700 leading-none">{abbr}</span>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 animate-pulse flex items-center gap-3 shadow-sm">
      <div className="w-9 h-9 rounded-lg bg-slate-200 shrink-0" />
      <div className="flex-1">
        <div className="h-4 bg-slate-200 rounded w-1/2 mb-1.5" />
        <div className="h-3 bg-slate-200 rounded w-1/3" />
      </div>
    </div>
  )
}

function OrgCard({ org }) {
  const color = org.primaryColor || '#555'
  return (
    <Link to={orgUrl(org)}
      className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 shadow-sm card-lift">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
        style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
        {org.logoUrl
          ? <img src={org.logoUrl} alt="" className="w-full h-full object-contain" />
          : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 text-sm font-semibold truncate">{org.name}</div>
        {org.region && <div className="micro-label">{org.region}</div>}
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </Link>
  )
}

function CompetitionCard({ comp }) {
  return (
    <Link to={competitionUrl(comp)}
      className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 shadow-sm card-lift">
      <CompLogoBadge comp={comp} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <CompetitionStatusBadge competition={comp} />
        </div>
        <div className="font-display font-bold text-slate-900 text-sm leading-tight truncate">{comp.name}</div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {comp.season   && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{comp.season}</span>}
          {comp.gender   && <><span className="text-slate-300">·</span><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{comp.gender}</span></>}
          {comp.ageGroup && <><span className="text-slate-300">·</span><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{comp.ageGroup}</span></>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </Link>
  )
}

export default function Browse() {
  const [segment, setSegment] = useState('school')
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    document.title = 'Browse · MatchPulse'
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(false)
    ;(segment === 'competition' ? fetchAllCompetitions() : fetchOrganizationsByType(segment))
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [segment])

  const EMPTY = {
    school:      { title: 'No schools yet.',      sub: 'Schools will appear here once they register on MatchPulse.' },
    club:        { title: 'No clubs yet.',         sub: 'Clubs will appear here once they register on MatchPulse.' },
    competition: { title: 'No competitions yet.',  sub: 'Competitions will appear here once they are created.' },
  }
  const empty = EMPTY[segment]

  const errorLabel = segment === 'school' ? 'schools' : segment === 'club' ? 'clubs' : 'competitions'

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-5 page-enter">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-slate-900 text-2xl">Browse</h1>
      </div>

      {/* Segment control */}
      <div className="inline-flex bg-slate-100 rounded-xl p-1 gap-1">
        {[
          { value: 'school',      label: 'Schools' },
          { value: 'club',        label: 'Clubs' },
          { value: 'competition', label: 'Competitions' },
        ].map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setSegment(value)}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors ${
              segment === value
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-4 py-16">
          <p className="text-slate-500 text-sm">Failed to load {errorLabel}.</p>
          <button onClick={() => setSegment(s => s)}
            className="text-sm text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonRow key={i} />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm mb-1">{empty.title}</p>
          <p className="text-slate-400 text-xs">{empty.sub}</p>
        </div>
      ) : segment === 'competition' ? (
        <div className="space-y-2">
          {items.map(comp => <CompetitionCard key={comp.id} comp={comp} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map(org => <OrgCard key={org.id} org={org} />)}
        </div>
      )}
    </div>
  )
}
