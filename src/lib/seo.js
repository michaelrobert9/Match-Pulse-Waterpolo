// SEO metadata + JSON-LD — the single source of truth for what goes in <head>.
//
// Pure and isomorphic: NO DOM, NO Firebase, NO React. It maps a route + entity
// to the title / description / canonical / OG / robots / H1 it should render,
// and builds schema.org JSON-LD objects. Designed to be consumed by:
//   1. the bot-render Cloud Function (Task 1) — serialises this into real HTML,
//   2. a client head manager (Task 2) — applies it to document.head,
//   3. the SEO admin (§6) — entity overrides slot in via `entity.seo`.
//
// Templates mirror the SEO brief §4.2. Per-entity overrides (entity.seo.*)
// always win over the computed defaults, so admins can tune any page.

import { competitionUrl, teamUrl, playerUrl, orgUrl, matchUrl } from './slugify'

export const SITE = {
  origin:        'https://matchpulse.co.za',
  name:          'MatchPulse',
  titleSuffix:   ' | MatchPulse',
  defaultTitle:  'MatchPulse — Live Hockey Scores, Fixtures & Results SA',
  description:   'Follow live scores, fixtures, log tables and player records for South African school and club hockey. Free to follow every competition.',
  ogImage:       'https://matchpulse.co.za/og-default.png', // export og-default.svg → PNG before deploy
  twitterCard:   'summary_large_image',
  twitterSite:   '@matchpulse',
  themeColor:    '#008C5A',
}

// Google truncates titles ~60 chars and descriptions ~160. Clamp on a word
// boundary so we never ship a mid-word cut.
const TITLE_MAX = 60
const DESC_MAX  = 160

function clamp(str, max) {
  const s = String(str ?? '').trim().replace(/\s+/g, ' ')
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, '') + '…'
}

// Compose a page title with the brand suffix, clamped to fit WITH the suffix.
function withSuffix(core) {
  const c = String(core ?? '').trim()
  if (!c) return SITE.defaultTitle
  if (c.length + SITE.titleSuffix.length <= TITLE_MAX) return c + SITE.titleSuffix
  return clamp(c, TITLE_MAX)   // too long for the suffix — keep the name, drop the brand
}

function abs(path) {
  if (!path) return SITE.origin + '/'
  if (/^https?:\/\//.test(path)) return path
  return SITE.origin + (path.startsWith('/') ? path : '/' + path)
}

// Year label for a competition season (season may be a year string or number).
function seasonYear(comp) {
  const s = comp?.season
  return s != null && String(s).trim() ? String(s).trim() : ''
}

// ── buildMeta ────────────────────────────────────────────────────────────────
// type: 'home' | 'plans' | 'competition' | 'team' | 'player' | 'org' | 'match'
//       | 'competitions' | 'players' | 'schools' | 'clubs' | 'generic'
// entity: the domain object (comp/team/person/match/org); optional for static.
// path: explicit route path; falls back to the entity's canonical URL.
//
// Returns: { title, description, canonical, h1, ogTitle, ogDescription,
//            ogImage, ogType, twitterCard, robots }
export function buildMeta({ type, entity = null, path = null } = {}) {
  const o = entity?.seo ?? {}            // per-entity admin overrides
  let core, description, h1, canonical, ogType = 'website', ogImage = SITE.ogImage
  let robots = 'index,follow'

  switch (type) {
    case 'home':
      core        = SITE.defaultTitle
      description = SITE.description
      h1          = 'Live hockey scores, fixtures & results'
      canonical   = '/'
      break

    case 'plans':
      core        = 'MatchPulse Pricing — Hockey League Management Software'
      description = 'Run your hockey competition on MatchPulse. Free for supporters, Plus from R2,000 once-off, Pro at R15,000/yr. You pay for what you host.'
      h1          = 'Plans & pricing'
      canonical   = '/plans'
      break

    case 'competitions':
      core        = 'Hockey Competitions, Logs & Results'
      description = 'Browse live South African school and club hockey competitions — log tables, fixtures, results and top scorers, updated as games finish.'
      h1          = 'Competitions'
      canonical   = '/competitions'
      break

    case 'players':
      core        = 'Hockey Players & Career Records'
      description = 'Search hockey players across South African schools and clubs. Career appearances, goals and competition history on MatchPulse.'
      h1          = 'Players'
      canonical   = '/players'
      break

    case 'schools':
      core        = 'School Hockey — Fixtures, Results & Teams'
      description = 'South African school hockey on MatchPulse: fixtures, results, log tables and squad records for every school competition.'
      h1          = 'Schools'
      canonical   = '/schools'
      break

    case 'clubs':
      core        = 'Club Hockey — Fixtures, Results & Teams'
      description = 'South African club hockey on MatchPulse: fixtures, results, log tables and squad records for every club competition.'
      h1          = 'Clubs'
      canonical   = '/clubs'
      break

    case 'competition': {
      const name = entity?.name ?? 'Competition'
      const yr   = seasonYear(entity)
      core        = `${name} Log & Results${yr ? ` ${yr}` : ''}`
      description = `Live log table, fixtures and results for the ${name}. Standings, scorers and team records, updated as games finish.`
      h1          = `${name} — Log & Results`
      canonical   = competitionUrl(entity)
      break
    }

    case 'team': {
      const name = entity?.displayName ?? entity?.name ?? 'Team'
      core        = `${name} Hockey Fixtures & Results`
      description = `Fixtures, results, log position and squad records for ${name}. Follow every ${name} hockey match live on MatchPulse.`
      h1          = name
      canonical   = teamUrl(entity) ?? null
      ogImage     = entity?.logoUrl || ogImage
      break
    }

    case 'player': {
      const name = entity?.fullName ?? entity?.name ?? 'Player'
      core        = `${name} — Hockey Career Stats`
      description = `Career hockey record for ${name}: appearances, goals and competition history across all teams on MatchPulse.`
      h1          = name
      canonical   = playerUrl(entity)
      ogImage     = entity?.photoUrl || ogImage
      ogType      = 'profile'
      break
    }

    case 'org': {
      const name = entity?.name ?? 'Organisation'
      const kind = entity?.type === 'club' ? 'club' : 'school'
      core        = `${name} Hockey — Fixtures & Results`
      description = `${name} hockey on MatchPulse: fixtures, results, log tables and teams for this ${kind}.`
      h1          = name
      canonical   = orgUrl(entity)
      ogImage     = entity?.logoUrl || ogImage
      break
    }

    case 'match': {
      const home = entity?.homeTeamName ?? 'Home'
      const away = entity?.awayTeamName ?? 'Away'
      const isFinal = entity?.status === 'final'
      const score   = isFinal ? ` ${entity?.homeScore ?? 0}-${entity?.awayScore ?? 0}` : ''
      core        = `${home} vs ${away}${score} — Hockey ${isFinal ? 'Result' : 'Fixture'}`
      description = isFinal
        ? `Full result and match timeline: ${home} ${entity?.homeScore ?? 0}-${entity?.awayScore ?? 0} ${away}. Scorers, cards and stats on MatchPulse.`
        : `${home} vs ${away} hockey fixture. Follow it live with scores, timeline and stats on MatchPulse.`
      h1          = `${home} vs ${away}`
      canonical   = matchUrl(entity)
      ogType      = 'article'
      break
    }

    default:
      core        = entity?.name ?? SITE.defaultTitle
      description = SITE.description
      h1          = entity?.name ?? SITE.name
      canonical   = path ?? '/'
  }

  // Apply per-entity overrides, then clamp.
  const finalCore = o.title ?? core
  const title       = o.title ? clamp(o.title, TITLE_MAX) : withSuffix(finalCore)
  const description2 = clamp(o.description ?? description, DESC_MAX)
  const canonical2   = abs(o.canonical ?? path ?? canonical)
  if (o.robots) robots = o.robots
  if (o.noindex === true) robots = 'noindex,follow'

  return {
    title,
    description: description2,
    canonical:   canonical2,
    h1:          o.h1 ?? h1,
    ogTitle:     o.ogTitle ?? title,
    ogDescription: o.ogDescription ?? description2,
    ogImage:     abs(o.ogImage ?? ogImage),
    ogType,
    twitterCard: SITE.twitterCard,
    robots,
  }
}

// ── JSON-LD builders (schema.org) ──────────────────────────────────────────────
// Each returns a plain object. The render layer serialises with jsonLdScript().

export function organizationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.origin,
    logo: abs('/icon.svg'),
    description: SITE.description,
    sameAs: [],   // populate from settings/seo (social profiles) in the render layer
  }
}

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.origin,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE.origin}/browse?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }
}

