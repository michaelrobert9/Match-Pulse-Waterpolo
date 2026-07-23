import { useEffect, useRef, useState } from 'react'
import { X, Check, ChevronLeft, MoreVertical, Users, Star, ArrowLeftRight, RotateCcw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchMatch, fetchTeamLineup, subscribeMatch, fetchAllPeople, fetchOrganizations, fetchTeamsForOrganization } from '../../lib/queries'
import { configured } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import {
  startMatch, pauseMatch, resumeMatch, endPeriod, startPeriod, finalizeMatch,
  addGoal, enrichGoal, addCard, reverseGoal, reverseCard, recordShootout,
  addPersonToMatchLineup, removePersonFromMatchLineup, toggleLineupStarter, updateMatchLineupEntry, updateMatch,
  setPlayerOfMatch, syncFixtureMembership, swapFixtureSides, resetMatch,
  setFixtureNotPlayed, setFixtureWalkover, abandonMatch, letAbandonedStand, revertFixtureOutcome,
  submitFixtureResult,
} from '../../lib/adminQueries'
import { fetchCompetition } from '../../lib/queries'
import { walkoverScore, outcomeBanner } from '../../lib/fixtureResult'
import FixtureBanner from '../../components/FixtureBanner'
import {
  getElapsedMs, formatClock, nextPeriodAction,
  periodRemainingMs, formatCountdown, gameMinuteLabel, isPastExpectedEnd,
} from '../../lib/matchClock'
import { isLive, isScheduled } from '../../lib/fixtureStatus'
import { useTeamIdentity } from '../../hooks/useTeamIdentity'
import { TeamCrest } from '../../components/TeamIdentity'
import PersonAvatar from '../../components/PersonAvatar'
import { slugify } from '../../lib/slugify'

const DEFAULT_BREAK_SECS = 120

// ── 00:00 alarm ──────────────────────────────────────────────────────────────
// Two short rising beeps, generated with the Web Audio API — no asset, works
// offline. The AudioContext must be created/resumed inside a user tap (the
// start/resume handlers) to satisfy autoplay policies; the beep itself then
// fires programmatically minutes later. Fires once per period, never loops.
function playAlarm(ctx) {
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') ctx.resume()
    const beep = (freq, at, dur) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      // Gain envelope avoids start/stop clicks.
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + dur + 0.05)
    }
    const t0 = ctx.currentTime
    beep(880,  t0,        0.18) // A5
    beep(1318, t0 + 0.24, 0.28) // E6 — rising pair
  } catch { /* audio unavailable — the vibration fallback still fires */ }
}

function formatBreak(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function wallTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

const GOAL_TYPES = [
  { key: 'open', label: 'Open Play' },
  { key: 'sc',   label: 'Short Corner' },
  { key: 'ps',   label: 'Penalty Stroke' },
  { key: 'og',   label: 'Own Goal' },
]
const GOAL_TYPE_SHORT = { open: 'Open Play', sc: 'Short Corner', ps: 'Penalty Stroke', og: 'Own Goal' }
const CARD_TYPES = [
  { key: 'green',  label: 'Green Card',  dot: 'bg-emerald-500' },
  { key: 'yellow', label: 'Yellow Card', dot: 'bg-yellow-400' },
  { key: 'red',    label: 'Red Card',    dot: 'bg-red-500' },
]
const CARD_DOT = { green: 'bg-emerald-400', yellow: 'bg-yellow-400', red: 'bg-red-500' }
const CARD_LABEL = { green: 'Green Card', yellow: 'Yellow Card', red: 'Red Card' }
// Sensible hockey defaults when no explicit duration is captured. Red = sent off.
const CARD_DEFAULT_MIN = { green: 2, yellow: 5, red: null }
// Selectable suspension lengths for a green card.
const GREEN_DURATIONS = [1, 2, 3, 5]

// Timeline duration text: stored duration wins, else the colour's default.
function cardDurationLabel(ev) {
  if (ev.cardType === 'red') return 'Sent off'
  const min = ev.durationMinutes ?? CARD_DEFAULT_MIN[ev.cardType]
  return min != null ? `${min} min` : null
}

// ── Theme (scoring screen only) ──────────────────────────────────────────────
// Defaults to bright — the scoring screen is used outdoors in daylight.
function useScorerTheme() {
  const [bright, setBright] = useState(() => {
    const saved = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('scorerBright')
    return saved == null ? true : saved === '1'
  })
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('scorerBright', bright ? '1' : '0')
  }, [bright])
  return [bright, setBright]
}

function theme(bright) {
  return bright
    ? {
        root: 'bg-white text-slate-900',
        header: 'bg-white border-slate-200',
        surface: 'bg-slate-50 border-slate-200',
        bar: 'bg-slate-100 border-slate-200',
        muted: 'text-slate-500',
        score: 'text-slate-900',
        timelineText: 'text-slate-700',
        neutralBtn: 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100',
        sheet: 'bg-white border-slate-200',
      }
    : {
        root: 'bg-canvas text-white',
        header: 'bg-surface border-slate-800',
        surface: 'bg-surface border-slate-800',
        bar: 'bg-surface border-slate-800',
        muted: 'text-slate-500',
        score: 'text-white',
        timelineText: 'text-slate-300',
        neutralBtn: 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700',
        sheet: 'bg-[#0F1219] border-slate-700',
      }
}

