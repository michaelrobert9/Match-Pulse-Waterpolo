import { Link, useLocation } from 'react-router-dom'
import { competitionUrl } from '../lib/slugify'
import CompetitionStatusBadge from './CompetitionStatusBadge'
import CompetitionCrest from './CompetitionCrest'

// Tabs are type-aware. League shows a full standings table; tournaments show
// pools + knockout; festivals show no ranking (fixtures + optional info stats).
function tabsForType(base, type, { festivalStats } = {}) {
  if (type === 'tournament') {
    return [
      { to: base,               label: 'Overview' },
      { to: `${base}/pools`,     label: 'Pools' },
      { to: `${base}/knockout`,  label: 'Playoffs' },
      { to: `${base}/fixtures`,  label: 'Fixtures' },
    ]
  }
  if (type === 'festival') {
    const t = [
      { to: base,               label: 'Overview' },
      { to: `${base}/fixtures`,  label: 'Fixtures' },
    ]
    if (festivalStats) t.push({ to: `${base}/stats`, label: 'Stats' })
    return t
  }
  // league (default)
  return [
    { to: base,                label: 'Overview' },
    { to: `${base}/standings`, label: 'Standings' },
    { to: `${base}/fixtures`,  label: 'Fixtures' },
  ]
}

export default function CompetitionNav({ competition }) {
  const { pathname } = useLocation()
  const base = competitionUrl(competition)
  const festivalStats = competition.rules?.statsTable?.enabled === true
  const tabs = tabsForType(base, competition.type, { festivalStats }).map(t => ({
    ...t,
    active: t.to === base ? pathname === base : pathname.startsWith(t.to),
  }))

  return (
    <div className="border-b border-slate-200 bg-white">
      {competition.bannerUrl && (
        <div className="w-full">
          <img src={competition.bannerUrl} alt=""
            className="w-full h-32 sm:h-44 object-cover" />
        </div>
      )}
      <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <CompetitionCrest competition={competition} size={44} className="mt-0.5" />
            <div className="min-w-0">
              <h1 className="font-display font-bold text-slate-900 text-lg leading-tight truncate">{competition.name}</h1>
              <div className="micro-label mt-0.5">
                {[competition.type, competition.ageGroup, competition.gender, competition.season].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <CompetitionStatusBadge competition={competition} className="shrink-0 mt-0.5" />
        </div>

        <div className="flex -mb-px overflow-x-auto">
          {tabs.map(({ to, label, active }) => (
            <Link key={to} to={to}
              className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-emerald-600 text-emerald-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