// items: [{ name, path }] in order Home › … › current.
export function breadcrumbLd(items = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  }
}

export function sportsTeamLd(team) {
  if (!team) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: team.displayName ?? team.name,
    sport: 'Field hockey',
    url: abs(teamUrl(team) ?? '/'),
    ...(team.logoUrl ? { logo: team.logoUrl } : {}),
  }
}

// Athlete (Person) schema for a player career page.
export function athleteLd(person) {
  if (!person) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: person.fullName ?? person.name,
    url: abs(playerUrl(person)),
    ...(person.photoUrl ? { image: person.photoUrl } : {}),
    knowsAbout: 'Field hockey',
  }
}

// SportsEvent for a fixture/result. `comp` is optional context for the URL.
export function sportsEventLd(match, comp = null) {
  if (!match) return null
  const home = match.homeTeamName ?? 'Home'
  const away = match.awayTeamName ?? 'Away'
  const eventStatus =
    match.status === 'cancelled' ? 'https://schema.org/EventCancelled' :
    match.status === 'postponed' ? 'https://schema.org/EventPostponed' :
    'https://schema.org/EventScheduled'
  const startDate = match.scheduledAt?.toDate ? match.scheduledAt.toDate().toISOString()
    : (match.scheduledAt ? new Date(match.scheduledAt).toISOString() : undefined)

  const team = (name, score) => ({
    '@type': 'SportsTeam',
    name,
    ...(match.status === 'final' && score != null ? { } : {}),
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${home} vs ${away}`,
    sport: 'Field hockey',
    url: abs(matchUrl({ ...match, competitionSlug: comp?.slug, competitionSeason: comp?.season })),
    eventStatus,
    ...(startDate ? { startDate } : {}),
    ...(match.pitch || match.venue ? { location: { '@type': 'Place', name: match.pitch ?? match.venue } } : {}),
    competitor: [team(home, match.homeScore), team(away, match.awayScore)],
    ...(match.status === 'final' ? {
      homeTeam: { '@type': 'SportsTeam', name: home },
      awayTeam: { '@type': 'SportsTeam', name: away },
    } : {}),
  }
}

// Serialise a JSON-LD object (or array) into a script tag string for HTML
// injection. Escapes "</" so a value can never break out of the script element.
export function jsonLdScript(obj) {
  if (!obj) return ''
  const json = JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1')
  return `<script type="application/ld+json">${json}</script>`
}
