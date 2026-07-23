import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { sections, indexMeta } from '../../support'
import { useSupportHead } from '../../support/head'
import './Support.css'

export default function SupportIndex() {
  const [q, setQ] = useState('')

  useSupportHead({
    title: 'Support Centre · MatchPulse',
    description: indexMeta.introPlain || 'Help and how-to guides for running competitions on MatchPulse.',
    path: '/support',
  })

  const query = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!query) return sections
    return sections
      .map(s => ({ ...s, articles: s.articles.filter(a => a.title.toLowerCase().includes(query)) }))
      .filter(s => s.title.toLowerCase().includes(query) || s.articles.length > 0)
  }, [query])

  return (
    <div className="mp-support">
      <div className="wrap">
        <div className="crumb"><span>Support Centre</span></div>
        <div className="head">
          <div className="eyebrow">Support Centre</div>
          <h1>{indexMeta.title}</h1>
          <div className="lede" dangerouslySetInnerHTML={{ __html: indexMeta.introHtml }} />
          <div className="search">
            <Search className="w-4 h-4" />
            <input
              type="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search the support centre…" aria-label="Search support articles" />
          </div>
        </div>

        <div className="sections">
          {filtered.map(section => (
            <div className="sec-card" key={section.slug}>
              <h2>{section.title}</h2>
              {section.articles.length === 0 ? (
                <div className="sec-empty">No matching articles.</div>
              ) : (
                <ul>
                  {section.articles.map(a => (
                    <li key={a.slug}>
                      <Link to={`/support/${a.category}/${a.slug}`}>{a.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="sec-empty">Nothing matches “{q}”. Try another word.</div>
          )}
        </div>
      </div>
    </div>
  )
}
