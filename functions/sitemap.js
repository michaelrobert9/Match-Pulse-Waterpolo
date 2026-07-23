// Dynamic sitemap.xml — generated live from Firestore on each request.
//
// Replaces the hand-maintained public/sitemap.xml. Served at /sitemap.xml via a
// Firebase Hosting rewrite to the `sitemap` function (see firebase.json). Covers
// the static marketing routes plus every public competition, team, player, org
// and final match, so crawlers can discover deep routes that the SPA's client
// rendering would otherwise hide.
//
// URL builders below MIRROR src/lib/slugify.js. Keep them in sync — this file is
// CommonJS (functions runtime) and cannot import the ESM client helpers.

const ORIGIN = 'https://matchpulse.co.za'

// Mirror of src/lib/slugify.js `slugify`.
function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Mirror of competitionUrl(): /competitions/:season/:slug, with legacy fallbacks.
function competitionPath(comp) {
  if (comp.slug && comp.season) return `/competitions/${comp.season}/${comp.slug}`
  if (comp.competitionPath)     return `/competition/${comp.competitionPath}`
  return `/competitions/${comp.id}`
}

// Mirror of orgUrl(): /schools|clubs/:slug.
function orgPath(org) {
  const base = org.type === 'club' ? 'clubs' : 'schools'
  const slug = org.slug || slugify(org.name || '')
  return slug ? `/${base}/${slug}` : null
}

// Mirror of matchUrl(): competition-scoped slug → standalone slug → legacy.
function matchPath(m) {
  if (m.competitionSlug && m.competitionSeason && m.matchSlug)
    return `/competitions/${m.competitionSeason}/${m.competitionSlug}/matches/${m.matchSlug}`
  if (m.season && m.matchSlug) return `/matches/${m.season}/${m.matchSlug}`
  if (m.matchSlug) return `/matches/${m.matchSlug}`
  if (m.slug)      return `/match/${m.slug}`
  return `/matches/${m.id}`
}

// XML-escape a URL/text node (loc values can contain & in query strings).
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Coerce a Firestore Timestamp / Date / ISO string into a YYYY-MM-DD lastmod.
function lastmod(val) {
  try {
    const d = val?.toDate ? val.toDate()
      : (val instanceof Date ? val : (val ? new Date(val) : null))
    if (!d || Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  } catch { return null }
}

function urlEntry({ path, lastmod: lm, changefreq, priority }) {
  const parts = [`    <loc>${xmlEscape(ORIGIN + path)}</loc>`]
  if (lm)         parts.push(`    <lastmod>${lm}</lastmod>`)
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`)
  if (priority != null) parts.push(`    <priority>${priority}</priority>`)
  return `  <url>\n${parts.join('\n')}\n  </url>`
}

// Static, always-present marketing/index routes.
const STATIC_ROUTES = [
  { path: '/',               changefreq: 'daily',   priority: 1.0 },
  { path: '/competitions',   changefreq: 'daily',   priority: 0.9 },
  { path: '/browse',         changefreq: 'daily',   priority: 0.9 },
  { path: '/schools',        changefreq: 'weekly',  priority: 0.8 },
  { path: '/clubs',          changefreq: 'weekly',  priority: 0.8 },
  { path: '/players',        changefreq: 'weekly',  priority: 0.8 },
  { path: '/plans',          changefreq: 'monthly', priority: 0.7 },
  { path: '/why-matchpulse', changefreq: 'monthly', priority: 0.6 },
  { path: '/support',        changefreq: 'monthly', priority: 0.6 },
  { path: '/contact',        changefreq: 'yearly',  priority: 0.4 },
]

// Static Support Centre articles (built from markdown). One sitemap URL each.
let SUPPORT_PATHS = []
try {
  const support = require('./support-content.json')
  SUPPORT_PATHS = Object.values(support.articles || {}).map(a => `/support/${a.category}/${a.slug}`)
} catch (e) { /* generated at build time */ }

// Static legal documents (built from markdown). One sitemap URL each.
let LEGAL_PATHS = []
try {
  const legal = require('./legal-content.json')
  LEGAL_PATHS = (legal.order || []).map(slug => `/legal/${slug}`)
} catch (e) { /* generated at build time */ }

// Build the full sitemap XML string from Firestore. `db` is an admin Firestore.
async function buildSitemap(db, logger) {
  const entries = STATIC_ROUTES.map(urlEntry)
  const seen = new Set(STATIC_ROUTES.map(r => r.path))
  const push = (e) => { if (e.path && !seen.has(e.path)) { seen.add(e.path); entries.push(urlEntry(e)) } }

  // Support Centre articles (static).
  for (const p of SUPPORT_PATHS) push({ path: p, changefreq: 'monthly', priority: 0.5 })

  // Legal documents (static).
  for (const p of LEGAL_PATHS) push({ path: p, changefreq: 'yearly', priority: 0.3 })

  // Public competitions (status: active) → overview pages.
  try {
    const comps = await db.collection('competitions').where('status', '==', 'active').get()
    comps.forEach(d => {
      const c = { id: d.id, ...d.data() }
      push({ path: competitionPath(c), lastmod: lastmod(c.updatedAt), changefreq: 'daily', priority: 0.9 })
    })
  } catch (e) { logger?.warn?.('sitemap: competitions failed', e) }

  // Teams with a frozen slug.
  try {
    const teams = await db.collection('teams').get()
    teams.forEach(d => {
      const t = d.data()
      if (t.slug) push({ path: `/team/${t.slug}`, lastmod: lastmod(t.updatedAt), changefreq: 'weekly', priority: 0.7 })
    })
  } catch (e) { logger?.warn?.('sitemap: teams failed', e) }

  // Players (people) with a frozen slug → career-record pages.
  try {
    const people = await db.collection('people').get()
    people.forEach(d => {
      const p = d.data()
      if (p.slug) push({ path: `/player/${p.slug}`, lastmod: lastmod(p.updatedAt), changefreq: 'weekly', priority: 0.6 })
    })
  } catch (e) { logger?.warn?.('sitemap: people failed', e) }

  // Organisations (schools / clubs).
  try {
    const orgs = await db.collection('organizations').get()
    orgs.forEach(d => {
      const o = { id: d.id, ...d.data() }
      push({ path: orgPath(o), lastmod: lastmod(o.updatedAt), changefreq: 'weekly', priority: 0.7 })
    })
  } catch (e) { logger?.warn?.('sitemap: organizations failed', e) }

  // Final matches → result pages (high long-tail SEO value).
  try {
    const finals = await db.collection('matches').where('status', '==', 'final').get()
    finals.forEach(d => {
      const m = { id: d.id, ...d.data() }
      push({ path: matchPath(m), lastmod: lastmod(m.endedAt || m.updatedAt), changefreq: 'monthly', priority: 0.6 })
    })
  } catch (e) { logger?.warn?.('sitemap: matches failed', e) }

  if (seen.size > 45000) {
    logger?.warn?.(`sitemap: ${seen.size} URLs approaching the 50k single-file limit — split into a sitemap index`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join('\n') +
    `\n</urlset>\n`
}

module.exports = { buildSitemap, slugify, competitionPath, orgPath, matchPath }
