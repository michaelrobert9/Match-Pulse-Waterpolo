import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  collection, doc, getDoc, getDocs, query, where, addDoc, deleteDoc,
  serverTimestamp, orderBy,
} from 'firebase/firestore'
import { db, storage } from '../../../firebase'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  ChevronLeft, Plus, X, Trash2, Check, AlertTriangle, ExternalLink,
  Users, Calendar, Layers, Trophy, BarChart2, ClipboardCheck,
  SlidersHorizontal, Info, Search, RefreshCw, CheckCircle2, Clock, Pencil, Loader2, RotateCcw,
} from 'lucide-react'
import {
  updateCompetition, deleteCompetition,
  addFixtureToCompetition, removeFixtureFromCompetition,
  generateRoundRobinFixtures,
  addTeamToCompetition, addNamedTeamToCompetition, removeTeamFromCompetition,
  updateCompetitionMemberName,
  updateScheduleConfig,
  generateUniqueMatchSlug,
  fetchCompetitionStaff, setCompetitionStaff, removeCompetitionStaff,
  recalculateCompetitionStats,
  submitFixtureResult, postponeFixture, cancelFixture,
  revertFixtureOutcome,
} from '../../../lib/adminQueries'
import { userDisplayName, userInitial } from '../../../lib/names'
import { useAuth } from '../../../contexts/AuthContext'
import { matchSlug as buildMatchSlug } from '../../../lib/slugify'
import { fetchCompetitionPools, fetchCompetitionKnockout, fetchCompetitionFixtureMembers, fetchAwaitingResultMatchesForCompetition, fetchCompetitionAuditLog, toDate } from '../../../lib/queries'
import { POINTS_PRESETS, competitionLifecycle } from '../../../lib/competitionRules'
import { isScheduled } from '../../../lib/fixtureStatus'
import StatusBadge from '../../../components/StatusBadge'
import CompetitionStatusBadge from '../../../components/CompetitionStatusBadge'
import CompetitionStructureSection from './CompetitionStructureSection'
import FormatSelector from '../../../components/FormatSelector'
import { DEFAULT_PERIODS, DEFAULT_PERIOD_MINUTES, DEFAULT_BREAK_MINUTES, competitionMatchFormat } from '../../../lib/matchClock'

// ── Constants ──────────────────────────────────────────────────────────────────

const COMP_TYPES = ['league', 'tournament', 'festival']
const GENDERS    = ['men', 'women', 'boys', 'girls']
const AGE_GROUPS = ['senior', 'u21', 'u19', 'u18', 'u17', 'u16', 'u15', 'u14', 'u13', 'u12']
const ORG_TYPES  = [
  { value: 'any',    label: 'Schools & clubs' },
  { value: 'school', label: 'Schools only' },
  { value: 'club',   label: 'Clubs only' },
]
const ENFORCEMENT_MODES = [
  { value: 'disabled', label: 'Disabled', help: 'Eligibility is shown for reference only.' },
  { value: 'warning',  label: 'Warning',  help: 'Mismatched teams can join, with a visible warning.' },
  { value: 'strict',   label: 'Strict',   help: 'Mismatched teams cannot be added.' },
]

const STATUS_HELP = {
  draft:     'Being set up — not ready for teams or fixtures.',
  setup:     'Teams and structure are being configured.',
  ready:     'Configured and waiting to start.',
  active:    'In progress — fixtures being played.',
  completed: 'Finished — results are final.',
  archived:  'Closed and hidden from active lists.',
}

