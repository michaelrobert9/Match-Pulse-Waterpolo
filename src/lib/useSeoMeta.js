// Client-side head manager.
//
// Calls buildMeta() from seo.js and applies the result to document.head:
//   - <title>
//   - <meta name="description">
//   - <link rel="canonical">
//   - <meta name="robots">
//   - All og:* and twitter:* tags
//   - JSON-LD <script> tags (injected/replaced on route change)
//
// The bot renderer (functions/renderer.js) does the same job server-side for
// crawlers that don't execute JS. Both consumers call the same buildMeta()
// from src/lib/seo.js, so they stay in sync automatically.
//
// Usage:
//   useSeoMeta({ type: 'competition', entity: comp })
//   useSeoMeta({ type: 'player', entity: person })
//   useSeoMeta({ type: 'home' })
//
// `entity` is optional (omit for static pages). Pass the domain object
// directly; the hook reads entity.seo.* for per-entity admin overrides.
// `path` can override the canonical URL (defaults to window.location.pathname).

import { useEffect } from 'react'
import { buildMeta, jsonLdScript, organizationLd, websiteLd, breadcrumbLd, sportsEventLd, sportsTeamLd, athleteLd } from './seo'

function setMeta(name, content, { property = false } = {}) {
  if (content == null || content === '') return
  const attr = property ? 'property' : 'name'
  let el = document.querySelector(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setLink(rel, href) {
  if (!href) return
  let el = document.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

const LD_ATTR = 'data-seo-ld'

function clearLd() {
  document.querySelectorAll(`script[type="application/ld+json"][${LD_ATTR}]`).forEach(el => el.remove())
}

function injectLd(obj) {
  if (!obj) return
  const el = document.createElement('script')
  el.type = 'application/ld+json'
  el.setAttribute(LD_ATTR, '1')
  el.textContent = JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1')
  document.head.appendChild(el)
}

export function useSeoMeta({ type, entity = null, path = null } = {}) {
  useEffect(() => {
    const resolvedPath = path ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
    const meta = buildMeta({ type, entity, path: resolvedPath })

    document.title = meta.title
    setMeta('description', meta.description)
    setMeta('robots', meta.robots)
    setLink('canonical', meta.canonical)

    setMeta('og:title',       meta.ogTitle,       { property: true })
    setMeta('og:description', meta.ogDescription, { property: true })
    setMeta('og:url',         meta.canonical,     { property: true })
    setMeta('og:type',        meta.ogType,        { property: true })
    setMeta('og:image',       meta.ogImage,       { property: true })
    setMeta('og:site_name',   'MatchPulse',       { property: true })

    setMeta('twitter:card',        'summary_large_image')
    setMeta('twitter:title',       meta.ogTitle)
    setMeta('twitter:description', meta.ogDescription)
    setMeta('twitter:image',       meta.ogImage)

    // JSON-LD: clear old entries, inject fresh ones.
    clearLd()

    if (type === 'home') {
      injectLd(organizationLd())
      injectLd(websiteLd())
    }
    if (type === 'match' && entity) {
      injectLd(sportsEventLd(entity))
    }
    if (type === 'team' && entity) {
      injectLd(sportsTeamLd(entity))
    }
    if ((type === 'player') && entity) {
      injectLd(athleteLd(entity))
    }

    // Breadcrumb for deep pages
    if (type !== 'home' && type !== 'generic') {
      const crumbs = [{ name: 'Home', path: '/' }]
      if (type === 'competition') crumbs.push({ name: 'Competitions', path: '/competitions' })
      if (type === 'match')       crumbs.push({ name: 'Competitions', path: '/competitions' })
      if (type === 'player')      crumbs.push({ name: 'Players',      path: '/players' })
      if (type === 'team')        crumbs.push({ name: 'Teams',        path: '/browse' })
      if (type === 'org') {
        const base = entity?.type === 'club' ? '/clubs' : '/schools'
        crumbs.push({ name: entity?.type === 'club' ? 'Clubs' : 'Schools', path: base })
      }
      if (entity?.fullName || entity?.displayName || entity?.name) {
        crumbs.push({ name: entity.fullName ?? entity.displayName ?? entity.name, path: resolvedPath })
      }
      if (crumbs.length > 1) injectLd(breadcrumbLd(crumbs))
    }
  }, [type, entity, path])
}
