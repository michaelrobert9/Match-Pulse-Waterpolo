import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, X, Plus, ChevronLeft, Clipboard, Users, Pencil, UserPlus, Lock } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { roleLabel, grantLabel, grantOf } from '../../lib/capabilities'
import InviteUserForm from '../../components/InviteUserForm'
import { fetchOrganization } from '../../lib/queries'
import {
  updateOrganization, deleteOrganization,
  createCompetition, fetchCompetitionsForOrg, addFixtureToCompetition,
  createTeam, updateTeam, deleteTeam,
  createMatch, deleteMatch,
  fetchOrgStaff, removeOrgStaff,
  propagateTeamNameToMatches, propagateOrgNameToMatches,
  redeemEntitlementToken,
} from '../../lib/adminQueries'
import { DeleteOrgModal } from '../admin/Organizations'
import { toDate } from '../../lib/queries'
import { userDisplayName, userInitial } from '../../lib/names'
import {
  SCHOOL_GENDER_PROFILES, SCHOOL_GENDER_LABEL, CLUB_DIVISIONS, TEAM_LEVELS,
  schoolGenderProfile, schoolTeamName, clubTeamName, divisionLabel, generatedTeamName,
} from '../../lib/teamNaming'
import { DEFAULT_PERIODS, DEFAULT_PERIOD_MINUTES, DEFAULT_BREAK_MINUTES } from '../../lib/matchClock'
import StatusBadge from '../../components/StatusBadge'
import CompetitionStatusBadge from '../../components/CompetitionStatusBadge'
import OpponentSelector from '../../components/OpponentSelector'
import FormatSelector from '../../components/FormatSelector'
import { MatchTeamIdentity, MatchVersus } from '../../components/TeamIdentity'
import { prefetchMatchTeams } from '../../lib/teamIdentity'
import { monogram } from '../../lib/names'
import { orgEntitlementStatus } from '../../lib/entitlement'
import SquadManager from '../../components/SquadManager'