// Workflow tabs per competition type. Only relevant tabs are shown.
function tabsFor(competition) {
  const config    = { id: 'config',    label: 'Configuration',     Icon: SlidersHorizontal }
  const teams     = { id: 'teams',     label: 'Teams',             Icon: Users }
  const structure = { id: 'structure', label: 'Structure',         Icon: Layers }
  const fixtures  = { id: 'fixtures',  label: 'Fixtures',          Icon: Calendar }
  const results   = { id: 'results',   label: 'Results',           Icon: ClipboardCheck }
  const standings = { id: 'standings', label: 'Standings',         Icon: BarChart2 }
  const poolStand = { id: 'standings', label: 'Pools / Standings', Icon: BarChart2 }
  const knockout  = { id: 'knockout',  label: 'Playoffs',          Icon: Trophy }
  const stats     = { id: 'stats',     label: 'Stats',             Icon: BarChart2 }

  switch (competition.type) {
    case 'tournament':
      return [config, teams, structure, fixtures, results, poolStand, knockout]
    case 'festival': {
      const statsEnabled = competition.rules?.statsTable?.enabled ?? competition.festivalStats ?? false
      return [config, teams, fixtures, ...(statsEnabled ? [stats] : [])]
    }
    default:
      return [config, teams, fixtures, results, standings]
  }
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Input({ ...props }) {
  return (
    <input
      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
      {...props}
    />
  )
}

function SelectField({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  )
}

function Card({ title, subtitle, action, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function EditButton({ editing, onClick }) {
  return (
    <button onClick={onClick}
      className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors shrink-0">
      {editing ? 'Cancel' : 'Edit'}
    </button>
  )
}

function SaveRow({ saving, disabled, onSave }) {
  return (
    <button onClick={onSave} disabled={saving || disabled}
      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors mt-3">
      {saving ? 'Saving…' : 'Save'}
    </button>
  )
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex border-b border-slate-200 overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mb-6">
      {tabs.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-3 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
            active === id
              ? 'border-emerald-500 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}>
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Competition staff card ─────────────────────────────────────────────────────
// Lets a competition admin grant direct (org-independent) access to others.

function CompetitionStaffCard({ competition }) {
  const [staff,       setStaff]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [allUsers,    setAllUsers]    = useState([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [removing,    setRemoving]    = useState(null)

  function reload() {
    setLoading(true)
    fetchCompetitionStaff(competition.id)
      .then(setStaff)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [competition.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureUsersLoaded() {
    if (usersLoaded) return
    try {
      const snap = await getDocs(query(collection(db, 'userProfiles'), orderBy('email')))
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setUsersLoaded(true)
    } catch { /* ignore */ }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      await setCompetitionStaff(competition.id, selected.id, 'admin')
      setSelected(null)
      setSearch('')
      reload()
    } catch (err) {
      setError(err.message || 'Could not add user.')
    } finally { setSaving(false) }
  }

  async function handleRemove(memberId) {
    setRemoving(memberId)
    try {
      await removeCompetitionStaff(competition.id, memberId)
      setStaff(prev => prev.filter(s => s.id !== memberId))
    } catch { /* ignore */ }
    finally { setRemoving(null) }
  }

  const staffIds = new Set(staff.map(s => s.id))
  const suggestions = search.trim() && !selected
    ? allUsers
        .filter(u => !staffIds.has(u.id))
        .filter(u => {
          const t = search.toLowerCase()
          return (u.email ?? '').toLowerCase().includes(t)
            || (u.displayName ?? '').toLowerCase().includes(t)
            || (u.name ?? '').toLowerCase().includes(t)
        })
        .slice(0, 8)
    : []

  return (
    <Card
      title="Competition access"
      subtitle="Users who manage this competition directly, independent of any organisation">
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {staff.length > 0 && (
            <div className="space-y-2 mb-4">
              {staff.map(s => (
                <div key={s.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-black text-emerald-700">{userInitial(s)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{userDisplayName(s)}</div>
                    {s.email && <div className="text-[11px] text-slate-400 truncate">{s.email}</div>}
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0">
                    Admin
                  </span>
                  <button onClick={() => handleRemove(s.id)} disabled={removing === s.id}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors p-1 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAdd} className="space-y-2">
            <div className="relative">
              {selected ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                    <span className="text-[8px] font-black text-emerald-700">{userInitial(selected)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-slate-900 truncate">{userDisplayName(selected)}</span>
                    {selected.email && <span className="text-[11px] text-slate-500 ml-1.5">{selected.email}</span>}
                  </div>
                  <button type="button" onClick={() => { setSelected(null); setSearch('') }}
                    className="text-slate-400 hover:text-slate-600 shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setError('') }}
                    onFocus={ensureUsersLoaded}
                    placeholder="Search by name or email…"
                    className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </>
              )}
            </div>

            {suggestions.length > 0 && (
              <div className="border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 shadow-sm max-h-44 overflow-y-auto">
                {suggestions.map(u => (
                  <button key={u.id} type="button" onClick={() => { setSelected(u); setSearch('') }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                      <span className="text-[8px] font-black text-emerald-700">{userInitial(u)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{userDisplayName(u)}</div>
                      {u.email && <div className="text-[10px] text-slate-400 truncate">{u.email}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {error && <p className="text-red-600 text-xs">{error}</p>}

            <button type="submit" disabled={saving || !selected}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
              {saving ? 'Adding…' : 'Grant access'}
            </button>
          </form>
        </>
      )}
    </Card>
  )
}

// ── Configuration tab ──────────────────────────────────────────────────────────
// Everything the organiser needs to understand the competition's rules, in
// plain sporting terms. Each card edits independently.

function ConfigTab({ competition, onSaved, onGoToTab }) {
  return (
    <div className="space-y-4">
      <BasicCard competition={competition} onSaved={onSaved} />
      <ScoringCard competition={competition} onSaved={onSaved} />
      <MatchFormatCard competition={competition} onSaved={onSaved} />
      <TieBreakersCard competition={competition} onSaved={onSaved} />
      <EligibilityCard competition={competition} onSaved={onSaved} />
      <POTMCard competition={competition} onSaved={onSaved} />
      {competition.type === 'festival'   && <FestivalStatsCard competition={competition} onSaved={onSaved} />}
      {competition.type === 'tournament' && <ScheduleConfigCard competition={competition} onSaved={onSaved} />}
      {competition.type === 'tournament' && <TournamentSummaryCard competition={competition} onGoToTab={onGoToTab} />}
      <SettingsTab competition={competition} onSaved={onSaved} />
      <CompetitionStaffCard competition={competition} />
      <HistoryCard competition={competition} />
      <StatsRebuildCard competition={competition} />
      <DangerZone competition={competition} />
    </div>
  )
}

// ── Stats rebuild (competition admin) ────────────────────────────────────────
// Triggers the backend recompute-from-history engine for this competition. Only
// this competition's `players` slices (caps/goals/cards) are rebuilt. Career
// totals on player profiles span all competitions and refresh on the nightly
// run, so they are intentionally not part of this immediate rebuild.

// ── Audit trail (per-competition history) ─────────────────────────────────────
// Human-readable labels for the recorded event types.
const AUDIT_LABELS = {
  fixture_walkover: 'Walkover awarded', fixture_withdrawal: 'Withdrawal recorded',
  fixture_no_show: 'No-show recorded', fixture_not_played: 'Marked not played',
  fixture_abandoned: 'Match abandoned', fixture_let_stand: 'Frozen score let stand',
  fixture_outcome_reverted: 'Outcome reverted',
  result_set: 'Result set', result_edited: 'Result edited', rescheduled: 'Rescheduled',
  postponed: 'Postponed', cancelled: 'Cancelled',
  slot_override_team: 'Playoff slot overridden', slot_override_walkover: 'Playoff walkover',
  slot_override_reverted: 'Playoff override reverted', advancement_locked: 'Advancement locked',
  playoff_fixtures_created: 'Playoff fixtures created', playoff_config_updated: 'Playoff settings changed',
  manual_placement_override: 'Manual pool placement', pool_verified: 'Pool verified',
  pool_unverified: 'Pool unverified', pool_finalized: 'Pool finalized',
}
function auditLabel(t) {
  return AUDIT_LABELS[t] || String(t || 'Action').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}
function auditTime(v) {
  const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null)
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

// Outcome actions that can be safely undone — each has a clean reverse that
// restores the fixture to its exact pre-action state (revertFixtureOutcome).
const UNDOABLE_OUTCOMES = new Set([
  'fixture_walkover', 'fixture_withdrawal', 'fixture_no_show',
  'fixture_not_played', 'fixture_abandoned', 'fixture_let_stand',
])
// Every entry type that reflects a fixture's outcome state (setting actions plus
// the revert itself) — used to decide which entry is the CURRENT one per fixture.
const OUTCOME_RELATED = new Set([...UNDOABLE_OUTCOMES, 'fixture_outcome_reverted'])

// Given entries newest-first, the set of entry ids that may be undone: for each
// fixture, only its most-recent outcome action — and only if it wasn't already
// reverted or superseded. Older/stale outcome entries are not offered.
function undoableEntryIds(entries) {
  const decided = new Set(); const ids = new Set()
  for (const e of entries ?? []) {
    if (!e.matchId || !OUTCOME_RELATED.has(e.eventType)) continue
    if (decided.has(e.matchId)) continue   // a newer outcome entry already governs this fixture
    decided.add(e.matchId)
    if (UNDOABLE_OUTCOMES.has(e.eventType)) ids.add(e.id)
  }
  return ids
}

function HistoryCard({ competition }) {
  const [open, setOpen]       = useState(false)
  const [entries, setEntries] = useState(null)
  const [confirmId, setConfirmId] = useState(null)  // entry awaiting confirmation
  const [undoing, setUndoing]     = useState(false)
  const [undoErr, setUndoErr]     = useState('')

  useEffect(() => {
    if (!open || entries !== null) return
    fetchCompetitionAuditLog(competition.id).then(setEntries).catch(() => setEntries([]))
  }, [open, entries, competition.id])

  const undoable = undoableEntryIds(entries)

  async function confirmUndo(entry) {
    setUndoing(true); setUndoErr('')
    try {
      await revertFixtureOutcome(entry.matchId, { reason: 'Undone from audit trail' })
      setConfirmId(null)
      setEntries(null)   // refetch — the revert adds its own entry and clears undoability
    } catch (e) {
      setUndoErr(e.message || 'Undo failed.')
    } finally { setUndoing(false) }
  }

  return (
    <Card title="Audit trail" subtitle="Every organiser action on this competition — who, when and why"
      action={<button onClick={() => setOpen(o => !o)} className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500">{open ? 'Hide' : 'Show'}</button>}>
      {!open ? (
        <p className="text-sm text-slate-500">Walkovers, abandonments, result edits, reverts and playoff overrides are logged here.</p>
      ) : entries === null ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 text-emerald-500 animate-spin" /></div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">No recorded actions yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-96 overflow-auto -mx-1">
          {entries.map(e => {
            const reason   = e.payload?.reason
            const canUndo  = undoable.has(e.id)
            const awaiting = confirmId === e.id
            return (
              <li key={e.id} className="px-1 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800">{auditLabel(e.eventType)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400 tabular-nums">{auditTime(e.occurredAt)}</span>
                    {canUndo && !awaiting && (
                      <button onClick={() => { setConfirmId(e.id); setUndoErr('') }}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:text-amber-700 border border-amber-200 rounded-md px-2 py-0.5 transition-colors">
                        <RotateCcw className="w-3 h-3" /> Undo
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{e.actorEmail || e.actorId || 'Unknown'}</div>
                {reason && <div className="text-[12px] text-slate-600 mt-1 italic">“{reason}”</div>}

                {awaiting && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <p className="text-[12px] text-amber-800 font-medium">
                      Undo “{auditLabel(e.eventType)}”? This returns the fixture to its pre-outcome state — its previous status and score are restored and the outcome is cleared. The undo is itself recorded in this trail.
                    </p>
                    {undoErr && <p className="text-[11px] text-red-600 mt-1.5">{undoErr}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => confirmUndo(e)} disabled={undoing}
                        className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-1.5">
                        <RotateCcw className="w-3.5 h-3.5" /> {undoing ? 'Undoing…' : 'Confirm undo'}
                      </button>
                      <button onClick={() => { setConfirmId(null); setUndoErr('') }} disabled={undoing}
                        className="text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 px-2 py-1.5">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function StatsRebuildCard({ competition }) {
  const [phase,  setPhase]  = useState('idle') // idle | confirm | running | done | error
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  async function run() {
    setPhase('running')
    try {
      const r = await recalculateCompetitionStats(competition.id)
      setResult(r)
      setPhase('done')
    } catch (e) {
      setErrMsg(e.message || 'Recalculation failed.')
      setPhase('error')
    }
  }

  return (
    <Card title="Recalculate player stats"
      subtitle="Rebuild this competition's stats from its Final fixtures">
      <p className="text-sm text-slate-600 mb-3">
        Rebuilds caps, goals, and cards for every player in this competition from all its Final
        fixtures, on the server. Stats are always derived from match history, so this simply
        re-derives them — safe to run multiple times, with identical results each run.
      </p>
      <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
        This refreshes the competition's own stats immediately. Overall career totals on player
        profiles span every competition and refresh automatically once a day.
      </p>

      {phase === 'idle' && (
        <button onClick={() => setPhase('confirm')}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 rounded-lg px-3 py-2 transition-colors">
          <RefreshCw className="w-4 h-4" /> Recalculate stats
        </button>
      )}

      {phase === 'confirm' && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-700">Recalculate now?</span>
          <button onClick={run}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-3 py-2 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Yes, recalculate
          </button>
          <button onClick={() => setPhase('idle')}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-2 transition-colors">
            Cancel
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Recalculating…
        </div>
      )}

      {phase === 'done' && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
            <Check className="w-4 h-4" />
            Done — {result?.matchCount ?? 0} Final fixtures replayed across {result?.playerCount ?? 0} player
            records.
          </span>
          <button onClick={() => setPhase('idle')} className="text-xs text-slate-400 hover:text-slate-600">
            Reset
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-600">{errMsg}</span>
          <button onClick={() => setPhase('idle')} className="text-xs text-slate-400 hover:text-slate-600">
            Dismiss
          </button>
        </div>
      )}
    </Card>
  )
}

// ── Danger zone (platform-admin only) ───────────────────────────────────────────
// Permanently deletes the competition and every fixture beneath it. Gated to
// master admins both here (renders nothing otherwise) and by Firestore rules.

function DangerZone({ competition }) {
  const { isPlatformAdmin } = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  if (!isPlatformAdmin) return null

  return (
    <>
      <div className="bg-white rounded-2xl border border-red-200 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-red-100 bg-red-50">
          <h3 className="text-sm font-bold text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Danger zone
          </h3>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">Delete this competition</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Permanently removes the competition and all of its fixtures. This cannot be undone.
            </p>
          </div>
          <button onClick={() => setConfirming(true)}
            className="shrink-0 inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded-xl px-4 py-2.5 transition-colors">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </div>
      {confirming && (
        <DeleteCompetitionModal
          competition={competition}
          onCancel={() => setConfirming(false)}
          onConfirmed={() => navigate('/manage/competitions', { replace: true })}
        />
      )}
    </>
  )
}

function DeleteCompetitionModal({ competition, onCancel, onConfirmed }) {
  const [text,  setText]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const canDelete = text === 'DELETE' && !busy

  async function handleConfirm() {
    if (!canDelete) return
    setBusy(true)
    setError('')
    try {
      await deleteCompetition(competition.id)
      onConfirmed()
    } catch {
      setError('Could not delete. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-display font-bold text-slate-900 text-lg mb-1">Delete competition?</h2>
        <p className="text-sm text-slate-600 mb-4">
          You are about to permanently delete <span className="font-bold text-slate-900">{competition.name}</span>.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-[13px] text-red-700 leading-relaxed">
            This deletes the competition and <span className="font-bold">every fixture</span> in it — including all
            scores, events and standings. This cannot be undone.
          </p>
        </div>

        <label className="micro-label block mb-1.5 text-slate-500">
          Type <span className="font-mono text-red-600">DELETE</span> to confirm
        </label>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="DELETE"
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-red-400 transition-colors mb-4"
        />
        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-lg py-3 transition-colors">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!canDelete}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg py-3 transition-colors">
            {busy ? 'Deleting…' : 'Delete competition'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LogoPreview({ url, size = 48 }) {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [url])
  if (!url) return null
  return ok
    ? <img src={url} alt="" onError={() => setOk(false)}
        className="rounded-xl object-contain border border-slate-200"
        style={{ width: size, height: size }} />
    : <div className="rounded-xl bg-slate-100 flex items-center justify-center text-[10px] text-slate-400"
        style={{ width: size, height: size }}>No image</div>
}

function BasicCard({ competition, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [form, setForm] = useState({
    name:      competition.name      ?? '',
    type:      competition.type      ?? 'league',
    season:    competition.season    ?? '',
    logoUrl:   competition.logoUrl   ?? '',
    bannerUrl: competition.bannerUrl ?? '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function uploadImage(file, key, path) {
    if (!file || !storage) return
    setUploading(true)
    setUploadError('')
    try {
      const r = storageRef(storage, path)
      await uploadBytes(r, file)
      const url = await getDownloadURL(r)
      set(key, url)
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }
  function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    uploadImage(file, 'logoUrl', `competition-logos/${competition.id}`)
    e.target.value = ''
  }
  function handleBannerUpload(e) {
    const file = e.target.files?.[0]
    uploadImage(file, 'bannerUrl', `competition-banners/${competition.id}`)
    e.target.value = ''
  }

  async function save() {
    setSaving(true)
    try {
      const patch = {
        name:      form.name.trim(),
        type:      form.type,
        season:    form.season,
        logoUrl:   form.logoUrl.trim() || null,
        bannerUrl: form.bannerUrl.trim() || null,
      }
      await updateCompetition(competition.id, patch)
      onSaved({ ...competition, ...patch })
      setEditing(false)
    } finally { setSaving(false) }
  }

  return (
    <Card title="Competition" action={<EditButton editing={editing} onClick={() => setEditing(e => !e)} />}>
      {!editing ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {competition.bannerUrl && (
            <div className="col-span-2">
              <img src={competition.bannerUrl} alt="" className="w-full h-24 object-cover rounded-xl border border-slate-200" />
            </div>
          )}
          {competition.logoUrl && (
            <div className="col-span-2">
              <LogoPreview url={competition.logoUrl} size={48} />
            </div>
          )}
          <div className="col-span-2">
            <dt className="micro-label">Name</dt>
            <dd className="text-slate-900 font-semibold mt-0.5">{competition.name}</dd>
          </div>
          <div>
            <dt className="micro-label">Type</dt>
            <dd className="text-slate-900 font-medium capitalize mt-0.5">{competition.type}</dd>
          </div>
          <div>
            <dt className="micro-label">Season</dt>
            <dd className="text-slate-900 font-medium mt-0.5">{competition.season || '—'}</dd>
          </div>
          <div>
            <dt className="micro-label">Status</dt>
            <dd className="mt-0.5">
              <CompetitionStatusBadge competition={competition} />
            </dd>
          </div>
          <div>
            <dt className="micro-label">Visibility</dt>
            <dd className="text-slate-900 font-medium mt-0.5">
              {competition.published ? 'Published' : 'Private'}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="micro-label block mb-1.5">Name</label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label block mb-1.5">Type</label>
              <SelectField value={form.type} onChange={v => set('type', v)}
                options={COMP_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
            </div>
            <div>
              <label className="micro-label block mb-1.5">Season</label>
              <Input value={form.season} onChange={e => set('season', e.target.value)} placeholder="2025" />
            </div>
          </div>
          <div>
            <label className="micro-label block mb-1.5">Logo</label>
            <div className="flex items-start gap-3">
              {form.logoUrl.trim()
                ? <LogoPreview url={form.logoUrl.trim()} size={56} />
                : <div className="w-14 h-14 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-400 shrink-0">No logo</div>}
              <div className="flex-1 min-w-0 space-y-2">
                <label className={`inline-flex items-center justify-center gap-1.5 cursor-pointer text-[11px] font-bold uppercase tracking-wider rounded-lg px-3 py-2 transition-colors ${uploading ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                  {uploading ? 'Uploading…' : 'Upload image'}
                  <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={handleLogoUpload} />
                </label>
                <Input
                  value={form.logoUrl}
                  onChange={e => set('logoUrl', e.target.value)}
                  placeholder="…or paste an image URL"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="micro-label block mb-1.5">Card / banner image</label>
            {form.bannerUrl.trim() && (
              <img src={form.bannerUrl.trim()} alt=""
                className="w-full h-28 object-cover rounded-xl border border-slate-200 mb-2" />
            )}
            <div className="flex items-center gap-2">
              <label className={`inline-flex items-center justify-center gap-1.5 cursor-pointer text-[11px] font-bold uppercase tracking-wider rounded-lg px-3 py-2 transition-colors shrink-0 ${uploading ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                {uploading ? 'Uploading…' : 'Upload image'}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={handleBannerUpload} />
              </label>
              <Input
                value={form.bannerUrl}
                onChange={e => set('bannerUrl', e.target.value)}
                placeholder="…or paste a banner image URL"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">Wide image shown on the competition page and cards (≈ 1200×400).</p>
          </div>
          {uploadError && <p className="text-red-600 text-xs">{uploadError}</p>}
          <SaveRow saving={saving || uploading} disabled={!form.name.trim()} onSave={save} />
        </div>
      )}
    </Card>
  )
}

function ScoringCard({ competition, onSaved }) {
  const rules    = competition.rules ?? {}
  const points   = rules.points ?? { win: 3, draw: 1, loss: 0 }
  const walkover = rules.walkoverScore ?? { concedingTeam: 0, opposingTeam: 5 }

  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    win: String(points.win ?? 3), draw: String(points.draw ?? 1), loss: String(points.loss ?? 0),
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const activePreset = POINTS_PRESETS.find(p =>
    String(p.points.win) === form.win && String(p.points.draw) === form.draw && String(p.points.loss) === form.loss)

  async function save() {
    setSaving(true)
    try {
      const newRules = {
        ...rules,
        points: { win: Number(form.win) || 0, draw: Number(form.draw) || 0, loss: Number(form.loss) || 0 },
      }
      await updateCompetition(competition.id, { rules: newRules })
      onSaved({ ...competition, rules: newRules })
      setEditing(false)
    } finally { setSaving(false) }
  }

  return (
    <Card title="Scoring" action={<EditButton editing={editing} onClick={() => setEditing(e => !e)} />}>
      {!editing ? (
        <div className="flex gap-8 mb-4">
          {[['Win', points.win], ['Draw', points.draw], ['Loss', points.loss]].map(([lbl, val]) => (
            <div key={lbl} className="text-center">
              <div className="text-2xl font-black text-slate-900">{val ?? '—'}</div>
              <div className="micro-label mt-0.5">{lbl}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          <div className="flex gap-2 flex-wrap">
            {POINTS_PRESETS.map(p => (
              <button key={p.label} type="button"
                onClick={() => setForm({ win: String(p.points.win), draw: String(p.points.draw), loss: String(p.points.loss) })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  activePreset?.label === p.label
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['Win', 'win'], ['Draw', 'draw'], ['Loss', 'loss']].map(([lbl, key]) => (
              <div key={key}>
                <label className="micro-label block mb-1.5">{lbl}</label>
                <Input type="number" min={0} max={9} value={form[key]} onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>
          <SaveRow saving={saving} onSave={save} />
        </div>
      )}

      {/* Settings that exist in the rules schema but are not yet applied by
          the engine are shown disabled — never as unexplained live settings. */}
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="flex items-start gap-3 opacity-60">
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-700">Bonus points</div>
            <p className="text-[11px] text-slate-400">Extra points for goals scored or margins.</p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">Coming soon</span>
        </div>
        <div className="flex items-start gap-3 opacity-60">
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-700">Walkover result</div>
            <p className="text-[11px] text-slate-400">
              Used when a team forfeits or fails to fulfil a fixture.
              Default scoreline {walkover.opposingTeam}–{walkover.concedingTeam} to the opposing team.
            </p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">Coming soon</span>
        </div>
      </div>
    </Card>
  )
}

function TieBreakersCard({ competition, onSaved }) {
  const rules = competition.rules ?? {}
  const tbs   = rules.tieBreakers ?? []
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [order, setOrder]       = useState(tbs)
  const [confirmed, setConfirmed] = useState(false)

  function startEdit() {
    setOrder(tbs.map(t => ({ ...t })))
    setConfirmed(false)
    setEditing(true)
  }
  function move(i, delta) {
    setOrder(prev => {
      const j = i + delta
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  async function save() {
    setSaving(true)
    try {
      const newRules = { ...rules, tieBreakers: order }
      await updateCompetition(competition.id, { rules: newRules })
      onSaved({ ...competition, rules: newRules })
      setEditing(false)
    } finally { setSaving(false) }
  }

  if (tbs.length === 0) return null

  return (
    <Card title="Tie-breakers"
      subtitle="When teams are level on points these rules are applied in order until the tie is broken"
      action={<EditButton editing={editing} onClick={() => editing ? setEditing(false) : startEdit()} />}>
      {!editing ? (
        <>
          <ol className="space-y-1.5">
            {tbs.map((tb, i) => (
              <li key={tb.key} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-[11px] font-bold text-slate-400 shrink-0">{i + 1}</span>
                <span className="text-slate-700 flex-1">{tb.label}</span>
                <span className="text-[10px] text-slate-400">
                  {tb.direction === 'asc' ? '↑ lowest wins' : tb.direction === 'desc' ? '↓ highest wins' : ''}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-slate-400 mt-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            If every rule is exhausted, a manual administrator decision (with a public reason) is required —
            a winner is never invented.
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Changing the tie-breaker order changes how standings are decided. Already-verified pool
            results keep the rules they were verified under.
          </div>
          <ol className="space-y-1">
            {order.map((tb, i) => (
              <li key={tb.key} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="w-5 text-[11px] font-bold text-slate-400 shrink-0">{i + 1}</span>
                <span className="text-sm text-slate-700 flex-1">{tb.label}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="text-slate-500 hover:text-slate-900 disabled:opacity-30 px-1">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === order.length - 1}
                  className="text-slate-500 hover:text-slate-900 disabled:opacity-30 px-1">↓</button>
              </li>
            ))}
          </ol>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              className="accent-amber-600 w-4 h-4 mt-0.5" />
            <span className="text-[12px] text-slate-600">
              I understand this changes how tied teams are ranked in this competition.
            </span>
          </label>
          <SaveRow saving={saving} disabled={!confirmed} onSave={save} />
        </div>
      )}
    </Card>
  )
}

function EligibilityCard({ competition, onSaved }) {
  const rules = competition.rules ?? {}
  const elig  = rules.eligibility ?? {}
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    gender:      competition.gender   ?? '',
    ageGroup:    competition.ageGroup ?? 'senior',
    orgType:     elig.orgType         ?? 'any',
    teamLevel:   elig.teamLevel       ?? '',
    enforcement: elig.enforcement     ?? 'disabled',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const newRules = {
        ...rules,
        eligibility: { orgType: form.orgType, teamLevel: form.teamLevel.trim(), enforcement: form.enforcement },
      }
      const patch = { gender: form.gender, ageGroup: form.ageGroup, rules: newRules }
      await updateCompetition(competition.id, patch)
      onSaved({ ...competition, ...patch })
      setEditing(false)
    } finally { setSaving(false) }
  }

  const orgLabel  = ORG_TYPES.find(o => o.value === (elig.orgType ?? 'any'))?.label
  const enfMode   = ENFORCEMENT_MODES.find(m => m.value === (elig.enforcement ?? 'disabled'))

  return (
    <Card title="Eligibility" subtitle="Who this competition is for"
      action={<EditButton editing={editing} onClick={() => setEditing(e => !e)} />}>
      {!editing ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="micro-label">Gender</dt>
            <dd className="text-slate-900 font-medium capitalize mt-0.5">{competition.gender || '—'}</dd>
          </div>
          <div>
            <dt className="micro-label">Age group</dt>
            <dd className="text-slate-900 font-medium mt-0.5">{competition.ageGroup || '—'}</dd>
          </div>
          <div>
            <dt className="micro-label">Open to</dt>
            <dd className="text-slate-900 font-medium mt-0.5">{orgLabel}</dd>
          </div>
          <div>
            <dt className="micro-label">Team level</dt>
            <dd className="text-slate-900 font-medium mt-0.5">{elig.teamLevel || 'Any'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="micro-label">Enforcement</dt>
            <dd className="text-slate-900 font-medium mt-0.5">
              {enfMode?.label}
              <span className="text-[11px] text-slate-400 font-normal ml-2">{enfMode?.help}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label block mb-1.5">Gender</label>
              <SelectField value={form.gender} onChange={v => set('gender', v)}
                options={[{ value: '', label: 'Any' }, ...GENDERS.map(g => ({ value: g, label: g.charAt(0).toUpperCase() + g.slice(1) }))]} />
            </div>
            <div>
              <label className="micro-label block mb-1.5">Age group</label>
              <SelectField value={form.ageGroup} onChange={v => set('ageGroup', v)} options={AGE_GROUPS} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label block mb-1.5">Open to</label>
              <SelectField value={form.orgType} onChange={v => set('orgType', v)} options={ORG_TYPES} />
            </div>
            <div>
              <label className="micro-label block mb-1.5">Team level (optional)</label>
              <Input value={form.teamLevel} onChange={e => set('teamLevel', e.target.value)} placeholder="e.g. 1st team" />
            </div>
          </div>
          <div>
            <label className="micro-label block mb-1.5">Enforcement</label>
            <SelectField value={form.enforcement} onChange={v => set('enforcement', v)} options={ENFORCEMENT_MODES} />
            <p className="text-[11px] text-slate-400 mt-1.5">
              {ENFORCEMENT_MODES.find(m => m.value === form.enforcement)?.help}
              {' '}Automatic enforcement is not active yet — eligibility is shown to organisers for reference.
            </p>
          </div>
          <SaveRow saving={saving} onSave={save} />
        </div>
      )}
    </Card>
  )
}

function POTMCard({ competition, onSaved }) {
  const rules   = competition.rules ?? {}
  const enabled = rules.potm?.enabled ?? false
  const [saving, setSaving] = useState(false)

  async function toggle(next) {
    setSaving(true)
    try {
      const newRules = { ...rules, potm: { ...(rules.potm ?? {}), enabled: next } }
      await updateCompetition(competition.id, { rules: newRules })
      onSaved({ ...competition, rules: newRules })
    } finally { setSaving(false) }
  }

  return (
    <Card title="Player of the Match"
      subtitle="Recognise outstanding individual performances">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} disabled={saving}
          onChange={e => toggle(e.target.checked)}
          className="accent-emerald-600 w-4 h-4 mt-0.5" />
        <div>
          <span className="text-sm font-medium text-slate-700">Show Player of the Match stats</span>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Enables the POTM selection screen at the end of each match and displays a leaderboard
            on the competition overview page.
          </p>
        </div>
      </label>
    </Card>
  )
}

function FestivalStatsCard({ competition, onSaved }) {
  const rules = competition.rules ?? {}
  const enabled = rules.statsTable?.enabled ?? competition.festivalStats ?? false
  const [saving, setSaving] = useState(false)

  async function toggle(next) {
    setSaving(true)
    try {
      const newRules = { ...rules, statsTable: { ...(rules.statsTable ?? {}), enabled: next } }
      const patch = { rules: newRules, festivalStats: next }
      await updateCompetition(competition.id, patch)
      onSaved({ ...competition, ...patch })
    } finally { setSaving(false) }
  }

  return (
    <Card title="Festival stats table"
      subtitle="Festivals have no winners or rankings — this is an informational table only">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} disabled={saving}
          onChange={e => toggle(e.target.checked)}
          className="accent-emerald-600 w-4 h-4 mt-0.5" />
        <div>
          <span className="text-sm font-medium text-slate-700">Show informational stats table</span>
          <p className="text-[11px] text-slate-400">
            Played, won, drawn, lost, goals — no positions, no official ranking.
          </p>
        </div>
      </label>
    </Card>
  )
}

// ── Schedule config card ───────────────────────────────────────────────────────
// Tournaments only. Stores the schedule parameters used by the pool fixture
// generator: fields, operating hours, match duration, gaps, allocation mode.

// Default match format for the competition — applied to every new fixture so
// the organiser doesn't re-enter periods/timing each time. Still overridable per
// fixture (e.g. a final played to a different format).
function MatchFormatCard({ competition, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [fmt, setFmt]         = useState(() => competitionMatchFormat(competition))
  const current = competitionMatchFormat(competition)
  const isCustom = !!competition.matchFormat

  async function save() {
    setSaving(true)
    try {
      const matchFormat = {
        periods:       Number(fmt.periods) || DEFAULT_PERIODS,
        periodMinutes: Number(fmt.periodMinutes) || 0,
        breakMinutes:  Array.isArray(fmt.breakMinutes) ? fmt.breakMinutes.map(Number) : DEFAULT_BREAK_MINUTES,
        indoor:        fmt.indoor === true,
      }
      await updateCompetition(competition.id, { matchFormat })
      onSaved({ ...competition, matchFormat })
      setEditing(false)
    } finally { setSaving(false) }
  }

  const summary = `${current.indoor ? 'Indoor' : 'Outdoor'} · ${current.periods} × ${current.periodMinutes} min`
    + (current.breakMinutes?.length ? ` · breaks ${current.breakMinutes.join(' / ')}m` : '')

  return (
    <Card title="Default match format"
      subtitle="Applied to new fixtures — still adjustable per fixture"
      action={<EditButton editing={editing} onClick={() => { setFmt(competitionMatchFormat(competition)); setEditing(e => !e) }} />}>
      {!editing ? (
        <div className="text-sm text-slate-700">
          {summary}
          {!isCustom && <span className="text-[11px] text-slate-400 ml-2">(platform default)</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <FormatSelector
            periods={fmt.periods} periodMinutes={fmt.periodMinutes} breakMinutes={fmt.breakMinutes}
            indoor={fmt.indoor}
            onChange={(v) => setFmt(v)} />
          <SaveRow saving={saving} onSave={save} />
        </div>
      )}
    </Card>
  )
}

function ScheduleConfigCard({ competition, onSaved }) {
  const cfg     = competition.scheduleConfig ?? {}
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [pools,   setPools]   = useState([])

  const defaultFields = cfg.fields ?? [{ id: 'f1', name: 'Field 1' }]
  const [fields,       setFields]       = useState(defaultFields)
  const [startDate,    setStartDate]    = useState(cfg.startDate ?? '')
  const [opStart,      setOpStart]      = useState(cfg.operatingHours?.start ?? '08:00')
  const [opEnd,        setOpEnd]        = useState(cfg.operatingHours?.end   ?? '18:00')
  const [matchDur,     setMatchDur]     = useState(String(cfg.matchDurationMinutes ?? 60))
  const [changeover,   setChangeover]   = useState(String(cfg.changeoverGapMinutes ?? 10))
  const [teamRest,     setTeamRest]     = useState(String(cfg.teamRestGapMinutes ?? 30))
  const [allocMode,    setAllocMode]    = useState(cfg.fieldAllocationMode ?? 'any')
  const [fieldPinning, setFieldPinning] = useState(cfg.fieldPinning ?? {})

  useEffect(() => {
    if (editing) {
      fetchCompetitionPools(competition.id).then(setPools).catch(() => {})
    }
  }, [editing, competition.id])

  function addField() {
    const nextId = `f${Date.now()}`
    setFields(prev => [...prev, { id: nextId, name: `Field ${prev.length + 1}` }])
  }
  function removeField(id) {
    setFields(prev => prev.filter(f => f.id !== id))
    setFieldPinning(prev => {
      const next = { ...prev }
      for (const pid of Object.keys(next)) next[pid] = (next[pid] ?? []).filter(fid => fid !== id)
      return next
    })
  }
  function renameField(id, name) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, name } : f))
  }
  function togglePin(poolId, fieldId) {
    setFieldPinning(prev => {
      const cur = prev[poolId] ?? []
      return { ...prev, [poolId]: cur.includes(fieldId) ? cur.filter(f => f !== fieldId) : [...cur, fieldId] }
    })
  }

  async function save() {
    setSaving(true)
    try {
      const sc = {
        fields,
        startDate: startDate || null,
        operatingHours: { start: opStart, end: opEnd },
        matchDurationMinutes:  Number(matchDur)   || 60,
        changeoverGapMinutes:  Number(changeover) || 10,
        teamRestGapMinutes:    Number(teamRest)   || 30,
        fieldAllocationMode:   allocMode,
        fieldPinning: allocMode === 'pinned' ? fieldPinning : {},
      }
      await updateScheduleConfig(competition.id, sc)
      onSaved({ ...competition, scheduleConfig: sc })
      setEditing(false)
    } finally { setSaving(false) }
  }

  const hasConfig = (cfg.fields?.length > 0) || cfg.startDate

  return (
    <Card title="Schedule" subtitle="Field & timing config for fixture generation"
      action={<EditButton editing={editing} onClick={() => setEditing(e => !e)} />}>
      {!editing ? (
        hasConfig ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2">
              <dt className="micro-label">Fields</dt>
              <dd className="text-slate-900 font-medium mt-0.5">
                {(cfg.fields ?? []).map(f => f.name).join(', ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="micro-label">Start date</dt>
              <dd className="text-slate-900 font-medium mt-0.5">{cfg.startDate || '—'}</dd>
            </div>
            <div>
              <dt className="micro-label">Operating hours</dt>
              <dd className="text-slate-900 font-medium mt-0.5">
                {cfg.operatingHours ? `${cfg.operatingHours.start} – ${cfg.operatingHours.end}` : '—'}
              </dd>
            </div>
            <div>
              <dt className="micro-label">Match duration</dt>
              <dd className="text-slate-900 font-medium mt-0.5">{cfg.matchDurationMinutes ?? '—'} min</dd>
            </div>
            <div>
              <dt className="micro-label">Changeover / team rest</dt>
              <dd className="text-slate-900 font-medium mt-0.5">
                {cfg.changeoverGapMinutes ?? '—'} / {cfg.teamRestGapMinutes ?? '—'} min
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="micro-label">Field allocation</dt>
              <dd className="text-slate-900 font-medium mt-0.5 capitalize">
                {cfg.fieldAllocationMode ?? 'any'}
                {cfg.fieldAllocationMode === 'pinned' && (
                  <span className="text-slate-400 font-normal text-[11px] ml-2">
                    — per-pool pinning configured below
                  </span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">Not configured yet. Click Edit to set up fields and timing.</p>
        )
      ) : (
        <div className="space-y-4">
          {/* Fields */}
          <div>
            <label className="micro-label block mb-1.5">Fields</label>
            <div className="space-y-1.5 mb-2">
              {fields.map(f => (
                <div key={f.id} className="flex items-center gap-2">
                  <Input value={f.name} onChange={e => renameField(f.id, e.target.value)}
                    placeholder="Field name" className="flex-1" />
                  <button type="button" onClick={() => removeField(f.id)} disabled={fields.length <= 1}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addField}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add field
            </button>
          </div>

          {/* Start date */}
          <div>
            <label className="micro-label block mb-1.5">Tournament start date</label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          {/* Operating hours */}
          <div>
            <label className="micro-label block mb-1.5">Operating hours (daily)</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">First start</label>
                <Input type="time" value={opStart} onChange={e => setOpStart(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">Latest end</label>
                <Input type="time" value={opEnd} onChange={e => setOpEnd(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Timing */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="micro-label block mb-1.5">Match duration (min)</label>
              <Input type="number" min={10} max={180} value={matchDur}
                onChange={e => setMatchDur(e.target.value)} />
            </div>
            <div>
              <label className="micro-label block mb-1.5">Changeover gap (min)</label>
              <Input type="number" min={0} max={120} value={changeover}
                onChange={e => setChangeover(e.target.value)} />
            </div>
            <div>
              <label className="micro-label block mb-1.5">Team rest gap (min)</label>
              <Input type="number" min={0} max={240} value={teamRest}
                onChange={e => setTeamRest(e.target.value)} />
            </div>
          </div>

          {/* Field allocation mode */}
          <div>
            <label className="micro-label block mb-1.5">Field allocation</label>
            <div className="flex gap-2">
              {[
                { value: 'any',    label: 'Any field',    desc: 'Fixtures placed on whichever field is free first.' },
                { value: 'pinned', label: 'Pinned',       desc: 'Each pool is restricted to specific assigned fields.' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => setAllocMode(opt.value)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    allocMode === opt.value
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="text-sm font-semibold text-slate-800">{opt.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Per-pool field pinning (pinned mode only) */}
          {allocMode === 'pinned' && pools.length > 0 && (
            <div>
              <label className="micro-label block mb-1.5">Field pinning per pool</label>
              <div className="space-y-2">
                {pools.map(pool => (
                  <div key={pool.poolId} className="flex items-start gap-3">
                    <span className="text-sm text-slate-700 w-20 shrink-0 pt-0.5">{pool.name}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {fields.map(f => {
                        const pinned = (fieldPinning[pool.poolId] ?? []).includes(f.id)
                        return (
                          <button key={f.id} type="button" onClick={() => togglePin(pool.poolId, f.id)}
                            className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
                              pinned ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                            }`}>
                            {f.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {allocMode === 'pinned' && pools.length === 0 && (
            <p className="text-[11px] text-slate-400">
              Create pools in the Structure tab first, then return here to assign fields to each pool.
            </p>
          )}

          <SaveRow saving={saving} disabled={fields.length === 0} onSave={save} />
        </div>
      )}
    </Card>
  )
}

function TournamentSummaryCard({ competition, onGoToTab }) {
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchCompetitionPools(competition.id),
      fetchCompetitionKnockout(competition.id),
    ]).then(([pools, knockout]) => {
      const roundLabels = [...new Set(knockout
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(s => s.roundLabel).filter(Boolean))]
      setSummary({
        poolCount: pools.length,
        slotCounts: pools.map(p => (p.slots ?? []).length),
        rounds: roundLabels,
        knockoutSlots: knockout.length,
      })
    }).catch(() => setSummary({ poolCount: 0, slotCounts: [], rounds: [], knockoutSlots: 0 }))
  }, [competition.id])

  return (
    <Card title="Tournament structure"
      action={
        <button onClick={() => onGoToTab('structure')}
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors shrink-0">
          Configure
        </button>
      }>
      {!summary ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : summary.poolCount === 0 && summary.knockoutSlots === 0 ? (
        <p className="text-sm text-slate-500">
          Not set up yet — use the Structure tab to choose pools, qualifiers and knockout rounds.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="micro-label">Pools</dt>
            <dd className="text-slate-900 font-medium mt-0.5">
              {summary.poolCount > 0
                ? `${summary.poolCount} pool${summary.poolCount !== 1 ? 's' : ''} · ${summary.slotCounts.join(' / ')} teams`
                : 'None'}
            </dd>
          </div>
          <div>
            <dt className="micro-label">Knockout</dt>
            <dd className="text-slate-900 font-medium mt-0.5">
              {summary.rounds.length > 0 ? summary.rounds.join(' → ') : 'None'}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  )
}

// ── Settings / Publish tab ─────────────────────────────────────────────────────

function toDatetimeLocal(val) {
  if (!val) return ''
  try {
    const d = val?.toDate ? val.toDate() : (val instanceof Date ? val : new Date(val))
    if (isNaN(d.getTime())) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '' }
}

function initSettingsForm(competition) {
  return {
    published: competition.published ?? false,
    startDate: toDatetimeLocal(competition.startDate),
    endDate:   toDatetimeLocal(competition.endDate),
  }
}

function SettingsTab({ competition, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [form, setForm] = useState(() => initSettingsForm(competition))
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false) }

  // Resync when the competition prop changes (e.g. after a sibling card saves).
  useEffect(() => {
    setForm(initSettingsForm(competition))
    setSaved(false)
  }, [competition.id, competition.published, competition.startDate, competition.endDate])

  async function save() {
    setSaving(true)
    try {
      const patch = {
        published: form.published,
        startDate: form.startDate || null,
        endDate:   form.endDate   || null,
      }
      await updateCompetition(competition.id, patch)
      onSaved({ ...competition, ...patch })
      setSaved(true)
    } finally { setSaving(false) }
  }

  // Lifecycle is derived from the dates in the form as the admin edits them.
  const lifecycle = competitionLifecycle(form)

  return (
    <div className="space-y-4">
      <Card title="Lifecycle">
        <div className="space-y-3">
          <div>
            <label className="micro-label block mb-1.5">Status</label>
            <div className="flex items-center gap-2">
              <StatusBadge status={lifecycle} />
              <span className="text-[11px] text-slate-400">
                Set automatically from the start and end times below.
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label block mb-1.5">Start date &amp; time</label>
              <Input type="datetime-local" value={form.startDate || ''} onChange={e => set('startDate', e.target.value)} />
            </div>
            <div>
              <label className="micro-label block mb-1.5">End date &amp; time</label>
              <Input type="datetime-local" value={form.endDate || ''} onChange={e => set('endDate', e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Visibility">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.published}
            onChange={e => set('published', e.target.checked)}
            className="accent-emerald-600 w-4 h-4 mt-0.5" />
          <div>
            <span className="text-sm font-medium text-slate-700">Published</span>
            <p className="text-[11px] text-slate-400">
              Published competitions appear on the public site. Private competitions are only
              visible to organisers.
            </p>
          </div>
        </label>
      </Card>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" /> Settings saved.
        </div>
      )}
      <button onClick={save} disabled={saving}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3 transition-colors">
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      <div className="flex justify-center">
        <Link to={`/competitions/${competition.id}`}
          className="text-[11px] text-slate-500 hover:text-emerald-600 transition-colors flex items-center gap-1">
          <ExternalLink className="w-3.5 h-3.5" /> View public competition page
        </Link>
      </div>
    </div>
  )
}

// ── Teams tab ──────────────────────────────────────────────────────────────────

// One participating team. The organiser can edit its name within this
// competition (e.g. fix a typo) — the org prefix stays, only the team label is
// editable. For name-only entrants the whole name is editable.
function CompetitionTeamRow({ team, onRename, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [name, setName]       = useState(team.displayName ?? '')
  const [saving, setSaving]   = useState(false)

  async function save() {
    setSaving(true)
    try { await onRename(team, name); setEditing(false) }
    finally { setSaving(false) }
  }

  const s = team.memberStatus ?? 'admin_approved'
  const cfg = s === 'admin_approved' ? ['text-emerald-700', 'bg-emerald-50', 'Approved']
    : s === 'accepted' ? ['text-emerald-700', 'bg-emerald-50', 'Accepted']
    : s === 'invited'  ? ['text-amber-700',   'bg-amber-50',   'Invited']
    : s === 'declined' ? ['text-slate-500',   'bg-slate-100',  'Declined']
    : ['text-slate-500', 'bg-slate-100', s]

  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold"
        style={{
          backgroundColor: (team.primaryColor || '#64748b') + '20',
          border: `2px solid ${team.primaryColor || '#94a3b8'}`,
          color: team.primaryColor || '#64748b',
        }}>
        {(team.orgName || team.displayName || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5">
            {team.orgName && <span className="text-slate-400 text-sm shrink-0 truncate max-w-[40%]">{team.orgName}</span>}
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-emerald-500" />
            <button onClick={save} disabled={saving || !name.trim()} title="Save"
              className="text-emerald-600 hover:text-emerald-500 disabled:opacity-40 p-1 shrink-0"><Check className="w-4 h-4" /></button>
            <button onClick={() => { setName(team.displayName ?? ''); setEditing(false) }} title="Cancel"
              className="text-slate-400 hover:text-slate-600 p-1 shrink-0"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="text-slate-900 text-sm font-medium truncate">
            {team.orgName ? `${team.orgName} ${team.displayName}` : team.displayName}
          </div>
        )}
      </div>
      {!editing && (
        <>
          <span className={`text-[9px] font-bold uppercase tracking-widest rounded px-1.5 py-0.5 shrink-0 ${cfg[0]} ${cfg[1]}`}>{cfg[2]}</span>
          <button onClick={() => { setName(team.displayName ?? ''); setEditing(true) }} title="Edit name"
            className="text-slate-400 hover:text-slate-700 transition-colors p-1 shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => onRemove(team)} title="Remove"
            className="text-slate-400 hover:text-red-500 transition-colors p-1 shrink-0"><X className="w-4 h-4" /></button>
        </>
      )}
    </div>
  )
}

function TeamsTab({ competition, teams, setTeams }) {
  const [orgs, setOrgs]                     = useState([])
  const [showAdd, setShowAdd]               = useState(false)
  const [mode, setMode]                     = useState('named') // 'named' | 'registered'
  const [selectedOrgId, setSelectedOrgId]   = useState('')
  const [orgTeams, setOrgTeams]             = useState([])
  const [loadingTeams, setLoadingTeams]     = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [namedName, setNamedName]           = useState('')
  const [namedColor, setNamedColor]         = useState('')
  const [namedLinkOrgId, setNamedLinkOrgId] = useState('')
  const [saving, setSaving]                 = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'organizations'), orderBy('name')))
      .then(snap => setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedOrgId) { setOrgTeams([]); setSelectedTeamId(''); return }
    setLoadingTeams(true)
    const existingIds = new Set(teams.map(t => t.id))
    getDocs(query(collection(db, 'teams'), where('organizationId', '==', selectedOrgId)))
      .then(snap => {
        const available = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => !existingIds.has(t.id))
          .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
        setOrgTeams(available)
        setSelectedTeamId(available.length === 1 ? available[0].id : '')
      })
      .catch(() => setOrgTeams([]))
      .finally(() => setLoadingTeams(false))
  }, [selectedOrgId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(e) {
    e.preventDefault()
    if (!selectedOrgId || !selectedTeamId) return
    setSaving(true)
    try {
      const org  = orgs.find(o => o.id === selectedOrgId)
      const team = orgTeams.find(t => t.id === selectedTeamId)
      await addTeamToCompetition(competition.id, team.id, {
        teamId:         team.id,
        organizationId: org.id,
        status:         'admin_approved',
        displaySnapshot: {
          teamName:     team.displayName || org.name,
          orgName:      org.name,
          primaryColor: team.primaryColor || org.primaryColor || null,
        },
      })
      setTeams(prev => [...prev, {
        id: team.id, organizationId: org.id, orgName: org.name,
        displayName: team.displayName || org.name,
        shortCode: team.shortCode || org.shortCode,
        primaryColor: team.primaryColor || org.primaryColor,
        memberStatus: 'admin_approved',
      }])
      setShowAdd(false)
      setSelectedOrgId('')
      setSelectedTeamId('')
      setOrgTeams([])
    } finally { setSaving(false) }
  }

  // Add a participating team by name. The host types the entrant's name; the
  // team needs no account. An optional link to a registered org is participation
  // only — it never makes the team one of that org's own club teams, nor does it
  // grant any control of this competition.
  async function handleAddNamed(e) {
    e.preventDefault()
    const name = namedName.trim()
    if (!name) return
    setSaving(true)
    try {
      const linkedOrg = namedLinkOrgId ? orgs.find(o => o.id === namedLinkOrgId) : null
      const color = namedColor || linkedOrg?.primaryColor || null
      const id = await addNamedTeamToCompetition(competition.id, {
        teamName:       name,
        primaryColor:   color,
        organizationId: linkedOrg?.id   || null,
        orgName:        linkedOrg?.name || null,
      })
      setTeams(prev => [...prev, {
        id,
        displayName:    name,
        orgName:        linkedOrg?.name || null,
        organizationId: linkedOrg?.id   || null,
        primaryColor:   color,
        memberStatus:   'admin_approved',
        claimed:        !!linkedOrg,
      }])
      setShowAdd(false)
      setNamedName('')
      setNamedColor('')
      setNamedLinkOrgId('')
    } finally { setSaving(false) }
  }

  async function handleRemove(team) {
    if (!confirm(`Remove ${team.displayName} from this competition?`)) return
    // Teams are org assets — only remove the competition membership, not the team doc.
    await removeTeamFromCompetition(competition.id, team.id)
    setTeams(prev => prev.filter(t => t.id !== team.id))
  }

  async function handleRename(team, name) {
    const clean = (name ?? '').trim()
    if (!clean || clean === team.displayName) return
    await updateCompetitionMemberName(competition.id, team.id, clean)
    setTeams(prev => prev.map(t => (t.id === team.id ? { ...t, displayName: clean } : t)))
  }

  // Teams are listed alphabetically by their full (org + team) label.
  const sortedTeams = [...teams].sort((a, b) => {
    const la = (a.orgName ? `${a.orgName} ${a.displayName}` : a.displayName ?? '').toLowerCase()
    const lb = (b.orgName ? `${b.orgName} ${b.displayName}` : b.displayName ?? '').toLowerCase()
    return la.localeCompare(lb)
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {teams.length} team{teams.length !== 1 ? 's' : ''} in this competition
        </p>
        <button onClick={() => setShowAdd(v => !v)}
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
            showAdd
              ? 'bg-slate-700 text-white border-slate-700'
              : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
          }`}>
          {showAdd ? 'Cancel' : <><Plus className="w-3.5 h-3.5" /> Add team</>}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          {/* Mode toggle: type a name (default), or pick a registered team. */}
          <div className="flex gap-1.5">
            {[['named', 'By name'], ['registered', 'Registered team']].map(([id, lbl]) => (
              <button key={id} type="button" onClick={() => setMode(id)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  mode === id ? 'bg-slate-700 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-700'
                }`}>
                {lbl}
              </button>
            ))}
          </div>

          {mode === 'named' ? (
            <form onSubmit={handleAddNamed} className="space-y-3">
              <p className="text-[11px] text-slate-400">
                Type the entrant’s name — no account required. Optionally link it to a registered
                school or club; linking is for reference only and gives that org no control here.
              </p>
              <div>
                <label className="micro-label block mb-1.5">Team name</label>
                <Input value={namedName} onChange={e => setNamedName(e.target.value)}
                  placeholder="e.g. Crusaders 1st XI" required />
              </div>
              <div className="grid grid-cols-[auto,1fr] gap-3 items-end">
                <div>
                  <label className="micro-label block mb-1.5">Colour</label>
                  <input type="color" value={namedColor || '#64748b'} onChange={e => setNamedColor(e.target.value)}
                    className="w-12 h-10 rounded-lg border border-slate-200 bg-white p-0.5 cursor-pointer" />
                </div>
                <div>
                  <label className="micro-label block mb-1.5">Link to a registered org (optional)</label>
                  <select value={namedLinkOrgId} onChange={e => setNamedLinkOrgId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
                    <option value="">Unclaimed — no link</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={saving || !namedName.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
                {saving ? 'Adding…' : 'Add team'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="micro-label block mb-1.5">School / club</label>
                <select value={selectedOrgId} onChange={e => setSelectedOrgId(e.target.value)} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
                  <option value="">Select school or club…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              {selectedOrgId && (
                loadingTeams ? (
                  <p className="text-sm text-slate-400 py-1">Loading teams…</p>
                ) : orgTeams.length === 0 ? (
                  <p className="text-sm text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    No teams found for this organisation. Add it by name instead, or create the team
                    via the organisation profile.
                  </p>
                ) : (
                  <div>
                    <label className="micro-label block mb-1.5">Team</label>
                    <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} required
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
                      <option value="">Select team…</option>
                      {orgTeams.map(t => <option key={t.id} value={t.id}>{t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName}</option>)}
                    </select>
                  </div>
                )
              )}
              <button type="submit" disabled={saving || !selectedOrgId || !selectedTeamId}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
                {saving ? 'Adding…' : 'Add team'}
              </button>
            </form>
          )}
        </div>
      )}

      {teams.length === 0 && !showAdd ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-10 text-center">
          <p className="text-slate-500 text-sm">No teams added yet.</p>
          <p className="text-slate-400 text-xs mt-1">Add entrants by name — they don’t need an account.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedTeams.map(team => (
            <CompetitionTeamRow key={team.id} team={team} onRename={handleRename} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Fixtures tab ───────────────────────────────────────────────────────────────

function formatFixtureDate(ts) {
  if (!ts) return 'Date TBD'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function FixtureRow({ fx, onDelete, resolveName }) {
  const homeName = resolveName
    ? resolveName(fx.homeTeamId, fx.homeOrgName, fx.homeTeamName)
    : (fx.homeOrgName ? `${fx.homeOrgName} ${fx.homeTeamName}` : (fx.homeTeamName ?? ''))
  const awayName = resolveName
    ? resolveName(fx.awayTeamId, fx.awayOrgName, fx.awayTeamName)
    : (fx.awayOrgName ? `${fx.awayOrgName} ${fx.awayTeamName}` : (fx.awayTeamName ?? ''))
  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 hover:border-slate-300 transition-colors">
      {/* The row opens the score card (/score/:id) where admins edit the result. */}
      <Link to={`/score/${fx.id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-900 text-sm font-medium truncate group-hover:text-emerald-700">{homeName}</span>
            <span className="font-mono text-slate-500 text-xs shrink-0">
              {!isScheduled(fx) ? `${fx.homeScore ?? 0}–${fx.awayScore ?? 0}` : 'vs'}
            </span>
            <span className="text-slate-900 text-sm font-medium text-right truncate group-hover:text-emerald-700">{awayName}</span>
          </div>
          <div className="micro-label mt-0.5">{formatFixtureDate(fx.scheduledAt)}</div>
        </div>
        <StatusBadge status={fx.status} className="shrink-0" />
      </Link>
      {onDelete && (
        <button onClick={() => onDelete(fx.id)}
          className="text-slate-400 hover:text-red-500 transition-colors p-1 shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function FixturesTab({ competition, teams, fixtures, setFixtures }) {
  const type = competition.type
  const [pools, setPools]         = useState([])
  const [fxMembers, setFxMembers] = useState([])
  const [filter, setFilter]       = useState(type === 'league' ? 'upcoming' : 'all')
  const [showNew, setShowNew]     = useState(false)
  const [showGen, setShowGen]     = useState(false)
  const [genPoolId, setGenPoolId] = useState('')
  const [genDbl, setGenDbl]       = useState(false)
  // New fixtures default to the competition's configured match format (falling
  // back to the platform default). Per-fixture overrides remain available below.
  const defaultFmt = competitionMatchFormat(competition)
  const [genFmt, setGenFmt]       = useState(defaultFmt)
  const [genBusy, setGenBusy]     = useState(false)
  const [genDone, setGenDone]     = useState(null)
  const [saving, setSaving]       = useState(false)
  const [newForm, setNewForm]     = useState({
    homeTeamId: '', awayTeamId: '', scheduledAt: '', pitch: '',
    periods: defaultFmt.periods, periodMinutes: defaultFmt.periodMinutes,
    breakMinutes: defaultFmt.breakMinutes, indoor: defaultFmt.indoor,
  })

  useEffect(() => {
    if (type !== 'tournament') return
    Promise.all([
      fetchCompetitionPools(competition.id),
      fetchCompetitionFixtureMembers(competition.id),
    ]).then(([p, fm]) => { setPools(p); setFxMembers(fm) }).catch(() => {})
  }, [competition.id, type, fixtures.length])

  const setNew = (k, v) => setNewForm(f => ({ ...f, [k]: v }))

  // Only accepted/admin_approved teams can be used in fixtures — listed
  // alphabetically by their full (org + team) label.
  const activeTeams = teams
    .filter(t => {
      const s = t.memberStatus ?? 'admin_approved'
      return s === 'accepted' || s === 'admin_approved'
    })
    .sort((a, b) => {
      const la = (a.orgName ? `${a.orgName} ${a.displayName}` : a.displayName ?? '').toLowerCase()
      const lb = (b.orgName ? `${b.orgName} ${b.displayName}` : b.displayName ?? '').toLowerCase()
      return la.localeCompare(lb)
    })

  const canGenerateLeague     = type === 'league' && activeTeams.length >= 2
  const canGenerateTournament = type === 'tournament' && pools.some(p => (p.slots ?? []).filter(s => s.teamId).length >= 2)

  const poolTeams = (() => {
    if (type !== 'tournament' || !genPoolId) return []
    const pool = pools.find(p => p.poolId === genPoolId)
    if (!pool) return []
    return (pool.slots ?? [])
      .map(s => activeTeams.find(t => t.id === s.teamId))
      .filter(Boolean)
  })()

  const genTeamCount = type === 'tournament' ? poolTeams.length : activeTeams.length
  const pairCount = genDbl
    ? genTeamCount * (genTeamCount - 1)
    : Math.floor(genTeamCount * (genTeamCount - 1) / 2)

  async function handleCreateFixture(e) {
    e.preventDefault()
    if (!newForm.homeTeamId || !newForm.awayTeamId || newForm.homeTeamId === newForm.awayTeamId) return
    setSaving(true)
    try {
      const home        = teams.find(t => t.id === newForm.homeTeamId)
      const away        = teams.find(t => t.id === newForm.awayTeamId)
      const scheduledAt = newForm.scheduledAt ? new Date(newForm.scheduledAt) : null
      const seasonStr   = competition.season ? String(competition.season) : null
      const baseSlug    = buildMatchSlug(home.displayName, away.displayName)
      const matchSlug   = seasonStr
        ? await generateUniqueMatchSlug(seasonStr, baseSlug)
        : baseSlug
      const compSlug    = competition.slug || null
      const ref = await addDoc(collection(db, 'matches'), {
        competitionId: competition.id,
        ownerOrgId: competition.ownerOrgId || null,
        homeTeamId: home.id, homeTeamName: home.displayName,
        homeTeamShortCode: home.shortCode || null, homeTeamColor: home.primaryColor || null,
        homeOrgId: home.organizationId ?? null, homeOrgName: home.orgName || null, homeRegistered: !!home.organizationId,
        awayTeamId: away.id, awayTeamName: away.displayName,
        awayTeamShortCode: away.shortCode || null, awayTeamColor: away.primaryColor || null,
        awayOrgId: away.organizationId ?? null, awayOrgName: away.orgName || null, awayRegistered: !!away.organizationId,
        homeScore: 0, awayScore: 0,
        periods: Number(newForm.periods), periodMinutes: Number(newForm.periodMinutes),
        breakMinutes: Array.isArray(newForm.breakMinutes) ? newForm.breakMinutes : DEFAULT_BREAK_MINUTES,
        goals: [], cards: [], controlLog: [],
        startedAt: null, pausedAt: null, totalPausedMs: 0, nextPeriodIndex: 1,
        scheduledAt, pitch: newForm.pitch || '', indoor: !!newForm.indoor, status: 'scheduled', tracked: false,
        matchSlug,
        ...(seasonStr ? { season: seasonStr } : {}),
        ...(compSlug && seasonStr ? { competitionSlug: compSlug, competitionSeason: seasonStr } : {}),
        createdAt: serverTimestamp(),
      })
      await addFixtureToCompetition(competition.id,
        { id: ref.id, homeTeamId: home.id, awayTeamId: away.id },
        { countsTowardStandings: type !== 'festival' }
      )
      setFixtures(prev => [...prev, {
        id: ref.id, homeTeamName: home.displayName, awayTeamName: away.displayName,
        homeTeamId: home.id, awayTeamId: away.id,
        scheduledAt, status: 'scheduled', tracked: false, homeScore: 0, awayScore: 0,
      }])
      setShowNew(false)
      setNewForm({ homeTeamId: '', awayTeamId: '', scheduledAt: '', pitch: '', periods: defaultFmt.periods, periodMinutes: defaultFmt.periodMinutes, breakMinutes: defaultFmt.breakMinutes, indoor: defaultFmt.indoor })
    } finally { setSaving(false) }
  }

  async function handleGenerate() {
    setGenBusy(true); setGenDone(null)
    try {
      const genTeams = type === 'tournament' ? poolTeams : activeTeams
      const ids = await generateRoundRobinFixtures(competition.id, genTeams, {
        doubleRoundRobin: genDbl,
        season:           competition.season,
        periods:          genFmt.periods,
        periodMinutes:    genFmt.periodMinutes,
        breakMinutes:     genFmt.breakMinutes ?? DEFAULT_BREAK_MINUTES,
        indoor:           genFmt.indoor === true,
        ownerOrgId:       competition.ownerOrgId || null,
        competitionSlug:  competition.slug || null,
        ...(type === 'tournament' && genPoolId ? { poolId: genPoolId } : {}),
      })
      const snap = await getDocs(query(collection(db, 'matches'), where('competitionId', '==', competition.id)))
      setFixtures(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.scheduledAt?.toMillis?.() ?? 0) - (b.scheduledAt?.toMillis?.() ?? 0))
      )
      setGenDone(ids.length)
      setShowGen(false)
    } finally { setGenBusy(false) }
  }

  async function handleDelete(fixtureId) {
    if (!confirm('Delete this fixture?')) return
    await deleteDoc(doc(db, 'matches', fixtureId))
    removeFixtureFromCompetition(competition.id, fixtureId).catch(() => {})
    setFixtures(prev => prev.filter(f => f.id !== fixtureId))
  }

  function resolveTeamName(teamId, orgName, teamName) {
    if (orgName) return `${orgName} ${teamName}`
    const team = teams.find(t => t.id === teamId)
    return team?.orgName ? `${team.orgName} ${teamName}` : (teamName ?? '')
  }

  // ── Grouping per competition type ──
  let groups
  if (type === 'tournament') {
    const poolOfMatch = {}
    for (const f of fxMembers) if (f.poolId) poolOfMatch[f.matchId] = f.poolId
    groups = pools.map(p => ({
      label: p.name,
      items: fixtures.filter(fx => poolOfMatch[fx.id] === p.poolId),
    })).filter(g => g.items.length > 0)
    const grouped = new Set(groups.flatMap(g => g.items.map(i => i.id)))
    const rest = fixtures.filter(fx => !grouped.has(fx.id))
    if (rest.length > 0) groups.push({ label: 'Knockout & ungrouped fixtures', items: rest })
  } else if (type === 'festival') {
    const items = filter === 'results' ? fixtures.filter(f => !isScheduled(f)) : fixtures
    groups = [{ label: null, items }]
  } else {
    const items = filter === 'upcoming' ? fixtures.filter(isScheduled)
      : filter === 'results' ? fixtures.filter(f => !isScheduled(f))
      : fixtures
    groups = [{ label: null, items }]
  }

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {type === 'league' && (
          <div className="flex gap-1.5">
            {[['upcoming', 'Upcoming'], ['results', 'Results'], ['all', 'All']].map(([id, lbl]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  filter === id ? 'bg-slate-700 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-700'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
        )}
        {type === 'festival' && (
          <div className="flex gap-1.5">
            {[['all', 'Fixture wall'], ['results', 'Results']].map(([id, lbl]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  filter === id ? 'bg-slate-700 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-700'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
        )}
        {type === 'tournament' && (
          <p className="text-sm text-slate-500">{fixtures.length} fixture{fixtures.length !== 1 ? 's' : ''}</p>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {(canGenerateLeague || canGenerateTournament) && (
            <button onClick={() => { setShowGen(v => !v); setShowNew(false) }}
              className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
                showGen
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
              }`}>
              Generate fixtures
            </button>
          )}
          <button onClick={() => { setShowNew(v => !v); setShowGen(false) }}
            className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-colors ${
              showNew
                ? 'bg-slate-700 text-white border-slate-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {showNew ? 'Cancel' : <><Plus className="w-3.5 h-3.5" /> New fixture</>}
          </button>
        </div>
      </div>

      {genDone !== null && !showGen && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" /> {genDone} fixture{genDone !== 1 ? 's' : ''} generated
        </div>
      )}

      {/* Generation panel */}
      {showGen && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <p className="text-sm font-bold text-slate-700">
            {type === 'tournament' ? 'Generate pool round-robin fixtures' : 'Generate round-robin fixtures'}
          </p>

          {type === 'tournament' && (
            <div>
              <label className="micro-label block mb-1.5">Pool</label>
              <select value={genPoolId} onChange={e => setGenPoolId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">Select pool…</option>
                {pools.map(p => {
                  const assigned = (p.slots ?? []).filter(s => s.teamId).length
                  return <option key={p.poolId} value={p.poolId}>{p.name} ({assigned} team{assigned !== 1 ? 's' : ''} assigned)</option>
                })}
              </select>
              {genPoolId && poolTeams.length < 2 && (
                <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Assign at least 2 teams to this pool first (Structure tab).
                </p>
              )}
              {genPoolId && poolTeams.length >= 2 && (
                <p className="text-xs text-emerald-700 mt-1.5">
                  {poolTeams.length} teams → {pairCount} fixture{pairCount !== 1 ? 's' : ''}, linked to this pool and counting toward its standings
                </p>
              )}
            </div>
          )}

          {type === 'league' && (
            <>
              <p className="text-xs text-slate-500">
                {activeTeams.length} teams · {pairCount} fixture{pairCount !== 1 ? 's' : ''} will be created unscheduled
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={genDbl} onChange={e => setGenDbl(e.target.checked)}
                  className="accent-emerald-600 w-4 h-4" />
                <span className="text-sm text-slate-700">Home &amp; away (double round-robin)</span>
              </label>
            </>
          )}

          <div>
            <p className="micro-label mb-1.5">Match format</p>
            <FormatSelector
              periods={genFmt.periods}
              periodMinutes={genFmt.periodMinutes}
              breakMinutes={genFmt.breakMinutes}
              indoor={genFmt.indoor}
              onChange={({ periods, periodMinutes, breakMinutes, indoor }) =>
                setGenFmt({ periods, periodMinutes, breakMinutes, indoor })
              }
            />
          </div>

          <div className="flex gap-3">
            <button onClick={handleGenerate}
              disabled={
                genBusy ||
                (type === 'tournament' && (!genPoolId || poolTeams.length < 2)) ||
                (type === 'league' && teams.length < 2)
              }
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
              {genBusy ? 'Generating…' : `Generate ${pairCount || 0} fixture${pairCount !== 1 ? 's' : ''}`}
            </button>
            <button onClick={() => setShowGen(false)}
              className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Manual fixture form */}
      {showNew && (
        <form onSubmit={handleCreateFixture}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          {activeTeams.length < 2 && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Add at least 2 accepted teams first (Teams tab).
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label block mb-1.5">Home team</label>
              <select value={newForm.homeTeamId} onChange={e => setNew('homeTeamId', e.target.value)} required
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">Home…</option>
                {activeTeams.map(t => <option key={t.id} value={t.id}>{t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName}</option>)}
              </select>
            </div>
            <div>
              <label className="micro-label block mb-1.5">Away team</label>
              <select value={newForm.awayTeamId} onChange={e => setNew('awayTeamId', e.target.value)} required
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">Away…</option>
                {activeTeams.filter(t => t.id !== newForm.homeTeamId).map(t => (
                  <option key={t.id} value={t.id}>{t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="micro-label block mb-1.5">Date &amp; time</label>
            <Input type="datetime-local" value={newForm.scheduledAt}
              onChange={e => setNew('scheduledAt', e.target.value)} />
          </div>
          <div>
            <label className="micro-label block mb-1.5">Match format</label>
            <FormatSelector
              periods={newForm.periods}
              periodMinutes={newForm.periodMinutes}
              breakMinutes={newForm.breakMinutes}
              indoor={newForm.indoor}
              onChange={({ periods, periodMinutes, breakMinutes, indoor }) =>
                setNewForm(f => ({ ...f, periods, periodMinutes, breakMinutes, indoor }))
              }
            />
          </div>
          <div>
            <label className="micro-label block mb-1.5">Venue (optional)</label>
            <Input value={newForm.pitch} onChange={e => setNew('pitch', e.target.value)} placeholder="Field 1" />
          </div>
          <button type="submit"
            disabled={saving || !newForm.homeTeamId || !newForm.awayTeamId || newForm.homeTeamId === newForm.awayTeamId}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
            {saving ? 'Creating…' : 'Create fixture'}
          </button>
        </form>
      )}

      {/* Fixture lists, grouped per competition type */}
      {fixtures.length === 0 && !showNew && !showGen ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-10 text-center">
          <p className="text-slate-500 text-sm">No fixtures yet.</p>
          <p className="text-slate-400 text-xs mt-1">
            {type === 'festival'
              ? 'Use New fixture to add fixtures manually — festivals have no generated schedule.'
              : type === 'tournament'
              ? 'Assign teams to pools in the Structure tab, then generate each pool’s fixtures here.'
              : 'Use Generate fixtures to create the full round-robin, or New fixture for one.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) => (
            <div key={g.label ?? gi}>
              {g.label && (
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">{g.label}</p>
              )}
              {g.items.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">Nothing here.</p>
              ) : (
                <div className="space-y-2">
                  {g.items.map(fx => <FixtureRow key={fx.id} fx={fx} onDelete={handleDelete} resolveName={resolveTeamName} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Awaiting-result confirmation (competition-scoped) ─────────────────────────

function fmtWhen(val) {
  const d = toDate(val)
  return d
    ? d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Date TBD'
}

function AwaitingResultRow({ match, onResolved }) {
  const tracked = match.tracked === true
  const [home, setHome] = useState(tracked ? String(match.homeScore ?? 0) : '')
  const [away, setAway] = useState(tracked ? String(match.awayScore ?? 0) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const homeLabel = match.homeOrgName
    ? `${match.homeOrgName} ${match.homeTeamName}` : match.homeTeamName || 'Home'
  const awayLabel = match.awayOrgName
    ? `${match.awayOrgName} ${match.awayTeamName}` : match.awayTeamName || 'Away'

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); onResolved(match.id) }
    catch (e) { setError(e.message || 'Action failed.'); setBusy(false) }
  }

  function confirm() {
    if (home === '' || away === '') { setError('Enter a score for both teams.'); return }
    run(() => submitFixtureResult(match.id, {
      homeScore: Number(home), awayScore: Number(away), method: 'admin_approved',
    }))
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
          tracked ? 'bg-sky-50 border-sky-200 text-sky-600' : 'bg-amber-50 border-amber-200 text-amber-600'
        }`}>
          {tracked ? <Clock className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {tracked ? 'Provisional live score' : 'No live data — enter result'}
        </span>
        <span className="text-[11px] text-slate-400">{fmtWhen(match.scheduledAt)}</span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="flex-1 text-sm font-semibold text-slate-900 truncate text-right">{homeLabel}</span>
        <input type="number" min="0" inputMode="numeric" value={home} onChange={e => setHome(e.target.value)}
          className="w-12 text-center font-mono font-black text-lg bg-slate-50 border border-slate-200 rounded-lg py-1 focus:outline-none focus:border-emerald-500" />
        <span className="text-slate-300 text-xs">–</span>
        <input type="number" min="0" inputMode="numeric" value={away} onChange={e => setAway(e.target.value)}
          className="w-12 text-center font-mono font-black text-lg bg-slate-50 border border-slate-200 rounded-lg py-1 focus:outline-none focus:border-emerald-500" />
        <span className="flex-1 text-sm font-semibold text-slate-900 truncate">{awayLabel}</span>
      </div>

      {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={confirm} disabled={busy}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-3 py-2 transition-colors">
          <CheckCircle2 className="w-4 h-4" /> Confirm result
        </button>
        <button onClick={() => run(() => postponeFixture(match.id))} disabled={busy}
          className="text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 px-2 py-2 transition-colors">
          Postpone
        </button>
        <button onClick={() => { if (window.confirm('Cancel this fixture? It will never count.')) run(() => cancelFixture(match.id)) }} disabled={busy}
          className="text-xs font-bold uppercase tracking-wider text-red-500 hover:text-red-700 px-2 py-2 transition-colors ml-auto">
          Cancel
        </button>
      </div>
    </div>
  )
}

function AwaitingResultSection({ competition }) {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAwaitingResultMatchesForCompetition(competition.id)
      .then(setMatches).catch(() => {}).finally(() => setLoading(false))
  }, [competition.id])

  function handleResolved(id) {
    setMatches(prev => prev.filter(m => m.id !== id))
  }

  if (loading) return (
    <div className="flex justify-center py-6">
      <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (matches.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
          Awaiting confirmation · {matches.length}
        </p>
      </div>
      {matches.map(m => (
        <AwaitingResultRow key={m.id} match={m} onResolved={handleResolved} />
      ))}
    </div>
  )
}

// ── Results tab ────────────────────────────────────────────────────────────────

function ResultsTab({ competition, fixtures }) {
  const played = fixtures
    .filter(f => !isScheduled(f))
    .sort((a, b) => (b.scheduledAt?.toMillis?.() ?? 0) - (a.scheduledAt?.toMillis?.() ?? 0))
  const upcoming = fixtures.length - played.length

  return (
    <div className="space-y-3">
      <AwaitingResultSection competition={competition} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {played.length} result{played.length !== 1 ? 's' : ''} · {upcoming} still to play
        </p>
        <Link to="/score"
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
          Open scorer
        </Link>
      </div>

      {played.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-10 text-center">
          <p className="text-slate-500 text-sm">No results yet.</p>
          <p className="text-slate-400 text-xs mt-1">Results appear here as fixtures are scored.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {played.map(fx => (
            <Link key={fx.id} to={`/matches/${fx.id}`}
              className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 hover:border-slate-300 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-900 text-sm font-medium truncate">{fx.homeOrgName ? `${fx.homeOrgName} ${fx.homeTeamName}` : (fx.homeTeamName ?? "")}</span>
                  <span className="font-mono text-slate-900 text-sm font-bold shrink-0">
                    {fx.homeScore ?? 0}–{fx.awayScore ?? 0}
                  </span>
                  <span className="text-slate-900 text-sm font-medium text-right truncate">{fx.awayOrgName ? `${fx.awayOrgName} ${fx.awayTeamName}` : (fx.awayTeamName ?? "")}</span>
                </div>
                <div className="micro-label mt-0.5">{formatFixtureDate(fx.scheduledAt)}</div>
              </div>
              <StatusBadge status={fx.status} className="shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Standings / Stats tabs ─────────────────────────────────────────────────────

function LeagueStandingsTab({ competition }) {
  return (
    <Card title="Standings" subtitle="Computed automatically from entered results">
      <div className="flex flex-col sm:flex-row gap-3">
        <Link to={`/competitions/${competition.id}/standings`}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-3 transition-colors">
          <ExternalLink className="w-4 h-4" />
          View standings table
        </Link>
        <Link to={`/competitions/${competition.id}/fixtures`}
          className="flex items-center justify-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-3 transition-colors">
          <ExternalLink className="w-4 h-4" />
          View fixtures &amp; results
        </Link>
      </div>
    </Card>
  )
}

function FestivalStatsTab({ competition }) {
  return (
    <Card title="Festival stats" subtitle="Informational only — no positions or official ranking">
      <p className="text-sm text-slate-600 mb-4">
        The stats table shows played, won, drawn, lost and goals for each team, in a fixed order.
        It never ranks teams — festivals have no winners.
      </p>
      <Link to={`/competitions/${competition.id}`}
        className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-3 transition-colors">
        <ExternalLink className="w-4 h-4" />
        View public festival page
      </Link>
    </Card>
  )
}

function TournamentStandingsTab({ competition }) {
  return (
    <div className="space-y-4">
      <CompetitionStructureSection competition={competition} panel="standings" />
      <div className="flex justify-center">
        <Link to={`/competitions/${competition.id}/pools`}
          className="text-[11px] text-slate-500 hover:text-emerald-600 transition-colors flex items-center gap-1">
          <ExternalLink className="w-3.5 h-3.5" /> View public pools page
        </Link>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function CompetitionManage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [competition, setCompetition] = useState(null)
  const [teams,       setTeams]       = useState([])
  const [fixtures,    setFixtures]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [activeTab,   setActiveTab]   = useState('config')

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'competitions', id)),
      getDocs(collection(db, 'competitions', id, 'teams')),
      getDocs(query(collection(db, 'matches'), where('competitionId', '==', id))),
    ]).then(async ([compSnap, memberSnap, fixturesSnap]) => {
      if (compSnap.exists()) setCompetition({ id: compSnap.id, ...compSnap.data() })
      // Load all members (all statuses) so TeamsTab can show invite state.
      const members = memberSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (members.length > 0) {
        const teamDocs = await Promise.all(members.map(m => getDoc(doc(db, 'teams', m.id))))
        setTeams(members.map((m, i) => {
          const d = teamDocs[i]
          const snap = m.displaySnapshot ?? {}
          if (d.exists()) {
            return {
              id: d.id, ...d.data(),
              // The competition-scoped name (membership snapshot) wins, so an
              // organiser's edit shows here too — not just in standings.
              displayName: snap.teamName ?? d.data().displayName,
              memberStatus: m.status,
              orgName: d.data().orgName || snap.orgName || null,
              claimed: !!m.organizationId,
            }
          }
          // Name-only participant — build the team object from the membership snapshot.
          return {
            id:             m.id,
            displayName:    snap.teamName ?? m.id,
            orgName:        snap.orgName ?? null,
            organizationId: m.organizationId ?? null,
            primaryColor:   snap.primaryColor ?? null,
            shortCode:      null,
            memberStatus:   m.status,
            claimed:        !!m.organizationId,
          }
        }))
      }
      setFixtures(
        fixturesSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.scheduledAt?.toMillis?.() ?? 0) - (b.scheduledAt?.toMillis?.() ?? 0))
      )
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8"><Spinner /></div>
  )

  if (!competition) return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 text-center">
      <p className="text-slate-500">Competition not found.</p>
      <Link to="/manage/competitions"
        className="text-emerald-600 text-sm hover:underline mt-2 inline-block">
        Back to competitions
      </Link>
    </div>
  )

  const tabs = tabsFor(competition)
  const validTab = tabs.some(t => t.id === activeTab) ? activeTab : 'config'

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)}
          className="text-slate-400 hover:text-slate-900 transition-colors shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-slate-900 text-xl leading-tight truncate">
            {competition.name}
          </h1>
          <div className="micro-label mt-0.5">
            {[competition.type, competition.ageGroup, competition.gender, competition.season]
              .filter(Boolean).join(' · ')}
          </div>
        </div>
        <CompetitionStatusBadge competition={competition} className="shrink-0" />
      </div>

      {/* Tab bar */}
      <TabBar tabs={tabs} active={validTab} onChange={setActiveTab} />

      {/* Tab content */}
      {validTab === 'config' && (
        <ConfigTab competition={competition} onSaved={setCompetition} onGoToTab={setActiveTab} />
      )}
      {validTab === 'teams' && (
        <TeamsTab competition={competition} teams={teams} setTeams={setTeams} />
      )}
      {validTab === 'structure' && competition.type === 'tournament' && (
        <CompetitionStructureSection competition={competition} panel="structure" />
      )}
      {validTab === 'fixtures' && (
        <FixturesTab
          competition={competition}
          teams={teams}
          fixtures={fixtures}
          setFixtures={setFixtures}
        />
      )}
      {validTab === 'results' && (
        <ResultsTab competition={competition} fixtures={fixtures} />
      )}
      {validTab === 'standings' && competition.type === 'league' && (
        <LeagueStandingsTab competition={competition} />
      )}
      {validTab === 'standings' && competition.type === 'tournament' && (
        <TournamentStandingsTab competition={competition} />
      )}
      {validTab === 'knockout' && competition.type === 'tournament' && (
        <CompetitionStructureSection competition={competition} panel="knockout" />
      )}
      {validTab === 'stats' && competition.type === 'festival' && (
        <FestivalStatsTab competition={competition} />
      )}
    </div>
  )
}
