import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { isScheduled } from '../lib/fixtureStatus'
import {
  fetchPerson, fetchCareerForPerson, fetchPersonBySlug,
  fetchMatchesForPlayer, fetchOrganization, toDate,
} from '../lib/queries'
import { matchUrl } from '../lib/slugify'
import { monogram } from '../lib/names'
import { useAuth } from '../contexts/AuthContext'
import { managesPlayerProfile } from '../lib/capabilities'
import { removeSelfFromFixture } from '../lib/adminQueries'

// ── Helpers ────────────────────────────────────────────────────────────────

const ROLE_LABELS = {
  player:               'Player',
  umpire:               'Umpire',
  tournament_director:  'Tournament Director',
  team_manager:         'Team Manager',
  technical_director:   'Technical Director',
}

function formatDate(d) {
  if (!d) return null
  const date = d?.toDate ? d.toDate() : new Date(d)
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

function age(dob) {
  if (!dob) return null
  const d = dob?.toDate ? dob.toDate() : new Date(dob)
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

// Group career records by organisationId, then by teamId within each org.
// Returns an array of org-groups, each with a `teams` array.
// Each team has aggregate stats across all competitions + its individual records.
function groupCareer(career, orgMap) {
  const orgOrder = []
  const byOrg = {}

  for (const r of career) {
    const orgKey = r.organizationId || '__none__'
    if (!byOrg[orgKey]) {
      orgOrder.push(orgKey)
      byOrg[orgKey] = { orgId: r.organizationId || null, org: orgMap[r.organizationId] || null, byTeam: {}, teamOrder: [] }
    }
    const teamKey = r.teamId || r.teamDisplayName || '__team__'
    if (!byOrg[orgKey].byTeam[teamKey]) {
      byOrg[orgKey].teamOrder.push(teamKey)
      byOrg[orgKey].byTeam[teamKey] = []
    }
    byOrg[orgKey].byTeam[teamKey].push(r)
  }

  return orgOrder.map(orgKey => {
    const group = byOrg[orgKey]
    const teams = group.teamOrder.map(teamKey => {
      const records = [...group.byTeam[teamKey]].sort(
        (a, b) => String(b.competitionSeason).localeCompare(String(a.competitionSeason))
      )
      const caps  = records.reduce((s, r) => s + (r.caps  ?? 0), 0)
      const goals = records.reduce((s, r) => s + (r.goals ?? 0), 0)
      const cards = records.reduce((acc, r) => ({
        green:  acc.green  + (r.cards?.green  || 0),
        yellow: acc.yellow + (r.cards?.yellow || 0),
        red:    acc.red    + (r.cards?.red    || 0),
      }), { green: 0, yellow: 0, red: 0 })
      return {
        teamId:           records[0].teamId,
        teamDisplayName:  records[0].teamDisplayName,
        teamPrimaryColor: records[0].teamPrimaryColor,
        caps, goals, cards, records,
      }
    })
    return { orgId: group.orgId, org: group.org, teams }
  })
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PlayerPhoto({ person }) {
  const initials = person.fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return person.photoUrl ? (
    <img src={person.photoUrl} alt={person.fullName}
      className="w-24 h-24 rounded-xl object-cover object-top border-2 border-slate-200" />
  ) : (
    <div className="w-24 h-24 rounded-xl bg-slate-100 border-2 border-slate-200 flex items-center justify-center shrink-0">
      <span className="font-display font-bold text-2xl text-slate-500">{initials}</span>
    </div>
  )
}

function StatBlock({ value, label, color = 'text-emerald-600' }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`font-mono font-black text-3xl tabular-nums leading-none ${color}`}>{value ?? '—'}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 text-center leading-tight">{label}</span>
    </div>
  )
}

// One row of competition-level stats shown inside a team block.
function CompRecord({ record }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-600 truncate">{record.competitionName}</span>
        {record.competitionSeason && (
          <span className="text-[10px] text-slate-400 ml-1.5">{record.competitionSeason}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-slate-500">
        <span>{record.caps ?? 0} caps</span>
        <span className="text-slate-300">·</span>
        <span className="text-emerald-600">{record.goals ?? 0} gls</span>
      </div>
    </div>
  )
}

// A team within an org: aggregate stats + expandable competition records.
function TeamBlock({ team }) {
  const [expanded, setExpanded] = useState(false)
  const totalCards = (team.cards?.green ?? 0) + (team.cards?.yellow ?? 0) + (team.cards?.red ?? 0)

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="h-1" style={{ backgroundColor: team.teamPrimaryColor || '#94a3b8' }} />
      <div className="p-4">
        {/* Team name */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: team.teamPrimaryColor || '#94a3b8' }} />
          <span className="text-slate-900 font-semibold text-sm">{team.teamDisplayName}</span>
          {team.records.length > 1 && (
            <span className="text-[10px] text-slate-400 ml-auto">
              {team.records.length} competition{team.records.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Aggregate stats */}
        <div className="grid grid-cols-4 gap-0 border-t border-slate-200 pt-3">
          {[
            { val: team.caps,  label: 'Caps',     cls: 'text-slate-900' },
            { val: team.goals, label: 'Goals',    cls: 'text-emerald-600' },
            {
              val: team.caps > 0 && team.goals > 0
                ? (team.goals / team.caps).toFixed(2) : '—',
              label: 'Avg/Game', cls: 'text-slate-900',
            },
            { val: totalCards || '—', label: 'Cards', cls: 'text-slate-900' },
          ].map(({ val, label, cls }, i) => (
            <div key={label} className={`flex flex-col items-center${i > 0 ? ' border-l border-slate-200' : ''}`}>
              <span className={`font-mono font-black text-xl tabular-nums ${cls}`}>{val}</span>
              <span className="micro-label">{label}</span>
            </div>
          ))}
        </div>

        {/* Card breakdown */}
        {totalCards > 0 && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
            {team.cards?.green  > 0 && <span className="flex items-center gap-1 text-[9px] font-mono text-green-600"><span className="w-1.5 h-2.5 bg-green-500 rounded-sm inline-block" />{team.cards.green}×</span>}
            {team.cards?.yellow > 0 && <span className="flex items-center gap-1 text-[9px] font-mono text-yellow-600"><span className="w-1.5 h-2.5 bg-yellow-400 rounded-sm inline-block" />{team.cards.yellow}×</span>}
            {team.cards?.red    > 0 && <span className="flex items-center gap-1 text-[9px] font-mono text-red-600"><span className="w-1.5 h-2.5 bg-red-500 rounded-sm inline-block" />{team.cards.red}×</span>}
          </div>
        )}

        {/* Competition records */}
        {team.records.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-100 divide-y divide-slate-100">
            {(expanded ? team.records : team.records.slice(0, 3)).map(r => (
              <CompRecord key={r.id} record={r} />
            ))}
            {team.records.length > 3 && (
              <button onClick={() => setExpanded(e => !e)}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors pt-2">
                {expanded ? 'Show less' : `+${team.records.length - 3} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Org group: header with logo/name + list of TeamBlocks.
function OrgSection({ orgId, org, teams }) {
  const color   = org?.primaryColor || '#64748b'
  const orgName = org?.name || 'Other'
  return (
    <div className="space-y-2">
      {/* Org header */}
      <div className="flex items-center gap-2.5 px-1">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 overflow-hidden"
          style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
          {org?.logoUrl
            ? <img src={org.logoUrl} alt="" className="w-full h-full object-contain" />
            : <span className="text-[8px] font-bold font-mono" style={{ color }}>{monogram(orgName)}</span>}
        </div>
        <div>
          <div className="text-slate-900 font-bold text-sm leading-none">{orgName}</div>
          {org?.type && <div className="text-[10px] text-slate-400 capitalize mt-0.5">{org.type}</div>}
        </div>
      </div>
      {/* Teams */}
      <div className="space-y-2">
        {teams.map((team, i) => <TeamBlock key={team.teamId || i} team={team} />)}
      </div>
    </div>
  )
}

// A single fixture the player was listed in.
function FixtureCard({ match, personId, canSelfRemove, onRemoved }) {
  const [removing, setRemoving] = useState(false)
  const inHome    = (match.homeLineup ?? []).some(e => e.personId === personId)
  const entry     = [...(match.homeLineup ?? []), ...(match.awayLineup ?? [])].find(e => e.personId === personId)
  const teamColor = inHome ? match.homeTeamColor : match.awayTeamColor
  const isFinal   = match.status === 'final'
  const d         = toDate(match.scheduledAt)
  const dateStr   = d ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  async function handleSelfRemove(e) {
    e.preventDefault()
    if (!confirm('Remove this player from the fixture lineup?')) return
    setRemoving(true)
    try {
      await removeSelfFromFixture(match.id, personId)
      onRemoved(match.id)
    } catch (err) {
      alert(err.message ?? 'Removal failed.')
      setRemoving(false)
    }
  }

  return (
    <Link to={matchUrl(match)}
      className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:border-slate-300 transition-colors block">
      <div className="h-1" style={{ backgroundColor: teamColor || '#94a3b8' }} />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          {dateStr && <span className="font-mono text-[10px] text-slate-500">{dateStr}</span>}
          <div className="flex items-center gap-1.5 ml-auto">
            {entry?.isStarter && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Starter</span>
            )}
            {entry?.shirtNumber && (
              <span className="font-mono text-[10px] text-slate-400">#{entry.shirtNumber}</span>
            )}
            {canSelfRemove && !isFinal && (
              <button onClick={handleSelfRemove} disabled={removing}
                className="text-[9px] font-bold uppercase tracking-widest text-red-500 hover:text-red-400 disabled:opacity-50 border border-red-200 rounded px-1.5 py-0.5 transition-colors">
                {removing ? 'Removing…' : 'Remove me'}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className={`text-sm font-semibold truncate ${inHome ? 'text-slate-900' : 'text-slate-500'}`}>
              {match.homeOrgName ? `${match.homeOrgName} ${match.homeTeamName}` : (match.homeTeamName ?? '')}
            </div>
            <div className={`text-sm font-semibold truncate ${!inHome ? 'text-slate-900' : 'text-slate-500'}`}>
              {match.awayOrgName ? `${match.awayOrgName} ${match.awayTeamName}` : (match.awayTeamName ?? '')}
            </div>
          </div>
          {isFinal ? (
            <div className="text-right shrink-0 space-y-0.5">
              <div className={`font-mono font-black text-base tabular-nums leading-none ${inHome ? 'text-slate-900' : 'text-slate-400'}`}>{match.homeScore ?? 0}</div>
              <div className={`font-mono font-black text-base tabular-nums leading-none ${!inHome ? 'text-slate-900' : 'text-slate-400'}`}>{match.awayScore ?? 0}</div>
            </div>
          ) : (
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 shrink-0 ml-2">
              {match.status === 'live' ? 'Live' : isScheduled(match) ? 'Scheduled' : match.status}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PersonCareer() {
  const { id, slug }  = useParams()
  const { uid }       = useAuth()
  const [person,   setPerson]   = useState(null)
  const [career,   setCareer]   = useState([])
  const [orgMap,   setOrgMap]   = useState({})
  const [matches,  setMatches]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const personPromise = slug ? fetchPersonBySlug(slug) : fetchPerson(id)
    personPromise.then(async p => {
      if (!p) { setError('Person not found'); return }
      setPerson(p)
      document.title = `${p.fullName} · MatchPulse`

      const [c, m] = await Promise.all([
        fetchCareerForPerson(p.id),
        fetchMatchesForPlayer(p.id),
      ])
      setCareer(c)
      setMatches(m)

      // Fetch org documents for all orgs represented in career records.
      const orgIds = [...new Set(c.map(r => r.organizationId).filter(Boolean))]
      const orgDocs = await Promise.all(orgIds.map(i => fetchOrganization(i)))
      const map = {}
      orgDocs.filter(Boolean).forEach(o => { map[o.id] = o })
      setOrgMap(map)
    }).catch(() => setError('Failed to load data'))
    .finally(() => setLoading(false))
  }, [id, slug])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !person) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 px-6 text-center">
        <span className="text-slate-500 text-sm">{error || 'Person not found'}</span>
        <Link to="/" className="text-emerald-600 text-sm hover:underline">Back to home</Link>
      </div>
    )
  }

  const latestTeam  = career[0]
  const orgGroups   = groupCareer(career, orgMap)
  const canSelfRemove = managesPlayerProfile(person, uid)

  return (
    <div className="pb-12">

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200">
        {latestTeam && <div className="h-1" style={{ backgroundColor: latestTeam.teamPrimaryColor }} />}

        <div className="px-4 pt-5 pb-6">
          {/* Photo + name */}
          <div className="flex items-start gap-4 mb-5">
            <PlayerPhoto person={person} />
            <div className="flex-1 min-w-0 pt-1">
              <div className="font-display font-black text-3xl text-slate-900 leading-none uppercase tracking-tight break-words">
                {person.fullName}
              </div>
              {latestTeam && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: latestTeam.teamPrimaryColor }} />
                  <span className="text-sm text-slate-600 font-medium">{latestTeam.teamDisplayName}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {latestTeam?.position && <span className="micro-label">{latestTeam.position}</span>}
                {person.dateOfBirth && (
                  <>
                    <span className="micro-label text-slate-300">·</span>
                    <span className="micro-label">{formatDate(person.dateOfBirth)} · {age(person.dateOfBirth)} yrs</span>
                  </>
                )}
              </div>
              {person.roles?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {person.roles.map(role => (
                    <span key={role} className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500">
                      {ROLE_LABELS[role] ?? role}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Career total — compact summary bar */}
          <div className="grid grid-cols-5 gap-0 bg-slate-50 rounded-xl border border-slate-200 p-3">
            <StatBlock value={person.careerCaps}  label="Total Caps" />
            <div className="w-px bg-slate-200 mx-auto" />
            <StatBlock value={person.careerGoals} label="Total Goals" />
            <div className="w-px bg-slate-200 mx-auto" />
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-end gap-0.5">
                {(person.careerCards?.green  > 0) && <span className="font-mono font-black text-xl text-green-600 tabular-nums leading-none">{person.careerCards.green}</span>}
                {(person.careerCards?.yellow > 0) && <span className="font-mono font-black text-xl text-yellow-600 tabular-nums leading-none">{(person.careerCards?.green > 0) ? <span className="text-slate-300 text-base">/</span> : null}{person.careerCards.yellow}</span>}
                {(person.careerCards?.red    > 0) && <span className="font-mono font-black text-xl text-red-600 tabular-nums leading-none">{(person.careerCards?.green > 0 || person.careerCards?.yellow > 0) ? <span className="text-slate-300 text-base">/</span> : null}{person.careerCards.red}</span>}
                {(!person.careerCards?.green && !person.careerCards?.yellow && !person.careerCards?.red) && (
                  <span className="font-mono font-black text-xl text-slate-400 tabular-nums leading-none">0</span>
                )}
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 text-center leading-tight">Total Cards</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 px-1">
            <span className="micro-label text-slate-400">
              {orgGroups.length} organisation{orgGroups.length !== 1 ? 's' : ''} · {career.length} competition{career.length !== 1 ? 's' : ''}
            </span>
            {matches.length > 0 && (
              <span className="micro-label text-slate-400">{matches.length} fixture{matches.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── CAREER BY ORG & TEAM ──────────────────────────────────────── */}
      <div className="px-4 pt-5 space-y-6">
        {career.length === 0 ? (
          <div>
            <h2 className="micro-label text-slate-500 mb-3">Career History</h2>
            <p className="text-slate-500 text-sm">No competition records found.</p>
          </div>
        ) : (
          orgGroups.map((group, gi) => (
            <OrgSection key={group.orgId ?? gi} orgId={group.orgId} org={group.org} teams={group.teams} />
          ))
        )}

        {/* ── FIXTURES ──────────────────────────────────────────────── */}
        <div>
          <h2 className="micro-label text-slate-500 mb-3">
            Fixtures{matches.length > 0 ? ` (${matches.length})` : ''}
          </h2>
          {matches.length === 0 ? (
            <p className="text-slate-500 text-sm">No fixtures listed yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {matches.slice(0, 20).map(m => (
                  <FixtureCard key={m.id} match={m} personId={person.id}
                    canSelfRemove={canSelfRemove}
                    onRemoved={matchId => setMatches(prev => prev.filter(x => x.id !== matchId))}
                  />
                ))}
              </div>
              {matches.length > 20 && (
                <p className="text-center text-sm text-slate-400 pt-2">
                  Showing 20 of {matches.length} fixtures
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
