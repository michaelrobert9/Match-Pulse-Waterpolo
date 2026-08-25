import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchPlayers } from '../lib/queries'
import { playerUrl } from '../lib/slugify'

function initials(name) {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse shadow-sm">
      <div className="aspect-video bg-slate-200" />
      <div className="px-4 py-3">
        <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
      </div>
    </div>
  )
}

function PlayerCard({ person }) {
  const hasPhoto = !!person.photoUrl

  return (
    <Link to={playerUrl(person)}
      className="block bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-slate-300 hover:shadow-md transition-all duration-200 shadow-sm group">

      {/* Banner — the profile banner image (gradient fallback), with the
          portrait as a bottom-left rounded-square badge, matching the org and
          competition cards. */}
      <div className="relative aspect-video overflow-hidden">
        {person.bannerUrl
          ? <img src={person.bannerUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />
        }
        {/* Portrait badge — bottom-left */}
        <div className="absolute bottom-3 left-4 w-12 h-12 rounded-xl bg-white shadow border border-white/80 flex items-center justify-center overflow-hidden shrink-0">
          {hasPhoto
            ? <img src={person.photoUrl} alt="" className="w-full h-full object-cover object-top" />
            : <span className="text-sm font-black font-mono text-slate-500 leading-none">{initials(person.fullName)}</span>
          }
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-4">
        <div className="font-display font-bold text-slate-900 text-base leading-tight">{person.fullName}</div>
        <div className="flex items-center justify-between mt-1 gap-2">
          <div className="text-xs text-slate-500 min-w-0 truncate">
            {[person.position, person.nationality].filter(Boolean).join(' · ')}
          </div>
          {(person.careerCaps ?? 0) > 0 && (
            <div className="shrink-0 text-right">
              <span className="font-mono font-bold text-sm text-emerald-600">{person.careerCaps}</span>
              <span className="text-xs text-slate-400 ml-1">caps</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// The words of a person's name (first name, surname, any middle names), used by
// the A–Z index so a player can be found by EITHER their name or surname.
function nameWords(fullName) {
  return (fullName || '').split(/\s+/).filter(Boolean)
}
// True when any name word starts with the given (upper-case) letter.
function nameStartsWith(fullName, letter) {
  return nameWords(fullName).some(w => w[0]?.toUpperCase() === letter)
}

export default function PlayersList() {
  const [all,     setAll]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [search,  setSearch]  = useState('')
  const [letter,  setLetter]  = useState('')   // active A–Z filter, '' = all

  function load() {
    setLoading(true); setError(false)
    fetchPlayers()
      .then(setAll)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { document.title = 'Players · MatchPulse'; load() }, [])

  // Letters that actually have at least one player, so empty letters render
  // disabled rather than leading to a dead end.
  const availableLetters = new Set()
  all.forEach(p => nameWords(p.fullName).forEach(w => {
    const c = w[0]?.toUpperCase()
    if (c >= 'A' && c <= 'Z') availableLetters.add(c)
  }))

  const q = search.trim().toLowerCase()
  const visible = all.filter(p =>
    (!q || p.fullName?.toLowerCase().includes(q)) &&
    (!letter || nameStartsWith(p.fullName, letter))
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display font-bold text-slate-900 text-2xl">Players</h1>
        {!loading && all.length > 0 && (
          <span className="micro-label text-slate-400">{all.length} player{all.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Search */}
      {!loading && all.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors shadow-sm"
          />
        </div>
      )}

      {/* A–Z index — jump to players whose name OR surname starts with a letter. */}
      {!loading && all.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setLetter('')}
            className={`min-w-[28px] h-7 px-2 rounded-md text-xs font-bold transition-colors ${
              letter === '' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}>
            All
          </button>
          {ALPHABET.map(L => {
            const has = availableLetters.has(L)
            const active = letter === L
            return (
              <button
                key={L}
                disabled={!has}
                onClick={() => setLetter(active ? '' : L)}
                className={`w-7 h-7 rounded-md text-xs font-bold transition-colors ${
                  active ? 'bg-emerald-600 text-white'
                  : has ? 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  : 'bg-transparent text-slate-300 cursor-default'
                }`}>
                {L}
              </button>
            )
          })}
        </div>
      )}

      {error ? (
        <div className="px-4 py-16 flex flex-col items-center gap-4">
          <p className="text-slate-500 text-sm">Failed to load players.</p>
          <button onClick={load}
            className="text-sm text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm mb-1">
            {search ? `No players matching "${search}".`
              : letter ? `No players with a name starting with “${letter}”.`
              : 'No players yet.'}
          </p>
          {(search || letter)
            ? <button onClick={() => { setSearch(''); setLetter('') }} className="text-emerald-600 text-sm hover:underline">Clear filters</button>
            : <p className="text-slate-400 text-xs">Player profiles will appear here once they are added.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map(p => <PlayerCard key={p.id} person={p} />)}
        </div>
      )}
    </div>
  )
}
