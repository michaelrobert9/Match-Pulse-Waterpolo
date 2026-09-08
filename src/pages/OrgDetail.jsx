import { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchOrganizationBySlug, fetchTeamsForOrganization,
  fetchMatchesForOrg, toDate,
} from '../lib/queries'
import { teamUrl, matchUrl } from '../lib/slugify'
import { SPORT_KEY } from '../firebase'
import { prefetchMatchTeams, resolveTeamProfileIdentity } from '../lib/teamIdentity'
import { MatchTeamIdentity } from '../components/TeamIdentity'
import MatchDayRow from '../components/MatchDayRow'
import { collapseMatchDays } from '../lib/matchGroups'
import { computeTeamStats, latestSeason } from '../lib/teamStats'
import { seniorityDescriptor, composeTeamDisplay } from '../lib/teamNaming'
import { sortBySeniority } from '../lib/seniority'
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

// Rugby records points (PF/PA); the goal sports record goals (GF/GA). The score
// total itself is sport-neutral (scoreFor/scoreAgainst) — only the label differs.
const [SCORE_FOR_LABEL, SCORE_AGAINST_LABEL] = SPORT_KEY === 'rugby' ? ['PF', 'PA'] : ['GF', 'GA']

// Six-cell P/W/D/L + score-for/against grid — same visual language as the team page.
function StatGrid({ stats }) {
  const cells = [
    { value: stats.played,       label: 'P' },
    { value: stats.won,          label: 'W' },
    { value: stats.drawn,        label: 'D' },
    { value: stats.lost,         label: 'L' },
    { value: stats.scoreFor,     label: SCORE_FOR_LABEL },
    { value: stats.scoreAgainst, label: SCORE_AGAINST_LABEL },
  ]
  return (
    <div className="grid grid-cols-6 gap-2">
      {cells.map(({ value, label }) => (
        <div key={label} className="bg-slate-50 rounded-xl border border-slate-200 p-2.5 text-center">
          <div className="font-mono font-black text-lg text-slate-900 tabular-nums">{value}</div>
          <div className="micro-label mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  )
}

// One team's season record on the school overview: crest + name + a View more
// link through to the full team page (all-time + season record + fixtures +
// squad), with the season's P/W/D/L/PF/PA beneath.
function SeasonRecordCard({ team, org, stats }) {
  const identity = resolveTeamProfileIdentity(team, org)
  const color    = team.primaryColor || org?.primaryColor || '#555'
  const url      = teamUrl(team, org)
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
          style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
          {identity.image
            ? <img src={identity.image} alt="" className="w-full h-full object-cover" />
            : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(team.displayName)}</span>}
        </div>
        <div className="flex-1 min-w-0">
          {url
            ? <Link to={url} className="text-slate-900 text-sm font-bold truncate block hover:text-emerald-600 transition-colors">{composeTeamDisplay(org?.matchName || org?.name, team.displayName)}</Link>
            : <div className="text-slate-900 text-sm font-bold truncate">{composeTeamDisplay(org?.matchName || org?.name, team.displayName)}</div>}
        </div>
        {url && (
          <Link to={url}
            className="shrink-0 flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
            View more <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <StatGrid stats={stats} />
    </div>
  )
}

export default function OrgDetail({ type }) {
  const { slug } = useParams()
  const [org,      setOrg]      = useState(null)
  useSeoMeta({ type: 'org', entity: org })
  const [teams,    setTeams]    = useState([])
  const [matches,  setMatches]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [upcomingExpanded, setUpcomingExpanded] = useState(false)

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

  // Collapse match days FIRST, then keep only the ones still to come. A collapsed
  // group is "upcoming" until any child is played or live; a standalone match is
  // upcoming until it's final. sortAt is the item's ms timestamp (a group's
  // earliest child), so sorting by it preserves standalone scheduledAt order.
  const items = collapseMatchDays(matches)
  const upcomingItems = items.filter(it => it.kind === 'group'
    ? !(it.tally.played > 0 || it.tally.status === 'live')
    : it.match?.status !== 'final')
  const upcomingSorted = upcomingItems.sort((a, b) => (a.sortAt ?? Infinity) - (b.sortAt ?? Infinity))
  const upcoming = upcomingExpanded ? upcomingSorted : upcomingSorted.slice(0, 5)

  // Season record per team — the overview of how the school is performing this
  // season. Every registered team is listed (seniority order: 1st, 2nd … U16A,
  // U16B …), each with its P/W/D/L/PF/PA for the current season and a link to the
  // full team page. The season is the latest one across the org's matches.
  const currentSeason = latestSeason(matches) ?? String(new Date().getFullYear())
  const sortedTeams = sortBySeniority(teams, t => seniorityDescriptor(t))
  const seasonRecords = sortedTeams.map(team => ({
    team,
    stats: computeTeamStats(
      matches.filter(m => m.homeTeamId === team.id || m.awayTeamId === team.id),
      team.id,
      currentSeason,
    ),
  }))

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">

      {/* Hero */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {org.bannerUrl && (
          <img src={org.bannerUrl} alt="" className="w-full h-40 sm:h-56 object-cover" />
        )}
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${color}, ${secondary})` }} />
        <div className="p-5 flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
            style={{ backgroundColor: color + '20', border: `2px solid ${color}` }}>
            {org.logoUrl
              ? <img src={org.logoUrl} alt={org.name} className="w-full h-full object-cover" />
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

      {/* Upcoming Fixtures — standalone matches and match-day rows together */}
      <section>
        <SectionHeader title="Upcoming Matches" />
        {upcomingSorted.length === 0 ? (
          <EmptyCard
            message={`No upcoming matches for ${org.name}.`}
            sub="Matches will appear here once they are scheduled."
          />
        ) : (
          <>
            <div className="space-y-2">
              {upcoming.map(it => it.kind === 'group'
                ? <MatchDayRow key={it.matchGroupId} item={it} viewerOrgId={org.id} />
                : <UpcomingCard key={it.match.id} match={it.match} />)}
            </div>
            {upcomingSorted.length > 5 && (
              <button type="button" onClick={() => setUpcomingExpanded(v => !v)}
                className="mt-2 w-full text-center text-[11px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 py-2 rounded-lg border border-slate-200 hover:border-emerald-300 bg-white transition-colors">
                {upcomingExpanded ? 'Show fewer' : `Show ${upcomingSorted.length - 5} more`}
              </button>
            )}
          </>
        )}
      </section>

      {/* Season Record — one card per team, seniority order, View more → team page */}
      <section>
        <SectionHeader title={`Season Record${currentSeason ? ` · ${currentSeason}` : ''}`} />
        {seasonRecords.length === 0 ? (
          <EmptyCard
            message="No teams yet."
            sub="Create a team to start adding matches."
          />
        ) : (
          <div className="space-y-3">
            {seasonRecords.map(({ team, stats }) => (
              <SeasonRecordCard key={team.id} team={team} org={org} stats={stats} />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
