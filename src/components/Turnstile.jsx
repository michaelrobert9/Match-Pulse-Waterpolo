import { useEffect, useRef } from 'react'

// Cloudflare Turnstile captcha widget. Self-contained: dynamically loads the
// Turnstile script (no npm dependency, no new UI library) and renders the widget
// only when a site key is configured via VITE_TURNSTILE_SITE_KEY. When no key is
// set the component renders nothing and `turnstileConfigured` is false, so the
// contact form can present itself without a captcha before the keys are
// provisioned (the backend skips verification to match). Get keys at
// dash.cloudflare.com → Turnstile.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

export const turnstileConfigured = !!SITE_KEY

let scriptPromise = null
function loadScript() {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve()
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load captcha'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

// Renders the widget and reports its token: onToken(token) when solved, and
// onToken('') when the token expires or errors (so the caller can re-disable
// submission). Renders nothing when no site key is configured.
export default function Turnstile({ onToken }) {
  const ref = useRef(null)
  const widgetId = useRef(null)
  const cb = useRef(onToken)
  cb.current = onToken

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (t) => cb.current?.(t),
        'expired-callback': () => cb.current?.(''),
        'error-callback': () => cb.current?.(''),
      })
    }).catch(() => {})
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current) } catch { /* already gone */ }
      }
    }
  }, [])

  if (!SITE_KEY) return null
  return <div ref={ref} className="min-h-[65px]" />
}
