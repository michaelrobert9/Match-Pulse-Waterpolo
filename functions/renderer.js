// Bot renderer — dynamic head injection for search & AI crawlers.
//
// Architecture: this function is the `**` catch-all rewrite in firebase.json.
// It handles ALL requests, but behaves differently by audience:
//
//   Non-bot (human): fetches the real SPA index.html from Firebase Hosting
//                    at the canonical /index.html path (static file, bypasses
//                    this rewrite) and returns it unchanged. Adds ~10ms vs a
//                    direct static-file serve; cached in module scope.
//   Bot/crawler:     same fetch, then injects per-route metadata into <head>
//                    (title, description, canonical, OG, JSON-LD). The SPA
//                    body is still an empty <div id="root"> — React hydrates for
//                    Google (which runs JS); LLM/social crawlers that don't run
//                    JS get the correct <head> plus the raw HTML shell.
//
// This is Phase 1 (head injection). Phase 2 would add full body rendering via
// Puppeteer/headless-Chrome, so non-JS crawlers see body content too.
//
// The /index.html static file serves directly from Firebase Hosting (exact path
// match takes priority over rewrites), so the internal fetch never loops.

const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')

// Static Support Centre content (built from markdown by
// scripts/build-support-content.mjs). Used to render real head + body HTML for
// crawlers so the support pages are fully indexable, not an empty shell.
let SUPPORT = { index: {}, sections: [], articles: {} }
try { SUPPORT = require('./support-content.json') } catch (e) { /* generated at build */ }

// Static legal documents (built from markdown by scripts/build-legal-content.mjs).
let LEGAL = { order: [], docs: {} }
try { LEGAL = require('./legal-content.json') } catch (e) { /* generated at build */ }

// ── Bot detection ─────────────────────────────────────────────────────────────

const BOT_UA_PATTERNS = [
  // Search engines
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
  'yandexbot', 'sogou', 'exabot', 'ia_archiver', 'archive.org_bot',
  // Social / link-preview
  'facebot', 'facebookexternalhit', 'linkedinbot', 'twitterbot',
  'pinterest', 'whatsapp', 'telegrambot', 'discordbot', 'slackbot',
  'embedly', 'quora link preview',
  // AI / answer engines (GEO)
  'gptbot', 'oai-searchbot', 'chatgpt-user',
  'claudebot', 'claude-web',
  'perplexitybot', 'google-extended',
  'ccbot', 'bytespider',
  // Generic prerender / fetch tools
  'prerender', 'headlesschrome', 'applebot',
]

function isBot(ua) {
  if (!ua) return false
  const u = ua.toLowerCase()
  return BOT_UA_PATTERNS.some(p => u.includes(p))
}

// ── Route→entity parser ───────────────────────────────────────────────────────
// Returns { kind, params } so the metadata builder knows what to fetch.

// First path segments that belong to known app/SEO routes — never treated as an
// org slug by the nested-team (/{orgSlug}/{teamSeg}) fallback.
const RESERVED_TOP = new Set([
  'login', 'signup', 'portal', 'admin', 'manage', 'score', 'fixtures',
  'profile', 'people', 'team', 'match', 'matches', 'player', 'players',
  'competition', 'competitions', 'schools', 'clubs', 'associations',
  'plans', 'why-matchpulse', 'browse', 'support', 'legal', 'contact',
])

