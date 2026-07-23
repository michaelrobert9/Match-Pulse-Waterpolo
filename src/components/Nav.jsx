import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Menu, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchLiveMatches } from '../lib/queries'

function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

const NAV_ITEMS = [
  { to: '/',               label: 'Home',          end: true },
  { to: '/competitions',   label: 'Competitions' },
  { to: '/players',        label: 'Players' },
  { to: '/why-matchpulse', label: 'Why MatchPulse' },
  { to: '/plans',          label: 'Plans' },
  { to: '/support',        label: 'Support' },
]

const TEAMS_ITEMS = [
  { to: '/schools',      label: 'Schools' },
  { to: '/clubs',        label: 'Clubs' },
  { to: '/associations', label: 'Associations' },
]

const linkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'text-slate-900 bg-slate-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
  }`

const mobileLinkClass = ({ isActive }) =>
  `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'text-slate-900 bg-slate-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
  }`

function TeamsDropdown({ pathname }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const isActive = TEAMS_ITEMS.some(i => pathname.startsWith(i.to))

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'text-slate-900 bg-slate-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
        }`}
      >
        Teams
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden py-1">
          {TEAMS_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)}
              className={({ isActive: a }) =>
                `block px-4 py-2.5 text-sm font-medium transition-colors ${a ? 'text-slate-900 bg-slate-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Nav() {
  const { user, isPlatformAdmin, orgRoles, canScore } = useAuth()
  const [open, setOpen] = useState(false)
  const [liveMatches, setLiveMatches] = useState([])
  const [badgeOpen, setBadgeOpen] = useState(false)
  const headerRef = useRef(null)
  const { pathname } = useLocation()
  const scrolled = useScrolled()

  useEffect(() => { setOpen(false); setBadgeOpen(false) }, [pathname])

  useEffect(() => {
    if (!canScore) { setLiveMatches([]); return }
    let alive = true
    const orgIds = Object.keys(orgRoles ?? {})
    async function load() {
      const all = await fetchLiveMatches(50)
      if (!alive) return
      setLiveMatches(isPlatformAdmin ? all : all.filter(m => orgIds.includes(m.orgId)))
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [canScore, isPlatformAdmin, orgRoles])

  // Close the live-matches dropdown on any click outside the header (covers
  // both the desktop badge and the mobile indicator — both live in the header).
  useEffect(() => {
    if (!badgeOpen) return
    function onDown(e) {
      if (headerRef.current && !headerRef.current.contains(e.target)) setBadgeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [badgeOpen])

  const hasLive = liveMatches.length > 0

  return (
    <header ref={headerRef} className={`border-b border-slate-200 sticky top-0 z-20 transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-md' : 'bg-white shadow-sm'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">

        {/* Logo — always links home */}
        <Link to="/" className="flex items-center gap-1.5 shrink-0">
          <span className="font-display font-bold text-slate-900 text-lg leading-none">
            Match<span className="text-emerald-600">Pulse</span>
          </span>
          <span className="text-[9px] font-black uppercase tracking-[0.15em] text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5 leading-none">
            Water Polo
          </span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1 flex-1 ml-4">
          <NavLink to="/" end className={linkClass}>Home</NavLink>
          <TeamsDropdown pathname={pathname} />
          {NAV_ITEMS.filter(i => i.to !== '/').map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>{item.label}</NavLink>
          ))}
          {canScore && (
            <NavLink to="/score" className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-red-700 bg-red-50' : 'text-red-600 hover:text-red-700 hover:bg-red-50'}`
            }>Score</NavLink>
          )}
          {user && !isPlatformAdmin && (
            <NavLink to="/manage" className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-emerald-700 bg-emerald-50' : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'}`
            }>Manage</NavLink>
          )}
          {isPlatformAdmin && (
            <NavLink to="/admin" className={({ isActive }) =>
              `ml-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-amber-700 bg-amber-50' : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'}`
            }>Admin</NavLink>
          )}
        </nav>

        {/* Desktop right: live badge + profile / sign in */}
        <div className="hidden md:flex items-center gap-2 ml-auto">
          {hasLive && (
            <div className="relative">
              <button onClick={() => setBadgeOpen(o => !o)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-bold text-red-600 tabular-nums">{liveMatches.length} LIVE</span>
              </button>
              {badgeOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
                  {liveMatches.map(m => (
                    <Link key={m.id} to={`/score/${m.id}`} onClick={() => setBadgeOpen(false)}
                      className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                      <span className="text-sm font-medium text-slate-900 truncate">
                        {m.homeOrgName ? `${m.homeOrgName} ${m.homeTeamName}` : (m.homeTeamName ?? "")} <span className="font-mono font-black">{m.homeScore}–{m.awayScore}</span> {m.awayOrgName ? `${m.awayOrgName} ${m.awayTeamName}` : (m.awayTeamName ?? "")}
                      </span>
                      <span className="text-[10px] text-red-500 font-bold ml-2 shrink-0">● LIVE</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
          {user ? (
            <Link to="/profile"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors group">
              <div className="w-7 h-7 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center group-hover:border-emerald-400 transition-colors shrink-0">
                <span className="text-[10px] font-black text-emerald-700 leading-none">
                  {user.displayName?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors max-w-[140px] truncate">
                {user.displayName || user.email?.split('@')[0]}
              </span>
            </Link>
          ) : (
            <Link to="/login"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg px-4 py-2 transition-colors">
              Sign in
            </Link>
          )}
        </div>

        {/* Mobile: live indicator + burger */}
        <div className="md:hidden ml-auto flex items-center gap-1">
          {hasLive && (
            <button onClick={() => { setBadgeOpen(o => !o); setOpen(false) }}
              aria-label="Live matches" aria-expanded={badgeOpen}
              className="relative w-10 h-10 rounded-lg flex items-center justify-center hover:bg-red-50 transition-colors shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-[8px] font-black text-white flex items-center justify-center leading-none">
                {liveMatches.length}
              </span>
            </button>
          )}
          <button onClick={() => { setOpen(o => !o); setBadgeOpen(false) }}
            aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
            className="w-11 h-11 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors shrink-0">
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile live-matches dropdown — opened by the indicator, independent of the menu */}
      {badgeOpen && hasLive && (
        <div className="md:hidden absolute right-2 top-full mt-1 w-72 max-w-[calc(100vw-1rem)] bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">Live now</span>
          </div>
          {liveMatches.map(m => (
            <Link key={m.id} to={`/score/${m.id}`} onClick={() => setBadgeOpen(false)}
              className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
              <span className="text-sm font-medium text-slate-900 truncate">
                {m.homeOrgName ? `${m.homeOrgName} ${m.homeTeamName}` : (m.homeTeamName ?? "")} <span className="font-mono font-black">{m.homeScore}–{m.awayScore}</span> {m.awayOrgName ? `${m.awayOrgName} ${m.awayTeamName}` : (m.awayTeamName ?? "")}
              </span>
              <span className="text-[10px] text-red-500 font-bold ml-2 shrink-0">● LIVE</span>
            </Link>
          ))}
        </div>
      )}

      {/* Mobile menu panel */}
      {open && (
        <nav className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
          <NavLink to="/" end className={mobileLinkClass}>Home</NavLink>
          {/* Teams group */}
          <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Teams</p>
          {TEAMS_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} className={mobileLinkClass}>{item.label}</NavLink>
          ))}
          {NAV_ITEMS.filter(i => i.to !== '/').map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={mobileLinkClass}>{item.label}</NavLink>
          ))}
          {canScore && (
            <NavLink to="/score" className={({ isActive }) =>
              `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-red-700 bg-red-50' : 'text-red-600 hover:bg-red-50'}`
            }>Score</NavLink>
          )}
          {user && !isPlatformAdmin && (
            <NavLink to="/manage" className={({ isActive }) =>
              `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-emerald-700 bg-emerald-50' : 'text-emerald-600 hover:bg-emerald-50'}`
            }>Manage</NavLink>
          )}
          {isPlatformAdmin && (
            <NavLink to="/admin" className={({ isActive }) =>
              `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-amber-700 bg-amber-50' : 'text-amber-600 hover:bg-amber-50'}`
            }>Admin</NavLink>
          )}

          <div className="border-t border-slate-200 my-2" />

          {user ? (
            <NavLink to="/profile" className={mobileLinkClass}>
              {user.displayName || user.email?.split('@')[0] || 'Profile'}
            </NavLink>
          ) : (
            <Link to="/login"
              className="block text-center bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg px-4 py-2.5 transition-colors">
              Sign in
            </Link>
          )}
        </nav>
      )}
    </header>
  )
}
