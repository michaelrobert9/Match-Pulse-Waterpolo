import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { goSignIn } from '../lib/mainSite'

export default function ProtectedRoute({ children, require: requiredRole = 'admin' }) {
  const { user, isPlatformAdmin, canScore, loading } = useAuth()

  // Signed out → the main site owns sign-in. Redirect there; it authenticates
  // and bounces back to /auth/handoff on the path that was requested.
  useEffect(() => {
    if (!loading && !user) goSignIn()
  }, [loading, user])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // The redirect above is in flight — render a spinner, never a login screen.
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (requiredRole === 'any') return children

  // Scorer area: platform admins, plus any organisation owner/staff member.
  // Match-level ownership is enforced separately when a specific match loads.
  if (requiredRole === 'scorer') {
    return canScore ? children : <Navigate to="/" replace />
  }

  if (!isPlatformAdmin) return <Navigate to="/" replace />

  return children
}
