// The main MatchPulse site owns account SETTINGS, plans and billing. Sign-in
// itself is LOCAL to this subdomain now (platform brief v2 §1/§2): an installed
// iOS home-screen app can't be redirected off-origin to log in and back. So we
// only link out for things that genuinely live centrally — changing your name,
// email or password, and buying/managing a plan.

export const MAIN_SITE = import.meta.env.VITE_MAIN_SITE || 'https://matchpulse.co.za'
export const SPORT_KEY = 'waterpolo'

// Pricing / plan CTAs point at the main site's plans section.
export const MAIN_PLANS_URL   = `${MAIN_SITE}/#plans`
// Account settings (name, email, password) live on the main site.
export const MAIN_ACCOUNT_URL = `${MAIN_SITE}/account`

// Send a user to the main site's account page (name / email / password).
export function goAccount() {
  window.location.assign(MAIN_ACCOUNT_URL)
}