function parseRoute(pathname) {
  // Strip trailing slash except for root.
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const seg = p.split('/').filter(Boolean)   // e.g. ['competitions','2026','north-coast']

  if (p === '/')              return { kind: 'home' }
  if (p === '/plans')         return { kind: 'plans' }
  if (p === '/why-matchpulse')return { kind: 'why' }
  if (p === '/contact')       return { kind: 'contact' }
  if (p === '/support')       return { kind: 'support_index' }
  if (seg[0] === 'support' && seg.length >= 3) {
    return { kind: 'support_article', params: { category: seg[1], slug: seg[2] } }
  }
  if (seg[0] === 'legal' && seg.length === 2) {
    return { kind: 'legal', params: { doc: seg[1] } }
  }
  if (p === '/competitions')  return { kind: 'competitions' }
  if (p === '/browse')        return { kind: 'browse' }
  if (p === '/players')       return { kind: 'players' }
  if (p === '/schools')       return { kind: 'orgs', params: { type: 'school' } }
  if (p === '/clubs')         return { kind: 'orgs', params: { type: 'club' } }
  if (p === '/associations')  return { kind: 'orgs', params: { type: 'association' } }

  // /competitions/:season/:slug/matches/:matchSlug
  if (seg[0] === 'competitions' && seg.length >= 5 && seg[3] === 'matches') {
    return { kind: 'match_scoped', params: { season: seg[1], compSlug: seg[2], matchSlug: seg[4] } }
  }
  // /competitions/:season/:slug (with optional sub-tab: standings/fixtures/pools/knockout/stats)
  if (seg[0] === 'competitions' && seg.length >= 3 && !/^[a-f0-9]{20}$/.test(seg[1])) {
    return { kind: 'competition_slug', params: { season: seg[1], slug: seg[2] } }
  }
  // /competitions/:id
  if (seg[0] === 'competitions' && seg.length >= 2) {
    return { kind: 'competition_id', params: { id: seg[1] } }
  }
  // /competition/:series/:ageGroup/:season (legacy)
  if (seg[0] === 'competition' && seg.length >= 4) {
    return { kind: 'competition_path', params: { path: `${seg[1]}/${seg[2]}/${seg[3]}` } }
  }
  // /matches/:season/:matchSlug
  if (seg[0] === 'matches' && seg.length >= 3) {
    return { kind: 'match_slug', params: { season: seg[1], matchSlug: seg[2] } }
  }
  // /matches/:id  (24-char Firestore id)
  if (seg[0] === 'matches' && seg.length === 2) {
    return { kind: 'match_id', params: { id: seg[1] } }
  }
  // /match/:slug (legacy)
  if (seg[0] === 'match' && seg.length >= 2) {
    return { kind: 'match_legacy_slug', params: { slug: seg[1] } }
  }
  // /player/:slug
  if (seg[0] === 'player' && seg.length >= 2) {
    return { kind: 'player_slug', params: { slug: seg[1] } }
  }
  // /players/:id
  if (seg[0] === 'players' && seg.length >= 2) {
    return { kind: 'player_id', params: { id: seg[1] } }
  }
  // /team/:slug
  if (seg[0] === 'team' && seg.length >= 2) {
    return { kind: 'team_slug', params: { slug: seg[1] } }
  }
  // /schools/:slug or /clubs/:slug or /associations/:slug
  if ((seg[0] === 'schools' || seg[0] === 'clubs' || seg[0] === 'associations') && seg.length >= 2) {
    const type = seg[0] === 'clubs' ? 'club' : seg[0] === 'associations' ? 'association' : 'school'
    return { kind: 'org_slug', params: { type, slug: seg[1] } }
  }
  // /{org-slug}/{team-segment} — nested team profile. Last resort: any two-segment
  // path whose first segment is not a reserved app route.
  if (seg.length === 2 && !RESERVED_TOP.has(seg[0])) {
    return { kind: 'nested_team', params: { orgSlug: seg[0], teamSeg: seg[1] } }
  }

  return { kind: 'generic' }
}

// ── Metadata builder (mirrors src/lib/seo.js — keep in sync) ─────────────────

const ORIGIN     = 'https://matchpulse.co.za'
const SITE_NAME  = 'MatchPulse'
const OG_DEFAULT = `${ORIGIN}/og-default.png`
const TITLE_MAX  = 60
const DESC_MAX   = 160

function clamp(str, max) {
  const s = String(str ?? '').trim().replace(/\s+/g, ' ')
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, '') + '…'
}
function mkTitle(core) {
  const sfx = ` | ${SITE_NAME}`
  const c = String(core ?? '').trim()
  if (!c) return `${SITE_NAME} — Live Hockey Scores, Fixtures & Results SA`
  return c.length + sfx.length <= TITLE_MAX ? c + sfx : clamp(c, TITLE_MAX)
}

