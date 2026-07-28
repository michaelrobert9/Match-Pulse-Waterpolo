// The main MatchPulse site owns identity, plans and billing. This app never
// renders a login, password, email-change or purchase screen — it sends the
// user there instead. See the platform brief §2 and §4.

export const MAIN_SITE = import.meta.env.VITE_MAIN_SITE || 'https://matchpulse.co.za'
export const SPORT_KEY = 'waterpolo'

// Pricing / plan CTAs point at the main site's plans section.
export const MAIN_PLANS_URL   = `${MAIN_SITE}/#plans`
// Account settings (name, email, password) live on the main site.
export const MAIN_ACCOUNT_URL = `${MAIN_SITE}/account`

// Send a signed-out user to the main site to sign in. It authenticates them and
// bounces them straight back here — via /auth/handoff — on the path they asked
// for.
export function goSignIn(path = window.location.pathname + window.location.search) {
  const q = new URLSearchParams({ sport: SPORT_KEY, path })
  window.location.assign(`${MAIN_SITE}/login?${q}`)
}

// Send a user to the main site's account page (name / email / password).
export function goAccount() {
  window.location.assign(MAIN_ACCOUNT_URL)
}
