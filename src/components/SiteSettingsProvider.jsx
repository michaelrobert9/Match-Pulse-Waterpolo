import { useEffect } from 'react'
import { fetchSeoSettings } from '../lib/seoSettings'

function setMeta(name, content) {
  if (!content) return
  let el = document.querySelector(`meta[name="${name}"]`)
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el) }
  el.setAttribute('content', content)
}

function injectScript(id, src, inline) {
  if (document.getElementById(id)) return
  const s = document.createElement('script')
  s.id = id; s.async = true
  if (src) s.src = src
  if (inline) s.text = inline
  document.head.appendChild(s)
}

// Loads SEO settings from Firestore once and applies them to the document:
// meta tags, page title, Google Analytics, Stat Counter, Search Console.
// Renders nothing — pure side-effect component.
export default function SiteSettingsProvider() {
  useEffect(() => {
    fetchSeoSettings().then(s => {
      // Title
      const title = [s.siteTitle, s.siteTagline].filter(Boolean).join(' — ')
      if (title) document.title = title

      // Core meta
      setMeta('description', s.siteDescription)
      setMeta('keywords',    s.keywords)

      // Open Graph
      if (s.siteDescription) {
        ['og:description', 'twitter:description'].forEach(n => {
          let el = document.querySelector(`meta[property="${n}"]`) || document.querySelector(`meta[name="${n}"]`)
          if (el) el.setAttribute('content', s.siteDescription)
        })
      }
      if (s.ogImageUrl) {
        ['og:image', 'twitter:image'].forEach(n => {
          let el = document.querySelector(`meta[property="${n}"]`) || document.querySelector(`meta[name="${n}"]`)
          if (!el) { el = document.createElement('meta'); el.setAttribute('property', n); document.head.appendChild(el) }
          el.setAttribute('content', s.ogImageUrl)
        })
      }

      // Google Search Console verification
      if (s.googleSearchConsoleVerification) {
        setMeta('google-site-verification', s.googleSearchConsoleVerification)
      }

      // Google Analytics 4
      if (s.googleAnalyticsId) {
        injectScript('ga-async', `https://www.googletagmanager.com/gtag/js?id=${s.googleAnalyticsId}`)
        injectScript('ga-init', null,
          `window.dataLayer=window.dataLayer||[];` +
          `function gtag(){dataLayer.push(arguments);}` +
          `gtag('js',new Date());` +
          `gtag('config','${s.googleAnalyticsId}');`)
      }

      // Stat Counter
      if (s.statCounterProject && s.statCounterSecurity) {
        injectScript('sc-vars', null,
          `var sc_project=${Number(s.statCounterProject)};` +
          `var sc_invisible=1;` +
          `var sc_security="${s.statCounterSecurity}";`)
        injectScript('sc-loader', 'https://www.statcounter.com/counter/counter.js')
      }
    }).catch(() => {})
  }, [])

  return null
}
