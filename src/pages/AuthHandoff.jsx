// Cross-origin auth handoff. Firebase Auth persists its session in IndexedDB
// scoped to the ORIGIN, so a user signed in on the main site is not signed in
// here. The main site mints a single-use, 60-second ticket and sends the user
// to /auth/handoff#t=<ticket>&p=<path> — the fragment never reaches a server or
// a Referer header. We exchange it for a Firebase custom token and sign in.
//
// This route must stay OUTSIDE the auth guard: the user is by definition not
// signed in yet when they arrive.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase'
import { MAIN_SITE, SPORT_KEY } from '../lib/mainSite'

export default function AuthHandoff() {
  const [error, setError] = useState('')
  const navigate = useNavigate()
  // React StrictMode double-invokes effects in development and the ticket is
  // single-use — the second run would always fail. Guard it.
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    ;(async () => {
      // Read the fragment, then clear it from history immediately so the
      // ticket can't be re-shared, bookmarked or replayed from the URL bar.
      const frag   = new URLSearchParams(window.location.hash.slice(1))
      const ticket = frag.get('t')
      const path   = frag.get('p') || '/'
      window.history.replaceState(null, '', window.location.pathname)

      if (!ticket) { setError('This sign-in link is incomplete.'); return }

      try {
        const redeem = httpsCallable(functions, 'redeemHandoffTicket')
        const { data } = await redeem({ ticket })
        await signInWithCustomToken(auth, data.token)
        navigate(path, { replace: true })
      } catch (err) {
        // Tickets expire after 60 seconds and work exactly once. A refresh of
        // this URL failing is correct behaviour, not a bug.
        setError(
          err?.code === 'functions/deadline-exceeded'
            ? 'That sign-in link expired. Please try again.'
            : 'That sign-in link is no longer valid. Please sign in again.'
        )
      }
    })()
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-6 text-center">
        <div>
          <p className="text-slate-900 font-display font-bold text-lg mb-2">Sign-in link problem</p>
          <p className="text-slate-500 text-sm mb-5 max-w-xs mx-auto leading-relaxed">{error}</p>
          <a href={`${MAIN_SITE}/login?sport=${SPORT_KEY}`}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-6 py-3 transition-colors">
            Sign in again
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] grid place-items-center px-6">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm">Signing you in…</p>
      </div>
    </div>
  )
}
