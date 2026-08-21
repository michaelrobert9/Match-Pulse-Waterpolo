import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, X, Plus, Clipboard, Users, Pencil, UserPlus, Lock } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { roleLabel, grantLabel, grantOf } from '../../lib/capabilities'
import { plansUrl } from '../../lib/mainSite'
import InviteUserForm from '../../components/InviteUserForm'
import ImageUpload from '../../components/ImageUpload'
import { fetchOrganization } from '../../lib/queries'
import {
  updateOrganization, deleteOrganization,
  createCompetition, fetchCompetitionsForOrg, addFixtureToCompetition,
  createTeam, updateTeam, deleteTeam,
  createMatch,
  ensureCreatorOwnership,
  fetchOrgStaff, removeOrgStaff, setOrgStaff,
  propagateTeamNameToMatches,
} from '../../lib/adminQueries'
import { DeleteOrgModal } from '../admin/Organizations'
import { toDate } from '../../lib/queries'
import { userDisplayName, userInitial } from '../../lib/names'
import {
  SCHOOL_GENDER_PROFILES, SCHOOL_GENDER_LABEL, TEAM_GENDERS, DIVISION_TO_GENDER,
  schoolGenderProfile, generatedTeamName, levelLabel, composeTeamDisplay,
} from '../../lib/teamNaming'
import { LevelPicker, chipCls, levelFieldsOf, levelComplete, levelStateOf } from '../../components/LevelPicker'
import { DEFAULT_PERIODS, DEFAULT_PERIOD_MINUTES, DEFAULT_BREAK_MINUTES } from '../../lib/matchClock'
import StatusBadge from '../../components/StatusBadge'
import CompetitionStatusBadge from '../../components/CompetitionStatusBadge'
import OpponentSelector from '../../components/OpponentSelector'
import FormatSelector from '../../components/FormatSelector'
import { MatchTeamIdentity, MatchVersus } from '../../components/TeamIdentity'
import { prefetchMatchTeams } from '../../lib/teamIdentity'
import TeamListCrest from '../../components/TeamListCrest'
import { monogram } from '../../lib/names'
import { orgEntitlementStatus, userEntitlementStatus, bestEntitlement } from '../../lib/entitlement'
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

  if (loading) return <Section id="fixtures" title="Upcoming Matches"><Spinner /></Section>

  const canAddNew = !isSchool || teams.length > 0

  return (
    <Section
      id="fixtures"
      title={`Upcoming Matches (${upcoming.length})`}
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
          <Input label="Venue / pool (optional)" value={form.pitch} placeholder="e.g. Main pool"
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
            {saving ? 'Creating…' : 'Create match'}
          </button>
        </form>
      )}

      {isSchool && teams.length === 0 && (
        <div className="px-4 py-8 text-center">
          <p className="text-slate-500 text-sm">Add a team first, then create matches.</p>
        </div>
      )}
      {canAddNew && upcoming.length === 0 && !showAdd && (
        <div className="px-4 py-8 text-center">
          <p className="text-slate-400 text-sm font-medium mb-1">No upcoming matches</p>
          <p className="text-slate-600 text-xs">Create your first match to start scoring matches.</p>
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
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── Teams section ─────────────────────────────────────────────────────────────

function TeamsSection({ orgId, org, competitions, teams, setTeams, defaultOpen, canManage }) {
  const [showAdd,          setShowAdd]          = useState(false)
  const [editId,           setEditId]           = useState(null)
  const [squadOpenId,      setSquadOpenId]      = useState(null)   // team whose squad panel is open
  const [saving,           setSaving]           = useState(false)
  const [addError,         setAddError]         = useState('')     // surfaced create failure
  const [editSaving,       setEditSaving]       = useState(false)
  const [deleteTarget,     setDeleteTarget]     = useState(null)   // team to delete
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Structured edit state — mirrors the create controls.
  const [editAxis,  setEditAxis]  = useState('')   // school: boys/girls · club/assoc: gender value
  const [editLevel, setEditLevel] = useState(null) // { mode, ordinal, ageGroup, letter }
  const [editTeamName, setEditTeamName] = useState('') // assoc/league per-team name override

  // Team-identity edit state — only editable when team-level management is on.
  // These are display OVERRIDES; when empty the team inherits the org identity.
  const [editName,  setEditName]  = useState('')
  const [editImage, setEditImage] = useState('')
  const [editBio,   setEditBio]   = useState('')
  const teamMgmtOn = org?.teamLevelManagement === true

  // Create state. `axis` is the school gender (co-ed only) or the club/assoc
  // gender; `level` is the shared level-picker state. `newTeamName` is the
  // association/league per-team name ("Durban Panthers").
  const [axis,  setAxis]  = useState('')
  const [level, setLevel] = useState({ mode: 'senior', ordinal: '', ageGroup: '', letter: '' })
  const [newTeamName, setNewTeamName] = useState('')

  useEffect(() => { if (defaultOpen) setShowAdd(true) }, [defaultOpen])

  const isSchool   = org?.type === 'school'
  const orgType    = org?.type || 'club'
  const profile    = schoolGenderProfile(org)            // boys | girls | coed | null (unset)
  const genderUnset = isSchool && profile == null        // block creation until set
  const asksGender = isSchool && profile === 'coed'
  // Single-gender schools apply their gender automatically; co-ed schools pick.
  const effectiveSchoolGender = isSchool
    ? (asksGender ? axis : profile)
    : null

  const isAssoc = orgType === 'association'

  // Gender is a separate stored field for EVERY organisation type — schools
  // take it from the school (co-ed picks per team); clubs and associations
  // select from the shared gender list. Divisions are no longer written.
  const createFields = isSchool
    ? { gender: effectiveSchoolGender || null, ...levelFieldsOf(level) }
    : { gender: axis || null,                  ...levelFieldsOf(level) }
  const previewName = generatedTeamName({ ...createFields, orgGenderProfile: profile })
  // Full-card preview: [team name → org match name → org name] – [label]
  const previewFull = composeTeamDisplay(
    (isAssoc && newTeamName.trim()) || org?.matchName || org?.name, previewName)
  const canAdd = !genderUnset
    && levelComplete(level)
    && (isSchool ? !!effectiveSchoolGender : !!axis)

  function resetCreate() {
    setAxis('')
    setLevel({ mode: 'senior', ordinal: '', ageGroup: '', letter: '' })
    setNewTeamName('')
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!canAdd) return
    const name   = previewName
    const isDupe = teams.some(t =>
      (generatedTeamName({ ...t, orgGenderProfile: profile }) || t.displayName).toLowerCase() === name.toLowerCase()
    )
    if (isDupe) return
    setSaving(true)
    setAddError('')
    try {
      const teamName = isAssoc ? (newTeamName.trim() || null) : null
      const ref = await createTeam(org, name, { ...createFields, teamName })
      setTeams(prev => [...prev, {
        id: ref.id, organizationId: orgId, orgName: org.name,
        displayName: name,
        ...(teamName ? { teamName } : {}),
        gender: createFields.gender ?? null, division: null,
        ageGroup: createFields.ageGroup ?? null, teamLevel: createFields.teamLevel ?? null,
        teamLabel: levelLabel(createFields) || null,
        active: true, primaryColor: org.primaryColor,
        secondaryColor: org.secondaryColor || '#FFFFFF', logoUrl: org.logoUrl || null,
        played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0,
      }])
      setShowAdd(false)
      resetCreate()
    } catch (err) {
      // Never fail silently — a denied write (e.g. Firestore rules) or a
      // network error must tell the user why the team wasn't created.
      const msg = err?.code === 'permission-denied'
        ? "You don't have permission to add a team to this organisation."
        : (err?.message || 'Could not add the team. Please try again.')
      setAddError(msg)
    } finally { setSaving(false) }
  }

  async function toggleActive(team) {
    const next = team.active === false
    await updateTeam(team.id, { active: next })
    setTeams(prev => prev.map(t => t.id === team.id ? { ...t, active: next } : t))
  }

  function startEdit(team) {
    setEditId(team.id)
    // Axis: school → gender (single-gender schools apply the school's gender);
    // club/assoc → gender. A legacy division prefills its mapped gender
    // (men→men, ladies→women, juniorBoys→boys, juniorGirls→girls); masters/
    // open have no gender equivalent, so the admin picks one on save (that
    // save completes the division→gender split for the team).
    const clubAxis = (g) => TEAM_GENDERS.some(o => o.value === g) ? g : (DIVISION_TO_GENDER[g] ?? '')
    setEditAxis(isSchool
      ? (team.gender ?? (asksGender ? '' : (profile ?? '')))
      : clubAxis(team.gender ?? team.division ?? ''))
    setEditTeamName(team.teamName ?? '')
    setEditLevel(levelStateOf(team))
    // Identity overrides — stored values are kept even when the toggle is off
    // (hide-not-clear), so they reappear here when editing with the toggle on.
    setEditName(team.name ?? '')
    setEditImage(team.logoUrl ?? '')
    setEditBio(team.bio ?? '')
  }

  // Effective gender for the edited team, and its structured fields. Saving a
  // club/assoc team writes gender and CLEARS any legacy division — the lazy
  // half of the division→gender split.
  const editGenderEffective = isSchool && !asksGender ? profile : editAxis
  const editFields = isSchool
    ? { gender: editGenderEffective || null, ...levelFieldsOf(editLevel) }
    : { gender: editAxis || null, division: null, ...levelFieldsOf(editLevel) }
  const editPreview = editId
    ? generatedTeamName({ ...editFields, orgGenderProfile: profile })
    : ''
  const canSaveEdit = levelComplete(editLevel)
    && (isSchool ? !!editGenderEffective : !!editAxis)

  async function handleEdit(team) {
    if (!canSaveEdit) return
    const name = generatedTeamName({ ...editFields, orgGenderProfile: profile }) || team.displayName

    const structuralChanged =
      (editFields.gender    ?? null) !== (team.gender    ?? null) ||
      (editFields.division  ?? null) !== (team.division  ?? null) ||
      (editFields.ageGroup  ?? null) !== (team.ageGroup  ?? null) ||
      (editFields.teamLevel ?? null) !== (team.teamLevel ?? null)
    // Assoc/league per-team name — separate from the teamMgmt identity overrides.
    const teamNameNext    = isAssoc ? (editTeamName.trim() || null) : (team.teamName ?? null)
    const teamNameChanged = isAssoc && teamNameNext !== (team.teamName ?? null)

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
    if (!structuralChanged && !identityChanged && !teamNameChanged) { setEditId(null); return }

    setEditSaving(true)
    try {
      // updateTeam recomputes displayName + searchName + structuralKey from the
      // structured fields.
      await updateTeam(team.id, {
        ...(structuralChanged ? { ...editFields, orgGenderProfile: profile } : {}),
        ...(teamNameChanged ? { teamName: teamNameNext } : {}),
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
            ...(structuralChanged ? {
              gender: editFields.gender ?? null, division: editFields.division ?? null,
              ageGroup: editFields.ageGroup ?? null, teamLevel: editFields.teamLevel ?? null,
              teamLabel: levelLabel(editFields) || null,
              displayName: name, searchName: name.toLowerCase(),
            } : {}),
            ...(teamNameChanged ? { teamName: teamNameNext } : {}),
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
        genderUnset ? (
          /* Schools take gender from the school — block team creation until the
             school's gender profile is set (no default, no guessing). */
          <div className="px-4 py-4 border-b border-slate-200">
            <p className="text-sm font-semibold text-slate-900 mb-1">Set the school's gender profile first</p>
            <p className="text-[13px] text-slate-600">
              Teams take their gender from the school, so this must be set before you can add teams.
              Open <span className="font-semibold">Settings</span> and choose Boys only, Girls only or Co-ed.
            </p>
          </div>
        ) : (
        <form onSubmit={handleCreate} className="px-4 py-4 border-b border-slate-200 space-y-3">
          {isSchool ? (
            /* ── School: (gender for co-ed) → level selector ── */
            <div className="space-y-3">
              {asksGender && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[['boys', 'Boys'], ['girls', 'Girls']].map(([val, label]) => (
                      <button type="button" key={val} onClick={() => setAxis(val)} className={chipCls(axis === val)}>
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
                <LevelPicker orgType={orgType} value={level} onChange={setLevel} />
              </div>
            </div>
          ) : (
            /* ── Club / association: (team name for assoc) → gender → level ── */
            <div className="space-y-3">
              {isAssoc && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team name</p>
                  <input type="text" value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    placeholder="e.g. Durban Panthers"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Shown instead of the organisation on match cards. Leave blank to use the organisation name.
                  </p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {TEAM_GENDERS.map(g => (
                    <button type="button" key={g.value} onClick={() => setAxis(g.value)} className={chipCls(axis === g.value)}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              {axis && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team</p>
                  <LevelPicker orgType={orgType} value={level} onChange={setLevel} />
                </div>
              )}
            </div>
          )}

          {previewName && (
            <div className="text-xs text-slate-400">
              Preview: <span className="text-slate-900 font-semibold">{previewFull || previewName}</span>
            </div>
          )}

          {(() => {
            const isDupe = previewName && teams.some(t =>
              (generatedTeamName({ ...t, orgGenderProfile: profile }) || t.displayName).toLowerCase() === previewName.toLowerCase()
            )
            return (
              <>
                {isDupe && (
                  <p className="text-xs text-red-600">A team with this name already exists.</p>
                )}
                {addError && (
                  <p className="text-xs text-red-600">{addError}</p>
                )}
                <button type="submit" disabled={saving || !canAdd || !!isDupe}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
                  {saving ? 'Creating…' : 'Add team'}
                </button>
              </>
            )
          })()}
        </form>
        )
      )}

      {teams.length === 0 && !showAdd && (
        <div className="px-4 py-8 text-center">
          <p className="text-slate-400 text-sm font-medium mb-1">No teams yet</p>
          <p className="text-slate-600 text-xs">Teams are optional — add one to play your own matches, or host a competition below without any.</p>
        </div>
      )}

      <div className="divide-y divide-slate-200">
        {teams.map(team => {
          // Pass the org's gender profile so a single-sex school's teams omit
          // the gender word here too (same rule as every other display), and
          // lead with the per-team name where one is set (assoc/league).
          const teamName = composeTeamDisplay(team.teamName,
            generatedTeamName({ ...team, orgGenderProfile: profile }) || team.displayName)
          return (
          <div key={team.id}>
            <div className={`flex items-center gap-3 px-4 py-3 ${team.active === false ? 'opacity-60' : ''}`}>
              <TeamListCrest team={team} org={org} name={teamName} size={36} />
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
                            <button type="button" key={val} onClick={() => setEditAxis(val)} className={chipCls(editAxis === val)}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team</p>
                      <LevelPicker orgType={orgType} value={editLevel} onChange={setEditLevel} />
                    </div>
                  </>
                ) : (
                  <>
                    {isAssoc && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team name</p>
                        <input type="text" value={editTeamName}
                          onChange={e => setEditTeamName(e.target.value)}
                          placeholder="e.g. Durban Panthers"
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {TEAM_GENDERS.map(g => (
                          <button type="button" key={g.value} onClick={() => setEditAxis(g.value)} className={chipCls(editAxis === g.value)}>
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team</p>
                      <LevelPicker orgType={orgType} value={editLevel} onChange={setEditLevel} />
                    </div>
                  </>
                )}

                {editPreview && (
                  <div className="text-xs text-slate-400">
                    Preview: <span className="text-slate-900 font-semibold">
                      {composeTeamDisplay(
                        (isAssoc && editTeamName.trim()) || org?.matchName || org?.name,
                        editPreview)}
                    </span>
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
            <p className="text-sm font-semibold text-red-800 mb-0.5">Delete "{composeTeamDisplay(deleteTarget.teamName, generatedTeamName({ ...deleteTarget, orgGenderProfile: profile }) || deleteTarget.displayName)}"?</p>
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

function CompetitionsSection({ orgId, org, isPlatformAdmin, userEntitlement, competitions, setCompetitions, defaultOpen, canManage }) {
  // The platform master admin always has full rights — never plan-gated. Everyone
  // else: an org inherits its owner's entitlement, so gate on the ACTING USER's
  // plan (best-of their claim and this org, a fallback that is in practice
  // unpopulated) rather than the org doc — matching the create rules and
  // unlocking an entitled owner's own org. The existing-competition list below is
  // never gated on this; only the create/Manage affordances are.
  const entitlement = isPlatformAdmin
    ? { tier: 'admin', canCreate: true }
    : bestEntitlement([userEntitlementStatus(userEntitlement), orgEntitlementStatus(org)])

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
          <a href={plansUrl({ orgId, ref: 'org-competitions' })} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors">
            See plans
          </a>
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
  const [confirmId,   setConfirmId]   = useState(null)   // member pending remove-confirm (window.confirm is suppressed in installed PWAs)
  const [busyId,      setBusyId]      = useState(null)
  const [staffErr,    setStaffErr]    = useState('')

  const entityLabel  = org?.type === 'school' ? 'school' : org?.type === 'association' ? 'association' : 'club'
  // The inviter's effective role for the invite ceiling. Platform admins invite
  // as master_admin; an org-wide owner as owner; a team-scoped owner can only
  // appoint a Team Scorer for their own team (handled inside InviteUserForm).
  const inviterRole  = isPlatformAdmin ? 'master_admin' : (inviterGrant?.role ?? 'owner')
  const inviterTeamId = inviterGrant?.teamId ?? null

  useEffect(() => {
    fetchOrgStaff(orgId).then(setStaff).catch(() => {}).finally(() => setLoading(false))
  }, [orgId])

  async function doRemove(memberId) {
    setBusyId(memberId); setStaffErr('')
    try {
      await removeOrgStaff(orgId, memberId)
      setStaff(prev => prev.filter(s => s.id !== memberId))
      setConfirmId(null)
    } catch (e) {
      setStaffErr(e.message || 'Could not remove this member.')
    } finally { setBusyId(null) }
  }

  async function changeRole(memberId, role) {
    setBusyId(memberId); setStaffErr('')
    try {
      const member = staff.find(s => s.id === memberId)
      await setOrgStaff(orgId, memberId, role, { teamId: member?.teamId ?? null })
      setStaff(prev => prev.map(s => s.id === memberId ? { ...s, role } : s))
    } catch (e) {
      setStaffErr(e.message || 'Could not change this member’s access.')
    } finally { setBusyId(null) }
  }

  function handleInvited() {
    // Re-fetch staff so any immediate grants show up
    fetchOrgStaff(orgId).then(setStaff).catch(() => {})
    setShowInvite(false)
  }

  const ROLE_STYLE    = { owner: 'text-emerald-600', admin: 'text-violet-600', staff: 'text-blue-500' }
  // Roles the current user may assign to an existing member (owner is never
  // reassignable here — ownership transfer is a separate, master-admin action).
  const assignableRoles = (isPlatformAdmin || canAppoint) ? ['admin', 'staff'] : []
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
          {staffErr && <p className="px-4 py-2 text-red-600 text-xs">{staffErr}</p>}
          {staff.map(s => {
            const editable = (isPlatformAdmin || canAppoint) && s.role !== 'owner'
            return (
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
              {editable && confirmId === s.id ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] text-slate-500">Remove?</span>
                  <button disabled={busyId === s.id} onClick={() => doRemove(s.id)}
                    className="text-[10px] font-bold uppercase tracking-widest text-red-600 hover:text-red-500 disabled:opacity-50 px-1.5 py-1">
                    {busyId === s.id ? '…' : 'Yes'}
                  </button>
                  <button onClick={() => setConfirmId(null)}
                    className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1.5 py-1">No</button>
                </div>
              ) : editable ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Owner edits a member's access level (Admin ↔ Scorer). */}
                  <select value={s.role} disabled={busyId === s.id}
                    onChange={e => changeRole(s.id, e.target.value)}
                    className="text-[11px] border border-slate-200 rounded-lg px-1.5 py-1 bg-white text-slate-700 disabled:opacity-50">
                    {assignableRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                  <button onClick={() => { setStaffErr(''); setConfirmId(s.id) }} title="Remove"
                    className="text-slate-600 hover:text-red-400 transition-colors p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : null}
            </div>
          )})}
        </div>
      )}
    </Section>
  )
}

// ── Settings section ──────────────────────────────────────────────────────────

function SettingsSection({ org, onSaved }) {
  const entityLabel = org.type === 'school' ? 'School' : org.type === 'association' ? 'Association' : 'Club'
  const [bannerUrl, setBannerUrl] = useState(org.bannerUrl ?? '')
  const [teamMgmt, setTeamMgmt]   = useState(org.teamLevelManagement === true)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  // Organisation IDENTITY (name, match name, type, colours, logo, bio, website,
  // gender) is authored centrally on the main site and synced down read-only.
  // Only these sport-local fields are editable here: the card/banner image and
  // the team-level management toggle.
  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const patch = { bannerUrl: bannerUrl.trim() || null, teamLevelManagement: teamMgmt }
      await updateOrganization(org.id, patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      onSaved?.({ ...org, ...patch })
    } catch (err) {
      setError(err.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const genderLabel = SCHOOL_GENDER_PROFILES.find(o => o.value === org.genderProfile)?.label

  return (
    <Section id="settings" title={`${entityLabel} settings`}>
      <div className="px-4 py-4 space-y-4">
        {/* Identity is authored centrally on the main site and read-only here. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex items-center gap-3 mb-2">
            {org.logoUrl
              ? <img src={org.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" />
              : <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
                     style={{ backgroundColor: org.primaryColor || '#555' }}>{monogram(org.name)}</div>}
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">{org.name}</div>
              <div className="text-[11px] text-slate-500">{entityLabel}{org.region ? ` · ${org.region}` : ''}</div>
            </div>
          </div>
          {org.matchName && <ReadRow label="Match name">{org.matchName}</ReadRow>}
          {genderLabel && <ReadRow label="Gender">{genderLabel}</ReadRow>}
          <ReadRow label="Colours">
            <span className="inline-flex items-center gap-1.5 align-middle">
              <span className="w-4 h-4 rounded-full border border-slate-300 inline-block" style={{ backgroundColor: org.primaryColor || '#555' }} />
              <span className="w-4 h-4 rounded-full border border-slate-300 inline-block" style={{ backgroundColor: org.secondaryColor || '#fff' }} />
            </span>
          </ReadRow>
          {org.bio && <ReadRow label="About">{org.bio}</ReadRow>}
          {org.website && <ReadRow label="Website">{org.website}</ReadRow>}
          <a href="https://matchpulse.co.za/organisations" target="_blank" rel="noopener noreferrer"
            className="mt-3 block text-center text-[11px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 border border-emerald-200 rounded-lg py-2 transition-colors">
            Manage profile on MatchPulse →
          </a>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            Name, logo, colours and the rest of this {entityLabel.toLowerCase()}'s profile are managed
            centrally on the main MatchPulse site and appear here automatically.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          {/* Card/banner image is sport-specific and stays editable here. */}
          <ImageUpload
            specKey="orgBanner"
            entityId={org.id}
            value={bannerUrl}
            label="Card / banner image"
            onChange={url => setBannerUrl(url)}
          />

          {/* Team-level management toggle — sport-local; gates per-team identity
              editing and team-scoped Owner/Scorer grants. Default off: all teams
              inherit this org's identity and only org-wide roles apply. */}
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

          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={saving}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>

      <PlanActivationPanel org={org} onActivated={onSaved} />
    </Section>
  )
}

// Read-only label/value row for the centrally-managed identity summary.
function ReadRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0">{label}</span>
      <span className="text-sm text-slate-900 text-right min-w-0 break-words">{children ?? '—'}</span>
    </div>
  )
}

function PlanActivationPanel({ org }) {
  const { tier, canCreate, credits } = orgEntitlementStatus(org)
  const label = tier === 'pro' ? 'Pro' : tier === 'event' ? 'Event' : 'Free'
  // Plans are purchased and activated on the MAIN SITE (platform brief §2/§7a).
  // This app only shows the current plan and links out.
  return (
    <div className="border-t border-slate-100 px-4 py-4 space-y-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Plan</p>
        <p className="text-sm text-slate-900 font-semibold">
          {label}
          {tier === 'event' && <span className="text-slate-400 font-normal"> · {credits} credit{credits === 1 ? '' : 's'} remaining</span>}
        </p>
      </div>
      {!canCreate && (
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Hosting a competition needs a paid plan.
        </p>
      )}
      <a href={plansUrl({ orgId: org.id, ref: 'org-plan-panel' })} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-emerald-600 hover:text-emerald-500 text-sm font-semibold transition-colors">
        Manage plan on MatchPulse →
      </a>
    </div>
  )
}

function QuickActions({ teams, org, onFixture, onTeam, onCompetition, canManage }) {
  const disableFixture = org?.type === 'school' && teams.length === 0
  return (
    <div className="flex gap-2 flex-wrap mb-6">
      <button onClick={onFixture}
        disabled={disableFixture}
        title={disableFixture ? 'Add a team first' : undefined}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors shrink-0">
        <Plus className="w-4 h-4" />
        Create match
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
  const { uid, isPlatformAdmin, isOrgMember, orgRoles, canDo, refreshUserData, userEntitlement } = useAuth()

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
      // Self-heal: if you created this org but aren't registered as a member
      // (interrupted self-create, or data created against another database),
      // write the owner staff doc so team creation is authorised, then refresh
      // the role mirror. Guarded on non-membership because the staff doc is
      // unreadable to a non-member (so we assert rather than check first).
      if (!isPlatformAdmin && !isOrgMember(id) && orgData?.createdBy === uid) {
        ensureCreatorOwnership(id, orgData)
          .then(repaired => { if (repaired) refreshUserData?.() })
          .catch(() => {})
      }
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

        {/* Header — no in-page "Back": the shell's left nav is always present. */}
        <div className="mb-6">
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
              userEntitlement={userEntitlement}
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
          onConfirmed={() => navigate(isPlatformAdmin ? '/admin/organizations' : '/manage')}
        />
      )}
    </div>
  )
}
