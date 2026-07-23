import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../../firebase'
import CompetitionStatusBadge from '../../components/CompetitionStatusBadge'
import CompetitionCrest from '../../components/CompetitionCrest'

// Admin competitions list. Clicking a competition goes STRAIGHT to the
// Competition Manager (/manage/competitions/:id) — the manager is the single
// admin interface. The old detail/edit pages redirect there (see App.jsx).
export function CompetitionsList() {
  const [comps, setComps] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'competitions'), orderBy('name')))
      .then(snap => setComps(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-slate-900 text-lg">Competitions</h1>
        <Link to="/manage/competitions/new"
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
          + New
        </Link>
      </div>

      {comps.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500 text-sm mb-4">No competitions yet.</p>
          <Link to="/manage/competitions/new" className="text-emerald-600 text-sm hover:underline">Add the first one →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {comps.map(comp => (
            <Link key={comp.id} to={`/manage/competitions/${comp.id}`}
              className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
              <CompetitionCrest competition={comp} size={36} />
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 text-sm font-semibold truncate">{comp.name}</div>
                <div className="micro-label">{[comp.type, comp.ageGroup, comp.gender, comp.season].filter(Boolean).join(' · ')}</div>
              </div>
              <CompetitionStatusBadge competition={comp} className="shrink-0" />
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
