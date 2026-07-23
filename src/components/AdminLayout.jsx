import { useState, useEffect } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Home, Trophy, Shield, User, KeyRound, Search, CreditCard, ArrowLeft, Menu, X, Link2, CalendarDays, Inbox } from 'lucide-react'

export default function AdminLayout() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => { setOpen(false) }, [pathname])

  const navItems = [
    { to: '/admin',               label: 'Dashboard',      Icon: Home,    end: true },
    { to: '/admin/competitions',  label: 'Competitions',   Icon: Trophy             },
    { to: '/admin/fixtures',      label: 'Fixtures',       Icon: CalendarDays       },
    { to: '/admin/result-queue',  label: 'Awaiting result', Icon: Inbox             },
    { to: '/admin/organizations', label: 'Organizations',  Icon: Shield             },
    { to: '/admin/people',        label: 'People',         Icon: User               },
    { to: '/admin/permissions',   label: 'Administrators', Icon: KeyRound           },
    { to: '/admin/user-access',   label: 'User Access',    Icon: Link2              },
    { to: '/admin/seo',           label: 'SEO',            Icon: Search             },
    { to: '/admin/billing',       label: 'Billing',        Icon: CreditCard         },
  ]

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
            <div className="text-[9px] font-mono uppercase tracking-widest text-amber-600 mt-0.5">Admin</div>
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
            <div className="text-[9px] font-mono uppercase tracking-widest text-amber-600 mt-0.5">Admin</div>
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
            <Link to="/"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-transparent">
              <ArrowLeft className="w-5 h-5 shrink-0" />
              Public site
            </Link>
          </nav>
        )}

        <main className="flex-1 pb-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