function abs(path) {
  if (!path) return `${ORIGIN}/`
  if (/^https?:\/\//.test(path)) return path
  return ORIGIN + (path.startsWith('/') ? path : '/' + path)
}

function buildMeta({ kind, entity = null, path = '' }) {
  const o = entity?.seo ?? {}
  let core, desc, h1, canonical = abs(path), ogImage = OG_DEFAULT, ogType = 'website', robots = 'index,follow'

  switch (kind) {
    case 'home':
      core = `${SITE_NAME} — Live Hockey Scores, Fixtures & Results SA`
      desc = 'Follow live scores, fixtures, log tables and player records for South African school and club hockey. Free to follow every competition.'
      h1   = 'Live hockey scores, fixtures & results'
      break
    case 'plans':
      core = 'MatchPulse Pricing — Hockey League Management Software'
      desc = 'Run your hockey competition on MatchPulse. Free for supporters, Plus from R2,000 once-off, Pro at R15,000/yr. You pay for what you host.'
      h1   = 'Plans & pricing'; canonical = abs('/plans')
      break
    case 'why':
      core = `Why ${SITE_NAME}? — Hockey League Management for South Africa`
      desc = 'MatchPulse is the live-scoring and competition-management platform built for South African school and club hockey.'
      h1   = `Why ${SITE_NAME}?`; canonical = abs('/why-matchpulse')
      break
    case 'contact':
      core = `Contact ${SITE_NAME} — Get in Touch`
      desc = 'Get in touch with the MatchPulse team. Send us a message and we will get back to you by email.'
      h1   = 'Get in touch'; canonical = abs('/contact')
      break
    case 'support_index':
      core = 'Support Centre — MatchPulse Help & How-To Guides'
      desc = (entity?.introPlain) || 'Help and how-to guides for running competitions on MatchPulse — getting started, teams, fixtures, playoffs, live scoring and more.'
      h1   = entity?.title || 'Support Centre'; canonical = abs('/support')
      break
    case 'support_article':
      core = entity ? `${entity.title} — MatchPulse Support` : 'Support — MatchPulse'
      desc = entity?.description || 'MatchPulse help article.'
      h1   = entity?.title || 'Support'
      canonical = abs(path)
      ogType = 'article'
      break
    case 'legal':
      core = entity ? `${entity.title} — MatchPulse` : 'Legal — MatchPulse'
      desc = entity?.description || 'MatchPulse legal documents.'
      h1   = entity?.title || 'Legal'
      canonical = abs(path)
      ogType = 'article'
      break
    case 'competitions':
      core = 'Hockey Competitions, Logs & Results'
      desc = 'Browse live South African school and club hockey competitions — log tables, fixtures, results and top scorers, updated as games finish.'
      h1   = 'Competitions'; canonical = abs('/competitions')
      break
    case 'browse':
      core = 'Browse MatchPulse — Hockey Competitions & Schools'
      desc = 'Search and discover South African school and club hockey competitions, schools, clubs and teams on MatchPulse.'
      h1   = 'Browse'; canonical = abs('/browse')
      break
    case 'players':
      core = 'Hockey Players & Career Records'
      desc = 'Search hockey players across South African schools and clubs. Career appearances, goals and competition history on MatchPulse.'
      h1   = 'Players'; canonical = abs('/players')
      break
    case 'orgs':
      if (entity?.type === 'club') {
        core = 'Club Hockey — Fixtures, Results & Teams'
        desc = 'South African club hockey on MatchPulse: fixtures, results, log tables and squad records.'
        h1   = 'Clubs'; canonical = abs('/clubs')
      } else {
        core = 'School Hockey — Fixtures, Results & Teams'
        desc = 'South African school hockey on MatchPulse: fixtures, results, log tables and squad records.'
        h1   = 'Schools'; canonical = abs('/schools')
      }
      break
    case 'competition_slug':
    case 'competition_id':
    case 'competition_path': {
      const n = entity?.name ?? 'Competition'
      const yr = entity?.season ? String(entity.season) : ''
      core      = `${n} Log & Results${yr ? ` ${yr}` : ''}`
      desc      = `Live log table, fixtures and results for the ${n}. Standings, scorers and team records, updated as games finish.`
      h1        = `${n} — Log & Results`
      canonical = entity ? compCanonical(entity) : abs(path)
      ogImage   = entity?.logoUrl || ogImage
      break
    }
    case 'match_scoped':
    case 'match_slug':
    case 'match_id':
    case 'match_legacy_slug': {
      const home = entity?.homeTeamName ?? 'Home'
      const away = entity?.awayTeamName ?? 'Away'
      const final = entity?.status === 'final'
      const score = final ? ` ${entity.homeScore ?? 0}-${entity.awayScore ?? 0}` : ''
      core      = `${home} vs ${away}${score} — Hockey ${final ? 'Result' : 'Fixture'}`
      desc      = final
        ? `Full result: ${home} ${entity.homeScore ?? 0}-${entity.awayScore ?? 0} ${away}. Scorers, cards and timeline on MatchPulse.`
        : `${home} vs ${away} hockey fixture — follow it live with scores and timeline on MatchPulse.`
      h1        = `${home} vs ${away}`
      canonical = entity ? matchCanonical(entity) : abs(path)
      ogType    = 'article'
      break
    }
    case 'player_slug':
    case 'player_id': {
      const n = entity?.fullName ?? entity?.name ?? 'Player'
      core      = `${n} — Hockey Career Stats`
      desc      = `Career hockey record for ${n}: appearances, goals and competition history across all teams on MatchPulse.`
      h1        = n
      canonical = entity?.slug ? abs(`/player/${entity.slug}`) : abs(`/players/${entity?.id ?? ''}`)
      ogImage   = entity?.photoUrl || ogImage
      ogType    = 'profile'
      break
    }
    case 'team_slug':
    case 'nested_team': {
      const n = entity?.displayName ?? entity?.name ?? 'Team'
      core      = `${n} Hockey Fixtures & Results`
      desc      = `Fixtures, results, log position and squad records for ${n}. Follow every ${n} hockey match live on MatchPulse.`
      h1        = n
      // Prefer the nested /{orgSlug}/{teamSeg} canonical when the org slug is
      // known; fall back to the legacy /team/:slug, then the requested path.
      if (entity?.orgSlug && entity?.slug) {
        canonical = abs(`/${entity.orgSlug}/${teamPathSegment(entity.slug, entity.orgSlug)}`)
      } else if (entity?.slug) {
        canonical = abs(`/team/${entity.slug}`)
      } else {
        canonical = abs(path)
      }
      ogImage   = entity?.logoUrl || ogImage
      break
    }
    case 'org_slug': {
      const n = entity?.name ?? 'Organisation'
      const kind2 = entity?.type === 'club' ? 'club' : 'school'
      const base   = kind2 === 'club' ? 'clubs' : 'schools'
      const slug2  = entity?.slug || slugify(n)
      core      = `${n} Hockey — Fixtures & Results`
      desc      = `${n} hockey on MatchPulse: fixtures, results, log tables and teams.`
      h1        = n
      canonical = abs(`/${base}/${slug2}`)
      ogImage   = entity?.logoUrl || ogImage
      break
    }
    default:
      core = SITE_NAME
      desc = 'Live scores, fixtures, log tables and player records for South African school and club hockey.'
      h1   = SITE_NAME
  }

  const finalTitle  = o.title ? clamp(o.title, TITLE_MAX) : mkTitle(core)
  const description = clamp(o.description ?? desc, DESC_MAX)
  if (o.robots) robots = o.robots
  if (o.noindex) robots = 'noindex,follow'

  return { title: finalTitle, description, canonical: o.canonical ? abs(o.canonical) : canonical, h1, ogType, ogImage: abs(o.ogImage ?? ogImage), robots }
}

function slugify(str) {
  return String(str).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Mirror of src/lib/slugify.js teamPathSegment — strip the redundant org prefix.
function teamPathSegment(teamSlug, orgSlug) {
  if (!teamSlug) return ''
  if (orgSlug && teamSlug.startsWith(`${orgSlug}-`)) return teamSlug.slice(orgSlug.length + 1)
  return teamSlug
}

function compCanonical(c) {
  if (c.slug && c.season) return abs(`/competitions/${c.season}/${c.slug}`)
  if (c.competitionPath)  return abs(`/competition/${c.competitionPath}`)
  return abs(`/competitions/${c.id}`)
}

function matchCanonical(m) {
  if (m.competitionSlug && m.competitionSeason && m.matchSlug)
    return abs(`/competitions/${m.competitionSeason}/${m.competitionSlug}/matches/${m.matchSlug}`)
  if (m.season && m.matchSlug) return abs(`/matches/${m.season}/${m.matchSlug}`)
  if (m.matchSlug) return abs(`/matches/${m.matchSlug}`)
  if (m.slug)      return abs(`/match/${m.slug}`)
  return abs(`/matches/${m.id}`)
}

// ── JSON-LD ────────────────────────────────────────────────────────────────────

function jsonLd(kind, entity, path) {
  const ld = []

  if (kind === 'home') {
    ld.push({
      '@context': 'https://schema.org', '@type': 'Organization',
      name: SITE_NAME, url: ORIGIN, logo: abs('/icon.svg'),
      description: 'Live-scoring and competition-management platform for South African field hockey.',
    })
    ld.push({
      '@context': 'https://schema.org', '@type': 'WebSite',
      name: SITE_NAME, url: ORIGIN,
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${ORIGIN}/browse?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
    })
  }

  if ((kind === 'match_scoped' || kind === 'match_slug' || kind === 'match_id' || kind === 'match_legacy_slug') && entity) {
    const status =
      entity.status === 'cancelled' ? 'https://schema.org/EventCancelled' :
      entity.status === 'postponed' ? 'https://schema.org/EventPostponed' :
      'https://schema.org/EventScheduled'
    const startDate = (() => { try { const d = entity.scheduledAt?.toDate ? entity.scheduledAt.toDate() : (entity.scheduledAt ? new Date(entity.scheduledAt) : null); return d ? d.toISOString() : undefined } catch { return undefined } })()
    ld.push({
      '@context': 'https://schema.org', '@type': 'SportsEvent',
      name: `${entity.homeTeamName} vs ${entity.awayTeamName}`,
      sport: 'Field hockey', eventStatus: status,
      url: matchCanonical(entity),
      ...(startDate ? { startDate } : {}),
      competitor: [
        { '@type': 'SportsTeam', name: entity.homeTeamName },
        { '@type': 'SportsTeam', name: entity.awayTeamName },
      ],
    })
  }

  if ((kind === 'player_slug' || kind === 'player_id') && entity?.fullName) {
    ld.push({ '@context': 'https://schema.org', '@type': 'Person', name: entity.fullName, knowsAbout: 'Field hockey', ...(entity.photoUrl ? { image: entity.photoUrl } : {}) })
  }

  if ((kind === 'team_slug' || kind === 'nested_team') && entity?.displayName) {
    ld.push({ '@context': 'https://schema.org', '@type': 'SportsTeam', name: entity.displayName, sport: 'Field hockey', ...(entity.logoUrl ? { logo: entity.logoUrl } : {}) })
  }

  if (kind === 'support_article' && entity) {
    ld.push({
      '@context': 'https://schema.org', '@type': 'TechArticle',
      headline: entity.title, description: entity.description, url: abs(path), inLanguage: 'en-ZA',
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: ORIGIN },
    })
    ld.push({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Support Centre', item: abs('/support') },
        { '@type': 'ListItem', position: 2, name: entity.sectionTitle, item: abs('/support') },
        { '@type': 'ListItem', position: 3, name: entity.title, item: abs(path) },
      ],
    })
    // FAQ page: parse the "**Question?** answer" paragraphs into FAQPage entities.
    if (entity.slug === 'faq' && entity.html) {
      const qa = []
      const re = /<p><strong>([^<]+\?)<\/strong>\s*([\s\S]*?)<\/p>/g
      let m
      while ((m = re.exec(entity.html))) {
        const q = m[1].trim()
        const a = m[2].replace(/<[^>]+>/g, '').trim()
        if (q && a) qa.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })
      }
      if (qa.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa })
    }
  }

  // Breadcrumb for all deep pages
  if (kind !== 'home' && kind !== 'generic') {
    const crumbs = [{ name: 'Home', item: ORIGIN }]
    if (kind.startsWith('competition')) crumbs.push({ name: 'Competitions', item: abs('/competitions') })
    if (kind.startsWith('match')) crumbs.push({ name: 'Competitions', item: abs('/competitions') })
    if (kind.startsWith('player')) crumbs.push({ name: 'Players', item: abs('/players') })
    if (kind === 'team_slug' || kind === 'nested_team') crumbs.push({ name: 'Teams', item: abs('/browse') })
    if (kind === 'org_slug') crumbs.push({ name: entity?.type === 'club' ? 'Clubs' : 'Schools', item: abs(entity?.type === 'club' ? '/clubs' : '/schools') })
    if (entity?.name || entity?.fullName || entity?.displayName) {
      crumbs.push({ name: entity.fullName ?? entity.displayName ?? entity.name, item: abs(path) })
    }
    if (crumbs.length > 1) {
      ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) })
    }
  }

  return ld.map(o => {
    const json = JSON.stringify(o).replace(/<\/(script)/gi, '<\\/$1')
    return `<script type="application/ld+json">${json}</script>`
  }).join('\n    ')
}

