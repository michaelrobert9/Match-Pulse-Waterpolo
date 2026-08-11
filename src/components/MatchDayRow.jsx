import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { teamAccent } from '../lib/teamAccent'

// MatchDayRow — a collapsed "match day" (a group of child matches sharing a
// matchGroupId) rendered as ONE row in the ORG and PLATFORM feeds. Links to the
// group page (item.path). Never used on team/player/scorer listings, which keep
// showing individual matches.
//
// Props:
//   item        — a { kind:'group', ... } item from collapseMatchDays()
//   viewerOrgId — the org whose page this is (org feed); omitted on the platform
//                 feed, where we show "{home} vs {away}" instead of an opponent.

const LIVE_RED = '#E5484D'

function fmtDay(dateStr) {
  if (!dateStr) return ''
  // dateStr is 'YYYY-MM-DD'. Anchor to midday so the local date can't slip.
  const d = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function MatchDayRow({ item, viewerOrgId }) {
  const { tally } = item
  const played  = tally?.played ?? 0
  const toPlay  = tally?.toPlay ?? 0
  const isLive  = tally?.status === 'live'
  const hasResult = played > 0 || isLive

  const homeAccent = teamAccent(item.homeColor)
  const awayAccent = teamAccent(item.awayColor)

  // Who is the opponent (org feed), or the full pairing (platform feed).
  let title
  if (viewerOrgId && viewerOrgId === item.homeOrgId) {
    title = item.awayName
  } else if (viewerOrgId && viewerOrgId === item.awayOrgId) {
    title = item.homeName
  } else {
    title = `${item.homeName} vs ${item.awayName}`
  }

  // Day scoreline — present the viewer's wins first on their own away page.
  const viewerIsAway = viewerOrgId && viewerOrgId === item.awayOrgId
  const leftWins  = viewerIsAway ? (tally?.awayWins ?? 0) : (tally?.homeWins ?? 0)
  const rightWins = viewerIsAway ? (tally?.homeWins ?? 0) : (tally?.awayWins ?? 0)

  const count = item.count ?? item.kids?.length ?? 0
  const countLabel = `${count} match${count === 1 ? '' : 'es'}`

  return (
    <Link to={item.path || '/'}
      className="block bg-white rounded-2xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="flex items-center gap-3">

        {/* Identity accent + match-day glyph */}
        <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${homeAccent}1a, ${awayAccent}1a)`, border: '1px solid #e2e8f0' }}>
          <Layers className="w-4 h-4" style={{ color: homeAccent }} />
        </div>

        {/* Middle: date + opponent/pairing + match-day affordance */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{fmtDay(item.matchDate)}</span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">·</span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">Match day</span>
            {isLive && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ color: LIVE_RED, background: `${LIVE_RED}14` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: LIVE_RED }} />
                Live
              </span>
            )}
          </div>
          <div className="text-slate-900 font-semibold text-sm truncate mt-0.5">{title}</div>
          <div className="text-slate-500 text-[11px] mt-0.5">
            {hasResult ? countLabel : `${countLabel}${toPlay > 0 ? ` · ${toPlay} to play` : ''}`}
          </div>
        </div>

        {/* Right: day tally scoreline (once anything to show) */}
        {hasResult && (
          <div className="shrink-0 text-right">
            <div className="font-mono font-bold text-xl tabular-nums text-slate-900 leading-none">
              <span style={leftWins > rightWins ? { color: viewerIsAway ? awayAccent : homeAccent } : undefined}>{leftWins}</span>
              <span className="text-slate-300 font-normal mx-0.5">–</span>
              <span style={rightWins > leftWins ? { color: viewerIsAway ? homeAccent : awayAccent } : undefined}>{rightWins}</span>
            </div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">
              {played > 0 ? `${played} played` : 'Live'}
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
