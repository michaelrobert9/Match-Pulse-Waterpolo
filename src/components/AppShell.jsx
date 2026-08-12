import { useState, useEffect } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LazyBoundary from './LazyBoundary'
import { Home, Trophy, Shield, User, KeyRound, Search, ArrowLeft, Menu, X, Link2, CalendarDays, Inbox, Radio } from 'lucide-react'

// The single management shell. One chrome for BOTH platform admins and non-admin
// organisers — the left-nav is filtered by role, not a separate component. Every
// route that used to render bare in the public Layout (the /manage/* pages, match
// creation, the scorer list, my-players, profile) now renders inside this shell,
// so an admin or organiser never drops out to the front-end layout mid-session.
//
// Nav is derived from useAuth():
//   • platformAdmin claim  → the platform sections (People, SEO, Permissions, …)
//   • orgRoles             → "Create match" (needs an org)
//   • canScore             → the organiser competitions/score surfaces
// Everyone keeps a populated rail (Home, My players) so a claimed-profile-only
// spectator sees a thin-but-real nav, never an empty one.
function navFor({ isPlatformAdmin, orgRoles, canScore }) {
  if (isPlatformAdmin) {
    return [
      { to: '/admin',               label: 'Dashboard',       Icon: Home,        end: true },
      { to: '/manage/competitions', label: 'Competitions',    Icon: Trophy             },
      { to: '/admin/matches',       label: 'Matches',         Icon: CalendarDays       },
      { to: '/admin/result-queue',  label: 'Awaiting result', Icon: Inbox              },
      { to: '/admin/organizations', label: 'Organizations',   Icon: Shield             },
      { to: '/admin/people',        label: 'People',          Icon: User               },
      { to: '/admin/permissions',   label: 'Administrators',  Icon: KeyRound           },
      { to: '/admin/user-access',   label: 'User Access',     Icon: Link2              },
      { to: '/admin/seo',           label: 'SEO',             Icon: Search             },
    ]
  }

  // Organiser / any signed-in user. Always-present items keep the rail populated.
  const items = [
    { to: '/manage', label: 'Home', Icon: Home, end: true },
  ]
  if (canScore) {
    items.push({ to: '/manage/competitions', label: 'Competitions', Icon: Trophy })
  }
  if (Object.keys(orgRoles ?? {}).length > 0) {
    items.push({ to: '/match/new', label: 'Create match', Icon: CalendarDays })
  }
  items.push({ to: '/my-players', label: 'My players', Icon: User })
  if (canScore) {
    items.push({ to: '/score', label: 'Score matches', Icon: Radio })
  }
  return items
}

export default function AppShell() {
  const { user, isPlatformAdmin, orgRoles, canScore } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => { setOpen(false) }, [pathname])

  const navItems = navFor({ isPlatformAdmin, orgRoles, canScore })
  // Wordmark badge reads "Admin" for platform admins, "Manage" for organisers —
  // an organiser is not an admin and shouldn't be told they're in an admin area.
  const badge = isPlatformAdmin ? 'Admin' : 'Manage'

  const initials = user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      isActive
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
    }`

  return (
    <div className="min-h-screen bg-canvas flex">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen overflow-y-auto shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200">
          <Link to="/" className="block">
            <div className="font-display font-bold text-slate-900 text-base leading-none">
              Match<span className="text-emerald-600">Pulse</span>
            </div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-amber-600 mt-0.5">{badge}</div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass}>
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-200 space-y-1">
          <Link to="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-transparent">
            <ArrowLeft className="w-5 h-5 shrink-0" />
            Public site
          </Link>
          <Link to="/profile"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 transition-colors group border border-transparent">
            <div className="w-6 h-6 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center group-hover:border-emerald-500 transition-colors shrink-0">
              <span className="text-[9px] font-black text-emerald-600 leading-none">{initials}</span>
            </div>
            <span className="text-xs text-slate-500 font-mono truncate group-hover:text-slate-700 transition-colors">
              {user?.email}
            </span>
          </Link>
        </div>
      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0 shadow-sm">
          <Link to="/" className="block">
            <div className="font-display font-bold text-slate-900 text-base leading-none">
              Match<span className="text-emerald-600">Pulse</span>
            </div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-amber-600 mt-0.5">{badge}</div>
          </Link>
          <button onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors">
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </header>

        {/* Mobile dropdown nav */}
        {open && (
          <nav className="md:hidden bg-white border-b border-slate-200 px-3 py-3 space-y-0.5 shadow-sm">
            {navItems.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClass}>
                <Icon className="w-5 h-5 shrink-0" />
                {label}
              </NavLink>
            ))}
            <div className="border-t border-slate-200 my-2" />
            <Link to="/profile"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-transparent">
              <User className="w-5 h-5 shrink-0" />
              Account
            </Link>
            <Link to="/"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-transparent">
              <ArrowLeft className="w-5 h-5 shrink-0" />
              Public site
            </Link>
          </nav>
        )}

        <main className="flex-1 pb-8">
          <LazyBoundary><Outlet /></LazyBoundary>
        </main>
      </div>
    </div>
  )
}