// ── Bottom sheet ─────────────────────────────────────────────────────────────
function Sheet({ t, title, subtitle, color, onClose, dismissable = true, closable = true, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={() => dismissable && onClose()}>
      <div className={`w-full max-w-md ${t.sheet} rounded-t-2xl border-t flex flex-col`}
        style={{ maxHeight: '92dvh' }}
        onClick={e => e.stopPropagation()}>
        {/* Header — never scrolls */}
        <div className="px-5 pt-5 pb-2 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {color && <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />}
              <div className="min-w-0">
                <div className="font-display font-bold text-base truncate">{title}</div>
                {subtitle && <div className={`text-xs font-mono ${t.muted}`}>{subtitle}</div>}
              </div>
            </div>
            {closable && (
              <button onClick={onClose} className={`${t.muted} hover:opacity-70 p-1`}>
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 pb-8 flex-1 min-h-0">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Connectivity ─────────────────────────────────────────────────────────────
function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function ScoreMatch() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { isPlatformAdmin, isOrgMember, competitionRoles } = useAuth()
  const [bright, setBright] = useScorerTheme()
  const t = theme(bright)
  const online = useOnline()

  const [match,   setMatch]   = useState(null)
  const homeIdentity = useTeamIdentity(match, 'home')
  const awayIdentity = useTeamIdentity(match, 'away')
  const [home,    setHome]    = useState([])
  const [away,    setAway]    = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const savingRef             = useRef(false)   // ref lock: prevents double-tap races that beat React state
  const [, forceTick]         = useState(0)
  const lineupsLoaded = useRef(false)

  // goalEnrich: { eventId, side, step: 'type'|'attribution' } — two-step enrichment
  // for an already-recorded goal. Attribution step only reached when the scoring
  // team has fixture lineup players; otherwise the sheet closes after type selection.
  const [goalEnrich, setGoalEnrich] = useState(null)
  // pendingCard: { side, matchTimestamp, playerName } — held locally, not yet written
  const [pendingCard, setPendingCard] = useState(null)
  const [confirmEnd, setConfirmEnd]   = useState(false)
  const [menuFor, setMenuFor]         = useState(null) // timeline event id
  // tapLock: `${side}:${kind}` of the button briefly locked after a tap (~500ms)
  // to absorb accidental double-taps during rapid sideline scoring.
  const [tapLock, setTapLock]         = useState(null)
  const [notice, setNotice]           = useState(null) // transient inline message
  const [endNudgeDismissed, setEndNudgeDismissed] = useState(false) // §7 still-playing nudge
  // Set when THIS session ends the match, so we show the Full-time confirmation
  // and auto-return to the list (rather than redirecting a review visit).
  const [justFinalized, setJustFinalized] = useState(false)
  // POTM step: shown between finalization and the full-time screen when there
  // are lineup players to choose from.
  const [potmStep, setPotmStep] = useState(false)
  // Shootout: optional, only relevant when regulation ends level.
  const [shootoutEnabled, setShootoutEnabled] = useState(false)
  const [shootoutHome,    setShootoutHome]    = useState('')
  const [shootoutAway,    setShootoutAway]    = useState('')

  // Match lineup management (stored in match.homeLineup / match.awayLineup)
  const [lineupOpen,     setLineupOpen]     = useState(false)
  const [lineupSide,     setLineupSide]     = useState('home')
  const [addPersonOpen,  setAddPersonOpen]  = useState(false)
  const [allPeople,      setAllPeople]      = useState([])
  const [showAllPeople,  setShowAllPeople]  = useState(false)
  const [lineupSearch,   setLineupSearch]   = useState('')
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [lineupShirt,    setLineupShirt]    = useState('')
  const [lineupIsStarter, setLineupIsStarter] = useState(false)
  const [lineupSaving,   setLineupSaving]   = useState(false)
  const [lineupError,    setLineupError]    = useState('')
  // Per-fixture shirt edit on an existing lineup entry (carries through from the
  // squad, but overridable for this one match).
  const [editEntryId,    setEditEntryId]    = useState(null)
  const [editEntryShirt, setEditEntryShirt] = useState('')
  // Fixture outcome (walkover / abandoned / not-played) — organiser or admin.
  const [outcomeOpen,    setOutcomeOpen]    = useState(false)
  const [outcomeBusy,    setOutcomeBusy]    = useState(false)
  const [outcomeError,   setOutcomeError]   = useState('')
  const [wkDefault,      setWkDefault]      = useState({ conceding: 0, opposing: 5 })
  // Edit match details (platform admin only)
  const [editMatchOpen,  setEditMatchOpen]  = useState(false)
  const [editForm,       setEditForm]       = useState({})
  const [editSaving,     setEditSaving]     = useState(false)
  const [editError,      setEditError]      = useState('')
  const [editOrgs,            setEditOrgs]            = useState([])
  const [editOrgsLoaded,      setEditOrgsLoaded]      = useState(false)
  const [editHomeTeams,       setEditHomeTeams]       = useState([])
  const [editAwayTeams,       setEditAwayTeams]       = useState([])
  const [editHomeTeamsLoading, setEditHomeTeamsLoading] = useState(false)
  const [editAwayTeamsLoading, setEditAwayTeamsLoading] = useState(false)

  // Break countdown: timer between periods, derived from match.breakMinutes.
  // breakMinutes is an array — index = gap between period[i] and period[i+1].
  // Falls back to DEFAULT_BREAK_SECS (120s) for matches created before this field existed.
  const breakStartRef = useRef(null)
  const [breakSecsLeft, setBreakSecsLeft] = useState(DEFAULT_BREAK_SECS)

  useEffect(() => {
    if (!configured) {
      fetchMatch(id).then(m => { setMatch(m); setLoading(false) })
      return
    }
    setLoading(true)
    return subscribeMatch(id, m => { setMatch(m); setLoading(false) })
  }, [id])

  useEffect(() => {
    if (!match || lineupsLoaded.current) return
    lineupsLoaded.current = true
    // Suggest the season's squad: roster entries for the match's season (or the
    // current year), legacy unstamped entries, and this competition's own slices.
    const seasonOf = String(match.season ?? new Date().getFullYear())
    const relevant = l => (l ?? []).filter(e =>
      e.competitionId
        ? e.competitionId === match.competitionId
        : (!e.season || String(e.season) === seasonOf))
    fetchTeamLineup(match.homeTeamId).then(l => setHome(relevant(l)))
    fetchTeamLineup(match.awayTeamId).then(l => setAway(relevant(l)))
  }, [match?.homeTeamId, match?.awayTeamId])

  // Tick the clock display once a second while running.
  const isLive = match?.status === 'live'
  useEffect(() => {
    if (!isLive) return
    const iv = setInterval(() => forceTick(n => n + 1), 1000)
    return () => clearInterval(iv)
  }, [isLive])

  // 00:00 alarm — Web Audio beep + vibration, once per period. The context is
  // unlocked by the start/resume taps; the fired-guard resets when a new
  // period begins and pre-arms as already-fired when arriving on a period
  // that is past zero (a reload mid-overtime must not beep on load).
  const audioCtxRef   = useRef(null)
  const alarmFiredRef = useRef(false)

  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    } catch { /* no audio — the vibration fallback still fires */ }
  }

  useEffect(() => {
    alarmFiredRef.current = match ? periodRemainingMs(match) <= 0 : false
  }, [match?.currentPeriod])

  useEffect(() => {
    if (!isLive) return
    const iv = setInterval(() => {
      if (alarmFiredRef.current || periodRemainingMs(match) > 0) return
      alarmFiredRef.current = true
      playAlarm(audioCtxRef.current)
      if (navigator.vibrate) navigator.vibrate([250, 120, 250])
    }, 250)
    return () => clearInterval(iv)
  }, [isLive, match])

  // Keep the screen awake while a period is live — JS (and therefore the
  // alarm) stops the moment the phone locks. Re-acquired on tab return; a
  // denial (e.g. battery saver) is fine, the on-screen notice still warns.
  useEffect(() => {
    if (!isLive || !('wakeLock' in navigator)) return
    let lock = null, active = true
    const acquire = () => navigator.wakeLock.request('screen')
      .then(l => { if (active) lock = l; else l.release().catch(() => {}) })
      .catch(() => {})
    acquire()
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.().catch(() => {})
    }
  }, [isLive])

  // iOS suspends the AudioContext when the tab backgrounds; re-arm on return.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Warn before leaving if a match is in progress (pending writes may exist).
  useEffect(() => {
    if (!match || !isLive) return
    const handler = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [match?.status])

  // Auto-clear transient inline notices (e.g. a blocked reversal).
  useEffect(() => {
    if (!notice) return
    const iv = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(iv)
  }, [notice])

  // Break countdown: starts when period ends (isBreakState), resets when next period begins.
  const isBreakState = match?.currentPeriod === 'break'
  useEffect(() => {
    const breakIdx   = Math.max(0, (match?.nextPeriodIndex ?? 1) - 1)
    const breakMins  = Array.isArray(match?.breakMinutes) ? (match.breakMinutes[breakIdx] ?? 2) : 2
    const breakSecs  = breakMins * 60 || DEFAULT_BREAK_SECS
    if (!isBreakState) {
      breakStartRef.current = null
      setBreakSecsLeft(breakSecs)
      return
    }
    if (!breakStartRef.current) breakStartRef.current = Date.now()
    const iv = setInterval(() => {
      const elapsed = Math.floor((Date.now() - breakStartRef.current) / 1000)
      setBreakSecsLeft(Math.max(0, breakSecs - elapsed))
    }, 500)
    return () => clearInterval(iv)
  }, [isBreakState, match?.breakMinutes, match?.nextPeriodIndex])

  useEffect(() => {
    if (!showAllPeople || allPeople.length > 0) return
    fetchAllPeople().then(setAllPeople)
  }, [showAllPeople])

  // Load the competition's default walkover score when the outcome sheet opens.
  // MUST live above the early returns below — hooks may never render conditionally.
  useEffect(() => {
    if (!outcomeOpen || !match?.competitionId) return
    fetchCompetition(match.competitionId)
      .then(c => { if (c) setWkDefault(walkoverScore(c)) })
      .catch(() => {})
  }, [outcomeOpen, match?.competitionId])

  if (loading) return (
    <div className={`min-h-screen ${t.root} flex items-center justify-center`}>
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!match) return (
    <div className={`min-h-screen ${t.root} flex items-center justify-center`}>
      <p className={`${t.muted} text-sm`}>Match not found.</p>
    </div>
  )

  // Match-level ownership check: org member for either side, OR competition staff for this fixture.
  const authorised = isPlatformAdmin
    || isOrgMember(match.homeOrgId) || isOrgMember(match.awayOrgId)
    || (match.competitionId && !!competitionRoles[match.competitionId])
  if (!authorised) return (
    <div className={`min-h-screen ${t.root} flex flex-col items-center justify-center px-6 text-center gap-3`}>
      <p className="font-display font-bold text-lg">Not authorised</p>
      <p className={`${t.muted} text-sm`}>You don't have scoring access for this match.</p>
      <button onClick={() => navigate('/score')} className="text-emerald-500 text-sm font-bold mt-2">← Back to matches</button>
    </div>
  )

  const status     = match.status
  const isUpcoming = isScheduled(match)
  const isPaused   = status === 'paused'
  const isFinal    = status === 'final'
  const running    = status === 'live'
  const elapsedMs  = getElapsedMs(match)
  // Countdown from the period length into negative time; red inside 30s.
  const periodRemaining = periodRemainingMs(match)
  const clockRed   = !isBreakState && periodRemaining <= 30_000
  const nextAction = nextPeriodAction(match)

  // Active events for the live timeline (reversed events hidden).
  const goals = (match.goals ?? []).filter(g => g.status !== 'reversed')
  const cards = (match.cards ?? []).filter(c => c.status !== 'reversed')
  const LOGGED_PERIOD_TYPES = new Set(['match_start', 'period_start', 'period_end', 'match_end'])
  const periodEvents = (match.controlLog ?? [])
    .filter(e => LOGGED_PERIOD_TYPES.has(e.type))
    .map(e => ({ ...e, kind: 'period' }))
  const timeline = [
    ...goals.map(g => ({ ...g, kind: 'goal' })),
    ...cards.map(c => ({ ...c, kind: 'card' })),
    ...periodEvents,
  ].sort((a, b) => (a.matchTimestamp ?? 0) - (b.matchTimestamp ?? 0))

  const teamName = side => side === 'home' ? match.homeTeamName : match.awayTeamName
  const teamColor = side => side === 'home' ? match.homeTeamColor : match.awayTeamColor

  // ── Actions ────────────────────────────────────────────────────────────────
  async function withSaving(fn) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try { await fn() }
    catch (err) {
      setNotice(err?.code === 'permission-denied'
        ? 'Permission denied — your access may have changed.'
        : 'Could not save — check your connection and try again.')
    }
    finally { savingRef.current = false; setSaving(false) }
  }

  const handleStart = () => {
    unlockAudio()
    return withSaving(() => startMatch(id, { matchTimestamp: 0, periods: match.periods }))
  }

  const handlePause = () => withSaving(() =>
    pauseMatch(id, { matchTimestamp: elapsedMs }))

  const handleResume = () => {
    unlockAudio()
    return withSaving(() => {
      const span = match.pausedAt ? (Date.now() - match.pausedAt.toMillis()) : 0
      return resumeMatch(id, { matchTimestamp: elapsedMs, pauseSpanMs: span })
    })
  }

  const handleNextAction = () => withSaving(() => {
    unlockAudio()
    if (nextAction.kind === 'end_period') {
      return endPeriod(id, { matchTimestamp: elapsedMs, period: nextAction.period, nextIndex: nextAction.index + 1 })
    }
    if (nextAction.kind === 'start_period') {
      const span = match.pausedAt ? (Date.now() - match.pausedAt.toMillis()) : 0
      return startPeriod(id, { matchTimestamp: elapsedMs, period: nextAction.period, index: nextAction.index, pauseSpanMs: span })
    }
    setConfirmEnd(true)
    return Promise.resolve()
  })

  // Briefly lock a button after a tap so an accidental double-tap can't create
  // a duplicate event during fast sideline scoring.
  function lockTap(key) {
    setTapLock(key)
    setTimeout(() => setTapLock(cur => (cur === key ? null : cur)), 500)
  }

  // Goal: timestamp + score captured on first tap; strip is pure enrichment.
  async function handleGoal(side) {
    const key = `${side}:goal`
    if (saving || tapLock === key) return
    lockTap(key)
    const ts = getElapsedMs(match)
    setSaving(true)
    try {
      const eventId = await addGoal(id, side, { matchTimestamp: ts })
      if (navigator.vibrate) navigator.vibrate(60)
      setGoalEnrich({ eventId, side, step: 'type' })
    } catch (err) {
      setNotice(err?.code === 'permission-denied'
        ? 'Permission denied — your access may have changed.'
        : 'Could not save — check your connection and try again.')
    } finally { setSaving(false) }
  }

  // Fixture lineup for the scoring side, sorted by shirt number ascending.
  // Entries without a number sort last. Used only in the goal enrichment sheet.
  function fixtureSidePlayers(side) {
    const lineup = side === 'home' ? (match.homeLineup ?? []) : (match.awayLineup ?? [])
    return [...lineup].sort((a, b) => {
      const an = a.shirtNumber != null ? parseInt(a.shirtNumber, 10) : Infinity
      const bn = b.shirtNumber != null ? parseInt(b.shirtNumber, 10) : Infinity
      return an - bn
    })
  }

  // After the type step: advance to attribution if lineup players exist, else close.
  function advanceFromType() {
    if (!goalEnrich) return
    if (fixtureSidePlayers(goalEnrich.side).length > 0) {
      setGoalEnrich(ge => ge ? { ...ge, step: 'attribution' } : null)
    } else {
      setGoalEnrich(null)
    }
  }

  async function applyGoalType(goalType) {
    if (!goalEnrich) return
    await enrichGoal(id, goalEnrich.eventId, { goalType }, match.goals)
    advanceFromType()
  }

  // Attribution step: write scorer from the fixture lineup, or null for Unassigned.
  // Advances to the assist step when other lineup players exist to credit.
  async function applyGoalAttribution(entry) {
    if (!goalEnrich) return
    const patch = entry
      ? { scorerName: entry.personName, scorerPersonId: entry.personId }
      : { scorerName: null, scorerPersonId: null }
    await enrichGoal(id, goalEnrich.eventId, patch, match.goals)
    const others = fixtureSidePlayers(goalEnrich.side)
      .filter(p => !entry || p.personId !== entry.personId)
    if (others.length > 0) {
      setGoalEnrich(ge => ge ? { ...ge, step: 'assist', scorerPersonId: entry?.personId ?? null } : null)
    } else {
      setGoalEnrich(null)
    }
  }

  // Assist step: credit the assisting player, or null for no assist.
  async function applyGoalAssist(entry) {
    if (!goalEnrich) return
    const patch = entry
      ? { assistName: entry.personName, assistPersonId: entry.personId }
      : { assistName: null, assistPersonId: null }
    await enrichGoal(id, goalEnrich.eventId, patch, match.goals)
    setGoalEnrich(null)
  }

  // Card: timestamp captured on first tap into local state; written on colour select.
  function handleCardTap(side) {
    const key = `${side}:card`
    if (saving || tapLock === key) return
    lockTap(key)
    setPendingCard({ side, matchTimestamp: getElapsedMs(match), playerName: null, playerPlayerId: null })
  }
  // Green cards carry a suspension duration — capture it before writing.
  // Yellow/red are written immediately on colour selection.
  function applyCardColour(cardType) {
    if (!pendingCard) return
    if (cardType === 'green') {
      setPendingCard(pc => ({ ...pc, cardType: 'green' }))
      return
    }
    writeCard(cardType, null)
  }
  async function writeCard(cardType, durationMinutes) {
    if (!pendingCard) return
    const { side, matchTimestamp, playerName, playerPlayerId } = pendingCard
    setPendingCard(null)
    await withSaving(() => addCard(id, side, { matchTimestamp, cardType, playerName, playerPlayerId, durationMinutes }))
    if (navigator.vibrate) navigator.vibrate(60)
  }

  async function handleReverse(ev) {
    setMenuFor(null)
    await withSaving(async () => {
      const res = ev.kind === 'goal'
        ? await reverseGoal(id, ev.id, match.goals)
        : await reverseCard(id, ev.id, match.cards)
      if (res && res.ok === false && res.reason === 'negative-score') {
        setNotice('Reversal blocked — the score is already 0 and cannot go negative.')
      }
    })
  }

  async function handleConfirmEnd() {
    setConfirmEnd(false)
    await withSaving(async () => {
      if (configured) {
        await finalizeMatch(id)
        const sh = parseInt(shootoutHome, 10)
        const sa = parseInt(shootoutAway, 10)
        if (shootoutEnabled && !isNaN(sh) && !isNaN(sa)) {
          await recordShootout(id, sh, sa)
        }
      }
      const hasPlayers = (match?.homeLineup?.length ?? 0) + (match?.awayLineup?.length ?? 0) > 0
      if (hasPlayers) {
        setPotmStep(true)
      } else {
        setJustFinalized(true)
      }
    })
  }

  async function handleSelectPOTM(player) {
    if (player) {
      await setPlayerOfMatch(id, player).catch(() => {})
    }
    setPotmStep(false)
    setJustFinalized(true)
  }

  // Season squad for a side — roster entries carry a shirt number from the squad.
  // Deduped by person, minus anyone already in this fixture's lineup, so the panel
  // lets a scorer add a squad player in one tap without re-entering their details.
  function squadForSide(side) {
    const roster = side === 'home' ? home : away
    const sideLineup = (side === 'home' ? match.homeLineup : match.awayLineup) ?? []
    const inLineup = new Set(sideLineup.map(e => e.personId).filter(Boolean))
    const seen = new Set(); const out = []
    for (const p of roster) {
      if (!p.personId || inLineup.has(p.personId) || seen.has(p.personId)) continue
      seen.add(p.personId)
      out.push({
        id: p.personId, fullName: p.personName,
        shirtNumber: p.shirtNumber ?? null, position: p.position ?? null, photoUrl: p.photoUrl ?? null,
      })
    }
    return out.sort((a, b) => (a.shirtNumber || 99) - (b.shirtNumber || 99))
  }

  async function handleAddToLineup() {
    if (!selectedPerson) return
    setLineupSaving(true); setLineupError('')
    try {
      await addPersonToMatchLineup(id, {
        personId:   selectedPerson.id,
        personName: selectedPerson.fullName,
        side:       lineupSide,
        shirtNumber: lineupShirt || null,
        isStarter:  lineupIsStarter,
      })
      setSelectedPerson(null); setLineupShirt(''); setLineupIsStarter(false)
      setAddPersonOpen(false)
    } catch (e) {
      setLineupError(e.message || 'Failed to add player.')
    } finally { setLineupSaving(false) }
  }

  // One-tap add of a squad player, carrying their squad shirt number through as
  // a bench entry (starter status and shirt stay editable in the lineup list).
  async function quickAddSquadPlayer(sq) {
    setLineupSaving(true); setLineupError('')
    try {
      await addPersonToMatchLineup(id, {
        personId: sq.id, personName: sq.fullName, side: lineupSide,
        shirtNumber: sq.shirtNumber || null, isStarter: false,
      })
    } catch (e) {
      setLineupError(e.message || 'Failed to add player.')
    } finally { setLineupSaving(false) }
  }

  // Save a per-fixture shirt-number override on an existing lineup entry.
  async function saveEntryShirt(entry) {
    setLineupSaving(true); setLineupError('')
    try {
      await updateMatchLineupEntry(id, entry.id, lineupSide, { shirtNumber: editEntryShirt })
      setEditEntryId(null)
    } catch (e) {
      setLineupError(e.message || 'Update failed.')
    } finally { setLineupSaving(false) }
  }

  async function handleRemoveFromLineup(entry) {
    setLineupSaving(true); setLineupError('')
    try {
      await removePersonFromMatchLineup(id, entry.id, lineupSide)
    } catch (e) {
      setLineupError(e.message || 'Remove failed.')
    } finally { setLineupSaving(false) }
  }

  async function handleToggleStarter(entry) {
    setLineupSaving(true)
    try {
      await toggleLineupStarter(id, entry.id, lineupSide)
    } catch (e) {
      setLineupError(e.message || 'Update failed.')
    } finally { setLineupSaving(false) }
  }

  async function runOutcome(fn) {
    setOutcomeBusy(true); setOutcomeError('')
    try { await fn(); setOutcomeOpen(false) }
    catch (e) { setOutcomeError(e.message || 'Action failed.') }
    finally { setOutcomeBusy(false) }
  }

  function openEditMatch() {
    if (!match) return
    const d = match.scheduledAt?.toDate ? match.scheduledAt.toDate() : match.scheduledAt ? new Date(match.scheduledAt) : null
    const pad = n => String(n).padStart(2, '0')
    const dt = d ? `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
    setEditForm({
      scheduledAt:   dt,
      pitch:         match.pitch         || '',
      indoor:        match.indoor === true,
      homeTeamName:  match.homeTeamName  || '',
      awayTeamName:  match.awayTeamName  || '',
      homeOrgId:     match.homeOrgId     || '',
      homeTeamId:    match.homeTeamId    || '',
      awayOrgId:     match.awayOrgId     || '',
      awayTeamId:    match.awayTeamId    || '',
      periods:       match.periods       ?? 2,
      periodMinutes: match.periodMinutes ?? 35,
      matchSlug:     match.matchSlug     || match.slug || '',
    })
    setEditError('')
    const sortByName = ts => ts.slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    if (!editOrgsLoaded) {
      fetchOrganizations().then(orgs => { setEditOrgs(orgs); setEditOrgsLoaded(true) })
    }
    if (match.homeOrgId) {
      setEditHomeTeamsLoading(true)
      fetchTeamsForOrganization(match.homeOrgId).then(ts => setEditHomeTeams(sortByName(ts))).finally(() => setEditHomeTeamsLoading(false))
    }
    if (match.awayOrgId) {
      setEditAwayTeamsLoading(true)
      fetchTeamsForOrganization(match.awayOrgId).then(ts => setEditAwayTeams(sortByName(ts))).finally(() => setEditAwayTeamsLoading(false))
    }
    setEditMatchOpen(true)
  }

  async function handleRestart() {
    if (!match) return
    if (!window.confirm('Restart this match? It returns to “not started” and clears the clock, score, goals and cards. Use this if Start was tapped by mistake.')) return
    try { await resetMatch(match.id) }
    catch (e) { window.alert(e.message ?? 'Could not restart the match.') }
  }

  async function handleSwapSides() {
    if (!match) return
    if (!window.confirm('Switch the home and away team? Any score, goals and cards swap with them, and the match URL updates.')) return
    setEditSaving(true); setEditError('')
    try {
      await swapFixtureSides(match.id)
      setEditMatchOpen(false)
    } catch (e) {
      setEditError(e.message ?? 'Could not switch sides.')
    } finally { setEditSaving(false) }
  }

  async function handleEditMatch() {
    setEditSaving(true); setEditError('')
    try {
      const patch = {
        ...(editForm.scheduledAt ? { scheduledAt: new Date(editForm.scheduledAt) } : {}),
        pitch:         (editForm.pitch        ?? '').trim(),
        indoor:        editForm.indoor === true,
        homeTeamName:  (editForm.homeTeamName ?? '').trim(),
        awayTeamName:  (editForm.awayTeamName ?? '').trim(),
        periods:       Number(editForm.periods) || 2,
        periodMinutes: Number(editForm.periodMinutes) || 35,
      }
      // Home side — patch org, and all denormalized team identity fields
      if (editForm.homeOrgId) {
        patch.homeOrgId = editForm.homeOrgId
        const homeOrg = editOrgs.find(o => o.id === editForm.homeOrgId)
        if (homeOrg) patch.homeOrgName = homeOrg.name
        if (editForm.homeTeamId) {
          patch.homeTeamId = editForm.homeTeamId
          const homeTeam = editHomeTeams.find(t => t.id === editForm.homeTeamId)
          if (homeTeam) {
            patch.homeTeamColor     = homeTeam.primaryColor || null
            patch.homeTeamSlug      = homeTeam.slug         || null
            patch.homeTeamShortCode = homeTeam.shortCode    || null
            patch.homeRegistered    = true
          }
        } else if (editForm.homeOrgId !== (match.homeOrgId || '')) {
          // Org changed but no team chosen — clear the stale team link
          patch.homeTeamId        = null
          patch.homeTeamColor     = null
          patch.homeTeamSlug      = null
          patch.homeTeamShortCode = null
          patch.homeRegistered    = false
        }
      }
      // Away side — same pattern
      if (editForm.awayOrgId) {
        patch.awayOrgId = editForm.awayOrgId
        const awayOrg = editOrgs.find(o => o.id === editForm.awayOrgId)
        if (awayOrg) patch.awayOrgName = awayOrg.name
        if (editForm.awayTeamId) {
          patch.awayTeamId = editForm.awayTeamId
          const awayTeam = editAwayTeams.find(t => t.id === editForm.awayTeamId)
          if (awayTeam) {
            patch.awayTeamColor     = awayTeam.primaryColor || null
            patch.awayTeamSlug      = awayTeam.slug         || null
            patch.awayTeamShortCode = awayTeam.shortCode    || null
            patch.awayRegistered    = true
          }
        } else if (editForm.awayOrgId !== (match.awayOrgId || '')) {
          patch.awayTeamId        = null
          patch.awayTeamColor     = null
          patch.awayTeamSlug      = null
          patch.awayTeamShortCode = null
          patch.awayRegistered    = false
        }
      }
      // URL slug — slugify the admin's input and store as the canonical
      // matchSlug. Saved verbatim (no auto-suffix) so admins keep full control.
      const cleanSlug = slugify(editForm.matchSlug || '')
      if (cleanSlug) patch.matchSlug = cleanSlug
      await updateMatch(id, patch)
      // If teams changed: reset lineup cache and keep the competition's
      // fixture-membership doc in sync so standings/stats use correct IDs.
      if (patch.homeTeamId !== undefined || patch.awayTeamId !== undefined) {
        lineupsLoaded.current = false
        if (match.competitionId) {
          await syncFixtureMembership(id, match.competitionId, {
            homeTeamId: patch.homeTeamId,
            awayTeamId: patch.awayTeamId,
          })
        }
      }
      setEditMatchOpen(false)
    } catch (e) {
      setEditError(e.message || 'Save failed.')
    } finally { setEditSaving(false) }
  }

  function handleHomeOrgChange(orgId) {
    const sortByName = ts => ts.slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    setEditForm(f => ({ ...f, homeOrgId: orgId, homeTeamId: '' }))
    setEditHomeTeams([])
    if (orgId) {
      setEditHomeTeamsLoading(true)
      fetchTeamsForOrganization(orgId).then(ts => setEditHomeTeams(sortByName(ts))).finally(() => setEditHomeTeamsLoading(false))
    }
  }

  function handleAwayOrgChange(orgId) {
    const sortByName = ts => ts.slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    setEditForm(f => ({ ...f, awayOrgId: orgId, awayTeamId: '' }))
    setEditAwayTeams([])
    if (orgId) {
      setEditAwayTeamsLoading(true)
      fetchTeamsForOrganization(orgId).then(ts => setEditAwayTeams(sortByName(ts))).finally(() => setEditAwayTeamsLoading(false))
    }
  }

  function handleHomeTeamChange(teamId) {
    const team = editHomeTeams.find(tm => tm.id === teamId)
    setEditForm(f => ({ ...f, homeTeamId: teamId, ...(team ? { homeTeamName: team.displayName } : {}) }))
  }

  function handleAwayTeamChange(teamId) {
    const team = editAwayTeams.find(tm => tm.id === teamId)
    setEditForm(f => ({ ...f, awayTeamId: teamId, ...(team ? { awayTeamName: team.displayName } : {}) }))
  }

  const enrichGoalEvent = goalEnrich && (match.goals ?? []).find(g => g.id === goalEnrich.eventId)
  const pickerSidePlayers = side => side === 'home' ? home : away

  return (
    <div className={`max-w-2xl mx-auto overflow-hidden ${t.root} flex flex-col transition-colors`} style={{ height: '100dvh' }}>
      {/* Header */}
      <header className={`${t.header} border-b px-4 py-3 flex items-center gap-3 shrink-0`}>
        <button onClick={() => navigate('/score')} className={`${t.muted} hover:opacity-70`}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{homeIdentity?.primary ?? match.homeTeamName} vs {awayIdentity?.primary ?? match.awayTeamName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 ${running ? 'text-emerald-500' : t.muted}`}>
              {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
              {running ? `Live · ${match.currentPeriod ?? ''}` : isPaused ? `Paused · ${match.currentPeriod === 'break' ? 'Break' : match.currentPeriod ?? ''}` : status}
            </span>
            {!online && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500">⊘ Offline</span>
            )}
          </div>
        </div>
        {saving && <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />}
        {!isUpcoming && (
          <button onClick={handleRestart}
            className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-amber-300 text-amber-600 rounded-lg px-2.5 py-1.5 hover:bg-amber-50"
            title="Restart match (if Start was tapped by mistake)">
            <RotateCcw className="w-3.5 h-3.5" /> Restart
          </button>
        )}
        <button onClick={() => { setOutcomeError(''); setOutcomeOpen(true) }}
          className="shrink-0 text-[10px] font-bold uppercase tracking-widest border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50"
          title="Enter a result, or record a walkover / abandonment / not played">
          Result
        </button>
        {isPlatformAdmin && (
          <button onClick={openEditMatch}
            className={`shrink-0 text-[10px] font-bold uppercase tracking-widest border rounded-lg px-2.5 py-1.5 ${t.neutralBtn}`}
            title="Edit match details">
            Edit
          </button>
        )}
        <button onClick={() => { setLineupOpen(true); setLineupSide('home') }}
          className={`shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center ${t.neutralBtn}`}
          title="Manage lineup">
          <Users className="w-4 h-4" />
        </button>
        <button onClick={() => setBright(b => !b)}
          className={`shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center ${t.neutralBtn}`}
          title={bright ? 'Switch to dark' : 'Switch to bright'}>
          {bright ? '🌙' : '☀'}
        </button>
      </header>

      {/* Offline banner */}
      {!online && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-center text-[11px] font-medium text-amber-600">
          You're offline — events are saved on this device and will sync when the connection returns.
        </div>
      )}

      {/* Outcome banner — walkover / abandoned / not-played (above the score) */}
      {outcomeBanner(match) && (
        <div className="px-4 pt-3"><FixtureBanner match={match} /></div>
      )}

      {/* Transient notice (e.g. a blocked reversal) */}
      {notice && (
        <div className="bg-red-500/15 border-b border-red-500/30 px-4 py-2 text-center text-[11px] font-medium text-red-600">
          {notice}
        </div>
      )}

      {/* §7 nudge — well past expected full-time, gently prompt to end. Changes
          nothing; the daily sweep is the real backstop. Dismissible. */}
      {(running || isPaused) && !endNudgeDismissed && isPastExpectedEnd(match) && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-amber-600">Still playing? This match is well past full-time.</span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setConfirmEnd(true)}
              className="text-[10px] font-bold uppercase tracking-widest text-amber-700 hover:text-amber-800">End match</button>
            <button onClick={() => setEndNudgeDismissed(true)} aria-label="Dismiss"
              className="text-amber-500 hover:text-amber-700"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* Scoreline */}
      <div className={`px-5 py-6 landscape:py-3 border-b ${t.header} flex items-end justify-between gap-3 shrink-0`}>
        {/* Home */}
        <div className="flex-1 min-w-0 flex flex-col items-center">
          <TeamCrest identity={homeIdentity} size={32} className="mb-1.5" />
          {/* Fixed 2-line height so both score digits sit on the same baseline */}
          <div className="h-10 w-full flex items-start justify-center overflow-hidden mb-2 px-1">
            <span className={`text-[16px] font-semibold ${t.score} leading-snug text-center line-clamp-2`}>
              {homeIdentity?.primary ?? match.homeTeamName}
            </span>
          </div>
          <div className={`font-mono font-black tabular-nums leading-none ${t.score}`} style={{ fontSize: 64 }}>
            {match.homeScore ?? 0}
          </div>
        </div>
        {/* Dash — pb-5 centers it on the 64px score digits when items-end is in effect */}
        <div className={`font-mono ${t.muted} text-2xl shrink-0 pb-5`}>—</div>
        {/* Away */}
        <div className="flex-1 min-w-0 flex flex-col items-center">
          <TeamCrest identity={awayIdentity} size={32} className="mb-1.5" />
          <div className="h-10 w-full flex items-start justify-center overflow-hidden mb-2 px-1">
            <span className={`text-[16px] font-semibold ${t.score} leading-snug text-center line-clamp-2`}>
              {awayIdentity?.primary ?? match.awayTeamName}
            </span>
          </div>
          <div className={`font-mono font-black tabular-nums leading-none ${t.score}`} style={{ fontSize: 64 }}>
            {match.awayScore ?? 0}
          </div>
        </div>
      </div>

      {/* Timer bar */}
      {!isUpcoming && !isFinal && (
        <>
        <div className={`${t.bar} border-b px-5 py-4 flex items-center gap-4 shrink-0`}>
          {/* Pause/Resume — 56px tap target */}
          {isBreakState ? (
            <div className={`w-14 h-14 rounded-xl border flex items-center justify-center text-xl ${t.neutralBtn} opacity-40`}>⏸</div>
          ) : running ? (
            <button onClick={handlePause} disabled={saving}
              className={`w-14 h-14 rounded-xl border flex items-center justify-center text-xl ${t.neutralBtn}`}>⏸</button>
          ) : (
            <button onClick={handleResume} disabled={saving}
              className="w-14 h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center text-xl">▶</button>
          )}
          <div className="flex-1">
            <div className={`font-mono font-black tabular-nums leading-none ${
              isBreakState
                ? (breakSecsLeft <= 30 ? 'text-red-500' : t.score)
                : (clockRed ? 'text-red-500' : t.score)
            }`} style={{ fontSize: 36 }}>
              {isBreakState ? formatBreak(breakSecsLeft) : formatCountdown(periodRemaining)}
            </div>
            <div className={`text-[13px] font-bold uppercase tracking-[0.5px] ${
              (isBreakState ? breakSecsLeft <= 30 : clockRed) ? 'text-red-400' : t.muted
            } mt-0.5`}>
              {isBreakState ? 'Break' : match.currentPeriod}
            </div>
          </div>
          <button onClick={handleNextAction} disabled={saving}
            className={`px-7 rounded-xl font-bold text-sm transition-colors ${
              nextAction.kind === 'end_match'
                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`} style={{ minHeight: 56 }}>
            {nextAction.label} →
          </button>
        </div>
        {/* The alarm depends on JS running — a locked/dark screen means no
            beep, so the scorer must never rely on sound from a pocketed phone. */}
        <div className={`${t.bar} border-b px-5 py-1.5 text-center text-[10px] font-medium ${t.muted} shrink-0`}>
          Keep the screen on — the 00:00 alarm only sounds while this screen is awake.
        </div>
        </>
      )}

      {/* Timeline — only scrolling region */}
      <main className="flex-1 overflow-y-auto min-h-0 px-5 py-3">
        {timeline.length === 0 ? (
          <div className={`text-center text-[18px] ${t.muted}`} style={{ paddingTop: 80 }}>
            {isUpcoming ? 'Start the match to begin scoring.' : 'No events yet.'}
          </div>
        ) : (
          <div className="space-y-1">
            {timeline.map(ev => {
              const evKey = ev.id ?? `period-${ev.createdAt}`
              if (ev.kind === 'period') {
                const label =
                  ev.type === 'match_start' ? `Match started · ${ev.period}` :
                  ev.type === 'period_start' ? `${ev.period} started` :
                  ev.type === 'period_end'   ? `End of ${ev.period}` :
                  ev.type === 'match_end'    ? 'Full time' : ev.type
                return (
                  <div key={evKey} className={`flex items-center gap-3 py-1.5 ${t.muted}`}>
                    <span className={`font-mono text-xs w-16 shrink-0 tabular-nums`}>{gameMinuteLabel(match, ev.matchTimestamp)}</span>
                    <span className="text-[10px] shrink-0">
                      {ev.type === 'period_end' || ev.type === 'match_end' ? '■' : '▶'}
                    </span>
                    <span className="text-xs flex-1 min-w-0 font-semibold uppercase tracking-wide">{label}</span>
                    {ev.clockTime && (
                      <span className="text-[10px] font-mono shrink-0">{wallTime(ev.clockTime)}</span>
                    )}
                  </div>
                )
              }
              return (
                <div key={evKey} className={`flex items-center gap-3 py-1.5 ${t.timelineText}`}>
                  <span className={`font-mono text-xs ${t.muted} w-16 shrink-0 tabular-nums`}>{gameMinuteLabel(match, ev.matchTimestamp)}</span>
                  {ev.kind === 'goal' ? (
                    <span className="w-2.5 h-3 rounded-sm shrink-0" style={{ backgroundColor: teamColor(ev.side) }} />
                  ) : (
                    <span className={`w-2.5 h-3 rounded-sm shrink-0 ${CARD_DOT[ev.cardType] ?? 'bg-slate-400'}`} />
                  )}
                  <span className="text-sm flex-1 min-w-0 truncate">
                    <span className="font-semibold">{ev.kind === 'goal' ? 'Goal' : (CARD_LABEL[ev.cardType] ?? 'Card')}</span>
                    {' · '}{teamName(ev.side)}
                    {ev.kind === 'goal' && <span className={t.muted}> · {GOAL_TYPE_SHORT[ev.goalType] ?? 'Open Play'}</span>}
                    {ev.scorerName && <span className={t.muted}> · {ev.scorerName}</span>}
                    {ev.kind === 'goal' && ev.assistName && <span className={t.muted}> · A: {ev.assistName}</span>}
                    {ev.kind === 'card' && ev.playerName && <span className={t.muted}> · {ev.playerName}</span>}
                    {ev.kind === 'card' && cardDurationLabel(ev) && <span className={t.muted}> · {cardDurationLabel(ev)}</span>}
                  </span>
                  {!isFinal && (
                    menuFor === ev.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        {ev.kind === 'goal' && (ev.goalType ?? 'open') === 'open' && !ev.scorerName && (
                          <button onClick={() => { setMenuFor(null); setGoalEnrich({ eventId: ev.id, side: ev.side, step: 'type' }) }}
                            className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 px-2 py-1 rounded">
                            Enrich
                          </button>
                        )}
                        <button onClick={() => handleReverse(ev)}
                          className="text-[10px] font-bold uppercase tracking-widest text-red-500 px-2 py-1 rounded">
                          Reverse
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setMenuFor(ev.id)}
                        className={`${t.muted} hover:opacity-70 px-1 shrink-0`}>
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Action footer (live or paused only) — sticky bottom, safe-area aware */}
      {(running || isPaused) && (
        <div className={`shrink-0 border-t ${t.header} px-5 pt-4 space-y-4 landscape:space-y-2`}
          style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          {['home', 'away'].map(side => {
            const goalAccepted = tapLock === `${side}:goal`
            const cardAccepted = tapLock === `${side}:card`
            return (
              <div key={side}>
                {/* 8px between label and button row */}
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: teamColor(side) }} />
                  <span className={`text-[13px] font-bold uppercase tracking-[0.5px] ${t.muted}`}>
                    {teamName(side)} ({side === 'home' ? 'Home' : 'Away'})
                  </span>
                </div>
                {/* 70 / 30 split, 12px gap, 64px min height */}
                <div className="flex gap-3">
                  <button onClick={() => handleGoal(side)} disabled={saving || goalAccepted}
                    className={`flex-[7] text-white font-bold text-base rounded-xl transition-colors landscape:h-14 ${
                      goalAccepted ? 'bg-emerald-600' : 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50'
                    }`} style={{ minHeight: 64 }}>
                    {goalAccepted ? '✓ GOAL' : '+ GOAL'}
                  </button>
                  <button onClick={() => handleCardTap(side)} disabled={saving || cardAccepted}
                    className={`flex-[3] border font-bold text-sm rounded-xl transition-colors landscape:h-14 ${
                      cardAccepted ? 'bg-emerald-500/20 border-emerald-500 text-emerald-600' : t.neutralBtn
                    }`} style={{ minHeight: 64 }}>
                    {cardAccepted ? '✓' : 'CARD'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Start footer */}
      {isUpcoming && (
        <div className={`shrink-0 border-t ${t.header} px-5 pt-4`}
          style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <button onClick={handleStart} disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2"
            style={{ minHeight: 56 }}>
            <span className="w-2 h-2 rounded-full bg-white" /> Start match
          </button>
        </div>
      )}
      {isFinal && (
        <div className={`shrink-0 border-t ${t.header} px-4 py-4 text-center ${t.muted} text-sm font-bold uppercase tracking-widest`}>
          Full time · {formatClock(elapsedMs)}
          {match.shootoutHome != null && match.shootoutAway != null && (
            <span className="ml-2 normal-case">
              ({match.shootoutHome}–{match.shootoutAway} SO)
            </span>
          )}
        </div>
      )}

      {/* Goal enrichment — step 1: goal type */}
      {goalEnrich?.step === 'type' && (
        <Sheet t={t} title={`Goal · ${teamName(goalEnrich.side)}`}
          subtitle={`${gameMinuteLabel(match, enrichGoalEvent?.matchTimestamp ?? 0)} · recorded`}
          color={teamColor(goalEnrich.side)} onClose={() => setGoalEnrich(null)}>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {GOAL_TYPES.map(gt => {
              const active = (enrichGoalEvent?.goalType ?? 'open') === gt.key
              return (
                <button key={gt.key} onClick={() => applyGoalType(gt.key)}
                  className={`py-3 rounded-xl text-sm font-bold border transition-colors ${
                    active ? 'bg-emerald-500 border-emerald-500 text-white' : t.neutralBtn
                  }`}>
                  {gt.label}
                </button>
              )
            })}
          </div>
          {/* "Continue →" advances to attribution when lineup players exist;
              "Done" closes when there are no players to attribute to. */}
          <button onClick={advanceFromType}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3">
            {fixtureSidePlayers(goalEnrich.side).length > 0 ? 'Continue →' : 'Done'}
          </button>
        </Sheet>
      )}

      {/* Goal enrichment — step 2: player attribution (only when lineup players exist) */}
      {goalEnrich?.step === 'attribution' && (() => {
        const players = fixtureSidePlayers(goalEnrich.side)
        return (
          <Sheet t={t} title={`Who scored? · ${teamName(goalEnrich.side)}`}
            subtitle={`${gameMinuteLabel(match, enrichGoalEvent?.matchTimestamp ?? 0)}`}
            color={teamColor(goalEnrich.side)}
            dismissable={false} closable={false}
            onClose={() => {}}>
            <div className="space-y-1.5 max-h-64 overflow-y-auto mb-4">
              {players.map(entry => {
                const selected = enrichGoalEvent?.scorerPersonId === entry.personId
                return (
                  <button key={entry.id} onClick={() => applyGoalAttribution(entry)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      selected ? 'bg-emerald-500/20 border-emerald-500/50' : t.neutralBtn
                    }`}>
                    <span className={`font-mono text-sm font-black w-7 text-right shrink-0 tabular-nums ${
                      selected ? 'text-emerald-600' : t.muted
                    }`}>
                      {entry.shirtNumber ?? '—'}
                    </span>
                    <PersonAvatar name={entry.personName} photoUrl={entry.photoUrl} size={28} />
                    <span className="text-sm flex-1 truncate">{entry.personName}</span>
                    {entry.isStarter && (
                      <span className="text-emerald-500 text-[9px] font-bold shrink-0">★</span>
                    )}
                  </button>
                )
              })}
            </div>
            <button onClick={() => applyGoalAttribution(null)}
              className={`w-full border font-bold text-sm rounded-xl py-3 transition-colors ${t.neutralBtn}`}>
              Unassigned
            </button>
          </Sheet>
        )
      })()}

      {/* Goal enrichment — step 3: assist attribution (scorer excluded) */}
      {goalEnrich?.step === 'assist' && (() => {
        const players = fixtureSidePlayers(goalEnrich.side)
          .filter(p => p.personId !== goalEnrich.scorerPersonId)
        return (
          <Sheet t={t} title={`Who assisted? · ${teamName(goalEnrich.side)}`}
            subtitle={`${gameMinuteLabel(match, enrichGoalEvent?.matchTimestamp ?? 0)}`}
            color={teamColor(goalEnrich.side)}
            dismissable={false} closable={false}
            onClose={() => {}}>
            <div className="space-y-1.5 max-h-64 overflow-y-auto mb-4">
              {players.map(entry => {
                const selected = enrichGoalEvent?.assistPersonId === entry.personId
                return (
                  <button key={entry.id} onClick={() => applyGoalAssist(entry)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      selected ? 'bg-emerald-500/20 border-emerald-500/50' : t.neutralBtn
                    }`}>
                    <span className={`font-mono text-sm font-black w-7 text-right shrink-0 tabular-nums ${
                      selected ? 'text-emerald-600' : t.muted
                    }`}>
                      {entry.shirtNumber ?? '—'}
                    </span>
                    <PersonAvatar name={entry.personName} photoUrl={entry.photoUrl} size={28} />
                    <span className="text-sm flex-1 truncate">{entry.personName}</span>
                    {entry.isStarter && (
                      <span className="text-emerald-500 text-[9px] font-bold shrink-0">★</span>
                    )}
                  </button>
                )
              })}
            </div>
            <button onClick={() => applyGoalAssist(null)}
              className={`w-full border font-bold text-sm rounded-xl py-3 transition-colors ${t.neutralBtn}`}>
              No assist
            </button>
          </Sheet>
        )
      })()}

      {/* Card colour strip (colour required) */}
      {pendingCard && (
        <Sheet t={t} title={`Card · ${teamName(pendingCard.side)}`}
          subtitle={`${gameMinuteLabel(match, pendingCard.matchTimestamp)}`}
          color={teamColor(pendingCard.side)} onClose={() => setPendingCard(null)}>

          {pendingCard.cardType === 'green' ? (
            /* Green-card duration step */
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-4 h-5 rounded-sm bg-emerald-500 shrink-0" />
                <span className="font-bold text-sm">Green Card duration</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {GREEN_DURATIONS.map(min => (
                  <button key={min} onClick={() => writeCard('green', min)} disabled={saving}
                    className={`flex items-center justify-center font-bold text-sm rounded-xl border border-slate-300/30 hover:opacity-90 transition-opacity ${t.neutralBtn}`}
                    style={{ minHeight: 52 }}>
                    {min} min
                  </button>
                ))}
              </div>
              <button onClick={() => writeCard('green', null)} disabled={saving}
                className={`w-full text-sm font-bold rounded-xl py-3 transition-colors ${t.muted} hover:opacity-70`}>
                Skip — no duration
              </button>
            </>
          ) : (
            /* Player (optional) + colour selection */
            <>
              {pickerSidePlayers(pendingCard.side).length > 0 && (
                <>
                  <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-2`}>Player (optional)</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto mb-4">
                    {pickerSidePlayers(pendingCard.side).map(p => (
                      <button key={p.id}
                        onClick={() => setPendingCard(pc => ({ ...pc, playerName: p.personName, playerPlayerId: p.id }))}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left border transition-colors ${
                          pendingCard.playerPlayerId === p.id ? 'bg-emerald-500/20 border-emerald-500/50' : t.neutralBtn
                        }`}>
                        <span className={`font-mono text-xs ${t.muted} w-6 text-right shrink-0`}>{p.shirtNumber ?? '–'}</span>
                        <PersonAvatar name={p.personName} photoUrl={p.photoUrl} size={24} />
                        <span className="text-sm flex-1">{p.personName}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-2`}>Card colour</div>
              <div className="space-y-2">
                {CARD_TYPES.map(c => (
                  <button key={c.key} onClick={() => applyCardColour(c.key)}
                    className="w-full flex items-center gap-3 px-4 rounded-xl border border-slate-300/30 font-bold text-sm hover:opacity-90 transition-opacity"
                    style={{ minHeight: 52 }}>
                    <span className={`w-4 h-5 rounded-sm ${c.dot}`} />
                    {c.label}
                    {c.key === 'green' && <span className={`ml-auto text-[11px] ${t.muted}`}>Set duration →</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}

      {/* End match confirmation */}
      {confirmEnd && (
        <Sheet t={t} title="End match?" onClose={() => setConfirmEnd(false)}>
          <div className={`text-center mb-4`}>
            <div className="font-mono font-black text-3xl tabular-nums mb-1">
              {match.homeScore ?? 0} — {match.awayScore ?? 0}
            </div>
            <div className={`text-sm ${t.muted}`}>{match.homeTeamName} vs {match.awayTeamName}</div>
            <div className={`text-xs ${t.muted} mt-1`}>Duration {formatClock(elapsedMs)} · This will update standings.</div>
          </div>

          {/* Shootout — only offered on a drawn regulation score */}
          {(match.homeScore ?? 0) === (match.awayScore ?? 0) && (
            <div className={`mb-4 pt-4 border-t ${t.header}`}>
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={shootoutEnabled}
                  onChange={e => setShootoutEnabled(e.target.checked)}
                  className="accent-emerald-600 w-4 h-4" />
                <span className="text-sm font-semibold">Shootout?</span>
              </label>
              {shootoutEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1 truncate`}>
                      {match.homeTeamName ?? 'Home'}
                    </div>
                    <input type="number" min="0" max="99" value={shootoutHome}
                      onChange={e => setShootoutHome(e.target.value)}
                      placeholder="0"
                      className={`w-full rounded-lg border px-3 py-2 text-center font-mono font-bold text-xl focus:outline-none focus:border-emerald-500 ${t.neutralBtn}`} />
                  </div>
                  <div>
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1 truncate`}>
                      {match.awayTeamName ?? 'Away'}
                    </div>
                    <input type="number" min="0" max="99" value={shootoutAway}
                      onChange={e => setShootoutAway(e.target.value)}
                      placeholder="0"
                      className={`w-full rounded-lg border px-3 py-2 text-center font-mono font-bold text-xl focus:outline-none focus:border-emerald-500 ${t.neutralBtn}`} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setConfirmEnd(false)}
              className={`border font-bold text-sm rounded-xl py-3 ${t.neutralBtn}`}>Cancel</button>
            <button onClick={handleConfirmEnd}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl py-3">End match</button>
          </div>
        </Sheet>
      )}

      {/* Player of the Match selection — shown after finalization when players exist */}
      {potmStep && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className={`w-full max-w-md ${t.sheet} rounded-t-2xl border-t flex flex-col overflow-hidden`}
            style={{ maxHeight: '85dvh' }}>
            {/* Header */}
            <div className={`px-5 py-4 border-b ${bright ? 'border-slate-200' : 'border-slate-700'} shrink-0`}>
              <div className="flex items-center gap-2 mb-0.5">
                <Star className="w-4 h-4 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Player of the Match</span>
              </div>
              <p className={`text-sm ${t.muted}`}>Tap a player to award the honour, or skip.</p>
            </div>
            {/* Player list */}
            <div className="overflow-y-auto flex-1">
              {(['home', 'away']).map(side => {
                const players = side === 'home' ? (match.homeLineup ?? []) : (match.awayLineup ?? [])
                const teamName  = side === 'home' ? match.homeTeamName  : match.awayTeamName
                const teamColor = side === 'home' ? match.homeTeamColor : match.awayTeamColor
                if (players.length === 0) return null
                return (
                  <div key={side}>
                    <div className="flex items-center gap-2 px-4 py-2 sticky top-0"
                      style={{ backgroundColor: (teamColor ?? '#94a3b8') + '22' }}>
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: teamColor ?? '#94a3b8' }} />
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${t.muted}`}>{teamName}</span>
                    </div>
                    {players.map(p => (
                      <button key={p.id}
                        onClick={() => handleSelectPOTM({
                          personId:    p.personId    ?? null,
                          name:        p.personName,
                          side,
                          photoUrl:    p.photoUrl    ?? null,
                          shirtNumber: p.shirtNumber ?? null,
                        })}
                        className={`w-full flex items-center gap-3 px-4 py-3 border-b ${
                          bright ? 'border-slate-100 hover:bg-slate-50' : 'border-slate-800 hover:bg-slate-800'
                        } transition-colors text-left`}>
                        <span className="font-mono text-[11px] text-slate-400 w-5 text-right shrink-0">
                          {p.shirtNumber ?? '–'}
                        </span>
                        <PersonAvatar name={p.personName} photoUrl={p.photoUrl} size={28} />
                        <span className={`flex-1 text-sm font-medium truncate ${bright ? 'text-slate-900' : 'text-white'}`}>
                          {p.personName}
                        </span>
                        <Star className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
            {/* Skip */}
            <div className={`px-4 py-4 border-t shrink-0 ${bright ? 'border-slate-200' : 'border-slate-700'}`}>
              <button onClick={() => handleSelectPOTM(null)}
                className={`w-full border font-bold text-sm rounded-xl py-3 ${t.neutralBtn}`}>
                Skip — no award today
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-match: Full-time confirmation — stays open until dismissed */}
      {justFinalized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className={`w-full max-w-sm ${t.sheet} rounded-2xl border p-6 text-center`}>
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500 flex items-center justify-center mb-4">
              <Check className="w-7 h-7 text-white" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">Full time</div>
            <div className="font-mono font-black text-4xl tabular-nums mb-1">
              {match.homeScore ?? 0} — {match.awayScore ?? 0}
            </div>
            {match.shootoutHome != null && match.shootoutAway != null && (
              <div className={`text-sm font-mono ${t.muted} mb-1`}>
                ({match.shootoutHome}–{match.shootoutAway} SO)
              </div>
            )}
            <div className={`text-sm ${t.muted} mb-1`}>{match.homeTeamName} vs {match.awayTeamName}</div>
            <div className={`text-xs ${t.muted} mb-5`}>Result saved · standings updated</div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => {
                const hs = match.homeScore ?? 0
                const as = match.awayScore ?? 0
                const so = match.shootoutHome != null && match.shootoutAway != null
                  ? ` (${match.shootoutHome}–${match.shootoutAway} SO)` : ''
                const homeDisplay = match.homeOrgName ? `${match.homeOrgName} ${match.homeTeamName}` : (match.homeTeamName ?? "")
                const awayDisplay = match.awayOrgName ? `${match.awayOrgName} ${match.awayTeamName}` : (match.awayTeamName ?? "")
                const text = `Full time ⏱\n${homeDisplay} ${hs}–${as} ${awayDisplay}${so}`
                if (navigator.share) {
                  navigator.share({ title: 'Match result', text }).catch(() => {})
                } else {
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
                }
              }} className={`border font-bold text-sm rounded-xl py-3 ${t.neutralBtn}`}>
                Share result
              </button>
              <button onClick={() => navigate('/score')}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl py-3">
                Back to matches
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lineup panel */}
      {lineupOpen && (
        <Sheet t={t} title="Match Lineup" onClose={() => setLineupOpen(false)}>
          {/* Side tabs */}
          <div className="flex gap-2 mb-4">
            {['home', 'away'].map(side => (
              <button key={side} onClick={() => setLineupSide(side)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors flex items-center justify-center gap-2 ${
                  lineupSide === side ? 'bg-emerald-600 text-white border-emerald-600' : t.neutralBtn
                }`}>
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: teamColor(side) }} />
                {teamName(side)}
              </button>
            ))}
          </div>

          {lineupError && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-lg px-3 py-2 text-[12px] text-red-500 mb-3">
              {lineupError}
            </div>
          )}

          {/* Entries split by starter / sub */}
          {(() => {
            const entries = (lineupSide === 'home' ? match.homeLineup : match.awayLineup) ?? []
            const starters = entries.filter(e => e.isStarter)
            const subs     = entries.filter(e => !e.isStarter)
            if (entries.length === 0) return (
              <p className={`text-sm ${t.muted} text-center py-3 mb-4`}>No players added yet.</p>
            )
            return (
              <div className="mb-4 max-h-60 overflow-y-auto space-y-3">
                {starters.length > 0 && (
                  <div>
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>
                      Starting · {starters.length}
                    </div>
                    <ul className="space-y-1.5">
                      {starters.map(entry => (
                        <li key={entry.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${t.neutralBtn}`}>
                          <button onClick={() => handleToggleStarter(entry)} disabled={lineupSaving} title="Move to bench"
                            className="text-emerald-500 shrink-0 text-xs font-black">★</button>
                          {editEntryId === entry.id ? (
                            <span className="flex items-center gap-1 shrink-0">
                              <input type="number" min={1} max={99} value={editEntryShirt} autoFocus
                                onChange={e => setEditEntryShirt(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEntryShirt(entry) }}
                                placeholder="#"
                                className={`w-12 rounded-lg border px-1.5 py-1 text-xs ${t.neutralBtn}`} />
                              <button onClick={() => saveEntryShirt(entry)} disabled={lineupSaving}
                                title="Save shirt number" className="text-emerald-500 shrink-0">
                                <Check className="w-4 h-4" />
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => { setEditEntryId(entry.id); setEditEntryShirt(entry.shirtNumber ? String(entry.shirtNumber) : '') }}
                              title="Edit shirt number"
                              className={`font-mono text-xs ${t.muted} w-6 text-right shrink-0 hover:text-emerald-500 transition-colors`}>
                              {entry.shirtNumber || '#'}
                            </button>
                          )}
                          <PersonAvatar name={entry.personName} photoUrl={entry.photoUrl} size={26} />
                          <span className="text-sm flex-1 truncate">{entry.personName}</span>
                          <button onClick={() => handleRemoveFromLineup(entry)} disabled={lineupSaving}
                            className="text-red-500 hover:text-red-400 disabled:opacity-40 shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {subs.length > 0 && (
                  <div>
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>
                      Bench / squad · {subs.length}
                    </div>
                    <ul className="space-y-1.5">
                      {subs.map(entry => (
                        <li key={entry.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${t.neutralBtn}`}>
                          <button onClick={() => handleToggleStarter(entry)} disabled={lineupSaving} title="Mark as starter"
                            className={`shrink-0 text-xs font-black ${t.muted}`}>☆</button>
                          {editEntryId === entry.id ? (
                            <span className="flex items-center gap-1 shrink-0">
                              <input type="number" min={1} max={99} value={editEntryShirt} autoFocus
                                onChange={e => setEditEntryShirt(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEntryShirt(entry) }}
                                placeholder="#"
                                className={`w-12 rounded-lg border px-1.5 py-1 text-xs ${t.neutralBtn}`} />
                              <button onClick={() => saveEntryShirt(entry)} disabled={lineupSaving}
                                title="Save shirt number" className="text-emerald-500 shrink-0">
                                <Check className="w-4 h-4" />
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => { setEditEntryId(entry.id); setEditEntryShirt(entry.shirtNumber ? String(entry.shirtNumber) : '') }}
                              title="Edit shirt number"
                              className={`font-mono text-xs ${t.muted} w-6 text-right shrink-0 hover:text-emerald-500 transition-colors`}>
                              {entry.shirtNumber || '#'}
                            </button>
                          )}
                          <PersonAvatar name={entry.personName} photoUrl={entry.photoUrl} size={26} />
                          <span className="text-sm flex-1 truncate">{entry.personName}</span>
                          <button onClick={() => handleRemoveFromLineup(entry)} disabled={lineupSaving}
                            className="text-red-500 hover:text-red-400 disabled:opacity-40 shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })()}

          <button
            onClick={() => {
              setSelectedPerson(null); setLineupShirt(''); setLineupIsStarter(false)
              setLineupSearch(''); setShowAllPeople(false); setLineupError('')
              setAddPersonOpen(true)
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3">
            + Add player
          </button>
        </Sheet>
      )}

      {/* Add player to lineup */}
      {addPersonOpen && (
        <Sheet t={t} title={`Add to ${teamName(lineupSide)}`}
          color={teamColor(lineupSide)}
          onClose={() => setAddPersonOpen(false)}>
          {selectedPerson ? (
            /* Step 2: optional shirt# and starting status */
            <div>
              <div className={`text-sm font-bold text-center mb-4 truncate`}>{selectedPerson.fullName}</div>
              <div className="mb-4">
                <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Shirt # (optional)</div>
                <input type="text" value={lineupShirt} onChange={e => setLineupShirt(e.target.value)}
                  placeholder="e.g. 8"
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
              </div>
              <label className={`flex items-center gap-3 mb-4 cursor-pointer`}>
                <input type="checkbox" checked={lineupIsStarter} onChange={e => setLineupIsStarter(e.target.checked)}
                  className="accent-emerald-600 w-4 h-4" />
                <span className="text-sm font-medium">Starting player</span>
              </label>
              {lineupError && (
                <div className="bg-red-500/15 border border-red-500/30 rounded-lg px-3 py-2 text-[12px] text-red-500 mb-3">
                  {lineupError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setSelectedPerson(null)}
                  className={`border font-bold text-sm rounded-xl py-3 ${t.neutralBtn}`}>← Back</button>
                <button onClick={handleAddToLineup} disabled={lineupSaving}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl py-3">
                  {lineupSaving ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          ) : (
            /* Step 1: pick a person */
            <div>
              <input value={lineupSearch} onChange={e => setLineupSearch(e.target.value)}
                placeholder="Search by name…"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />

              {lineupSaving && (
                <p className={`text-[11px] ${t.muted} mb-2`}>Adding…</p>
              )}

              {!showAllPeople ? (
                /* Squad-first: one-tap add carries the squad shirt number through. */
                (() => {
                  const squad = squadForSide(lineupSide).filter(p =>
                    !lineupSearch || p.fullName.toLowerCase().includes(lineupSearch.toLowerCase()))
                  return (
                    <>
                      <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-2`}>
                        {teamName(lineupSide)} squad
                      </div>
                      {squad.length > 0 ? (
                        <ul className="space-y-1.5 max-h-52 overflow-y-auto mb-3">
                          {squad.map(sq => (
                            <li key={sq.id}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-xl border ${t.neutralBtn}`}>
                              <span className={`font-mono text-xs ${t.muted} w-6 text-right shrink-0`}>{sq.shirtNumber || '–'}</span>
                              <PersonAvatar name={sq.fullName} photoUrl={sq.photoUrl} size={26} />
                              <button onClick={() => { setSelectedPerson(sq); setLineupShirt(sq.shirtNumber ? String(sq.shirtNumber) : ''); setLineupIsStarter(false) }}
                                title="Set shirt / starter before adding"
                                className="text-sm flex-1 truncate text-left">
                                {sq.fullName}
                                {sq.position && <span className={`ml-1.5 text-[10px] font-bold uppercase tracking-widest ${t.muted}`}>{sq.position}</span>}
                              </button>
                              <button onClick={() => quickAddSquadPlayer(sq)} disabled={lineupSaving}
                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg px-2.5 py-1.5 shrink-0">
                                Add
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={`text-sm ${t.muted} text-center py-3 mb-3`}>
                          {lineupSearch ? 'No squad player by that name.' : 'No squad players for this team yet — search all players below.'}
                        </p>
                      )}
                    </>
                  )
                })()
              ) : (
                /* Anyone else — pick then set shirt/starter in step 2. */
                (() => {
                  const sideLineup = (lineupSide === 'home' ? match.homeLineup : match.awayLineup) ?? []
                  const filtered = allPeople.filter(p =>
                    (!lineupSearch || p.fullName.toLowerCase().includes(lineupSearch.toLowerCase())) &&
                    !sideLineup.some(e => e.personId === p.id)
                  )
                  return filtered.length > 0 ? (
                    <ul className="space-y-1.5 max-h-52 overflow-y-auto mb-3">
                      {filtered.map(p => (
                        <li key={p.id}>
                          <button onClick={() => { setSelectedPerson(p); setLineupShirt('') }}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${t.neutralBtn}`}>
                            <PersonAvatar name={p.fullName} photoUrl={p.photoUrl} size={28} />
                            <span className="text-sm flex-1 truncate">{p.fullName}</span>
                            {p.position && (
                              <span className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} shrink-0`}>{p.position}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={`text-sm ${t.muted} text-center py-3 mb-3`}>
                      {lineupSearch
                        ? 'No player found. Players need their own MatchPulse profile — ask them (or their parent) to sign up, then add them here.'
                        : 'No other players available.'}
                    </p>
                  )
                })()
              )}

              <button onClick={() => { setShowAllPeople(v => !v); setLineupSearch('') }}
                className={`w-full text-[11px] font-bold uppercase tracking-widest py-2.5 border rounded-xl transition-colors ${t.neutralBtn}`}>
                {showAllPeople ? '← Back to squad' : 'Search all players →'}
              </button>
            </div>
          )}
        </Sheet>
      )}

      {/* Match result — enter a result, or record a walkover / abandonment / not played */}
      {outcomeOpen && (
        <Sheet t={t} title="Match result" onClose={() => setOutcomeOpen(false)}>
          <ResultSheet
            match={match} t={t} busy={outcomeBusy} error={outcomeError} wkDefault={wkDefault}
            homeName={match.homeTeamName} awayName={match.awayTeamName}
            homePlayers={home} awayPlayers={away}
            onEnterResult={(payload) => runOutcome(() => submitFixtureResult(match.id, { ...payload, method: 'submitted' }))}
            onNotPlayed={(reason) => runOutcome(() => setFixtureNotPlayed(match.id, { reason }))}
            onWalkover={(payload) => runOutcome(() => setFixtureWalkover(match.id, payload))}
            onAbandon={(reason) => runOutcome(() => abandonMatch(match.id, { minute: Math.floor(getElapsedMs(match) / 60000), reason }))}
            onLetStand={() => runOutcome(() => letAbandonedStand(match.id))}
            onRevert={() => runOutcome(() => revertFixtureOutcome(match.id))}
          />
        </Sheet>
      )}

      {/* Edit match details — platform admin only */}
      {editMatchOpen && (
        <Sheet t={t} title="Edit match details" onClose={() => setEditMatchOpen(false)}>
          <div className="space-y-3">

            {/* Switch home & away — swaps identities, score and goal/card sides. */}
            <button onClick={handleSwapSides} disabled={editSaving}
              className={`w-full flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-widest py-2.5 border rounded-xl transition-colors disabled:opacity-50 ${t.neutralBtn}`}>
              <ArrowLeftRight className="w-3.5 h-3.5" /> Switch home &amp; away
            </button>

            {/* ── Home side ── */}
            <div className={`text-[11px] font-bold uppercase tracking-widest ${t.muted}`}>Home side</div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>School / club</div>
              <select value={editForm.homeOrgId} onChange={e => handleHomeOrgChange(e.target.value)}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`}>
                <option value="">— unchanged —</option>
                {editOrgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            {editForm.homeOrgId && (
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Team</div>
                <select value={editForm.homeTeamId} onChange={e => handleHomeTeamChange(e.target.value)}
                  disabled={editHomeTeamsLoading}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn} disabled:opacity-50`}>
                  <option value="">
                    {editHomeTeamsLoading ? 'Loading…' : editHomeTeams.length === 0 ? '— no registered teams —' : '— select team —'}
                  </option>
                  {editHomeTeams.map(team => <option key={team.id} value={team.id}>{team.displayName}</option>)}
                </select>
                {!editHomeTeamsLoading && editHomeTeams.length === 0 && (
                  <div className={`text-[10px] ${t.muted} mt-1`}>No registered teams — use Display name below.</div>
                )}
              </div>
            )}
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Display name</div>
              <input type="text" value={editForm.homeTeamName}
                onChange={e => setEditForm(f => ({ ...f, homeTeamName: e.target.value }))}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
            </div>

            {/* ── Away side ── */}
            <div className={`text-[11px] font-bold uppercase tracking-widest ${t.muted} pt-1`}>Away side</div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>School / club</div>
              <select value={editForm.awayOrgId} onChange={e => handleAwayOrgChange(e.target.value)}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`}>
                <option value="">— unchanged —</option>
                {editOrgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            {editForm.awayOrgId && (
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Team</div>
                <select value={editForm.awayTeamId} onChange={e => handleAwayTeamChange(e.target.value)}
                  disabled={editAwayTeamsLoading}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn} disabled:opacity-50`}>
                  <option value="">
                    {editAwayTeamsLoading ? 'Loading…' : editAwayTeams.length === 0 ? '— no registered teams —' : '— select team —'}
                  </option>
                  {editAwayTeams.map(team => <option key={team.id} value={team.id}>{team.displayName}</option>)}
                </select>
                {!editAwayTeamsLoading && editAwayTeams.length === 0 && (
                  <div className={`text-[10px] ${t.muted} mt-1`}>No registered teams — use Display name below.</div>
                )}
              </div>
            )}
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Display name</div>
              <input type="text" value={editForm.awayTeamName}
                onChange={e => setEditForm(f => ({ ...f, awayTeamName: e.target.value }))}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
            </div>

            {/* ── Schedule & format ── */}
            <div className={`text-[11px] font-bold uppercase tracking-widest ${t.muted} pt-1`}>Schedule &amp; format</div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Date &amp; time</div>
              <input type="datetime-local" value={editForm.scheduledAt}
                onChange={e => setEditForm(f => ({ ...f, scheduledAt: e.target.value }))}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
            </div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Pitch / venue</div>
              <input type="text" value={editForm.pitch}
                onChange={e => setEditForm(f => ({ ...f, pitch: e.target.value }))}
                placeholder="e.g. Field 1"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
            </div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Game type</div>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: false, label: 'Outdoor' }, { v: true, label: 'Indoor' }].map(opt => (
                  <button type="button" key={opt.label}
                    onClick={() => setEditForm(f => ({ ...f, indoor: opt.v }))}
                    className={`text-sm font-bold py-2.5 rounded-xl border transition-colors ${
                      (editForm.indoor === true) === opt.v
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : t.neutralBtn
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Periods</div>
                <input type="number" min="1" max="4" value={editForm.periods}
                  onChange={e => setEditForm(f => ({ ...f, periods: e.target.value }))}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
              </div>
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Period length (min)</div>
                <input type="number" min="1" max="90" value={editForm.periodMinutes}
                  onChange={e => setEditForm(f => ({ ...f, periodMinutes: e.target.value }))}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
              </div>
            </div>

            {/* ── Public URL ── */}
            <div className={`text-[11px] font-bold uppercase tracking-widest ${t.muted} pt-1`}>Public URL</div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${t.muted} mb-1.5`}>Match slug</div>
              <input type="text" value={editForm.matchSlug || ''}
                onChange={e => setEditForm(f => ({ ...f, matchSlug: e.target.value }))}
                placeholder="e.g. home-team-vs-away-team"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors ${t.neutralBtn}`} />
              <div className={`text-[10px] ${t.muted} mt-1 break-all`}>
                /…/matches/{slugify(editForm.matchSlug || '') || '—'}
              </div>
            </div>

            {editError && (
              <div className="bg-red-500/15 border border-red-500/30 rounded-lg px-3 py-2 text-[12px] text-red-500">
                {editError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button onClick={() => setEditMatchOpen(false)}
                className={`border font-bold text-sm rounded-xl py-3 ${t.neutralBtn}`}>Cancel</button>
              <button onClick={handleEditMatch} disabled={editSaving}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl py-3">
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// Match-result decision tree. The headline job is ENTERING a result for a game
// that was played but not live-scored — score plus optional scorer attribution
// (players credited, no fabricated minutes, no timeline). The other branches
// cover games that didn't happen (awarded / not played) and abandonments.
// Every action is reversible and audit-logged.
function ResultSheet({
  match, t, busy, error, wkDefault, homeName, awayName, homePlayers, awayPlayers,
  onEnterResult, onNotPlayed, onWalkover, onAbandon, onLetStand, onRevert,
}) {
  const [mode, setMode]     = useState('menu')    // menu | enter | didnt | award | notplayed | abandon
  const [winner, setWinner] = useState('home')
  const [awardKind, setAwardKind] = useState('walkover')  // walkover | withdrawal | no_show
  const [winScore, setWinScore]   = useState(numStr(wkDefault?.opposing, 5))
  const [loseScore, setLoseScore] = useState(numStr(wkDefault?.conceding, 0))
  const [reason, setReason] = useState('')
  // Enter-result state: scores + one scorer row per goal (optional).
  const [hs, setHs] = useState('')
  const [as, setAs] = useState('')
  const [homeScorers, setHomeScorers] = useState([])   // [{ name, personId }]
  const [awayScorers, setAwayScorers] = useState([])

  // The competition's default walkover score loads async — reflect it once here.
  useEffect(() => {
    setWinScore(numStr(wkDefault?.opposing, 5))
    setLoseScore(numStr(wkDefault?.conceding, 0))
  }, [wkDefault?.opposing, wkDefault?.conceding])

  const o = match.outcome
  const started = !!match.startedAt || match.status === 'live' || match.status === 'paused'
  const isFinal = match.status === 'final'
  const btn     = 'w-full text-sm font-bold py-3 rounded-xl border transition-colors text-left px-4 ' + (t?.neutralBtn ?? 'border-slate-200')
  const primary = 'w-full text-sm font-bold py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40'
  const danger  = 'w-full text-sm font-bold py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white disabled:opacity-40'
  const input   = 'w-full rounded-xl border px-3 py-2.5 text-sm ' + (t?.neutralBtn ?? 'border-slate-200')
  const sub     = `text-[11px] font-normal block mt-0.5 ${t?.muted ?? 'text-slate-500'}`

  // ── Frozen abandoned attempt → let-stand or revert ──
  if (o?.kind === 'abandoned' && o?.flag === 'frozen') {
    return (
      <div className="space-y-3">
        <p className={`text-sm ${t?.muted}`}>
          Abandoned at {o.frozen?.minute ? `${o.frozen.minute}'` : 'stoppage'} — frozen score {o.frozen?.home ?? 0}–{o.frozen?.away ?? 0}. Nothing counts until a replay finalises, or you let the frozen score stand.
        </p>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={onLetStand} disabled={busy} className={primary}>Let the frozen score stand (counts as the result)</button>
        <button onClick={onRevert} disabled={busy} className={btn}>Revert — undo the abandonment</button>
      </div>
    )
  }

  // ── Any other recorded outcome → revert ──
  if (o?.kind) {
    return (
      <div className="space-y-3">
        <p className={`text-sm ${t?.muted}`}>This fixture is recorded as <strong>{o.kind.replace('_', ' ')}</strong>. Reverting restores it to a normal, unresolved fixture.</p>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={onRevert} disabled={busy} className={danger}>Revert to normal play</button>
      </div>
    )
  }

  // ── Level 1 menu ──
  if (mode === 'menu') {
    return (
      <div className="space-y-2.5">
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {!isFinal && (
          <button onClick={() => setMode('enter')} className={btn}>
            Enter final result
            <span className={sub}>The game was played — type in the score (and scorers, if known). No live timeline is invented.</span>
          </button>
        )}
        {isFinal && (
          <p className={`text-[12px] ${t?.muted}`}>This match already has a final result — use <strong>Edit</strong> to correct the score. The options below reclassify it.</p>
        )}
        <button onClick={() => setMode('didnt')} className={btn}>
          Match didn't happen
          <span className={sub}>Walkover, withdrawal, no-show — or no result at all.</span>
        </button>
        {started && (
          <button onClick={() => setMode('abandon')} className={btn}>
            Match abandoned mid-play
            <span className={sub}>Freeze the current score and await a replay.</span>
          </button>
        )}
      </div>
    )
  }

  // ── Enter final result (score + optional scorers) ──
  if (mode === 'enter') {
    const validScore = hs !== '' && as !== '' && Number(hs) >= 0 && Number(as) >= 0
    function submit() {
      const goals = [
        ...homeScorers.filter(s => s.name).map(s => ({ side: 'home', scorerName: s.name, scorerPersonId: s.personId ?? null, assistName: s.assistName ?? null, assistPersonId: s.assistPersonId ?? null })),
        ...awayScorers.filter(s => s.name).map(s => ({ side: 'away', scorerName: s.name, scorerPersonId: s.personId ?? null, assistName: s.assistName ?? null, assistPersonId: s.assistPersonId ?? null })),
      ]
      onEnterResult({ homeScore: Number(hs), awayScore: Number(as), ...(goals.length ? { goals } : {}) })
    }
    return (
      <div className="space-y-3">
        <p className={`text-sm ${t?.muted}`}>Type in the final score. Add scorers if you know them — they count toward player stats. No minute-by-minute timeline is created.</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5 truncate`}>{homeName || 'Home'}</div>
            <input type="number" min={0} inputMode="numeric" value={hs} onChange={e => setHs(e.target.value)} className={input} />
          </div>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5 truncate`}>{awayName || 'Away'}</div>
            <input type="number" min={0} inputMode="numeric" value={as} onChange={e => setAs(e.target.value)} className={input} />
          </div>
        </div>
        <ScorerRows t={t} label={homeName || 'Home'} score={Number(hs) || 0} players={match.homeLineup ?? []} rows={homeScorers} setRows={setHomeScorers} input={input} />
        <ScorerRows t={t} label={awayName || 'Away'} score={Number(as) || 0} players={match.awayLineup ?? []} rows={awayScorers} setRows={setAwayScorers} input={input} />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={submit} disabled={busy || !validScore} className={primary}>Save final result</button>
        <button onClick={() => setMode('menu')} className={btn}>Back</button>
      </div>
    )
  }

  // ── Match didn't happen → credited or not? ──
  if (mode === 'didnt') {
    return (
      <div className="space-y-2.5">
        <p className={`text-sm ${t?.muted}`}>Was a team credited with the game?</p>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={() => setMode('award')} className={btn}>
          Yes — award it
          <span className={sub}>The opponent gets the walkover score. Standings count it; player stats don't.</span>
        </button>
        <button onClick={() => setMode('notplayed')} className={btn}>
          No — no result
          <span className={sub}>Festival or friendly that simply didn't happen. Nothing counts.</span>
        </button>
        <button onClick={() => setMode('menu')} className={btn}>Back</button>
      </div>
    )
  }

  // ── Award (walkover / withdrawal / no-show) ──
  if (mode === 'award') {
    function submit() {
      const w = Number(winScore) || 0, l = Number(loseScore) || 0
      onWalkover({
        kind: awardKind, awardedTo: winner,
        home: winner === 'home' ? w : l,
        away: winner === 'home' ? l : w,
        reason: reason.trim() || null,
      })
    }
    return (
      <div className="space-y-3">
        <div>
          <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5`}>Credited team (advances / wins)</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setWinner('home')} className={`text-sm font-bold py-2.5 rounded-xl border ${winner === 'home' ? 'bg-emerald-600 border-emerald-600 text-white' : (t?.neutralBtn ?? 'border-slate-200')}`}>{homeName || 'Home'}</button>
            <button onClick={() => setWinner('away')} className={`text-sm font-bold py-2.5 rounded-xl border ${winner === 'away' ? 'bg-emerald-600 border-emerald-600 text-white' : (t?.neutralBtn ?? 'border-slate-200')}`}>{awayName || 'Away'}</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5`}>Credited score</div>
            <input type="number" min={0} value={winScore} onChange={e => setWinScore(e.target.value)} className={input} />
          </div>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5`}>Opponent score</div>
            <input type="number" min={0} value={loseScore} onChange={e => setLoseScore(e.target.value)} className={input} />
          </div>
        </div>
        <div>
          <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5`}>Shown publicly as</div>
          <div className="grid grid-cols-3 gap-2">
            {[['walkover', 'Walkover'], ['withdrawal', 'Withdrawn'], ['no_show', 'No-show']].map(([k, lbl]) => (
              <button key={k} onClick={() => setAwardKind(k)}
                className={`text-[12px] font-bold py-2 rounded-xl border ${awardKind === k ? 'bg-slate-700 border-slate-700 text-white' : (t?.neutralBtn ?? 'border-slate-200')}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason (optional, shown publicly)" className={input} />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={submit} disabled={busy} className={primary}>Award the game</button>
        <button onClick={() => setMode('didnt')} className={btn}>Back</button>
      </div>
    )
  }

  // ── Not played ──
  if (mode === 'notplayed') {
    return (
      <div className="space-y-3">
        <p className={`text-sm ${t?.muted}`}>Marks the fixture as not played — no score, no log impact, no stats.</p>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason (optional, shown publicly)" className={input} />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={() => onNotPlayed(reason.trim() || null)} disabled={busy} className={primary}>Mark not played</button>
        <button onClick={() => setMode('didnt')} className={btn}>Back</button>
      </div>
    )
  }

  // ── Abandon ──
  return (
    <div className="space-y-3">
      <p className={`text-sm ${t?.muted}`}>Freezes the current score as a record, resets live scoring to 0–0 and returns the fixture to Scheduled to await a replay. Nothing counts until the replay finalises.</p>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason (optional, shown publicly)" className={input} />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button onClick={() => onAbandon(reason.trim() || null)} disabled={busy} className={danger}>Abandon &amp; freeze</button>
      <button onClick={() => setMode('menu')} className={btn}>Back</button>
    </div>
  )
}

// Scorer attribution rows for an entered result: one row per goal, each picked
// from the team's LINEUP (profiled players only — no free-text names). A goal
// with no scorer selected simply stays unattributed. `players` are the side's
// lineup entries ({ personId, personName }).
function ScorerRows({ t, label, score, players, rows, setRows, input }) {
  if (score <= 0) return null
  const available = (players ?? []).filter(p => p.personId)
  const canAdd = rows.length < score
  function setRow(i, patch) { setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r))) }
  function removeRow(i) { setRows(prev => prev.filter((_, j) => j !== i)) }
  return (
    <div>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${t?.muted} mb-1.5`}>{label} scorers (optional)</div>
      {available.length === 0 ? (
        <p className={`text-[11px] ${t?.muted} leading-relaxed`}>
          Add players to this team's lineup (in “Match Lineup”) to credit who scored — only players with a profile can be credited.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <select value={row.personId ?? ''} className={input + ' flex-1'}
                  onChange={e => {
                    const p = available.find(x => x.personId === e.target.value)
                    // A scorer change invalidates a same-player assist selection.
                    setRow(i, {
                      personId: p?.personId ?? null, name: p?.personName ?? '',
                      ...(row.assistPersonId && row.assistPersonId === p?.personId
                        ? { assistPersonId: null, assistName: null } : {}),
                    })
                  }}>
                  <option value="">Who scored?</option>
                  {available.map(p => <option key={p.personId} value={p.personId}>{p.personName}</option>)}
                </select>
                <button onClick={() => removeRow(i)} className={`shrink-0 p-2 rounded-lg border ${t?.neutralBtn ?? 'border-slate-200'}`} title="Remove">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {row.personId && available.length > 1 && (
                <select value={row.assistPersonId ?? ''} className={input}
                  onChange={e => {
                    const p = available.find(x => x.personId === e.target.value)
                    setRow(i, { assistPersonId: p?.personId ?? null, assistName: p?.personName ?? null })
                  }}>
                  <option value="">Assist — optional</option>
                  {available.filter(p => p.personId !== row.personId).map(p =>
                    <option key={p.personId} value={p.personId}>{p.personName}</option>)}
                </select>
              )}
            </div>
          ))}
          {canAdd && (
            <button onClick={() => setRows(prev => [...prev, { name: '', personId: null }])}
              className={`text-[11px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg border ${t?.neutralBtn ?? 'border-slate-200'}`}>
              + Add scorer ({rows.length}/{score})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function numStr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : String(fallback)
}
