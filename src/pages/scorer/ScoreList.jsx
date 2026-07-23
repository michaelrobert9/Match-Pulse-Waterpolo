import { useEffect, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchActionableMatches, toDate } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { prefetchMatchTeams } from '../../lib/teamIdentity'
import { MatchTeamIdentity, MatchTeamCrest } from '../../components/TeamIdentity'

function dayKey(val) {
  const d = toDate(val)
  return d ? d.toDateString() : '__tbd__'
}

function dayLabel(key) {
  if (key === '__tbd__') return 'Date TBD'
  const today    = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (key === today.toDateString())    return 'Today'
  if (key === tomorrow.toDateString()) return 'Tomorrow'
  return new Date(key).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
}

function fmtTime(val) {
  const d = toDate(val)
  return d ? d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : 'TBD'
}

function groupByDay(matches) {
  const order = []
  const groups = {}
  for (const m of matches) {
    const k = dayKey(m.scheduledAt)
    if (!groups[k]) { order.push(k); groups[k] = [] }
    groups[k].push(m)
  }
  return order.map(k => ({ key: k, label: dayLabel(k), matches: groups[k] }))
}

export default function ScoreList() {
  const { isPlatformAdmin, orgRoles, competitionRoles } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchActionableMatches({
      isPlatformAdmin,
      orgIds: Object.keys(orgRoles ?? {}),
      competitionIds: Object.keys(competitionRoles ?? {}),
    })
      .then(list => { prefetchMatchTeams(list); setMatches(list) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isPlatformAdmin, orgRoles, competitionRoles])

  const groups = groupByDay(matches)

  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-slate-900 text-lg">My matches</h1>
        <Link to="/fixtures/new"
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg px-3 py-2 transition-colors">
          <Plus className="w-4 h-4" />
          Add fixture
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : matches.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-slate-500 text-sm">No live or upcoming matches.</p>
          <Link to="/fixtures/new"
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg px-4 py-2.5 transition-colors">
            <Plus className="w-4 h-4" />
            Add a fixture
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.key}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{group.label}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <div className="space-y-2">
                {group.matches.map(match => {
                  const isLive = match.status === 'live'
                  return (
                    <Link key={match.id} to={`/score/${match.id}`}
                      className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-4 hover:border-slate-300 transition-colors shadow-sm ${
                        isLive ? 'border-red-200' : 'border-slate-200'
                      }`}>
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isLive ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`} />

                      {/* Two equal columns with the vs/score locked in the centre,
                          so it stays centred no matter how long either name is.
                          Names wrap fully — never truncated. */}
                      <div className="flex-1 min-w-0">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
                          <div className="flex flex-col items-center gap-1.5 min-w-0">
                            <MatchTeamCrest match={match} side="home" size={26} />
                            <MatchTeamIdentity match={match} side="home" hideIdentifier noLink align="center"
                              nameClass="text-slate-900 text-[13px] font-semibold text-center" />
                          </div>
                          <div className="self-center px-1">
                            {isLive ? (
                              <span className="font-mono font-black text-slate-900 text-base tabular-nums">
                                {match.homeScore}–{match.awayScore}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs font-semibold uppercase">vs</span>
                            )}
                          </div>
                          <div className="flex flex-col items-center gap-1.5 min-w-0">
                            <MatchTeamCrest match={match} side="away" size={26} />
                            <MatchTeamIdentity match={match} side="away" hideIdentifier noLink align="center"
                              nameClass="text-slate-900 text-[13px] font-semibold text-center" />
                          </div>
                        </div>
                        <div className="micro-label text-center mt-1.5">
                          {isLive
                            ? <span className="text-red-600">● LIVE{match.currentPeriod ? ` · ${match.currentPeriod}` : ''}</span>
                            : fmtTime(match.scheduledAt)
                          }
                        </div>
                      </div>

                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
