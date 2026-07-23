import { useEffect, useState } from 'react'
import { ChevronRight, Check, ChevronLeft, Users} from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { fetchOrganization } from '../../lib/queries'
import { fetchCompetitionsForOrg, createMatch, addFixtureToCompetition } from '../../lib/adminQueries'
import { DEFAULT_PERIODS, DEFAULT_PERIOD_MINUTES, DEFAULT_BREAK_MINUTES } from '../../lib/matchClock'
import OpponentSelector from '../../components/OpponentSelector'
import FormatSelector from '../../components/FormatSelector'
import { monogram } from '../../lib/names'

// ── Shared primitives ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function OrgHeader({ org, typeLabel, canChange, onChangeOrg }) {
  const color = org.primaryColor || '#555'
  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + '20', border: `2px solid ${color}` }}>
        {org.logoUrl
          ? <img src={org.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
          : <span className="text-[9px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>}
      </div>
      <div className="flex-1">
        <div className="text-slate-900 text-sm font-semibold">{org.name}</div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{typeLabel}</div>
      </div>
      {canChange && (
        <button type="button" onClick={onChangeOrg}
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors shrink-0 ml-2">
          Change
        </button>
      )}
    </div>
  )
}

function SuccessBanner({ matchId, matchName, onReset }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-emerald-700 text-sm font-semibold">Fixture created</span>
      </div>
      <div className="text-slate-600 text-xs mb-3 pl-6">{matchName}</div>
      <div className="flex gap-4 pl-6">
        <Link to={`/score/${matchId}`}
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
          Score now →
        </Link>
        <button type="button" onClick={onReset}
          className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors">
          Create another
        </button>
      </div>
    </div>
  )
}

// ── Entity selection card ─────────────────────────────────────────────────────