// ── Firestore fetch helpers ────────────────────────────────────────────────────

async function fetchEntity(db, route) {
  const { kind, params = {} } = route
  // Support content is static — no Firestore.
  if (kind === 'support_index')   return SUPPORT.index ?? null
  if (kind === 'support_article') return SUPPORT.articles?.[`${params.category}/${params.slug}`] ?? null
  if (kind === 'legal')           return LEGAL.docs?.[params.doc] ?? null
  try {
    if (kind === 'competition_id') {
      const d = await db.collection('competitions').doc(params.id).get()
      return d.exists ? { id: d.id, ...d.data() } : null
    }
    if (kind === 'competition_slug') {
      const snap = await db.collection('competitions')
        .where('slug', '==', params.slug).where('season', '==', String(params.season)).limit(1).get()
      if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() }
      // season might be stored as number
      const snap2 = await db.collection('competitions')
        .where('slug', '==', params.slug).where('season', '==', Number(params.season)).limit(1).get()
      return snap2.empty ? null : { id: snap2.docs[0].id, ...snap2.docs[0].data() }
    }
    if (kind === 'competition_path') {
      const snap = await db.collection('competitions').where('competitionPath', '==', params.path).limit(1).get()
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
    }
    if (kind === 'match_scoped') {
      const snap = await db.collection('matches')
        .where('competitionSlug', '==', params.compSlug).where('matchSlug', '==', params.matchSlug).limit(1).get()
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
    }
    if (kind === 'match_slug') {
      const snap = await db.collection('matches')
        .where('season', '==', String(params.season)).where('matchSlug', '==', params.matchSlug).limit(1).get()
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
    }
    if (kind === 'match_id') {
      const d = await db.collection('matches').doc(params.id).get()
      return d.exists ? { id: d.id, ...d.data() } : null
    }
    if (kind === 'match_legacy_slug') {
      const snap = await db.collection('matches').where('slug', '==', params.slug).limit(1).get()
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
    }
    if (kind === 'player_slug') {
      const snap = await db.collection('people').where('slug', '==', params.slug).limit(1).get()
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
    }
    if (kind === 'player_id') {
      const d = await db.collection('people').doc(params.id).get()
      return d.exists ? { id: d.id, ...d.data() } : null
    }
    if (kind === 'team_slug') {
      const snap = await db.collection('teams').where('slug', '==', params.slug).limit(1).get()
      if (snap.empty) return null
      const team = { id: snap.docs[0].id, ...snap.docs[0].data() }
      // Enrich with the parent org slug so the canonical can nest.
      if (team.organizationId) {
        const od = await db.collection('organizations').doc(team.organizationId).get()
        if (od.exists) team.orgSlug = od.data().slug ?? slugify(od.data().name ?? '')
      }
      return team
    }
    if (kind === 'nested_team') {
      // Resolve the org by slug, then the team within it whose slug reconstructs
      // to the requested segment.
      let orgDoc = null
      const bySlug = await db.collection('organizations').where('slug', '==', params.orgSlug).limit(1).get()
      if (!bySlug.empty) orgDoc = { id: bySlug.docs[0].id, ...bySlug.docs[0].data() }
      if (!orgDoc) {
        const all = await db.collection('organizations').get()
        const m = all.docs.find(d => slugify(d.data().name ?? '') === params.orgSlug)
        if (m) orgDoc = { id: m.id, ...m.data() }
      }
      if (!orgDoc) return null
      const teamsSnap = await db.collection('teams').where('organizationId', '==', orgDoc.id).get()
      const full = `${params.orgSlug}-${params.teamSeg}`
      const doc = teamsSnap.docs.find(d => {
        const t = d.data()
        return t.slug === full
          || t.slug === params.teamSeg
          || (t.slug && t.slug.startsWith(`${params.orgSlug}-`) && t.slug.slice(params.orgSlug.length + 1) === params.teamSeg)
          || slugify(t.displayName ?? '') === params.teamSeg
      })
      if (!doc) return null
      return { id: doc.id, ...doc.data(), orgSlug: orgDoc.slug ?? params.orgSlug }
    }
    if (kind === 'org_slug') {
      const snap = await db.collection('organizations').where('slug', '==', params.slug).limit(1).get()
      if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() }
      // Legacy: slug derived from name
      const all = await db.collection('organizations').where('type', '==', params.type).get()
      const match = all.docs.find(d => slugify(d.data().name) === params.slug)
      return match ? { id: match.id, ...match.data() } : null
    }
    if (kind === 'orgs') return { type: params.type }    // no Firestore needed — just need the type flag
  } catch (e) {
    logger.warn('renderer: entity fetch failed', { kind, params, err: e.message })
  }
  return null
}

