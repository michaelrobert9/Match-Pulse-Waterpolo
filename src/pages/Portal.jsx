import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Landing target after sign-in. We refresh the user's data ONCE so anything just
// granted (an invite claimed during sign-up, for example) is reflected before we
// route, rather than deciding on stale state.
//
// Plans are activated manually by the main site, so there is nothing to sit and
// poll for here. The single refresh is hard-capped by a timeout so this screen
// can never hang, whatever the refresh does.
const SETTLE_TIMEOUT_MS = 4000

export default function Portal() {
  const { user, isPlatformAdmin, canScore, loading, refreshUserData } = useAuth()
  const [settling, setSettling] = useState(true)

  useEffect(() => {
    let done = false
    const finish = () => { if (!done) { done = true; setSettling(false) } }
    // One refresh, then route. refreshUserData resolves immediately when there
    // is no signed-in user, so a signed-out visitor moves straight on.
    Promise.resolve(refreshUserData?.()).catch(() => {}).then(finish)
    // Safety net: never leave the spinner up if the refresh stalls.
    const t = setTimeout(finish, SETTLE_TIMEOUT_MS)
    return () => { done = true; clearTimeout(t) }
    // Run once on mount. refreshUserData's identity changes on every provider
    // render; depending on it re-ran this effect in a loop that could starve its
    // own timer and leave the spinner up forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading || (settling && user)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-canvas gap-4">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm">Signing you in…</p>
      </div>
    )
  }

  // No user: normally a signed-out visitor, but it can also be the brief gap
  // right after sign-in before the session propagates — /login bounces straight
  // back here the instant it resolves, so we never wrongly assume signed-out.
  if (!user)           return <Navigate to="/login?next=/portal" replace />
  if (isPlatformAdmin) return <Navigate to="/admin"  replace />
  if (canScore)        return <Navigate to="/manage" replace />
  return <Navigate to="/" replace />
}
