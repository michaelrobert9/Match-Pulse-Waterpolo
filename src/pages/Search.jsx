import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search as SearchIcon, X, ChevronRight, Clock } from 'lucide-react'
import { fetchAllCompetitions, fetchTopPeople } from '../lib/queries'

const EXAMPLE_TAGS = ['Senior IPT 2026', 'St Stithians', 'Western Province', 'U18 Girls', 'PHL 2026']

function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem('mp_recent_searches') || '[]') }
  catch { return [] }
}

function saveRecentSearch(q) {
  const prev = getRecentSearches().filter(s => s.toLowerCase() !== q.toLowerCase())
  localStorage.setItem('mp_recent_searches', JSON.stringify([q, ...prev].slice(0, 5)))
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 animate-pulse shadow-sm">
      <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-slate-200 rounded w-2/3" />
        <div className="h-3 bg-slate-200 rounded w-1/3" />
      </div>
    </div>
  )
}

export default function Search() {
  const [query,   setQuery]   = useState('')
  const [comps,   setComps]   = useState([])
  const [people,  setPeople]  = useState([])
  const [loaded,  setLoaded]  = useState(false)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  const [recentSearches, setRecentSearches] = useState(getRecentSearches)

  useEffect(() => {
    document.title = 'Search · MatchPulse'
    inputRef.current?.focus()
  }, [])

  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (q.length < 2 || loaded) return
    setLoading(true)
    Promise.all([fetchAllCompetitions(), fetchTopPeople(500)])
      .then(([c, p]) => { setComps(c); setPeople(p); setLoaded(true) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [q, loaded])

  useEffect(() => {
    if (loaded && q.length >= 2) {
      saveRecentSearch(query.trim())
      setRecentSearches(getRecentSearches())
    }
  }, [loaded, q])

  const matchedComps  = loaded && q.length >= 2 ? comps.filter(c => c.name?.toLowerCase().includes(q)) : []
  const matchedPeople = loaded && q.length >= 2 ? people.filter(p => p.fullName?.toLowerCase().includes(q)) : []
  const showEmpty     = loaded && q.length >= 2 && !loading && matchedComps.length === 0 && matchedPeople.length === 0
  const showIdle      = q.length < 2

  function applyTag(tag) {
    setQuery(tag)
    inputRef.current?.focus()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-12">
      {/* Input */}
      <div className="relative mb-5">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search competitions or players…"
          className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-10 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 text-sm transition-colors shadow-sm"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* No results */}
      {showEmpty && (
        <p className="text-center text-slate-500 text-sm py-8">
          No results for &ldquo;{query}&rdquo;
        </p>
      )}

      {/* Competition results */}
      {matchedComps.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Competitions</h2>
          <div className="space-y-2">
            {matchedComps.map(c => (
              <Link key={c.id} to={`/competitions/${c.id}`}
                className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-slate-900 text-base truncate">{c.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {c.season && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.season}</span>}
                      {c.gender && <><span className="text-slate-300">·</span><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.gender}</span></>}
                      {c.ageGroup && <><span className="text-slate-300">·</span><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.ageGroup}</span></>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Player results */}
      {matchedPeople.length > 0 && (
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Players</h2>
          <div className="space-y-2">
            {matchedPeople.map(p => {
              const initials = (p.fullName ?? '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
              return (
                <Link key={p.id} to={`/people/${p.id}`}
                  className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition-colors shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                    {p.photoUrl
                      ? <img src={p.photoUrl} alt="" className="w-full h-full object-cover" />
                      : <span className="font-display font-bold text-sm text-slate-500">{initials}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 font-semibold text-sm truncate">{p.fullName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-xs text-emerald-600">{p.careerCaps ?? 0} caps</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-xs text-slate-500">{p.careerGoals ?? 0} goals</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Idle state — recent searches + suggestions */}
      {showIdle && !loading && (
        <div className="space-y-6">
          {/* Recent searches */}
          {recentSearches.length > 0 && focused && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Recent</h2>
                <button
                  onClick={() => { localStorage.removeItem('mp_recent_searches'); setRecentSearches([]) }}
                  className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors">
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map(s => (
                  <button key={s} onClick={() => applyTag(s)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-100 transition-colors text-left">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-sm text-slate-600">{s}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Suggestions */}
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
              Try searching for
            </h2>
            <p className="text-slate-500 text-xs mb-3">
              A player name, team, school or competition.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => applyTag(tag)}
                  className="text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 px-3 py-1.5 rounded-full transition-colors">
                  {tag}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
