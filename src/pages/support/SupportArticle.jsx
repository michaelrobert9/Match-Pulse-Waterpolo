import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { getArticle, getSection, imageSlots, ORIGIN } from '../../support'
import { useSupportHead } from '../../support/head'
import SupportImage from './SupportImage'
import './Support.css'

export default function SupportArticle() {
  const { category, slug } = useParams()
  const navigate = useNavigate()

  const article = getArticle(category, slug)
  const section = article ? getSection(article.sectionSlug) : null
  const slots   = article ? imageSlots(category, slug) : []
  const path    = `/support/${category}/${slug}`

  const { prev, next } = useMemo(() => {
    const list = section?.articles ?? []
    const i = list.findIndex(a => a.slug === slug)
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null }
  }, [section, slug])

  const jsonLd = useMemo(() => article && ({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: article.title,
        description: article.description,
        url: ORIGIN + path,
        inLanguage: 'en-ZA',
        isPartOf: { '@type': 'WebSite', name: 'MatchPulse', url: ORIGIN },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Support Centre', item: ORIGIN + '/support' },
          { '@type': 'ListItem', position: 2, name: article.sectionTitle, item: ORIGIN + '/support#' + article.sectionSlug },
          { '@type': 'ListItem', position: 3, name: article.title, item: ORIGIN + path },
        ],
      },
    ],
  }), [article, path])

  useSupportHead({
    title: article ? `${article.title} · MatchPulse Support` : 'Support · MatchPulse',
    description: article?.description,
    path,
    jsonLd,
  })

  if (!article) return <Navigate to="/support" replace />

  // Internal cross-links render as plain <a href="/support/…"> in the article
  // HTML; intercept clicks so they navigate client-side (no full reload).
  function onBodyClick(e) {
    const a = e.target.closest('a')
    if (!a) return
    const href = a.getAttribute('href')
    if (href && href.startsWith('/support')) { e.preventDefault(); navigate(href) }
  }

  return (
    <div className="mp-support">
      <div className="wrap">
        <div className="crumb">
          <Link to="/support">Support Centre</Link>
          <span className="sep">/</span>
          <span>{article.sectionTitle}</span>
        </div>

        <div className="article-grid">
          {/* Section nav */}
          <nav className="sidenav" aria-label={`${article.sectionTitle} articles`}>
            <p className="label">{article.sectionTitle}</p>
            {(section?.articles ?? []).map(a => (
              <Link key={a.slug} to={`/support/${a.category}/${a.slug}`}
                className={a.slug === slug ? 'active' : ''}>
                {a.title}
              </Link>
            ))}
          </nav>

          {/* Article body */}
          <div>
            <article className="prose">
              <h1>{article.title}</h1>
              <div className="meta">{article.sectionTitle}</div>
              {slots.map((img, i) => <SupportImage key={i} {...img} />)}
              <div onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: article.html }} />
            </article>

            <div className="article-foot">
              {prev
                ? <Link to={`/support/${prev.category}/${prev.slug}`}>← {prev.title}</Link>
                : <span />}
              {next
                ? <Link to={`/support/${next.category}/${next.slug}`}>{next.title} →</Link>
                : <span />}
            </div>

            <Link to="/support" className="back-link"><ChevronLeft className="w-4 h-4" style={{ display: 'inline', verticalAlign: 'middle' }} /> All support articles</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