function EntityCard({ org, onClick }) {
  const color = org.primaryColor || '#555'
  return (
    <button type="button" onClick={() => onClick(org)}
      className="flex items-center gap-4 w-full bg-white rounded-xl border border-slate-200 px-4 py-4 hover:border-slate-400 transition-colors text-left shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + '20', border: `2px solid ${color}` }}>
        {org.logoUrl
          ? <img src={org.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
          : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 font-semibold text-sm truncate">{org.name}</div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">
          {org.type === 'school' ? 'School' : 'Club'}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </button>
  )
}

// ── Shared form fields ────────────────────────────────────────────────────────

function SideToggle({ value, onChange }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Playing at</p>
      <div className="flex gap-2">
        {[{ v: 'home', label: 'Home (we host)' }, { v: 'away', label: 'Away (we travel)' }].map(o => (
          <button type="button" key={o.v} onClick={() => onChange(o.v)}
            className={`flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors ${
              value === o.v ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function CompetitionField({ competitions, value, onChange }) {
  const [open, setOpen] = useState(false)
  if (competitions.length === 0) return null
  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors">
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        Competition (optional)
      </button>
      {open && (
        <select
          className="mt-2 w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          value={value}
          onChange={e => onChange(e.target.value)}>
          <option value="">No competition</option>
          {competitions.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.season ? ` (${c.season})` : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── School fixture form ───────────────────────────────────────────────────────

function SchoolFixtureForm({ org, canChange, onChangeOrg }) {
  const [teams,        setTeams]        = useState([])
  const [competitions, setCompetitions] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [done,         setDone]         = useState(null)
  const [error,        setError]        = useState('')

  const [form, setForm] = useState({
    yourTeamId:    '',
    side:          'home',
    opponent:      null,
    scheduledAt:   '',
    pitch:         '',
    periods:       DEFAULT_PERIODS,
    periodMinutes: DEFAULT_PERIOD_MINUTES,
    breakMinutes:  DEFAULT_BREAK_MINUTES,
    indoor:        false,
    competitionId: '',
  })

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'teams'), where('organizationId', '==', org.id)))
        .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      fetchCompetitionsForOrg(org.id).catch(() => []),
    ]).then(([teamList, comps]) => {
      setTeams(teamList)
      setCompetitions(comps)
    }).finally(() => setLoading(false))
  }, [org.id])

  const canSubmit = form.yourTeamId && form.opponent && form.scheduledAt
    && Number(form.periods) > 0 && Number(form.periodMinutes) > 0 && !saving

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const yourTeam = teams.find(t => t.id === form.yourTeamId)
      const homeTeam = form.side === 'home' ? yourTeam : form.opponent
      const awayTeam = form.side === 'home' ? form.opponent : yourTeam
      const comp     = competitions.find(c => c.id === form.competitionId)

      const ref = await createMatch(form.competitionId || null, homeTeam, awayTeam, {
        scheduledAt:   new Date(form.scheduledAt),
        pitch:         form.pitch.trim(),
        season:        comp?.season ?? null,
        periods:       Number(form.periods),
        periodMinutes: Number(form.periodMinutes),
        breakMinutes:  form.breakMinutes,
        indoor:        form.indoor,
      })
      // A competition fixture is ALWAYS a match + a membership join record —
      // never a bare match.competitionId. The dropdown only lists competitions
      // owned by this organisation, so the admin guard inside passes.
      if (form.competitionId) {
        await addFixtureToCompetition(form.competitionId, {
          id: ref.id, homeTeamId: homeTeam.id ?? null, awayTeamId: awayTeam.id ?? null,
        })
      }
      const homeLabel = homeTeam.orgName ? `${homeTeam.orgName} ${homeTeam.displayName}` : homeTeam.displayName
      const awayLabel = awayTeam.orgName ? `${awayTeam.orgName} ${awayTeam.displayName}` : awayTeam.displayName
      setDone({ matchId: ref.id, matchName: `${homeLabel} vs ${awayLabel}` })
      setForm(f => ({ ...f, yourTeamId: '', opponent: null, scheduledAt: '', pitch: '', side: 'home' }))
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally { setSaving(false) }
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <OrgHeader org={org} typeLabel="School Fixture" canChange={canChange} onChangeOrg={onChangeOrg} />

      {done && (
        <SuccessBanner
          matchId={done.matchId}
          matchName={done.matchName}
          onReset={() => setDone(null)}
        />
      )}

      {teams.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
            <Users className="w-6 h-6 text-emerald-600" />
          </div>
          <h3 className="text-slate-900 font-display font-bold text-base mb-1">No teams yet</h3>
          <p className="text-slate-500 text-sm mb-5 leading-relaxed max-w-xs mx-auto">
            School fixtures require teams. Add your first team to {org.name} to get started.
          </p>
          <Link to={`/manage/orgs/${org.id}`}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors">
            Add a team
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Your team */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Your team
            </label>
            <select
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              value={form.yourTeamId} required
              onChange={e => setForm(f => ({ ...f, yourTeamId: e.target.value, opponent: null }))}>
              <option value="">Select team…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}
            </select>
          </div>

          {/* Home / Away */}
          <SideToggle value={form.side} onChange={side => setForm(f => ({ ...f, side }))} />

          {/* Opponent */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Opponent team
            </label>
            <OpponentSelector
              orgTeams={teams}
              excludeTeamId={form.yourTeamId}
              orgId={org.id}
              excludeOrgId={org.id}
              value={form.opponent}
              onChange={opp => setForm(f => ({ ...f, opponent: opp }))}
            />
          </div>

          {/* Date & time */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Date &amp; time
            </label>
            <input type="datetime-local" required
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              value={form.scheduledAt}
              onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
          </div>

          {/* Venue */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Venue <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
            </label>
            <input type="text"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="e.g. Main astro, Field 1"
              value={form.pitch}
              onChange={e => setForm(f => ({ ...f, pitch: e.target.value }))} />
          </div>

          {/* Format */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Match format</p>
            <FormatSelector
              periods={form.periods}
              periodMinutes={form.periodMinutes}
              breakMinutes={form.breakMinutes}
              indoor={form.indoor}
              onChange={({ periods, periodMinutes, breakMinutes, indoor }) => setForm(f => ({ ...f, periods, periodMinutes, breakMinutes, indoor }))}
            />
          </div>

          {/* Competition — collapsed by default, secondary */}
          <CompetitionField
            competitions={competitions}
            value={form.competitionId}
            onChange={v => setForm(f => ({ ...f, competitionId: v }))}
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <button type="submit" disabled={!canSubmit}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors">
            {saving ? 'Creating…' : 'Create fixture'}
          </button>
        </form>
      )}
    </div>
  )
}

// ── Club fixture form ─────────────────────────────────────────────────────────

function ClubFixtureForm({ org, canChange, onChangeOrg }) {
  const [teams,        setTeams]        = useState([])
  const [competitions, setCompetitions] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [done,         setDone]         = useState(null)
  const [error,        setError]        = useState('')

  // yourSide: 'club' = play as club itself | <teamId> = specific team
  const [form, setForm] = useState({
    yourSide:      'club',
    side:          'home',
    opponent:      null,
    scheduledAt:   '',
    pitch:         '',
    periods:       DEFAULT_PERIODS,
    periodMinutes: DEFAULT_PERIOD_MINUTES,
    breakMinutes:  DEFAULT_BREAK_MINUTES,
    indoor:        false,
    competitionId: '',
  })

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'teams'), where('organizationId', '==', org.id)))
        .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      fetchCompetitionsForOrg(org.id).catch(() => []),
    ]).then(([teamList, comps]) => {
      setTeams(teamList)
      setCompetitions(comps)
    }).finally(() => setLoading(false))
  }, [org.id])

  // When playing as the club itself, synthesise a team-like object.
  // id=null → createMatch treats it as unregistered for team stats,
  // but organizationId is set so homeOrgId/awayOrgId are correct.
  const clubAsSide = {
    id:             null,
    displayName:    org.name,
    shortCode:      org.shortCode,
    primaryColor:   org.primaryColor || null,
    organizationId: org.id,
  }

  const yourTeamObj = form.yourSide === 'club'
    ? clubAsSide
    : (teams.find(t => t.id === form.yourSide) ?? null)

  const excludeTeamId = form.yourSide !== 'club' ? form.yourSide : null

  const canSubmit = yourTeamObj && form.opponent && form.scheduledAt
    && Number(form.periods) > 0 && Number(form.periodMinutes) > 0 && !saving

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const homeTeam = form.side === 'home' ? yourTeamObj : form.opponent
      const awayTeam = form.side === 'home' ? form.opponent : yourTeamObj
      const comp     = competitions.find(c => c.id === form.competitionId)

      const ref = await createMatch(form.competitionId || null, homeTeam, awayTeam, {
        scheduledAt:   new Date(form.scheduledAt),
        pitch:         form.pitch.trim(),
        season:        comp?.season ?? null,
        periods:       Number(form.periods),
        periodMinutes: Number(form.periodMinutes),
        breakMinutes:  form.breakMinutes,
        indoor:        form.indoor,
      })
      if (form.competitionId) {
        await addFixtureToCompetition(form.competitionId, {
          id: ref.id, homeTeamId: homeTeam.id ?? null, awayTeamId: awayTeam.id ?? null,
        })
      }
      const homeLabel = homeTeam.orgName ? `${homeTeam.orgName} ${homeTeam.displayName}` : homeTeam.displayName
      const awayLabel = awayTeam.orgName ? `${awayTeam.orgName} ${awayTeam.displayName}` : awayTeam.displayName
      setDone({ matchId: ref.id, matchName: `${homeLabel} vs ${awayLabel}` })
      setForm(f => ({ ...f, yourSide: 'club', opponent: null, scheduledAt: '', pitch: '', side: 'home' }))
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally { setSaving(false) }
  }

  const color = org.primaryColor || '#555'

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <OrgHeader org={org} typeLabel="Club Fixture" canChange={canChange} onChangeOrg={onChangeOrg} />

      {done && (
        <SuccessBanner
          matchId={done.matchId}
          matchName={done.matchName}
          onReset={() => setDone(null)}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Your side: club itself OR a specific team */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Your side</p>
          <div className="space-y-1.5">
            {/* Play as club */}
            <button type="button"
              onClick={() => setForm(f => ({ ...f, yourSide: 'club' }))}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left ${
                form.yourSide === 'club'
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-slate-200 hover:border-slate-400 bg-white'
              }`}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
                <span className="text-[8px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>
              </div>
              <div>
                <div className={`text-sm font-semibold ${form.yourSide === 'club' ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {org.name}
                </div>
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Club</div>
              </div>
            </button>

            {/* Play as a specific team */}
            {teams.length > 0 && (
              <>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-1 pt-1">or select a team</p>
                {teams.map(team => (
                  <button type="button" key={team.id}
                    onClick={() => setForm(f => ({ ...f, yourSide: team.id }))}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors text-left ${
                      form.yourSide === team.id
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 hover:border-slate-400 bg-white'
                    }`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.primaryColor || '#555' }} />
                    <span className={`text-sm font-semibold ${form.yourSide === team.id ? 'text-emerald-700' : 'text-slate-700'}`}>
                      {team.displayName}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Home / Away */}
        <SideToggle value={form.side} onChange={side => setForm(f => ({ ...f, side }))} />

        {/* Opponent */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
            Opponent
          </label>
          <OpponentSelector
            orgTeams={teams}
            excludeTeamId={excludeTeamId}
            orgId={org.id}
            excludeOrgId={org.id}
            value={form.opponent}
            onChange={opp => setForm(f => ({ ...f, opponent: opp }))}
          />
        </div>

        {/* Date & time */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
            Date &amp; time
          </label>
          <input type="datetime-local" required
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            value={form.scheduledAt}
            onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
        </div>

        {/* Venue */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
            Venue <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
          </label>
          <input type="text"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
            placeholder="e.g. Astro 1, Club ground"
            value={form.pitch}
            onChange={e => setForm(f => ({ ...f, pitch: e.target.value }))} />
        </div>

        {/* Format */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Match format</p>
          <FormatSelector
            periods={form.periods}
            periodMinutes={form.periodMinutes}
            breakMinutes={form.breakMinutes}
            indoor={form.indoor}
            onChange={({ periods, periodMinutes, breakMinutes, indoor }) => setForm(f => ({ ...f, periods, periodMinutes, breakMinutes, indoor }))}
          />
        </div>

        {/* Competition — secondary, collapsed */}
        <CompetitionField
          competitions={competitions}
          value={form.competitionId}
          onChange={v => setForm(f => ({ ...f, competitionId: v }))}
        />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <button type="submit" disabled={!canSubmit}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors">
          {saving ? 'Creating…' : 'Create fixture'}
        </button>
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewFixture() {
  const { orgRoles } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [orgs,    setOrgs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [selOrg,  setSelOrg]  = useState(null)

  const orgId   = searchParams.get('org')
  const orgIds  = Object.keys(orgRoles ?? {})
  const depKey  = orgIds.slice().sort().join(',')

  useEffect(() => {
    setLoading(true)
    if (orgIds.length === 0) { setLoading(false); return }
    Promise.all(orgIds.map(id => fetchOrganization(id)))
      .then(docs => setOrgs(docs.filter(Boolean)))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey])

  // Resolve org from URL param once orgs are loaded
  useEffect(() => {
    if (orgId && orgs.length > 0) {
      const found = orgs.find(o => o.id === orgId)
      if (found) setSelOrg(found)
    }
  }, [orgId, orgs])

  // Auto-select when only one org — skip the selection screen
  useEffect(() => {
    if (!loading && orgs.length === 1 && !orgId) {
      setSearchParams({ org: orgs[0].id }, { replace: true })
    }
  }, [loading, orgs, orgId, setSearchParams])

  function selectOrg(org) {
    setSelOrg(org)
    setSearchParams({ org: org.id })
  }

  function clearOrg() {
    setSelOrg(null)
    setSearchParams({})
  }

  const schools = orgs.filter(o => o.type === 'school')
  const clubs   = orgs.filter(o => o.type === 'club')

  const showBack = selOrg && orgs.length > 1

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <button onClick={showBack ? clearOrg : () => navigate(-1)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-6">
            <ChevronLeft className="w-4 h-4" />
            {showBack ? 'Back to selection' : 'Back'}
          </button>
          <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">Create fixture</h1>
          {!selOrg && !loading && orgs.length > 1 && (
            <p className="text-slate-500 text-sm mt-2">Select a school or club to continue.</p>
          )}
        </div>

        {loading && <Spinner />}

        {/* No orgs */}
        {!loading && orgIds.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
            <h3 className="text-slate-900 font-display font-bold text-base mb-2">No schools or clubs yet</h3>
            <p className="text-slate-500 text-sm mb-5 leading-relaxed">
              Create a school or club first, then come back to create fixtures.
            </p>
            <Link to="/manage/new-org"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors">
              Create school or club
            </Link>
          </div>
        )}

        {/* Entity selection — multiple orgs */}
        {!loading && !selOrg && orgs.length > 1 && (
          <div className="space-y-6">
            {schools.length > 0 && (
              <section>
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Schools</h2>
                <div className="space-y-2">
                  {schools.map(org => <EntityCard key={org.id} org={org} onClick={selectOrg} />)}
                </div>
              </section>
            )}
            {clubs.length > 0 && (
              <section>
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Clubs</h2>
                <div className="space-y-2">
                  {clubs.map(org => <EntityCard key={org.id} org={org} onClick={selectOrg} />)}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Fixture forms — school or club */}
        {!loading && selOrg && selOrg.type === 'school' && (
          <SchoolFixtureForm org={selOrg} canChange={orgs.length > 1} onChangeOrg={clearOrg} />
        )}
        {!loading && selOrg && selOrg.type === 'club' && (
          <ClubFixtureForm org={selOrg} canChange={orgs.length > 1} onChangeOrg={clearOrg} />
        )}
      </div>
    </div>
  )
}