// ── HTML injection ─────────────────────────────────────────────────────────────

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function injectHead(html, meta, ldStr) {
  const tags = [
    `<title>${escAttr(meta.title)}</title>`,
    `<meta name="description" content="${escAttr(meta.description)}" />`,
    `<link rel="canonical" href="${escAttr(meta.canonical)}" />`,
    `<meta name="robots" content="${escAttr(meta.robots)}" />`,
    `<meta property="og:title" content="${escAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escAttr(meta.description)}" />`,
    `<meta property="og:url" content="${escAttr(meta.canonical)}" />`,
    `<meta property="og:type" content="${escAttr(meta.ogType)}" />`,
    `<meta property="og:image" content="${escAttr(meta.ogImage)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escAttr(meta.ogImage)}" />`,
    ...(ldStr ? [ldStr] : []),
  ]
  // Remove any existing <title> from the template and inject our set before </head>
  return html
    .replace(/<title>[^<]*<\/title>/, '')
    .replace('</head>', `  ${tags.join('\n  ')}\n</head>`)
}

// ── Support body injection ──────────────────────────────────────────────────
// The Support Centre is static content, so for crawlers we render the real
// article body into #root (not just the head). React (createRoot) replaces this
// on the client, so there is no hydration mismatch.

function supportArticleBody(entity) {
  if (!entity) return ''
  return '<main class="mp-support"><div class="wrap">'
    + `<nav class="crumb"><a href="/support">Support Centre</a> / ${escAttr(entity.sectionTitle)}</nav>`
    + `<article class="prose"><h1>${escAttr(entity.title)}</h1>`
    + (entity.html || '')
    + '</article></div></main>'
}

