import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isScheduled, isLive } from '../lib/fixtureStatus'
import {
  fetchTeamBySlug, fetchTeamByOrgPath, fetchTeamLineup,
  fetchOrganization, fetchMatchesForTeam, fetchAllPeople, toDate,
} from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { assignPlayer, removePlayer, updatePlayer } from '../lib/adminQueries'
import { playerUrl, orgUrl, matchUrl } from '../lib/slugify'
import { generatedTeamName } from '../lib/teamNaming'
import { prefetchMatchTeams, resolveTeamProfileIdentity } from '../lib/teamIdentity'
import { monogram } from '../lib/names'
import { useSeoMeta } from '../lib/useSeoMeta'
import { MatchTeamIdentity } from '../components/TeamIdentity'
import StatusBadge from '../components/StatusBadge'
import SquadManager from '../components/SquadManager'

// Win/loss/draw + goals for a team across a (optionally season-filtered) set of
// final matches. Computed from matches rather than the team doc's cumulative
// counters so a current-season vs all-time split is always available.
function computeTeamStats(matches, teamId, season = null) {
  let played = 0, won = 0, lost = 0, drawn = 0, goalsFor = 0, goalsAgainst = 0
  for (const m of matches) {
    if (m.status !== 'final') continue
    if (season != null && String(m.season ?? '') !== String(season)) continue
    const isHome = m.homeTeamId === teamId
    const teamS  = isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0)
    const oppS   = isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0)
    played++; goalsFor += teamS; goalsAgainst += oppS
    if (teamS > oppS) won++
    else if (teamS < oppS) lost++
    else drawn++
  }
  return { played, won, lost, drawn, goalsFor, goalsAgainst }
}

