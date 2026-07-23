import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { getLegalDoc, LEGAL_LINKS } from '../../legal'
import { useSupportHead } from '../../support/head'
import '../support/Support.css'

// One page for each legal document (/legal/:doc). Reuses the Support Centre's
// `.mp-support .prose` reading styles so legal pages match the app's content
// conventions. The document HTML is prebuilt from markdown (build-legal-content.mjs)
// and the bot renderer serves the same content server-side for crawlers.
export default function LegalPage() {
  const { doc } = useParams()
  const navigate = useNavigate()
  const entry = getLegalDoc(doc)
  const path  = `/legal/${doc}`

  useSupportHead({
    title: entry ? `${entry.title} · MatchPulse` : 'Legal · MatchPulse',
    description: entry?.description,
    path,
  })

  if (!entry) return <Navigate to="/legal/terms" replace />

  // Internal links in the body (e.g. /plans, /legal/privacy, /contact) navigate
  // client-side. External links (mailto:, https:) fall through to the browser.
  function onBodyClick(e) {
    const a = e.target.closest('a')
    if (!a) return
    const href = a.getAttribute('href')
    if (href && href.startsWith('/')) { e.preventDefault(); navigate(href) }
  }

  return (
    <div className="mp-support">
      <div className="wrap wrap-narrow">
        <div className="crumb">
          <Link to="/">Home</Link>
          <span className="sep">/</span>
          <span>Legal</span>
        </div>

        <article className="prose">
          <h1>{entry.title}</h1>
          {entry.lastUpdated && <div className="meta">Last updated: {entry.lastUpdated}</div>}
          <div onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: entry.html }} />
        </article>

        <nav className="article-foot" aria-label="Legal documents">
          {LEGAL_LINKS.filter(l => l.slug !== doc).map(l => (
            <Link key={l.slug} to={l.path}>{l.title}</Link>
          ))}
          <Link to="/plans">Pricing</Link>
        </nav>
      </div>
    </div>
  )
}