function supportIndexBody(idx) {
  const secs = (SUPPORT.sections || []).map(s =>
    `<section><h2>${escAttr(s.title)}</h2><ul>`
    + (s.articles || []).map(a => `<li><a href="/support/${a.category}/${a.slug}">${escAttr(a.title)}</a></li>`).join('')
    + '</ul></section>').join('')
  return '<main class="mp-support"><div class="wrap">'
    + `<h1>${escAttr(idx?.title || 'Support Centre')}</h1>${idx?.introHtml || ''}${secs}</div></main>`
}

function legalBody(entity) {
  if (!entity) return ''
  return '<main class="mp-support"><div class="wrap wrap-narrow">'
    + '<nav class="crumb"><a href="/">Home</a> / Legal</nav>'
    + `<article class="prose"><h1>${escAttr(entity.title)}</h1>`
    + (entity.lastUpdated ? `<div class="meta">Last updated: ${escAttr(entity.lastUpdated)}</div>` : '')
    + (entity.html || '')
    + '</article></div></main>'
}

function injectBody(html, body) {
  if (!body) return html
  return html.replace(/<div id="root">\s*<\/div>/, `<div id="root">${body}</div>`)
}

// ── SPA shell cache ────────────────────────────────────────────────────────────
// Cached in module scope with a short TTL. A hosting-only deploy does NOT cold-
// start this function, so a warm instance would otherwise keep serving the OLD
// index.html (referencing the previous hashed JS bundle) indefinitely, and the
// site would look unchanged after a deploy. The TTL means a warm instance re-
// fetches the shell within SHELL_TTL_MS of any deploy — no function redeploy
// needed. On a fetch failure we fall back to the last good shell for availability.
//
// We fetch from the default web.app URL rather than req.headers.host so that:
//   a) there is zero chance of routing back through the ** rewrite (different domain)
//   b) the URL is stable even if the custom domain has any transient DNS/TLS issue