function StatGrid({ stats }) {
  const cells = [
    { value: stats.played,       label: 'P'  },
    { value: stats.won,          label: 'W'  },
    { value: stats.drawn,        label: 'D'  },
    { value: stats.lost,         label: 'L'  },
    { value: stats.goalsFor,     label: 'GF' },
    { value: stats.goalsAgainst, label: 'GA' },
  ]
  return (
    <div className="grid grid-cols-6 gap-2">
      {cells.map(({ value, label }) => (
        <div key={label} className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-sm">
          <div className="font-mono font-black text-lg text-slate-900 tabular-nums">{value}</div>
          <div className="micro-label mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Presentational helpers — shared visual language with OrgDetail ────────────

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function fmtDateTime(val) {
  const d = toDate(val)
  if (!d) return 'TBD'
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
    + ' · '
    + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function fmtDateShort(val) {
  const d = toDate(val)
  if (!d) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function SectionHeader({ title }) {
  return <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">{title}</h2>
}

function EmptyCard({ message, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center shadow-sm">
      <p className="text-slate-500 text-sm">{message}</p>
      {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function UpcomingCard({ match }) {
  const isActive = match.status === 'live' || match.status === 'paused'
  return (
    <Link to={matchUrl(match)}
      className="block bg-white rounded-2xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {isActive
          ? <><StatusBadge status={match.status} /><span className="font-mono text-[10px] text-slate-500 uppercase tracking-widest">{fmtDateTime(match.scheduledAt)}</span></>
          : <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-600">{fmtDateTime(match.scheduledAt)}</span>
        }
      </div>
      <div className="space-y-1">
        <MatchTeamIdentity match={match} side="home" hideIdentifier className="min-w-0"
          nameClass="text-slate-900 font-semibold text-sm truncate" />
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">vs</span>
        <MatchTeamIdentity match={match} side="away" hideIdentifier className="min-w-0"
          nameClass="text-slate-900 font-semibold text-sm truncate" />
      </div>
      {match.pitch && <div className="text-slate-500 text-xs mt-1.5">{match.pitch}</div>}
    </Link>
  )
}

function ResultCard({ match }) {
  const home = match.homeScore ?? 0
  const away = match.awayScore ?? 0
  return (
    <Link to={matchUrl(match)}
      className="block bg-white rounded-2xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <StatusBadge status="final" />
        <span className="font-mono text-[10px] text-slate-400 tabular-nums">{fmtDateShort(match.scheduledAt)}</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <MatchTeamIdentity match={match} side="home" hideIdentifier className="flex-1"
            nameClass="text-sm font-semibold text-slate-900" />
          <span className="font-mono font-bold text-xl tabular-nums shrink-0 text-slate-900 w-8 text-right">
            {home}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <MatchTeamIdentity match={match} side="away" hideIdentifier className="flex-1"
            nameClass="text-sm font-semibold text-slate-900" />
          <span className="font-mono font-bold text-xl tabular-nums shrink-0 text-slate-900 w-8 text-right">
            {away}
          </span>
        </div>
      </div>
    </Link>
  )
}

export default function TeamDetail() {
  // Supports both the nested URL (/:orgSlug/:teamSlug) and the legacy /team/:slug.
  const { orgSlug, teamSlug, slug } = useParams()
  const [team,    setTeam]    = useState(null)
  const [org,     setOrg]     = useState(null)
  const [roster,  setRoster]  = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setNotFound(false)

    async function run() {
      let t = null, o = null
      if (orgSlug && teamSlug) {
        const res = await fetchTeamByOrgPath(orgSlug, teamSlug)
        t = res.team; o = res.org
      } else if (slug) {
        const arr = await fetchTeamBySlug(slug)
        t = arr[0] ?? null
      }
      if (!alive) return
      if (!t) { setNotFound(true); setLoading(false); return }

      const [lineup, allMatches] = await Promise.all([
        fetchTeamLineup(t.id),
        fetchMatchesForTeam(t.id),
      ])
      if (!o && t.organizationId) o = await fetchOrganization(t.organizationId)
      await prefetchMatchTeams(allMatches ?? [])
      if (!alive) return

      setTeam(t)
      setOrg(o)
      setRoster(lineup ?? [])
      setMatches(allMatches ?? [])
      setLoading(false)
    }

    run().catch(() => { if (alive) { setNotFound(true); setLoading(false) } })
    return () => { alive = false }
  }, [orgSlug, teamSlug, slug])

  // Resolve display identity (image / name / bio) with the org inherit-vs-own rule.
  const identity = team ? resolveTeamProfileIdentity(team, org) : null
  const name     = identity ? (identity.name || generatedTeamName(team) || team.displayName || team.name) : ''
  const fullName = org ? `${org.name} ${name}`.replace(/\s+/g, ' ').trim() : name
  useSeoMeta({ type: 'team', entity: team ? { ...team, displayName: fullName, orgSlug: org?.slug ?? null } : null })

  if (loading) return <Spinner />

  if (notFound || !team) return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
      <p className="text-slate-500 text-sm mb-4">Team not found.</p>
      <Link to="/" className="text-emerald-600 text-sm hover:underline">← Back home</Link>
    </div>
  )

  const color     = team.primaryColor   || org?.primaryColor   || '#334155'
  const secondary = team.secondaryColor || org?.secondaryColor || color
  const teamImage = identity.image

  const upcoming = matches
    .filter(m => isScheduled(m) || isLive(m))
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
    .slice(0, 5)

  const results = matches
    .filter(m => m.status === 'final')
    .sort((a, b) => toDate(b.scheduledAt) - toDate(a.scheduledAt))
    .slice(0, 5)

  const seasons = [...new Set(
    matches.filter(m => m.status === 'final' && m.season != null).map(m => String(m.season))
  )].sort().reverse()
  const currentSeason = seasons[0] ?? null
  const allTimeStats  = computeTeamStats(matches, team.id, null)
  const seasonStats   = currentSeason ? computeTeamStats(matches, team.id, currentSeason) : null

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">

      {/* Hero — mirrors OrgDetail */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${color}, ${secondary})` }} />
        <div className="p-5 flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
            style={{ backgroundColor: color + '20', border: `2px solid ${color}` }}>
            {teamImage
              ? <img src={teamImage} alt={fullName} className="w-full h-full object-contain" />
              : <span className="text-sm font-bold font-mono" style={{ color }}>{monogram(org ? org.name : team.displayName)}</span>}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <span className="inline-flex font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 mb-2">
              Team
            </span>
            <h1 className="font-display font-bold text-slate-900 text-2xl leading-tight">{fullName}</h1>
            {org && (
              <Link to={orgUrl(org)}
                className="inline-block text-emerald-600 text-xs mt-1 hover:underline">
                {org.name} →
              </Link>
            )}
            {(team.competitionSeason || team.competitionName) && (
              <div className="text-slate-500 text-sm mt-1 flex items-center gap-1.5 flex-wrap">
                {team.competitionSeason && <span>{team.competitionSeason}</span>}
                {team.competitionSeason && team.competitionName && <span className="text-slate-300">·</span>}
                {team.competitionName && <span>{team.competitionName}</span>}
              </div>
            )}
            {identity.bio && (
              <p className="text-slate-600 text-sm mt-2 leading-relaxed">{identity.bio}</p>
            )}
          </div>
        </div>
      </div>

      {/* Season Record */}
      <section>
        <SectionHeader title="Season Record" />
        <div className="space-y-3">
          {seasonStats && (
            <div>
              <div className="micro-label text-slate-500 mb-2">This season{currentSeason ? ` · ${currentSeason}` : ''}</div>
              <StatGrid stats={seasonStats} />
            </div>
          )}
          <div>
            <div className="micro-label text-slate-500 mb-2">All-time</div>
            <StatGrid stats={allTimeStats} />
          </div>
        </div>
      </section>

      {/* Upcoming Fixtures */}
      <section>
        <SectionHeader title="Upcoming Fixtures" />
        {upcoming.length === 0 ? (
          <EmptyCard message="No upcoming fixtures." sub="Fixtures will appear here once they are scheduled." />
        ) : (
          <div className="space-y-2">
            {upcoming.map(m => <UpcomingCard key={m.id} match={m} />)}
          </div>
        )}
      </section>

      {/* Recent Results */}
      <section>
        <SectionHeader title="Recent Results" />
        {results.length === 0 ? (
          <EmptyCard message="No results yet." sub="Completed matches will appear here." />
        ) : (
          <div className="space-y-2">
            {results.map(m => <ResultCard key={m.id} match={m} />)}
          </div>
        )}
      </section>

      {/* Squad — season-scoped roster, display only. Management lives in the org
          management portal (OrgManage), not on the public team profile. */}
      <SquadManager team={team} readOnly />

    </div>
  )
}
