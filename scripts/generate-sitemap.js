#!/usr/bin/env node
// Generates public/sitemap.xml at deploy time by querying Firestore for all
// publicly-visible content. Run before `vite build` so the file lands in dist/.
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT    = join(__dirname, '..', 'public', 'sitemap.xml')
const BASE_URL  = 'https://matchpulse.co.za'
const NOW       = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT not set — skipping sitemap generation.')
  process.exit(0)
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// ── Helpers ────────────────────────────────────────────────────────────────

function url(loc, { priority = '0.5', changefreq = 'weekly', lastmod = NOW } = {}) {
  return [
    '  <url>',
    `    <loc>${BASE_URL}${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n')
}

function isOrgPublic(data) {
  const s = data.approvalState
  return !s || s === 'active'
}

function slugify(str) {
  return String(str ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function teamPathSegment(teamSlug, orgSlug) {
  if (orgSlug && teamSlug.startsWith(`${orgSlug}-`)) return teamSlug.slice(orgSlug.length + 1)
  return teamSlug
}

function orgBasePath(type) {
  return type === 'school' ? 'schools' : type === 'association' ? 'associations' : 'clubs'
}

function isCompetitionPublic(data) {
  return data.published === true || (data.status && data.status !== 'draft')
}

// ── Static pages ────────────────────────────────────────────────────────────

const staticUrls = [
  url('/',               { priority: '1.0', changefreq: 'daily'   }),
  url('/browse',         { priority: '0.9', changefreq: 'daily'   }),
  url('/competitions',   { priority: '0.9', changefreq: 'daily'   }),
  url('/schools',        { priority: '0.8', changefreq: 'daily'   }),
  url('/clubs',          { priority: '0.8', changefreq: 'daily'   }),
  url('/players',        { priority: '0.8', changefreq: 'daily'   }),
  url('/why-matchpulse', { priority: '0.6', changefreq: 'monthly' }),
  url('/contact',        { priority: '0.4', changefreq: 'yearly'  }),
  url('/legal/terms',           { priority: '0.3', changefreq: 'yearly' }),
  url('/legal/privacy',         { priority: '0.3', changefreq: 'yearly' }),
  url('/legal/cookies',         { priority: '0.3', changefreq: 'yearly' }),
  url('/legal/acceptable-use',  { priority: '0.3', changefreq: 'yearly' }),
]

// ── Dynamic content ─────────────────────────────────────────────────────────

async function orgUrls() {
  const snap = await db.collection('organizations').get()
  const urls = []
  for (const d of snap.docs) {
    const data = d.data()
    if (!isOrgPublic(data)) continue
    const slug = data.slug || null
    if (!slug) continue
    const type = orgBasePath(data.type)
    const lastmod = data.updatedAt?.toDate?.().toISOString().slice(0, 10) ?? NOW
    urls.push(url(`/${type}/${slug}`, { priority: '0.7', changefreq: 'weekly', lastmod }))
  }
  return urls
}

async function teamUrls() {
  const [teamsSnap, orgsSnap] = await Promise.all([
    db.collection('teams').get(),
    db.collection('organizations').get(),
  ])
  // org id → slug, for building the nested /{orgSlug}/{teamSeg} URL.
  const orgSlugById = new Map()
  for (const d of orgsSnap.docs) {
    const data = d.data()
    orgSlugById.set(d.id, data.slug || slugify(data.name))
  }
  const urls = []
  for (const d of teamsSnap.docs) {
    const data = d.data()
    const slug = data.slug || null
    if (!slug) continue
    const lastmod = data.updatedAt?.toDate?.().toISOString().slice(0, 10) ?? NOW
    const orgSlug = data.organizationId ? orgSlugById.get(data.organizationId) : null
    const path = orgSlug ? `/${orgSlug}/${teamPathSegment(slug, orgSlug)}` : `/team/${slug}`
    urls.push(url(path, { priority: '0.6', changefreq: 'weekly', lastmod }))
  }
  return urls
}

async function playerUrls() {
  const snap = await db.collection('people').get()
  const urls = []
  for (const d of snap.docs) {
    const data = d.data()
    const slug = data.slug || null
    if (!slug) continue
    const lastmod = data.updatedAt?.toDate?.().toISOString().slice(0, 10) ?? NOW
    urls.push(url(`/profile/${slug}`, { priority: '0.5', changefreq: 'monthly', lastmod }))
  }
  return urls
}

async function competitionUrls() {
  const snap = await db.collection('competitions').get()
  const urls = []
  for (const d of snap.docs) {
    const data = d.data()
    if (!isCompetitionPublic(data)) continue
    const slug   = data.slug   || null
    const season = data.season || null
    if (!slug || !season) continue
    const lastmod = data.updatedAt?.toDate?.().toISOString().slice(0, 10) ?? NOW
    const base = `/competitions/${season}/${slug}`
    urls.push(url(base,                { priority: '0.8', changefreq: 'daily',  lastmod }))
    urls.push(url(`${base}/fixtures`,  { priority: '0.7', changefreq: 'daily',  lastmod }))
    if (data.type === 'festival') {
      if (data.rules?.statsTable?.enabled || data.festivalStats) {
        urls.push(url(`${base}/stats`, { priority: '0.6', changefreq: 'daily',  lastmod }))
      }
    } else if (data.type === 'tournament') {
      urls.push(url(`${base}/pools`,    { priority: '0.7', changefreq: 'daily',  lastmod }))
      urls.push(url(`${base}/knockout`, { priority: '0.7', changefreq: 'daily',  lastmod }))
    } else {
      // league
      urls.push(url(`${base}/standings`, { priority: '0.7', changefreq: 'daily', lastmod }))
    }
  }
  return urls
}

async function matchUrls() {
  const snap = await db.collection('matches').get()
  const urls = []
  for (const d of snap.docs) {
    const data = d.data()
    const matchSlug = data.matchSlug || null
    if (!matchSlug) continue
    // Competition-scoped URL takes priority; falls back to season-scoped standalone.
    let loc
    if (data.competitionSlug && data.competitionSeason) {
      loc = `/competitions/${data.competitionSeason}/${data.competitionSlug}/matches/${matchSlug}`
    } else if (data.season) {
      loc = `/matches/${data.season}/${matchSlug}`
    } else {
      continue
    }
    const lastmod = data.updatedAt?.toDate?.().toISOString().slice(0, 10)
                 ?? data.createdAt?.toDate?.().toISOString().slice(0, 10)
                 ?? NOW
    urls.push(url(loc, { priority: '0.5', changefreq: 'monthly', lastmod }))
  }
  return urls
}

// ── Build & write ────────────────────────────────────────────────────────────

async function run() {
  console.log('Generating sitemap…')

  const [orgs, teams, players, competitions, matches] = await Promise.all([
    orgUrls(), teamUrls(), playerUrls(), competitionUrls(), matchUrls(),
  ])

  const allUrls = [...staticUrls, ...orgs, ...teams, ...players, ...competitions, ...matches]

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9',
    '          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">',
    '',
    allUrls.join('\n'),
    '',
    '</urlset>',
  ].join('\n')

  writeFileSync(OUTPUT, xml, 'utf8')

  const counts = {
    static: staticUrls.length,
    orgs: orgs.length, teams: teams.length,
    players: players.length, competitions: competitions.length, matches: matches.length,
  }
  console.log('URLs written:', counts)
  console.log(`Total: ${allUrls.length} → ${OUTPUT}`)
  process.exit(0)
}

run().catch(err => { console.error(err.message); process.exit(1) })
