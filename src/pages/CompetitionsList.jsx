import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchAllCompetitions } from '../lib/queries'
import { competitionUrl } from '../lib/slugify'
import { competitionLifecycle } from '../lib/competitionRules'
import CompetitionStatusBadge from '../components/CompetitionStatusBadge'
import CompetitionCrest from '../components/CompetitionCrest'

import { monogram } from '../lib/names'

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

function CompetitionCard({ comp }) {
  const hasLogo   = !!comp.logoUrl
  const hasBanner = !!comp.bannerUrl

  return (
    <Link to={competitionUrl(comp)}
      className="block bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-slate-300 hover:shadow-md transition-all duration-200 shadow-sm group">

      {/* Banner */}
      <div className="relative aspect-video overflow-hidden bg-emerald-800">
        {hasBanner
          ? <img src={comp.bannerUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 to-emerald-900" />
        }
        {/* Status badge — top right */}
        <div className="absolute top-3 right-3">
          <CompetitionStatusBadge competition={comp} />
        </div>
        {/* Logo badge — bottom left */}
        <div className="absolute bottom-3 left-4 w-12 h-12 rounded-xl bg-white shadow border border-white/80 flex items-center justify-center overflow-hidden shrink-0">
          {hasLogo
            ? <img src={comp.logoUrl} alt="" className="w-full h-full object-contain p-1" />
            : <span className="text-sm font-black text-emerald-700 leading-none">{monogram(comp.name)}</span>
          }
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-4">
        <div className="font-display font-bold text-slate-900 text-base leading-tight">{comp.name}</div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {comp.season   && <span className="text-xs text-slate-500">{comp.season}</span>}
          {comp.gender   && <><span className="text-slate-300 text-xs">·</span><span className="text-xs text-slate-500">{comp.gender}</span></>}
          {comp.ageGroup && <><span className="text-slate-300 text-xs">·</span><span className="text-xs text-slate-500">{comp.ageGroup}</span></>}
          {comp.type     && <><span className="text-slate-300 text-xs">·</span><span className="text-xs text-slate-500">{comp.type}</span></>}
        </div>
      </div>
    </Link>
  )
}

const SELECT_CLASS ='w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500 transition-colors'

export default function CompetitionsList() {
  const { isPlatformAdmin } = useAuth()
  const [comps,   setComps]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const [filterSeason,   setFilterSeason]   = useState('')
  const [filterGender,   setFilterGender]   = useState('')
  const [filterAgeGroup, setFilterAgeGroup] = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')

  function load() {
    setLoading(true)
    setError(null)
    fetchAllCompetitions()
      .then(setComps)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    document.title = 'Competitions · MatchPulse'
    load()
  }, [])

  const seasons = [...new Set(comps.map(c => c.season).filter(Boolean))].sort().reverse()

  const filtered = comps.filter(c => {
    if (filterSeason   && c.season   !== filterSeason)   return false
    if (filterGender   && c.gender   !== filterGender)   return false
    if (filterAgeGroup && c.ageGroup !== filterAgeGroup) return false
    if (filterStatus   && competitionLifecycle(c) !== filterStatus) return false
    return true
  })

  const canCreate = isPlatformAdmin

  if (error) {
    return (
      <div className="px-4 py-20 flex flex-col items-center gap-4">
        <p className="text-slate-500 text-sm text-center">Failed to load competitions.</p>
        <button onClick={load}
          className="text-sm text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors">
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-5 page-enter">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-slate-900 text-2xl">Competitions</h1>
        {canCreate && (
          <Link to="/admin/competitions/new"
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg px-3 py-2 transition-colors shrink-0">
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select value={filterSeason} onChange={e => setFilterSeason(e.target.value)} className={SELECT_CLASS}>
          <option value="">All seasons</option>
          {seasons.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SELECT_CLASS}>
          <option value="">All statuses</option>
          <option value="upcoming">Upcoming</option>
          <option value="live">Live</option>
          <option value="completed">Completed</option>
        </select>
        <select value={filterGender} onChange={e => setFilterGender(e.target.value)} className={SELECT_CLASS}>
          <option value="">All genders</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="boys">Boys</option>
          <option value="girls">Girls</option>
        </select>
        <select value={filterAgeGroup} onChange={e => setFilterAgeGroup(e.target.value)} className={SELECT_CLASS}>
          <option value="">All ages</option>
          <option value="senior">Senior</option>
          <option value="u21">U21</option>
          <option value="u18">U18</option>
          <option value="u16">U16</option>
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          {comps.length === 0 ? (
            <>
              <p className="text-slate-500 text-sm mb-1">No competitions yet.</p>
              <p className="text-slate-400 text-xs mb-4">
                Competitions from schools and clubs will appear here.
              </p>
              {canCreate && (
                <Link to="/admin/competitions/new"
                  className="text-emerald-600 text-sm hover:underline">
                  Create the first competition →
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="text-slate-500 text-sm mb-2">No competitions match these filters.</p>
              <button
                onClick={() => { setFilterSeason(''); setFilterGender(''); setFilterAgeGroup(''); setFilterStatus('') }}
                className="text-emerald-600 text-sm hover:underline">
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(c => <CompetitionCard key={c.id} comp={c} />)}
        </div>
      )}
    </div>
  )
}
