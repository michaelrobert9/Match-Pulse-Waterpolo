// The main MatchPulse site owns account SETTINGS, plans and billing end to end:
// a buyer completes a form there, gets an invoice, pays by EFT, and the plan is
// activated manually from the back end. Sign-in itself is LOCAL to this subdomain
// (platform brief v2 §1/§2) — an installed home-screen app can't be redirected
// off-origin to log in and back. So we only link out for things that genuinely
// live centrally: changing your name/email/password, and buying/managing a plan.
// The sport apps only ever READ entitlement; they never take payment or grant it.

// MAIN_SITE is resolved once (from the deploy env) in firebase.js; it is imported
// here rather than re-read so a staging/preview override stays consistent app-wide.
import { MAIN_SITE, SPORT_KEY } from '../firebase'
export { MAIN_SITE, SPORT_KEY }

// The plans/products page on the main site. Every plan/purchase CTA points here.
export const PLANS_URL = `${MAIN_SITE}/products`
// Account settings (name, email, password) live on the main site.
export const MAIN_ACCOUNT_URL = `${MAIN_SITE}/account`

// Build the outbound plans URL, tagging on who is asking and from where. These
// params are informational only — /products ignores them today — but they let a
// manual sale be attributed to a sport, an org and a user before the buyer emails
// in. Empty values are omitted; with none set this is just PLANS_URL.
export function plansUrl({ sport = SPORT_KEY, orgId, uid, tier, ref } = {}) {
  const params = new URLSearchParams()
  if (sport) params.set('sport', sport)
  if (orgId) params.set('org', orgId)
  if (uid)   params.set('uid', uid)
  if (tier)  params.set('tier', tier)
  if (ref)   params.set('ref', ref)
  const qs = params.toString()
  return qs ? `${PLANS_URL}?${qs}` : PLANS_URL
}

// Send a user to the main site's account page (name / email / password).
export function goAccount() {
  window.location.assign(MAIN_ACCOUNT_URL)
}
