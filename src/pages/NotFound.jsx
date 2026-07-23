import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { fetchRedirect } from '../lib/queries'

export default function NotFound() {
  const location = useLocation()
  const navigate = useNavigate()
  // Before showing 404, check for a slug-correction redirect record so links
  // shared before a slug was corrected keep resolving.
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    fetchRedirect(location.pathname)
      .then(r => {
        if (!alive) return
        if (r?.toPath) navigate(r.toPath, { replace: true })
        else setChecking(false)
      })
      .catch(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [location.pathname, navigate])

  if (checking) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 px-6 text-center">
      <span className="font-mono text-5xl font-black text-slate-700">404</span>
      <p className="text-slate-500 text-sm">Page not found.</p>
      <Link to="/" className="text-emerald-600 text-sm hover:underline">Back to home</Link>
    </div>
  )
}
