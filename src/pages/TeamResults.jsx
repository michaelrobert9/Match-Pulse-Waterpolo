import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import {
  fetchTeamBySlug, fetchTeamByOrgPath,
  fetchOrganization, fetchMatchesForTeam, toDate,
} from '../lib/queries'
import { teamUrl, matchUrl } from '../lib/slugify'
import { composeTeamDisplay } from '../lib/teamNaming'
import { prefetchMatchTeams, resolveTeamProfileIdentity } from '../lib/teamIdentity'
import { matchSeason } from '../lib/teamStats'
import { MatchTeamIdentity } from '../components/TeamIdentity'
import StatusBadge from '../components/StatusBadge'

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function fmtDateShort(val) {
  const d = toDate(val)
  if (!d) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Result card — mirrors the "Recent Results" card on the team profile so the
// full-history page reads identically to the summary it expands.
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

// Full match history for a team — every completed result, newest first, broken
// into season groups. Reached from the "View all results" link on TeamDetail and
// works under both the nested (/{org}/{team}/results) and legacy
// (/team/{slug}/results) URL shapes.
export default function TeamResults() {
  const { orgSlug, teamSlug, slug } = useParams()
  const [team,    setTeam]    = useState(null)
  const [org,     setOrg]     = useState(null)
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

      const allMatches = await fetchMatchesForTeam(t.id)
      if (!o && t.organizationId) o = await fetchOrganization(t.organizationId)
      await prefetchMatchTeams(allMatches ?? [])
      if (!alive) return

      setTeam(t)
      setOrg(o)
      setMatches(allMatches ?? [])
      setLoading(false)
    }

    run().catch(() => { if (alive) { setNotFound(true); setLoading(false) } })
    return () => { alive = false }
  }, [orgSlug, teamSlug, slug])

  const identity = team ? resolveTeamProfileIdentity(team, org) : null
  const name     = identity ? (identity.name || team.displayName || team.name) : ''
  const fullName = composeTeamDisplay(team?.teamName || org?.name, name)

  useEffect(() => {
    if (fullName) document.title = `${fullName} · Results · MatchPulse`
  }, [fullName])

  if (loading) return <Spinner />

  if (notFound || !team) return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
      <p className="text-slate-500 text-sm mb-4">Team not found.</p>
      <Link to="/" className="text-emerald-600 text-sm hover:underline">← Back home</Link>
    </div>
  )

  const results = matches
    .filter(m => m.status === 'final')
    .sort((a, b) => toDate(b.scheduledAt) - toDate(a.scheduledAt))

  // Group into seasons. Results are already newest-first, so the order seasons
  // are first seen is itself reverse-chronological — no separate season sort.
  const seasonOrder = []
  const bySeason = new Map()
  for (const m of results) {
    const s = matchSeason(m) || 'Earlier'
    if (!bySeason.has(s)) { bySeason.set(s, []); seasonOrder.push(s) }
    bySeason.get(s).push(m)
  }

  const backTo = teamUrl(team, org) || '/'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">
      <div>
        <Link to={backTo} className="inline-flex items-center gap-1 text-emerald-600 text-sm hover:underline mb-3">
          <ChevronLeft className="w-4 h-4" /> Back to {fullName}
        </Link>
        <h1 className="font-display font-bold text-slate-900 text-2xl leading-tight">All Results</h1>
        <p className="text-slate-500 text-sm mt-1">
          {results.length} completed {results.length === 1 ? 'match' : 'matches'}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center shadow-sm">
          <p className="text-slate-500 text-sm">No results yet.</p>
          <p className="text-slate-400 text-xs mt-1">Completed matches will appear here.</p>
        </div>
      ) : (
        seasonOrder.map(season => (
          <section key={season}>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">{season}</h2>
            <div className="space-y-2">
              {bySeason.get(season).map(m => <ResultCard key={m.id} match={m} />)}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
