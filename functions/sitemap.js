// Dynamic sitemap.xml — generated live from Firestore on each request.
//
// Served at /sitemap.xml via a Firebase Hosting rewrite to the sitemap function
// (see firebase.json). Covers the static marketing routes plus every public
// competition, team, player, org and final match, so crawlers can discover deep
// routes that the SPA's client rendering would otherwise hide.
//
// URL builders below MIRROR src/lib/matchPaths.js + src/lib/slugify.js. Keep
// them in sync — this file is CommonJS (functions runtime) and cannot import
// the ESM client helpers. Matches prefer the stored `path` field, which is the
// canonical URL identity MatchDetail resolves by (re-stamped on team/date
// changes), so the sitemap can never drift from what the app serves.

const ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://waterpolo.matchpulse.co.za').replace(/\/$/, '')

// Mirror of src/lib/matchPaths.js `slugify` (NFKD, & → "and").
function slugify(str) {
  return String(str ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Mirror of competitionUrl(): /competitions/:season/:slug, legacy fallback.
// No slug+season → null (the raw-id route exists but is not canonical).
function competitionPath(comp) {
  if (comp.slug && comp.season) return `/competitions/${comp.season}/${comp.slug}`
  if (comp.competitionPath)     return `/competition/${comp.competitionPath}`
  return null
}

// Mirror of orgUrl(): /schools|clubs|associations/:slug.
function orgPath(org) {
  const base = org.type === 'school' ? 'schools'
    : org.type === 'association' ? 'associations' : 'clubs'
  const slug = org.slug || slugify(org.name || '')
  return slug ? `/${base}/${slug}` : null
}

// A match's public URL. The stored `path` is authoritative (kept current by
// the re-stamp + redirect machinery); the builders below are the same shapes
// matchPaths.js produces, used only for docs that predate stored paths.
//   competition  /competitions/{season}/{competition-slug}/match/{matchSlug}
//   standalone   /match/{YYYY-MM-DD}/{matchSlug}
function matchLoc(m) {
  if (m.path) return m.path
  if (m.competitionSeason && m.competitionSlug && m.matchSlug)
    return `/competitions/${m.competitionSeason}/${m.competitionSlug}/match/${m.matchSlug}`
  if (m.matchDate && m.matchSlug) return `/match/${m.matchDate}/${m.matchSlug}`
  return null
}

// Mirror of the firestore rules' competition publicity predicate: public once
// published, or once its lifecycle has advanced past draft (legacy docs with
// status upcoming/active/final and no published flag are public).
function isCompetitionPublic(c) {
  return c.published === true || (c.status && c.status !== 'draft')
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
  // Organisation directories (/schools, /clubs, /associations) are intentionally
  // omitted — orgs are indexed on the MAIN site only, not the sport sites.
  { path: '/players',        changefreq: 'weekly',  priority: 0.8 },
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

// Build the full sitemap XML string from Firestore. `db` is the sport's named
// admin Firestore database — people live in the same database as the rest of
// the sport data (client: peopleDb = db).
async function buildSitemap(db, logger) {
  const entries = STATIC_ROUTES.map(urlEntry)
  const seen = new Set(STATIC_ROUTES.map(r => r.path))
  const push = (e) => { if (e.path && !seen.has(e.path)) { seen.add(e.path); entries.push(urlEntry(e)) } }

  // Support Centre articles (static).
  for (const p of SUPPORT_PATHS) push({ path: p, changefreq: 'monthly', priority: 0.5 })

  // Legal documents (static).
  for (const p of LEGAL_PATHS) push({ path: p, changefreq: 'yearly', priority: 0.3 })

  // Public competitions → overview + sub-pages (mirrors the publish gate, so
  // drafts and unpublished competitions never leak into the sitemap).
  try {
    const comps = await db.collection('competitions').get()
    comps.forEach(d => {
      const c = { id: d.id, ...d.data() }
      if (!isCompetitionPublic(c)) return
      const base = competitionPath(c)
      if (!base) return
      const lm = lastmod(c.updatedAt)
      push({ path: base, lastmod: lm, changefreq: 'daily', priority: 0.9 })
      push({ path: `${base}/matches`, lastmod: lm, changefreq: 'daily', priority: 0.7 })
      if (c.type === 'tournament') {
        push({ path: `${base}/pools`,    lastmod: lm, changefreq: 'daily', priority: 0.7 })
        push({ path: `${base}/knockout`, lastmod: lm, changefreq: 'daily', priority: 0.7 })
      } else if (c.type === 'festival') {
        if (c.rules?.statsTable?.enabled || c.festivalStats) {
          push({ path: `${base}/stats`, lastmod: lm, changefreq: 'daily', priority: 0.6 })
        }
      } else {
        push({ path: `${base}/standings`, lastmod: lm, changefreq: 'daily', priority: 0.7 })
      }
    })
  } catch (e) { logger?.warn?.('sitemap: competitions failed', e) }

  // Teams with a frozen slug. Also record which orgs have at least one team in
  // this sport, so empty/unactivated org profiles stay out of the index below.
  const orgIdsWithTeams = new Set()
  try {
    const teams = await db.collection('teams').get()
    teams.forEach(d => {
      const t = d.data()
      if (t.organizationId) orgIdsWithTeams.add(t.organizationId)
      if (t.slug) push({ path: `/team/${t.slug}`, lastmod: lastmod(t.updatedAt), changefreq: 'weekly', priority: 0.7 })
    })
  } catch (e) { logger?.warn?.('sitemap: teams failed', e) }

  // Players (people) with a frozen slug → career-record pages. Unclaimed
  // team-sheet profiles are noindex and never listed (ownerless profiles
  // addendum A3) — keep them out of the sitemap too.
  try {
    const people = await db.collection('people').get()
    people.forEach(d => {
      const p = d.data()
      if (p.claimStatus === 'unclaimed') return
      if (p.slug) push({ path: `/player/${p.slug}`, lastmod: lastmod(p.updatedAt), changefreq: 'weekly', priority: 0.6 })
    })
  } catch (e) { logger?.warn?.('sitemap: people failed', e) }

  // Organisations (schools / clubs / associations) are deliberately NOT included
  // in the sport sitemap. Across every sport there would be thousands of
  // near-duplicate org pages, diluting crawl budget and rankings; orgs are
  // listed and indexed on the MAIN site only. Their pages stay reachable but
  // carry a noindex robots tag (see src/lib/seo.js).

  // Final matches → result pages (high long-tail SEO value). Matches without a
  // resolvable public URL are skipped rather than emitted at a dead shape.
  try {
    const finals = await db.collection('matches').where('status', '==', 'final').get()
    finals.forEach(d => {
      const m = { id: d.id, ...d.data() }
      push({ path: matchLoc(m), lastmod: lastmod(m.endedAt || m.updatedAt), changefreq: 'monthly', priority: 0.6 })
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

module.exports = { buildSitemap, slugify, competitionPath, orgPath, matchLoc }
