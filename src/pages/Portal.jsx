import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Landing target after sign-in and after a PayFast payment returns. Because the
// PayFast ITN webhook grants entitlement a moment after the buyer is redirected
// back, we briefly poll the user profile so a just-purchased plan is reflected
// before we decide where to send them — rather than bouncing them home.
const MAX_TRIES   = 5
const RETRY_MS    = 1500

export default function Portal() {
  const { user, isPlatformAdmin, canScore, loading, refreshUserData } = useAuth()
  const [settling, setSettling] = useState(true)
  const triesRef = useRef(0)

  useEffect(() => {
    if (loading || !user || isPlatformAdmin || canScore) { setSettling(false); return }
    // Signed in but no access yet — the payment may still be settling. Poll.
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      triesRef.current += 1
      await refreshUserData()
      if (cancelled) return
      if (triesRef.current >= MAX_TRIES) { setSettling(false); return }
      setTimeout(tick, RETRY_MS)
    }
    const t = setTimeout(tick, RETRY_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [loading, user, isPlatformAdmin, canScore, refreshUserData])

  if (loading || (settling && user && !isPlatformAdmin && !canScore)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-canvas gap-4">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm">Activating your plan…</p>
      </div>
    )
  }

  if (!user)           return <Navigate to="/login"  replace />
  if (isPlatformAdmin) return <Navigate to="/admin"  replace />
  if (canScore)        return <Navigate to="/manage" replace />
  return <Navigate to="/" replace />
}
