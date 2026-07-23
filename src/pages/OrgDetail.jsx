import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchOrganizationBySlug, fetchTeamsForOrganization,
  fetchMatchesForOrg, toDate,
} from '../lib/queries'
import { teamUrl, matchUrl } from '../lib/slugify'
import { prefetchMatchTeams, resolveTeamProfileIdentity } from '../lib/teamIdentity'
import { MatchTeamIdentity } from '../components/TeamIdentity'
import StatusBadge from '../components/StatusBadge'
import { monogram } from '../lib/names'
import { useSeoMeta } from '../lib/useSeoMeta'

const TYPE_LABEL = { school: 'School', club: 'Club', association: 'Association' }

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

// Upcoming fixture card
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

// Result card
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

function TeamCard({ team, org }) {
  const identity = resolveTeamProfileIdentity(team, org)
  const color    = team.primaryColor || org?.primaryColor || '#555'
  const url      = teamUrl(team, org)
  const inner = (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
        style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
        {identity.image
          ? <img src={identity.image} alt="" className="w-full h-full object-contain" />
          : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(team.displayName)}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 text-sm font-semibold truncate">{team.displayName}</div>
        {team.season && <div className="micro-label">{team.season}</div>}
      </div>
      {url && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
    </div>
  )
  return url ? <Link to={url}>{inner}</Link> : <div>{inner}</div>
}

export default function OrgDetail({ type }) {
  const { slug } = useParams()
  const [org,      setOrg]      = useState(null)
  useSeoMeta({ type: 'org', entity: org })
  const [teams,    setTeams]    = useState([])
  const [matches,  setMatches]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setNotFound(false)
    fetchOrganizationBySlug(slug, type)
      .then(async found => {
        if (!alive) return
        if (!found) { setNotFound(true); return }
        setOrg(found)
        const [t, m] = await Promise.all([
          fetchTeamsForOrganization(found.id),
          fetchMatchesForOrg(found.id),
        ])
        prefetchMatchTeams(m)
        if (alive) { setTeams(t); setMatches(m) }
      })
      .catch(() => { if (alive) setNotFound(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug, type])

  if (loading) return <Spinner />

  if (notFound || !org) {
    const backTo = type === 'club' ? '/clubs' : type === 'association' ? '/associations' : '/schools'
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <p className="text-slate-500 text-sm mb-4">{TYPE_LABEL[type] ?? 'Organisation'} not found.</p>
        <Link to={backTo} className="text-emerald-600 text-sm hover:underline">
          ← Back to {type === 'club' ? 'clubs' : type === 'association' ? 'associations' : 'schools'}
        </Link>
      </div>
    )
  }

  const color     = org.primaryColor   || '#334155'
  const secondary = org.secondaryColor || color

  const upcoming = matches
    .filter(m => m.status !== 'final')
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))
    .slice(0, 5)

  const results = matches
    .filter(m => m.status === 'final')
    .sort((a, b) => toDate(b.scheduledAt) - toDate(a.scheduledAt))
    .slice(0, 5)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">

      {/* Hero */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${color}, ${secondary})` }} />
        <div className="p-5 flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
            style={{ backgroundColor: color + '20', border: `2px solid ${color}` }}>
            {org.logoUrl
              ? <img src={org.logoUrl} alt={org.name} className="w-full h-full object-contain" />
              : <span className="text-sm font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <span className="inline-flex font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 mb-2">
              {TYPE_LABEL[org.type] ?? org.type}
            </span>
            <h1 className="font-display font-bold text-slate-900 text-2xl leading-tight">{org.name}</h1>
            {org.region && (
              <div className="text-slate-500 text-sm mt-0.5">{org.region}</div>
            )}
            {org.bio && (
              <p className="text-slate-600 text-sm mt-2 leading-relaxed">{org.bio}</p>
            )}
            {org.website && (
              <a href={org.website} target="_blank" rel="noopener noreferrer"
                className="inline-block text-emerald-600 text-xs mt-2 hover:underline">
                {org.website.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming Fixtures */}
      <section>
        <SectionHeader title="Upcoming Fixtures" />
        {upcoming.length === 0 ? (
          <EmptyCard
            message={`No upcoming fixtures for ${org.name}.`}
            sub="Fixtures will appear here once they are scheduled."
          />
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
          <EmptyCard
            message="No results yet."
            sub="Completed matches will appear here."
          />
        ) : (
          <div className="space-y-2">
            {results.map(m => <ResultCard key={m.id} match={m} />)}
          </div>
        )}
      </section>

      {/* Teams */}
      <section>
        <SectionHeader title="Teams" />
        {teams.length === 0 ? (
          <EmptyCard
            message="No teams yet."
            sub="Create a team to start adding fixtures."
          />
        ) : (
          <div className="space-y-2">
            {teams.map(t => <TeamCard key={t.id} team={t} org={org} />)}
          </div>
        )}
      </section>

    </div>
  )
}
