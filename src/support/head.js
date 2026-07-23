import { useEffect } from 'react'

// Manage per-route <head> tags for human visitors (the bot renderer injects the
// same tags server-side for crawlers). Sets title, description, canonical, OG
// and optional JSON-LD, and restores them on unmount.
export function useSupportHead({ title, description, path, jsonLd } = {}) {
  useEffect(() => {
    const origin = 'https://matchpulse.co.za'
    const url = origin + (path || '')
    const prevTitle = document.title
    if (title) document.title = title

    const set = (selector, attrs) => {
      let el = document.head.querySelector(selector)
      let created = false
      if (!el) {
        el = document.createElement(attrs.tag)
        created = true
        document.head.appendChild(el)
      }
      const prev = {}
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'tag') continue
        prev[k] = el.getAttribute(k)
        el.setAttribute(k, v)
      }
      return { el, created, prev }
    }

    const managed = []
    if (description) {
      managed.push(set('meta[name="description"]', { tag: 'meta', name: 'description', content: description }))
      managed.push(set('meta[property="og:description"]', { tag: 'meta', property: 'og:description', content: description }))
    }
    if (title) {
      managed.push(set('meta[property="og:title"]', { tag: 'meta', property: 'og:title', content: title }))
    }
    managed.push(set('meta[property="og:type"]', { tag: 'meta', property: 'og:type', content: 'article' }))
    managed.push(set('meta[property="og:url"]', { tag: 'meta', property: 'og:url', content: url }))
    managed.push(set('link[rel="canonical"]', { tag: 'link', rel: 'canonical', href: url }))

    let ld
    if (jsonLd) {
      ld = document.createElement('script')
      ld.type = 'application/ld+json'
      ld.setAttribute('data-support', '1')
      ld.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(ld)
    }

    return () => {
      document.title = prevTitle
      for (const m of managed) {
        if (m.created) { m.el.remove(); continue }
        for (const [k, v] of Object.entries(m.prev)) {
          if (v == null) m.el.removeAttribute(k)
          else m.el.setAttribute(k, v)
        }
      }
      if (ld) ld.remove()
    }
  }, [title, description, path, JSON.stringify(jsonLd)])
}
