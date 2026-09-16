import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { fetchRedirect } from '../lib/queries'

// Shown when a competition (or one of its pages) can't be found at the current
// URL. Its slug may have been changed by an admin — before giving up, check for
// a redirect from the old URL to the new one and send the visitor there.
export default function RedirectOrNotFound({ message = 'Not found.' }) {
  const [to, setTo] = useState(undefined) // undefined = checking, null = no redirect
  useEffect(() => {
    let alive = true
    fetchRedirect(window.location.pathname)
      .then(dest => { if (alive) setTo(dest || null) })
      .catch(() => { if (alive) setTo(null) })
    return () => { alive = false }
  }, [])
  if (to === undefined) return null
  if (to) return <Navigate to={to} replace />
  return <div className="px-4 py-12 text-center text-slate-500 text-sm">{message}</div>
}
