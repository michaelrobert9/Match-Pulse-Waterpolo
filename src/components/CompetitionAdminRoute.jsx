import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchCompetition, fetchCompetitionBySlugSeason } from '../lib/queries'
import { competitionUrl } from '../lib/slugify'

// Route guard for competition-admin pages.
//
// Resolves the competition addressed by the route — either by document id
// (/.../:id) or by the long-term slug+season edition key
// (/competitions/:competitionSlug/:season/...) — then enforces the single
// competition-admin role. Unauthorised signed-in users are sent to the
// competition's public page; signed-out users go to /login.
//
// The resolved competition is handed to children via a render prop so the page
// does not have to fetch it a second time.
export default function CompetitionAdminRoute({ children }) {
  const { id, competitionSlug, season } = useParams()
  const { user, loading, canAdministerCompetition } = useAuth()
  const [competition, setCompetition] = useState(null)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    let alive = true
    setResolving(true)
    const lookup = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : fetchCompetition(id)
    lookup
      .then(c => { if (alive) { setCompetition(c); setResolving(false) } })
      .catch(() => { if (alive) { setCompetition(null); setResolving(false) } })
    return () => { alive = false }
  }, [id, competitionSlug, season])

  if (loading || resolving) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // Unknown competition → 404 fallthrough handled by the public page.
  if (!competition) return <Navigate to="/competitions" replace />

  if (!canAdministerCompetition(competition)) {
    return <Navigate to={competitionUrl(competition)} replace />
  }

  // Pass the resolved competition down so the page can render without refetching.
  return typeof children === 'function' ? children(competition) : children
}
