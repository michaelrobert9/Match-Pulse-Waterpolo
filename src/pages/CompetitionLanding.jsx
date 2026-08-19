import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import {
  fetchCompetition, fetchCompetitionByPath, fetchCompetitionBySlugSeason,
} from '../lib/queries'
import { competitionStatus } from '../lib/competitionRules'
import { competitionUrl } from '../lib/slugify'

// The competition base URL is a router: it sends the visitor to the right
// landing tab. A competition lands on MATCHES while it is still upcoming or
// live — that is what people want to see first — and only lands on OVERVIEW
// once it is completed. Overview always stays reachable at /overview.
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

export default function CompetitionLanding() {
  const { id, series, ageGroup, season, competitionSlug } = useParams()
  const [dest, setDest] = useState(undefined) // undefined = loading, null = not found

  useEffect(() => {
    let alive = true
    const p = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : series ? fetchCompetitionByPath(`${series}/${ageGroup}/${season}`)
      : fetchCompetition(id)
    p.then(comp => {
      if (!alive) return
      if (!comp) { setDest(null); return }
      const base = competitionUrl(comp)
      const done = competitionStatus(comp) === 'completed'
      setDest(`${base}/${done ? 'overview' : 'matches'}`)
    }).catch(() => { if (alive) setDest(null) })
    return () => { alive = false }
  }, [id, series, ageGroup, season, competitionSlug])

  if (dest === undefined) return <Spinner />
  if (dest === null)
    return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>
  return <Navigate to={dest} replace />
}