// ── Shared primitives ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Input({ label, hint, ...props }) {
  return (
    <div>
      {label && <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">{label}</label>}
      <input
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        {...props}
      />
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function Select({ label, children, ...props }) {
  return (
    <div>
      {label && <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">{label}</label>}
      <select
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

function Section({ id, title, action, children }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function fmtDate(val) {
  const d = toDate(val)
  if (!d) return 'TBD'
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}


// ── Upcoming fixtures section ─────────────────────────────────────────────────

function UpcomingFixturesSection({ orgId, org, competitions, teams, matches, setMatches, loading, defaultOpen }) {
  const [showAdd, setShowAdd] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [form,    setForm]    = useState({
    yourSide:      'club',
    yourTeamId:    '',
    side:          'home',
    opponent:      null,
    scheduledAt:   '', pitch: '',
    periods:       DEFAULT_PERIODS, periodMinutes: DEFAULT_PERIOD_MINUTES,
    breakMinutes:  DEFAULT_BREAK_MINUTES, indoor: false,
    competitionId: '',
  })

  useEffect(() => { if (defaultOpen) setShowAdd(true) }, [defaultOpen])

  const upcoming = matches
    .filter(m => m.status !== 'final')
    .sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt))

  const [showCompetition, setShowCompetition] = useState(false)

  const isSchool = org?.type === 'school'
  const color    = org?.primaryColor || '#555'

  const clubAsSide = {
    id:             null,
    displayName:    org?.name,
    orgName:        null,
    shortCode:      org?.shortCode,
    primaryColor:   org?.primaryColor || null,
    organizationId: orgId,
  }

  const yourTeamObj = isSchool
    ? (teams.find(t => t.id === form.yourTeamId) ?? null)
    : form.yourSide === 'club'
      ? clubAsSide
      : (teams.find(t => t.id === form.yourSide) ?? null)

  const excludeTeamId = isSchool
    ? form.yourTeamId
    : form.yourSide !== 'club' ? form.yourSide : null

  const canSubmit = !!yourTeamObj && !!form.opponent && !!form.scheduledAt
    && Number(form.periods) > 0 && Number(form.periodMinutes) > 0

  async function handleCreate(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    try {
      const homeTeam = form.side === 'home' ? yourTeamObj : form.opponent
      const awayTeam = form.side === 'home' ? form.opponent : yourTeamObj
      const comp = competitions.find(c => c.id === form.competitionId)

      const ref = await createMatch(form.competitionId || null, homeTeam, awayTeam, {
        scheduledAt:   new Date(form.scheduledAt),
        pitch:         form.pitch,
        season:        comp?.season ?? null,
        periods:       Number(form.periods),
        periodMinutes: Number(form.periodMinutes),
        breakMinutes:  form.breakMinutes,
        indoor:        form.indoor,
      })
      // A competition fixture is a match + membership join record, never a
      // bare match.competitionId (dropdown lists only this org's competitions).
      if (form.competitionId) {
        await addFixtureToCompetition(form.competitionId, {
          id: ref.id, homeTeamId: homeTeam.id ?? null, awayTeamId: awayTeam.id ?? null,
        })
      }
      const newMatch = {
        id: ref.id,
        competitionId: form.competitionId || null,
        homeTeamId:    homeTeam.id ?? null,
        awayTeamId:    awayTeam.id ?? null,
        homeTeamName:  homeTeam.displayName,
        homeOrgName:   homeTeam.orgName   || null,
        awayTeamName:  awayTeam.displayName,
        awayOrgName:   awayTeam.orgName   || null,
        homeTeamColor: homeTeam.primaryColor || null,
        awayTeamColor: awayTeam.primaryColor || null,
        homeOrgId:     homeTeam.organizationId || null,
        awayOrgId:     awayTeam.organizationId || null,
        homeScore: 0, awayScore: 0,
        scheduledAt: new Date(form.scheduledAt), pitch: form.pitch, status: 'scheduled', tracked: false,
      }
      setMatches(prev => [...prev, newMatch])
      setShowAdd(false)
      setForm(f => ({
        ...f,
        yourSide: 'club', yourTeamId: '',
        opponent: null, scheduledAt: '', pitch: '', side: 'home',
      }))
    } finally { setSaving(false) }
  }

  async function handleDelete(match) {
    if (!confirm('Delete this fixture?')) return
    await deleteMatch(match.id)
    setMatches(prev => prev.filter(m => m.id !== match.id))
  }

  if (loading) return <Section id="fixtures" title="Upcoming Fixtures"><Spinner /></Section>

  const canAddNew = !isSchool || teams.length > 0

  return (
    <Section
      id="fixtures"
      title={`Upcoming Fixtures (${upcoming.length})`}
      action={
        canAddNew && (
          <button onClick={() => setShowAdd(v => !v)}
            className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
            {showAdd ? 'Cancel' : '+ New'}
          </button>
        )
      }
    >
      {showAdd && (
        <form onSubmit={handleCreate} className="px-4 py-4 border-b border-slate-200 space-y-4">

          {isSchool ? (
            <Select label="Your team" value={form.yourTeamId} required
              onChange={e => setForm(f => ({ ...f, yourTeamId: e.target.value, opponent: null }))}>
              <option value="">Select your team…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}
            </Select>
          ) : (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Your side</p>
              <div className="space-y-1.5">
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, yourSide: 'club' }))}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors text-left ${
                    form.yourSide === 'club'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: color + '25', border: `1.5px solid ${color}` }}>
                    <span className="text-[8px] font-bold font-mono" style={{ color }}>{monogram(org?.name)}</span>
                  </div>
                  <div>
                    <span className={`text-sm font-semibold ${form.yourSide === 'club' ? 'text-slate-900' : 'text-slate-600'}`}>
                      {org?.name}
                    </span>
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold ml-2">Club</span>
                  </div>
                </button>
                {teams.length > 0 && (
                  <>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 px-1 pt-1">or select a team</p>
                    {teams.map(team => (
                      <button type="button" key={team.id}
                        onClick={() => setForm(f => ({ ...f, yourSide: team.id }))}
                        className={`w-full flex items-center gap-3 px-4 py-2 rounded-xl border transition-colors text-left ${
                          form.yourSide === team.id
                            ? 'border-emerald-500 bg-emerald-50'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.primaryColor || '#555' }} />
                        <span className={`text-sm font-semibold ${form.yourSide === team.id ? 'text-slate-900' : 'text-slate-600'}`}>
                          {team.displayName}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Playing at</p>
            <div className="flex gap-2">
              {[{ v: 'home', label: 'Home (we host)' }, { v: 'away', label: 'Away (we travel)' }].map(o => (
                <button type="button" key={o.v} onClick={() => setForm(f => ({ ...f, side: o.v }))}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors ${
                    form.side === o.v ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
              Opponent
            </label>
            <OpponentSelector
              orgTeams={teams}
              excludeTeamId={excludeTeamId}
              orgId={orgId}
              excludeOrgId={orgId}
              value={form.opponent}
              onChange={opp => setForm(f => ({ ...f, opponent: opp }))}
            />
          </div>

          <Input label="Date & time" type="datetime-local" required
            value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
          <Input label="Venue / pitch (optional)" value={form.pitch} placeholder="e.g. Astro 1"
            onChange={e => setForm(f => ({ ...f, pitch: e.target.value }))} />

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Match format</p>
            <FormatSelector
              periods={form.periods}
              periodMinutes={form.periodMinutes}
              breakMinutes={form.breakMinutes}
              indoor={form.indoor}
              onChange={({ periods, periodMinutes, breakMinutes, indoor }) => setForm(f => ({ ...f, periods, periodMinutes, breakMinutes, indoor }))}
            />
          </div>

          {competitions.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowCompetition(v => !v)}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors">
                <ChevronRight className={`w-3 h-3 transition-transform ${showCompetition ? 'rotate-90' : ''}`} />
                Competition (optional)
              </button>
              {showCompetition && (
                <Select className="mt-2" value={form.competitionId}
                  onChange={e => setForm(f => ({ ...f, competitionId: e.target.value }))}>
                  <option value="">No competition</option>
                  {competitions.map(c => <option key={c.id} value={c.id}>{c.name}{c.season ? ` (${c.season})` : ''}</option>)}
                </Select>
              )}
            </div>
          )}

          <button type="submit" disabled={saving || !canSubmit}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
            {saving ? 'Creating…' : 'Create fixture'}
          </button>
        </form>
      )}

      {isSchool && teams.length === 0 && (
        <div className="px-4 py-8 text-center">
          <p className="text-slate-500 text-sm">Add a team first, then create fixtures.</p>
        </div>
      )}
      {canAddNew && upcoming.length === 0 && !showAdd && (
        <div className="px-4 py-8 text-center">
          <p className="text-slate-400 text-sm font-medium mb-1">No upcoming fixtures</p>
          <p className="text-slate-600 text-xs">Create your first fixture to start scoring matches.</p>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="px-3 pb-3 space-y-2 pt-2">
          {upcoming.map(m => {
            const isActive = m.status === 'live' || m.status === 'paused'
            return (
              <div key={m.id} className="bg-slate-50 rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3">
                <Link to={`/score/${m.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                  <div className="flex items-center gap-2 mb-1.5">
                    {isActive && <StatusBadge status={m.status} />}
                    <span className={`font-mono text-[10px] uppercase tracking-widest ${isActive ? 'text-slate-500' : 'text-emerald-600'}`}>
                      {fmtDate(m.scheduledAt)}
                    </span>
                    {m.pitch && <span className="text-slate-600 text-[10px]">· {m.pitch}</span>}
                  </div>
                  <MatchVersus match={m} className="text-sm text-slate-900 font-semibold" vsClass="text-slate-600 font-normal" />
                </Link>
                <button onClick={() => handleDelete(m)} title="Delete fixture"
                  className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── Recent results section ────────────────────────────────────────────────────

function RecentResultsSection({ matches, setMatches, loading }) {
  const results = matches
    .filter(m => m.status === 'final')
    .sort((a, b) => toDate(b.scheduledAt) - toDate(a.scheduledAt))
    .slice(0, 10)

  async function handleDelete(match) {
    if (!confirm('Delete this result?')) return
    await deleteMatch(match.id)
    setMatches(prev => prev.filter(m => m.id !== match.id))
  }

  if (loading) return <Section id="results" title="Recent Results"><Spinner /></Section>

  return (
    <Section id="results" title={`Recent Results (${results.length})`}>
      {results.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-slate-500 text-sm">No results yet.</p>
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-2 pt-2">
          {results.map(m => {
            const home    = m.homeScore ?? 0
            const away    = m.awayScore ?? 0
            const homeWon = home > away
            const awayWon = away > home
            return (
              <div key={m.id} className="bg-slate-50 rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3">
                <Link to={`/score/${m.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <StatusBadge status="final" />
                    <span className="font-mono text-[10px] text-slate-600 tabular-nums">{fmtDate(m.scheduledAt)}</span>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-start gap-2">
                      <MatchTeamIdentity match={m} side="home" hideIdentifier className="flex-1"
                        nameClass={`text-sm font-semibold ${homeWon ? 'text-slate-900' : 'text-slate-400'}`} />
                      <span className={`font-mono font-bold text-xl tabular-nums shrink-0 ${homeWon ? 'text-slate-900' : 'text-slate-400'}`}>
                        {home}
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <MatchTeamIdentity match={m} side="away" hideIdentifier className="flex-1"
                        nameClass={`text-sm font-semibold ${awayWon ? 'text-slate-900' : 'text-slate-400'}`} />
                      <span className={`font-mono font-bold text-xl tabular-nums shrink-0 ${awayWon ? 'text-slate-900' : 'text-slate-400'}`}>
                        {away}
                      </span>
                    </div>
                  </div>
                </Link>
                <button onClick={() => handleDelete(m)} title="Delete result"
                  className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── Teams section ─────────────────────────────────────────────────────────────

const SCHOOL_CHIPS = [
  '1st XI', '2nd XI',
  'U18A',  'U18B',
  'U16A',  'U16B',
  'U15A',  'U15B',
  'U14A',  'U14B',
  'U13A',  'U13B',
]

function TeamsSection({ orgId, org, competitions, teams, setTeams, defaultOpen, canManage }) {
  const [showAdd,          setShowAdd]          = useState(false)
  const [editId,           setEditId]           = useState(null)
  const [squadOpenId,      setSquadOpenId]      = useState(null)   // team whose squad panel is open
  const [saving,           setSaving]           = useState(false)
  const [editSaving,       setEditSaving]       = useState(false)
  const [deleteTarget,     setDeleteTarget]     = useState(null)   // team to delete
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Structured edit state — mirrors the create controls.
  const [editGender, setEditGender] = useState('')   // school: boys/girls · club: division value
  const [editLabel,  setEditLabel]  = useState('')   // team label (e.g. "U16A", "1st Team")

  // Team-identity edit state — only editable when team-level management is on.
  // These are display OVERRIDES; when empty the team inherits the org identity.
  const [editName,  setEditName]  = useState('')
  const [editImage, setEditImage] = useState('')
  const [editBio,   setEditBio]   = useState('')
  const teamMgmtOn = org?.teamLevelManagement === true

  // School state
  const [dispName,     setDispName]     = useState('')  // the team label (chip / custom)
  const [schoolGender, setSchoolGender] = useState('')  // 'boys' | 'girls' (co-ed only)

  // Club state
  const [gender,      setGender]      = useState('')    // division value
  const [teamLevel,   setTeamLevel]   = useState('')
  const [customLevel, setCustomLevel] = useState('')

  useEffect(() => { if (defaultOpen) setShowAdd(true) }, [defaultOpen])

  const isSchool   = org?.type === 'school'
  const profile    = schoolGenderProfile(org)            // boys | girls | coed
  const asksGender = isSchool && profile === 'coed'
  // Single-gender schools apply their gender automatically.
  const effectiveSchoolGender = isSchool
    ? (asksGender ? schoolGender : profile)
    : null

  const clubName    = isSchool ? '' : clubTeamName(gender, teamLevel, customLevel)
  const schoolName  = isSchool ? schoolTeamName(effectiveSchoolGender, dispName.trim()) : ''
  const canAddClub  = !isSchool && gender && (teamLevel !== 'custom' || customLevel.trim())
  const canAddSchool = isSchool && dispName.trim() && effectiveSchoolGender

  async function handleCreate(e) {
    e.preventDefault()
    if (isSchool ? !canAddSchool : !canAddClub) return
    const name    = isSchool ? schoolName : clubName
    const isDupe  = teams.some(t =>
      (generatedTeamName(t) || t.displayName).toLowerCase() === name.toLowerCase()
    )
    if (isDupe) return
    setSaving(true)
    const options = isSchool
      ? { gender: effectiveSchoolGender, teamLabel: dispName.trim() }
      : { gender, teamLabel: (teamLevel === 'custom' ? customLevel.trim() : teamLevel) || null }
    try {
      const ref = await createTeam(org, name, options)
      setTeams(prev => [...prev, {
        id: ref.id, organizationId: orgId, orgName: org.name,
        displayName: name, gender: options.gender ?? null, teamLabel: options.teamLabel ?? null,
        active: true,
        shortCode: org.shortCode, primaryColor: org.primaryColor,
        secondaryColor: org.secondaryColor || '#FFFFFF', logoUrl: org.logoUrl || null,
        played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0,
      }])
      setShowAdd(false)
      setDispName('')
      setSchoolGender('')
      setGender('')
      setTeamLevel('')
      setCustomLevel('')
    } finally { setSaving(false) }
  }

  async function toggleActive(team) {
    const next = team.active === false
    await updateTeam(team.id, { active: next })
    setTeams(prev => prev.map(t => t.id === team.id ? { ...t, active: next } : t))
  }

  function startEdit(team) {
    setEditId(team.id)
    // School single-gender teams keep the school's gender; co-ed and clubs use
    // the team's stored value.
    setEditGender(team.gender ?? (isSchool && !asksGender ? profile : ''))
    setEditLabel(team.teamLabel ?? '')
    // Identity overrides — stored values are kept even when the toggle is off
    // (hide-not-clear), so they reappear here when editing with the toggle on.
    setEditName(team.name ?? '')
    setEditImage(team.logoUrl ?? '')
    setEditBio(team.bio ?? '')
  }

  // Live preview of the edited structured name.
  const editGenderEffective = isSchool && !asksGender ? profile : editGender
  const editPreview = editId
    ? generatedTeamName({ gender: editGenderEffective, teamLabel: editLabel.trim() })
    : ''
  const canSaveEdit = isSchool
    ? !!editLabel.trim() && !!editGenderEffective
    : !!editGender

  async function handleEdit(team) {
    const gender    = editGenderEffective || null
    const teamLabel = editLabel.trim() || null
    const name      = generatedTeamName({ gender, teamLabel }) || team.displayName
    if (!canSaveEdit) return

    const structuralChanged =
      gender !== (team.gender ?? null) || teamLabel !== (team.teamLabel ?? null)

    // Identity overrides only persist when team-level management is on. Empty
    // string normalises to null (inherit). Bio capped at 140.
    let identityPatch = {}
    if (teamMgmtOn) {
      const bio = editBio.trim()
      if (bio.length > 140) return
      identityPatch = {
        name:    editName.trim()  || null,
        logoUrl: editImage.trim() || null,
        bio:     bio || null,
      }
    }
    const identityChanged = teamMgmtOn && (
      (identityPatch.name    ?? null) !== (team.name    ?? null) ||
      (identityPatch.logoUrl ?? null) !== (team.logoUrl ?? null) ||
      (identityPatch.bio     ?? null) !== (team.bio     ?? null)
    )

    // Nothing changed → just close.
    if (!structuralChanged && !identityChanged) { setEditId(null); return }

    setEditSaving(true)
    try {
      // updateTeam recomputes displayName + searchName from the structured fields.
      await updateTeam(team.id, {
        ...(structuralChanged ? { gender, teamLabel } : {}),
        ...(identityChanged ? identityPatch : {}),
      })
      if (structuralChanged) {
        // Refresh the denormalised fallback on matches (not the display source —
        // registered teams resolve live — but keeps search/exports consistent).
        await propagateTeamNameToMatches(team.id, name)
      }
      setTeams(prev => prev.map(t => t.id === team.id
        ? {
            ...t,
            ...(structuralChanged ? { gender, teamLabel, displayName: name, searchName: name.toLowerCase() } : {}),
            ...(identityChanged ? identityPatch : {}),
          }
        : t))
      setEditId(null)
    } finally { setEditSaving(false) }
  }

  function initiateDelete(team) {
    setDeleteTarget(team)
    setDeleteConfirmText('')
  }

  async function handleRemove() {
    if (!deleteTarget || deleteConfirmText.trim().toLowerCase() !== 'delete') return
    const team = deleteTarget
    setDeleteTarget(null)
    setDeleteConfirmText('')
    await deleteTeam(team.id)
    setTeams(prev => prev.filter(t => t.id !== team.id))
  }

  return (
    <Section
      id="teams"
      title={`Teams (${teams.length})`}
      action={
        canManage && (
          <button onClick={() => setShowAdd(v => !v)}
            className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors">
            {showAdd ? 'Cancel' : '+ New'}
          </button>
        )
      }
    >
      {showAdd && (
        <form onSubmit={handleCreate} className="px-4 py-4 border-b border-slate-200 space-y-3">
          {isSchool ? (
            /* ── School: (gender for co-ed) → chips grid + custom input ── */
            <div className="space-y-3">
              {asksGender && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[['boys', 'Boys'], ['girls', 'Girls']].map(([val, label]) => (
                      <button type="button" key={val} onClick={() => setSchoolGender(val)}
                        className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors ${
                          schoolGender === val
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-slate-200 text-slate-600 hover:border-slate-400'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!asksGender && (
                <p className="text-[11px] text-slate-500">
                  This is a {profile === 'boys' ? 'boys' : 'girls'}-only school — teams use{' '}
                  <span className="font-semibold text-slate-700">{SCHOOL_GENDER_LABEL[profile]}</span> automatically.
                </p>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team</p>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {SCHOOL_CHIPS.map(chip => (
                    <button type="button" key={chip} onClick={() => setDispName(chip)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors ${
                        dispName === chip
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}>
                      {chip}
                    </button>
                  ))}
                </div>
                <input
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="Custom team (e.g. U16C, 3rd XI)"
                  value={dispName}
                  onChange={e => setDispName(e.target.value)}
                />
              </div>
              {schoolName && (
                <div className="text-xs text-slate-400">
                  Preview: <span className="text-slate-900 font-semibold">{schoolName}</span>
                </div>
              )}
            </div>
          ) : (
            /* ── Club: division → team level ── */
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Division</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {CLUB_DIVISIONS.map(g => (
                    <button type="button" key={g.value} onClick={() => setGender(g.value)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors ${
                        gender === g.value
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              {gender && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Team <span className="text-slate-600 normal-case tracking-normal font-normal">optional</span>
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {TEAM_LEVELS.map(lvl => (
                      <button type="button" key={lvl} onClick={() => setTeamLevel(lvl)}
                        className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
                          teamLevel === lvl
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-slate-200 text-slate-600 hover:border-slate-400'
                        }`}>
                        {lvl}
                      </button>
                    ))}
                    <button type="button" onClick={() => setTeamLevel('custom')}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
                        teamLevel === 'custom'
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}>
                      Custom
                    </button>
                    <button type="button" onClick={() => setTeamLevel('')}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
                        teamLevel === ''
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}>
                      None
                    </button>
                  </div>
                  {teamLevel === 'custom' && (
                    <input
                      className="mt-2 w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="e.g. Open, Vets, Under-21"
                      value={customLevel}
                      onChange={e => setCustomLevel(e.target.value)}
                    />
                  )}
                </div>
              )}
              {clubName && (
                <div className="text-xs text-slate-400">
                  Preview: <span className="text-slate-900 font-semibold">{clubName}</span>
                </div>
              )}
            </div>
          )}

          {(() => {
            const previewName = isSchool ? schoolName : clubName
            const isDupe = previewName && teams.some(t =>
              (generatedTeamName(t) || t.displayName).toLowerCase() === previewName.toLowerCase()
            )
            return (
              <>
                {isDupe && (
                  <p className="text-xs text-red-600">A team with this name already exists.</p>
                )}
                <button type="submit" disabled={saving || (isSchool ? !canAddSchool : !canAddClub) || !!isDupe}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
                  {saving ? 'Creating…' : 'Add team'}
                </button>
              </>
            )
          })()}
        </form>
      )}

      {teams.length === 0 && !showAdd && (
        <div className="px-4 py-8 text-center">
          <p className="text-slate-400 text-sm font-medium mb-1">No teams yet</p>
          <p className="text-slate-600 text-xs">Teams are optional — add one to play your own fixtures, or host a competition below without any.</p>
        </div>
      )}

      <div className="divide-y divide-slate-200">
        {teams.map(team => {
          const teamName = generatedTeamName(team) || team.displayName
          return (
          <div key={team.id}>
            <div className={`flex items-center gap-3 px-4 py-3 ${team.active === false ? 'opacity-60' : ''}`}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: (team.primaryColor || '#333') + '25', border: `2px solid ${team.primaryColor || '#333'}` }}>
                <span className="text-[9px] font-bold font-mono" style={{ color: team.primaryColor || '#aaa' }}>
                  {monogram(teamName)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-slate-900 text-sm font-semibold truncate">{teamName}</span>
                  {team.active === false && (
                    <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">Inactive</span>
                  )}
                </div>
              </div>
              {canManage && (
                <>
                  <button onClick={() => setSquadOpenId(id => id === team.id ? null : team.id)} title="Manage squad"
                    className={`text-[9px] font-bold uppercase tracking-widest px-1.5 shrink-0 transition-colors ${
                      squadOpenId === team.id ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-700'}`}>
                    Squad
                  </button>
                  <button onClick={() => toggleActive(team)} title={team.active === false ? 'Set active' : 'Set inactive'}
                    className="text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors px-1.5 shrink-0">
                    {team.active === false ? 'Activate' : 'Deactivate'}
                  </button>
                  <button onClick={() => startEdit(team)} title="Edit team label"
                    className="text-slate-400 hover:text-slate-700 transition-colors p-1 shrink-0">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => initiateDelete(team)} title="Remove team"
                    className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {editId === team.id && (
              <div className="px-4 pb-4 pt-1 space-y-3 bg-slate-50">
                {isSchool ? (
                  <>
                    {asksGender && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[['boys', 'Boys'], ['girls', 'Girls']].map(([val, label]) => (
                            <button type="button" key={val} onClick={() => setEditGender(val)}
                              className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors ${
                                editGender === val
                                  ? 'bg-emerald-500 border-emerald-500 text-white'
                                  : 'border-slate-200 text-slate-600 hover:border-slate-400'
                              }`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team</p>
                      <div className="grid grid-cols-4 gap-1.5 mb-2">
                        {SCHOOL_CHIPS.map(chip => (
                          <button type="button" key={chip} onClick={() => setEditLabel(chip)}
                            className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors ${
                              editLabel === chip
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'border-slate-200 text-slate-600 hover:border-slate-400'
                            }`}>
                            {chip}
                          </button>
                        ))}
                      </div>
                      <input
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                        placeholder="Custom team (e.g. U16C, 3rd XI)"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setEditId(null) }}
                        autoFocus
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Division</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {CLUB_DIVISIONS.map(g => (
                          <button type="button" key={g.value} onClick={() => setEditGender(g.value)}
                            className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors ${
                              editGender === g.value
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'border-slate-200 text-slate-600 hover:border-slate-400'
                            }`}>
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                        Team <span className="text-slate-600 normal-case tracking-normal font-normal">optional</span>
                      </p>
                      <div className="flex gap-1.5 flex-wrap mb-2">
                        {TEAM_LEVELS.map(lvl => (
                          <button type="button" key={lvl} onClick={() => setEditLabel(lvl)}
                            className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
                              editLabel === lvl
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'border-slate-200 text-slate-600 hover:border-slate-400'
                            }`}>
                            {lvl}
                          </button>
                        ))}
                        <button type="button" onClick={() => setEditLabel('')}
                          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
                            editLabel === ''
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-slate-200 text-slate-600 hover:border-slate-400'
                          }`}>
                          None
                        </button>
                      </div>
                      <input
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                        placeholder="Custom team (e.g. Open, Vets)"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setEditId(null) }}
                      />
                    </div>
                  </>
                )}

                {editPreview && (
                  <div className="text-xs text-slate-400">
                    Preview: <span className="text-slate-900 font-semibold">{(org?.name ? `${org.name} ` : '') + editPreview}</span>
                  </div>
                )}

                {/* Team identity overrides — only when team-level management is on.
                    Empty fields inherit the {org name / logo / bio}. */}
                {teamMgmtOn && (
                  <div className="space-y-3 pt-2 border-t border-slate-200">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Team identity <span className="normal-case tracking-normal font-normal text-slate-400">(optional — blank inherits the {isSchool ? 'school' : 'club'})</span>
                    </p>
                    <input
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="Display name override"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                    />
                    <input
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="Image URL"
                      value={editImage}
                      onChange={e => setEditImage(e.target.value)}
                    />
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bio</span>
                        <span className={`text-[10px] font-mono ${editBio.length > 140 ? 'text-red-500' : 'text-slate-300'}`}>{editBio.length}/140</span>
                      </div>
                      <textarea rows={2} maxLength={140}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
                        placeholder="Short team bio (max 140 chars)…"
                        value={editBio}
                        onChange={e => setEditBio(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button type="button" onClick={() => handleEdit(team)} disabled={editSaving || !canSaveEdit}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors shrink-0">
                    {editSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditId(null)}
                    className="px-4 py-2 border border-slate-200 text-slate-500 hover:text-slate-900 text-xs font-medium rounded-lg transition-colors shrink-0">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {squadOpenId === team.id && (
              <div className="px-4 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
                <SquadManager team={team} />
              </div>
            )}
          </div>
          )
        })}
      </div>

      {/* Delete confirmation overlay */}
      {deleteTarget && (
        <div className="mx-4 mb-4 bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-red-800 mb-0.5">Delete "{generatedTeamName(deleteTarget) || deleteTarget.displayName}"?</p>
            <p className="text-xs text-red-700">This cannot be undone. Type <span className="font-mono font-bold">delete</span> to confirm.</p>
          </div>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            placeholder="Type delete to confirm"
            className="w-full bg-white border border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={deleteConfirmText.trim().toLowerCase() !== 'delete'}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors">
              Delete team
            </button>
            <button
              onClick={() => { setDeleteTarget(null); setDeleteConfirmText('') }}
              className="px-4 py-2 border border-slate-200 text-slate-500 hover:text-slate-900 text-xs font-medium rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

// ── Competitions section ───────────────────────────────────────────────────────

function CompetitionsSection({ orgId, org, isPlatformAdmin, competitions, setCompetitions, defaultOpen, canManage }) {
  // The platform master admin always has full rights — never plan-gated.
  const entitlement = isPlatformAdmin ? { tier: 'admin', canCreate: true } : orgEntitlementStatus(org)

  return (
    <Section
      id="competitions"
      title={`Competitions (${competitions.length})`}
      action={
        entitlement.canCreate && canManage ? (
          <Link to="/manage/competitions"
            className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors">
            Manage
          </Link>
        ) : null
      }
    >
      {/* Locked / upgrade notice for orgs without an active plan */}
      {!entitlement.canCreate && (
        <div className="px-4 py-6 flex flex-col items-center text-center gap-3 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <Lock className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 mb-0.5">Competitions are a paid feature</p>
            <p className="text-slate-500 text-xs leading-relaxed max-w-xs">
              Host a tournament, league or festival. Purchase a plan and MatchPulse activates your competition access manually within one business day.
            </p>
          </div>
          <Link to="/plans"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors">
            See plans
          </Link>
        </div>
      )}

      {competitions.length === 0 ? (
        entitlement.canCreate ? (
          <div className="px-4 py-6 text-center">
            <p className="text-slate-500 text-sm mb-1">No competitions yet.</p>
            <Link to="/manage/competitions"
              className="text-emerald-600 text-xs hover:underline">
              Go to Competition Manager →
            </Link>
          </div>
        ) : null
      ) : (
        <div className="divide-y divide-slate-200">
          {competitions.map(c => (
            <Link key={c.id} to={`/manage/competitions/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 text-sm font-semibold truncate">{c.name}</div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {c.season && <span className="text-[10px] text-slate-500 font-mono">{c.season}</span>}
                  {c.gender && <><span className="text-slate-300">·</span><span className="text-[10px] text-slate-500">{c.gender}</span></>}
                  {c.ageGroup && <><span className="text-slate-300">·</span><span className="text-[10px] text-slate-500">{c.ageGroup}</span></>}
                </div>
              </div>
              <CompetitionStatusBadge competition={c} />
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Staff section ─────────────────────────────────────────────────────────────

function StaffSection({ orgId, org, isPlatformAdmin, uid, teams, canAppoint, inviterGrant, teamMgmtOn }) {
  const [staff,       setStaff]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showInvite,  setShowInvite]  = useState(false)

  const entityLabel  = org?.type === 'school' ? 'school' : org?.type === 'association' ? 'association' : 'club'
  // The inviter's effective role for the invite ceiling. Platform admins invite
  // as master_admin; an org-wide owner as owner; a team-scoped owner can only
  // appoint a Team Scorer for their own team (handled inside InviteUserForm).
  const inviterRole  = isPlatformAdmin ? 'master_admin' : (inviterGrant?.role ?? 'owner')
  const inviterTeamId = inviterGrant?.teamId ?? null

  useEffect(() => {
    fetchOrgStaff(orgId).then(setStaff).catch(() => {}).finally(() => setLoading(false))
  }, [orgId])

  async function handleRemove(memberId) {
    if (!confirm('Remove this member?')) return
    await removeOrgStaff(orgId, memberId)
    setStaff(prev => prev.filter(s => s.id !== memberId))
  }

  function handleInvited() {
    // Re-fetch staff so any immediate grants show up
    fetchOrgStaff(orgId).then(setStaff).catch(() => {})
    setShowInvite(false)
  }

  const ROLE_STYLE    = { owner: 'text-emerald-600', staff: 'text-blue-500' }
  const teamNameById  = id => teams?.find(t => t.id === id)?.displayName ?? null

  if (loading) return <Section id="staff" title="Members"><Spinner /></Section>

  return (
    <Section
      id="staff"
      title={`Members (${staff.length})`}
      action={
        canAppoint && (
          <button onClick={() => setShowInvite(v => !v)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors">
            {showInvite ? (
              <><X className="w-3 h-3" /> Cancel</>
            ) : (
              <><UserPlus className="w-3 h-3" /> Invite user</>
            )}
          </button>
        )
      }
    >
      {showInvite && (
        <div className="px-4 py-4 border-b border-slate-200">
          <InviteUserForm
            inviterRole={inviterRole}
            inviterTeamId={inviterTeamId}
            teamMgmtOn={teamMgmtOn}
            orgId={orgId}
            orgName={org?.name}
            teams={teams}
            uid={uid}
            onClose={handleInvited}
          />
        </div>
      )}

      {staff.length === 0 && !showInvite ? (
        <div className="px-4 py-6 text-center">
          <p className="text-slate-500 text-sm">No members yet.</p>
          {!canAppoint && (
            <p className="text-slate-600 text-xs mt-2">
              An owner of this {entityLabel} can invite scorers.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {staff.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-emerald-700">
                  {userInitial(s)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 text-sm font-semibold truncate">
                  {userDisplayName(s)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${ROLE_STYLE[s.role] ?? 'text-slate-500'}`}>
                    {roleLabel(s.role)}
                  </span>
                  {s.teamId && teamNameById(s.teamId) && (
                    <>
                      <span className="text-slate-300 text-[9px]">·</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        {teamNameById(s.teamId)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {(isPlatformAdmin || canAppoint) && s.role !== 'owner' && (
                <button onClick={() => handleRemove(s.id)} title="Remove"
                  className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Settings section ──────────────────────────────────────────────────────────

function SettingsSection({ org, onSaved }) {
  const [form,   setForm]   = useState({
    name:          org.name           ?? '',
    type:          org.type           ?? 'school',
    region:        org.region         ?? '',
    primaryColor:  org.primaryColor   ?? '#006B3C',
    secondaryColor:org.secondaryColor ?? '#FFFFFF',
    logoUrl:       org.logoUrl        ?? '',
    bannerUrl:     org.bannerUrl      ?? '',
    bio:           org.bio ?? org.description ?? '',
    website:       org.website        ?? '',
    genderProfile: org.genderProfile  ?? 'coed',
  })
  const isSchool    = form.type === 'school'
  const entityLabel = form.type === 'school' ? 'School' : form.type === 'association' ? 'Association' : 'Club'
  const [teamMgmt, setTeamMgmt] = useState(org.teamLevelManagement === true)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  async function handleSave(e) {
    e.preventDefault()
    const bio = form.bio.trim()
    if (bio.length > 140) { setError('Bio must be 140 characters or fewer.'); return }
    setSaving(true)
    setError('')
    try {
      const patch = {
        name:                form.name.trim(),
        type:                form.type,
        region:              form.region || null,
        primaryColor:        form.primaryColor,
        secondaryColor:      form.secondaryColor,
        logoUrl:             form.logoUrl.trim() || null,
        bannerUrl:           form.bannerUrl.trim() || null,
        bio:                 bio || null,
        description:         null,
        website:             form.website.trim() || null,
        teamLevelManagement: teamMgmt,
        ...(isSchool ? { genderProfile: form.genderProfile } : {}),
      }
      await updateOrganization(org.id, patch)
      // Propagate name change to all match documents that reference this org.
      if (patch.name !== org.name) {
        propagateOrgNameToMatches(org.id, patch.name).catch(() => {})
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      onSaved?.({ ...org, ...patch })
    } catch (err) {
      setError(err.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section id="settings" title={`${entityLabel} settings`}>
      <form onSubmit={handleSave} className="px-4 py-4 space-y-3">
        <Input label={`${entityLabel} name`} value={form.name} required
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Organisation type</label>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
            <option value="school">School</option>
            <option value="club">Club</option>
            <option value="association">Association</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Province</label>
          <select value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
            <option value="">Select province…</option>
            <option>Western Cape</option>
            <option>Eastern Cape</option>
            <option>Northern Cape</option>
            <option>Gauteng</option>
            <option>KwaZulu-Natal</option>
            <option>Free State</option>
            <option>Mpumalanga</option>
            <option>Limpopo</option>
            <option>North West</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Primary colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.primaryColor}
                onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <span className="text-slate-600 text-sm font-mono">{form.primaryColor}</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Secondary colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.secondaryColor}
                onChange={e => setForm(f => ({ ...f, secondaryColor: e.target.value }))}
                className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <span className="text-slate-600 text-sm font-mono">{form.secondaryColor}</span>
            </div>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Profile photo URL</label>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
              style={{ backgroundColor: form.primaryColor + '25', border: `2px solid ${form.primaryColor}` }}>
              {form.logoUrl.trim()
                ? <img src={form.logoUrl.trim()} alt="" className="w-full h-full object-cover"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                    onLoad={e => { e.currentTarget.style.display = '' }} />
                : <span className="text-xs font-bold font-mono" style={{ color: form.primaryColor }}>{monogram(form.name)}</span>
              }
            </div>
            <input value={form.logoUrl} onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
              type="url" placeholder="https://…"
              className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Logo or crest. Falls back to the {entityLabel.toLowerCase()}'s initials when empty.</p>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Card / banner image URL</label>
          <input value={form.bannerUrl} onChange={e => setForm(f => ({ ...f, bannerUrl: e.target.value }))}
            type="url" placeholder="https://…"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
          <p className="text-[11px] text-slate-500 mt-1">Displayed as the banner on the listing card. Recommended size: 1200 × 630 px.</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">About</label>
            <span className={`text-[10px] font-mono ${form.bio.length > 140 ? 'text-red-500' : 'text-slate-300'}`}>
              {form.bio.length}/140
            </span>
          </div>
          <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} rows={2} maxLength={140}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
            placeholder="Short description shown on the public profile (max 140 chars)…" />
        </div>
        <Input label="Website" value={form.website} type="url" placeholder="https://…"
          onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />

        {/* Team-level management toggle — gates per-team identity editing and
            team-scoped Owner/Scorer grants. Default off: all teams inherit this
            org's identity and only org-wide roles apply. */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">Team-level management</div>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              When on, individual teams can have their own image, name and bio, and you can
              appoint Team Owners and Team Scorers scoped to a single team. When off, every team
              inherits this {entityLabel.toLowerCase()}'s identity and only org-wide roles apply.
              Previously set team values are kept, just hidden.
            </p>
          </div>
          <button type="button" onClick={() => setTeamMgmt(v => !v)}
            role="switch" aria-checked={teamMgmt}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${teamMgmt ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${teamMgmt ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {isSchool && (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">School gender profile</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SCHOOL_GENDER_PROFILES.map(opt => (
                <button type="button" key={opt.value}
                  onClick={() => setForm(f => ({ ...f, genderProfile: opt.value }))}
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-2 rounded-lg border transition-colors ${
                    form.genderProfile === opt.value
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Co-ed schools choose Boys or Girls per team. Single-gender schools apply it automatically.
            </p>
          </div>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" disabled={saving}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <PlanActivationPanel org={org} onActivated={onSaved} />
    </Section>
  )
}

function PlanActivationPanel({ org, onActivated }) {
  const { tier, canCreate, credits } = orgEntitlementStatus(org)
  const [code,    setCode]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [success, setSuccess] = useState('')
  const [error,   setError]   = useState('')

  async function handleRedeem(e) {
    e.preventDefault()
    if (!code.trim()) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const plan = await redeemEntitlementToken(code.trim(), org.id)
      const label = plan === 'pro' ? 'Pro plan' : 'event credit'
      setSuccess(`${label} activated! Refresh the page to see your updated access.`)
      setCode('')
      onActivated?.({ ...org })
    } catch (err) {
      setError(err.message || 'Redemption failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-slate-100 px-4 py-4 space-y-3">
      {/* Current plan status */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Plan</p>
        {tier === 'none' ? (
          <p className="text-sm text-slate-500">Free plan — competitions are a paid feature.</p>
        ) : tier === 'pro' ? (
          <p className="text-sm font-semibold text-emerald-700">Pro — unlimited competitions</p>
        ) : (
          <p className="text-sm font-semibold text-amber-700">Plus — {credits ?? 0} event credit{credits !== 1 ? 's' : ''} remaining</p>
        )}
      </div>

      {/* Redemption form */}
      <form onSubmit={handleRedeem} className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Activate a plan</p>
        <p className="text-[11px] text-slate-500">Enter the activation code from your invoice email to unlock your purchased plan.</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="MP-2026-XXXX-XXXX"
            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm font-mono placeholder-slate-300 focus:outline-none focus:border-emerald-500 transition-colors uppercase"
          />
          <button type="submit" disabled={saving || !code.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm rounded-lg px-4 py-2 transition-colors shrink-0">
            {saving ? '…' : 'Activate'}
          </button>
        </div>
        {error   && <p className="text-red-600 text-xs">{error}</p>}
        {success && <p className="text-emerald-600 text-xs">{success}</p>}
      </form>
    </div>
  )
}

// ── Quick actions row ─────────────────────────────────────────────────────────

function QuickActions({ teams, org, onFixture, onTeam, onCompetition, canManage }) {
  const disableFixture = org?.type === 'school' && teams.length === 0
  return (
    <div className="flex gap-2 flex-wrap mb-6">
      <button onClick={onFixture}
        disabled={disableFixture}
        title={disableFixture ? 'Add a team first' : undefined}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors shrink-0">
        <Plus className="w-4 h-4" />
        Create fixture
      </button>
      {canManage && (
        <>
          <button onClick={onTeam}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 text-sm font-medium transition-colors shrink-0">
            <Users className="w-4 h-4" />
            Add team
          </button>
          <button onClick={onCompetition}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors shrink-0">
            <Clipboard className="w-4 h-4" />
            Add competition
          </button>
        </>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OrgManage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state: locationState } = useLocation()
  const { uid, isPlatformAdmin, isOrgMember, orgRoles, canDo } = useAuth()

  const [org,             setOrg]             = useState(null)
  const [competitions,    setCompetitions]    = useState([])
  const [teams,           setTeams]           = useState([])
  const [matches,         setMatches]         = useState([])
  const [loading,         setLoading]         = useState(true)
  const [confirmDeleteOrg, setConfirmDeleteOrg] = useState(false)

  // Which section the quick-action buttons should open.
  const [openFixture,     setOpenFixture]     = useState(false)
  const [openTeam,        setOpenTeam]        = useState(false)
  const [openCompetition, setOpenCompetition] = useState(false)

  const fixtureRef     = useRef(null)
  const teamRef        = useRef(null)
  const competitionRef = useRef(null)

  const canAccess = isPlatformAdmin || isOrgMember(id) || locationState?.freshOwner === true

  useEffect(() => {
    if (!canAccess) return
    setLoading(true)
    Promise.all([
      fetchOrganization(id),
      fetchCompetitionsForOrg(id),
      getDocs(query(collection(db, 'teams'), where('organizationId', '==', id))).then(snap =>
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
      ),
    ]).then(async ([orgData, comps, teamList]) => {
      setOrg(orgData)
      setCompetitions(comps)
      // Teams are org assets — competition membership lives in
      // competitions/{id}/teams, never on the team doc itself.
      setTeams(teamList)

      // Fetch by homeOrgId/awayOrgId — covers team-based matches (organizationId set on all teams)
      // and club-as-itself matches (homeTeamId null, homeOrgId = org.id).
      const [homeSnap, awaySnap] = await Promise.all([
        getDocs(query(collection(db, 'matches'), where('homeOrgId', '==', id))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'matches'), where('awayOrgId', '==', id))).catch(() => ({ docs: [] })),
      ])
      const seen = new Set()
      const all = [
        ...homeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        ...awaySnap.docs.map(d => ({ id: d.id, ...d.data() })),
      ].filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
      prefetchMatchTeams(all)
      setMatches(all)
    }).finally(() => setLoading(false))
  }, [id, canAccess])

  function scrollAndOpen(ref, setter) {
    setter(true)
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  if (!canAccess) return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 text-center">
      <div>
        <p className="text-slate-900 font-display font-bold text-lg mb-2">Access denied</p>
        <p className="text-slate-500 text-sm mb-4">You are not a member of this school or club.</p>
        <button onClick={() => navigate('/manage')} className="text-emerald-600 text-sm hover:underline">
          ← Back to Manage
        </button>
      </div>
    </div>
  )

  if (loading || !org) return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const grant          = grantOf(orgRoles?.[id])
  const role           = grant?.role
  const isOrgWideOwner = grant?.role === 'owner' && grant?.teamId == null
  const teamMgmtOn     = org.teamLevelManagement === true
  const canManage      = canDo(id, 'team.manage')
  const color          = org.primaryColor || '#555'
  const entityLabel    = org.type === 'school' ? 'School' : org.type === 'association' ? 'Association' : 'Club'

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-6">
          <button onClick={() => navigate('/manage')}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-5">
            <ChevronLeft className="w-4 h-4" />
            Manage
          </button>

          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: color + '25', border: `2px solid ${color}` }}>
              {org.logoUrl
                ? <img src={org.logoUrl} alt="" className="w-full h-full rounded-2xl object-cover" />
                : <span className="text-sm font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-slate-900 font-display font-bold text-xl leading-tight truncate">{org.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{entityLabel}</span>
                {role && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className={`text-[9px] font-bold uppercase tracking-widest ${isOrgWideOwner ? 'text-emerald-600' : 'text-slate-500'}`}>
                      {grantLabel(orgRoles?.[id])}
                    </span>
                  </>
                )}
                {isPlatformAdmin && !role && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-amber-600">Admin</span>
                  </>
                )}
              </div>
            </div>
            <Link to="/score"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold shrink-0 transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              Score
            </Link>
          </div>

          {org.description && (
            <p className="text-slate-400 text-sm mt-3 leading-relaxed">{org.description}</p>
          )}
        </div>

        {/* Quick actions */}
        <QuickActions
          teams={teams}
          org={org}
          onFixture={() => scrollAndOpen(fixtureRef, setOpenFixture)}
          onTeam={() => scrollAndOpen(teamRef, setOpenTeam)}
          onCompetition={() => scrollAndOpen(competitionRef, setOpenCompetition)}
          canManage={canManage}
        />

        {/* Sections — priority order: Upcoming Fixtures → Recent Results → Teams → Staff → Competitions → Settings */}
        <div className="space-y-4">
          <div ref={fixtureRef}>
            <UpcomingFixturesSection
              orgId={id} org={org}
              competitions={competitions} teams={teams}
              matches={matches} setMatches={setMatches}
              loading={loading} defaultOpen={openFixture}
            />
          </div>
          <RecentResultsSection matches={matches} setMatches={setMatches} loading={loading} />
          <div ref={teamRef}>
            <TeamsSection
              orgId={id} org={org}
              competitions={competitions} teams={teams} setTeams={setTeams}
              defaultOpen={openTeam} canManage={canManage}
            />
          </div>
          <StaffSection orgId={id} org={org} isPlatformAdmin={isPlatformAdmin}
            uid={uid} teams={teams} inviterGrant={grant} teamMgmtOn={teamMgmtOn}
            canAppoint={
              canDo(id, 'admin.appoint')
              || (grant?.teamId && canDo(id, 'admin.appoint', { teamId: grant.teamId, teamMgmtOn }))
            } />
          <div ref={competitionRef}>
            <CompetitionsSection
              orgId={id} org={org} isPlatformAdmin={isPlatformAdmin}
              competitions={competitions} setCompetitions={setCompetitions}
              defaultOpen={openCompetition} canManage={canDo(id, 'competition.manage')}
            />
          </div>
          {(isOrgWideOwner || isPlatformAdmin) && (
            <SettingsSection org={org} onSaved={updated => setOrg(updated)} />
          )}

          {isPlatformAdmin && (
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-red-100">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-red-600">Danger Zone</h2>
              </div>
              <div className="px-4 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Delete this {org.type === 'club' ? 'club' : org.type === 'association' ? 'association' : 'school'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Permanently removes the organisation and all its data. Cannot be undone.</p>
                </div>
                <button onClick={() => setConfirmDeleteOrg(true)}
                  className="shrink-0 px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors">
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmDeleteOrg && org && (
        <DeleteOrgModal
          org={org}
          onCancel={() => setConfirmDeleteOrg(false)}
          onConfirmed={() => navigate('/admin/organizations')}
        />
      )}
    </div>
  )
}