const SHELL_URL = process.env.SHELL_URL || 'https://match-pulse-4560e.web.app/index.html'
const SHELL_TTL_MS = 60 * 1000   // re-check the shell at most once a minute
let shellCache = null
let shellCachedAt = 0

async function getShell() {
  if (shellCache && (Date.now() - shellCachedAt) < SHELL_TTL_MS) return shellCache
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(SHELL_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`${res.status} fetching shell`)
    shellCache = await res.text()
    shellCachedAt = Date.now()
    return shellCache
  } catch (e) {
    clearTimeout(timer)
    logger.error('renderer: failed to fetch SPA shell', { url: SHELL_URL, err: e.message })
    return shellCache || null   // fall back to the last good shell if the refetch fails
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function rendererHandler(req, res) {
  const ua   = req.headers['user-agent'] ?? ''
  const host = req.headers.host ?? 'matchpulse.co.za'
  const path = req.path ?? '/'
  const bot  = isBot(ua)

  const shell = await getShell()
  if (!shell) {
    res.status(503).send('Service temporarily unavailable — unable to load app shell.')
    return
  }

  if (!bot) {
    // Human: return the SPA shell unchanged. React router handles the route.
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300')
    res.status(200).send(shell)
    return
  }

  // Bot: build and inject per-route metadata.
  try {
    const route  = parseRoute(path)
    const db     = admin.firestore()
    const entity = await fetchEntity(db, route)
    const meta   = buildMeta({ kind: route.kind, entity, path })
    const ldStr  = jsonLd(route.kind, entity, path)
    let html     = injectHead(shell, meta, ldStr)
    // Support pages are static — render the real body for non-JS crawlers too.
    if (route.kind === 'support_article') html = injectBody(html, supportArticleBody(entity))
    else if (route.kind === 'support_index') html = injectBody(html, supportIndexBody(entity))
    else if (route.kind === 'legal') html = injectBody(html, legalBody(entity))

    logger.info('renderer: served bot', { ua: ua.slice(0, 80), path, kind: route.kind, title: meta.title })

    res.set('Content-Type', 'text/html; charset=utf-8')
    // Cache rendered pages: 10min at edge (bots don't re-request that fast)
    res.set('Cache-Control', 'public, max-age=600, s-maxage=600')
    res.set('X-Renderer', 'matchpulse-head-injection/1')
    res.status(200).send(html)
  } catch (e) {
    logger.error('renderer: injection failed', { path, err: e.message })
    // Fallback: serve the unmodified shell so the user doesn't see an error page.
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(shell)
  }
}

module.exports = { rendererHandler }
