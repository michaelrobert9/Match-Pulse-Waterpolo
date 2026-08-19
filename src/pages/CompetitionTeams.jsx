import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Plus, X, Search } from 'lucide-react'
import {
  fetchCompetition, fetchCompetitionByPath, fetchCompetitionBySlugSeason,
  fetchCompetitionMembers, fetchCompetitionFixtures, fetchAllPeople, toDate,
} from '../lib/queries'
import {
  fetchCompetitionSquad, addToCompetitionSquad, removeFromCompetitionSquad,
} from '../lib/adminQueries'
import { competitionTeamLabel } from '../lib/teamNaming'
import { competitionUrl, matchUrl, playerUrl } from '../lib/slugify'
import { competitionViewableBy } from '../lib/competitionRules'
import CompetitionNav from '../components/CompetitionNav'
import { useAuth } from '../contexts/AuthContext'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

function monogram(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

// Order a squad by shirt number, then name.
function sortSquad(list) {
  return [...list].sort((a, b) => {
    const sa = Number(a.shirtNumber), sb = Number(b.shirtNumber)
    if (Number.isFinite(sa) && Number.isFinite(sb)) return sa - sb
    if (Number.isFinite(sa)) return -1
    if (Number.isFinite(sb)) return 1
    return (a.personName || '').localeCompare(b.personName || '')
  })
}

// A team's squad in THIS competition derived from the players named in the
// team's competition match line-ups. Used as a display fallback when no squad
// has been registered yet (the registered squad, once set, is auto-assigned to
// every match and so reproduces this view).
function deriveSquad(teamId, matches) {
  const byPerson = new Map()
  for (const m of matches) {
    const side = m.homeTeamId === teamId ? 'home' : m.awayTeamId === teamId ? 'away' : null
    if (!side) continue
    for (const e of (side === 'home' ? m.homeLineup : m.awayLineup) ?? []) {
      if (!e.personId || byPerson.has(e.personId)) continue
      byPerson.set(e.personId, { personId: e.personId, personName: e.personName, personSlug: e.personSlug ?? null, shirtNumber: e.shirtNumber ?? null })
    }
  }
  return sortSquad([...byPerson.values()])
}

function fmtDate(val) {
  const d = toDate(val)
  return d ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBD'
}

function MatchRow({ match, teamId }) {
  const isFinal = match.status === 'final'
  const isLive  = match.status === 'live'
  const homeIsTeam = match.homeTeamId === teamId
  return (
    <Link to={matchUrl(match)} className="block bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`text-sm truncate flex-1 ${homeIsTeam ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{match.homeTeamName}</span>
        <span className="mx-2 text-center shrink-0 min-w-[48px]">
          {isFinal || isLive
            ? <span className={`font-mono font-black tabular-nums ${isLive ? 'text-red-600' : 'text-slate-900'}`}>{match.homeScore}–{match.awayScore}</span>
            : <span className="font-mono text-slate-500 text-xs">{fmtDate(match.scheduledAt)}</span>}
        </span>
        <span className={`text-sm truncate flex-1 text-right ${!homeIsTeam ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{match.awayTeamName}</span>
      </div>
    </Link>
  )
}

// Add-player picker: searches all people, adds one to the squad.
function AddPlayer({ onAdd, existingIds, busy }) {
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState(null)
  const [q, setQ] = useState('')
  const [shirt, setShirt] = useState('')
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    if (open && people === null) fetchAllPeople().then(setPeople).catch(() => setPeople([]))
  }, [open, people])

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-500 text-[11px] font-bold uppercase tracking-widest">
        <Plus className="w-3.5 h-3.5" /> Add player
      </button>
    )
  }

  const matches = (people ?? [])
    .filter(p => !existingIds.has(p.id))
    .filter(p => q.trim() ? (p.fullName || '').toLowerCase().includes(q.trim().toLowerCase()) : true)
    .slice(0, 8)

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {picked ? (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{picked.fullName}</span>
          <input value={shirt} onChange={e => setShirt(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="#" inputMode="numeric"
            className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center" />
          <button disabled={busy} onClick={async () => { await onAdd(picked, shirt); setPicked(null); setShirt(''); setQ(''); setOpen(false) }}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-2">
            {busy ? '…' : 'Add'}
          </button>
          <button onClick={() => setPicked(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search players…"
              className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
          </div>
          {people === null ? <p className="text-slate-400 text-xs py-2">Loading…</p> : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {matches.length === 0
                ? <p className="text-slate-400 text-xs py-2">No matching players.</p>
                : matches.map(p => (
                  <button key={p.id} onClick={() => setPicked(p)}
                    className="w-full text-left text-sm text-slate-700 hover:bg-white rounded-lg px-2 py-1.5 transition-colors">
                    {p.fullName}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CompetitionTeams() {
  const { id, series, ageGroup, season, competitionSlug, teamId } = useParams()
  const auth = useAuth()
  const [competition, setCompetition] = useState(null)
  const [members, setMembers] = useState([])
  const [fixtures, setFixtures] = useState([])
  const [squad, setSquad] = useState([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const compPromise = competitionSlug
      ? fetchCompetitionBySlugSeason(competitionSlug, season)
      : series ? fetchCompetitionByPath(`${series}/${ageGroup}/${season}`)
      : fetchCompetition(id)
    compPromise.then(async comp => {
      if (!comp) return
      setCompetition(comp)
      document.title = `${comp.name} · Teams · MatchPulse`
      const [ms, fx, sq] = await Promise.all([
        fetchCompetitionMembers(comp.id),
        fetchCompetitionFixtures(comp.id),
        teamId ? fetchCompetitionSquad(comp.id, teamId).catch(() => []) : Promise.resolve([]),
      ])
      setMembers(ms); setFixtures(fx); setSquad(sq)
    }).finally(() => setLoading(false))
  }, [id, series, ageGroup, season, competitionSlug, teamId])

  if (loading) return <Spinner />
  if (!competition || !competitionViewableBy(competition, auth))
    return <div className="px-4 py-12 text-center text-slate-500 text-sm">Competition not found.</div>

  const base = competitionUrl(competition)

  // ── Team detail (Fixtures / Results / Squad) ──────────────────────────────
  if (teamId) {
    const member = members.find(m => m.id === teamId || m.teamId === teamId)
    const name = member ? competitionTeamLabel(member.displaySnapshot) : 'Team'
    const orgId = member?.organizationId ?? null
    const canManage = !!(auth.canAdministerCompetition?.(competition) || (orgId && auth.isOrgMember?.(orgId)))

    const teamMatches = fixtures.filter(m => m.homeTeamId === teamId || m.awayTeamId === teamId)
    const results  = teamMatches.filter(m => m.status === 'final')
      .sort((a, b) => (toDate(b.scheduledAt)?.getTime() ?? 0) - (toDate(a.scheduledAt)?.getTime() ?? 0))
    const upcoming = teamMatches.filter(m => m.status !== 'final')
      .sort((a, b) => (toDate(a.scheduledAt)?.getTime() ?? 0) - (toDate(b.scheduledAt)?.getTime() ?? 0))
    const displaySquad = squad.length ? sortSquad(squad) : deriveSquad(teamId, teamMatches)
    const existingIds = new Set(displaySquad.map(p => p.personId))

    async function reloadSquad() {
      setSquad(await fetchCompetitionSquad(competition.id, teamId).catch(() => squad))
    }
    async function handleAdd(person, shirt) {
      setBusy(true)
      try {
        await addToCompetitionSquad(competition.id, teamId, {
          personId: person.id, personName: person.fullName, personSlug: person.slug ?? null,
          shirtNumber: shirt || null,
        })
        await reloadSquad()
      } catch (e) { alert(e.message || 'Could not add player.') } finally { setBusy(false) }
    }
    async function handleRemove(personId) {
      if (!confirm('Remove this player from the squad? They will be taken out of the team’s matches in this competition.')) return
      setBusy(true)
      try { await removeFromCompetitionSquad(competition.id, teamId, personId); await reloadSquad() }
      catch (e) { alert(e.message || 'Could not remove player.') } finally { setBusy(false) }
    }

    return (
      <div className="max-w-4xl mx-auto pb-8">
        <CompetitionNav competition={competition} />
        <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-6">
          <Link to={`${base}/teams`} className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm">
            <ChevronLeft className="w-4 h-4" /> All teams
          </Link>
          <h1 className="font-display font-black text-slate-900 text-xl leading-tight">{name}</h1>

          <section>
            <div className="micro-label text-slate-500 mb-2">Fixtures</div>
            {upcoming.length === 0
              ? <p className="text-slate-400 text-sm py-2">No upcoming matches.</p>
              : <div className="space-y-2">{upcoming.map(m => <MatchRow key={m.id} match={m} teamId={teamId} />)}</div>}
          </section>

          <section>
            <div className="micro-label text-slate-500 mb-2">Results</div>
            {results.length === 0
              ? <p className="text-slate-400 text-sm py-2">No results yet.</p>
              : <div className="space-y-2">{results.map(m => <MatchRow key={m.id} match={m} teamId={teamId} />)}</div>}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="micro-label text-slate-500">Squad</div>
              {canManage && squad.length > 0 && (
                <span className="text-[10px] text-slate-400">Squad players are added to every match in this competition.</span>
              )}
            </div>
            {displaySquad.length === 0 ? (
              <p className="text-slate-400 text-sm py-2">No squad listed yet.</p>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                {displaySquad.map(p => (
                  <div key={p.personId} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-7 text-center font-mono font-bold text-slate-400 text-sm shrink-0">{p.shirtNumber ?? '–'}</span>
                    <Link to={playerUrl({ id: p.personId, slug: p.personSlug })} className="text-sm font-semibold text-slate-800 truncate hover:text-emerald-600 transition-colors">
                      {p.personName || 'Player'}
                    </Link>
                    <Link to={playerUrl({ id: p.personId, slug: p.personSlug })} className="ml-auto text-[10px] font-bold uppercase tracking-widest text-emerald-600 shrink-0">Profile →</Link>
                    {canManage && (
                      <button disabled={busy} onClick={() => handleRemove(p.personId)}
                        className="text-slate-300 hover:text-red-500 disabled:opacity-40 shrink-0" title="Remove from squad">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canManage && <AddPlayer onAdd={handleAdd} existingIds={existingIds} busy={busy} />}
          </section>
        </div>
      </div>
    )
  }

  // ── Team list ─────────────────────────────────────────────────────────────
  const teams = [...members].sort((a, b) =>
    (competitionTeamLabel(a.displaySnapshot) || '').localeCompare(competitionTeamLabel(b.displaySnapshot) || ''))

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <CompetitionNav competition={competition} />
      <div className="px-4 sm:px-6 lg:px-8 py-5">
        {teams.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-8">No teams have entered yet.</p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {teams.map(m => {
              const tid = m.id ?? m.teamId
              const label = competitionTeamLabel(m.displaySnapshot)
              const color = m.displaySnapshot?.primaryColor || '#64748b'
              return (
                <Link key={tid} to={`${base}/teams/${tid}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0" style={{ backgroundColor: color }}>{monogram(label)}</span>
                  <span className="text-sm font-semibold text-slate-900 truncate">{label}</span>
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">View →</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
