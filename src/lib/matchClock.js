// Match clock + period helpers.
//
// The timer is never persisted tick-by-tick. Elapsed time is computed from
// the match document's startedAt / pausedAt / totalPausedMs fields, so it
// survives page reloads and never drifts (always wall-clock based).

function toMillis(val) {
  if (!val) return null
  if (typeof val.toMillis === 'function') return val.toMillis()
  if (val instanceof Date) return val.getTime()
  return new Date(val).getTime()
}

// Elapsed match time in milliseconds, accounting for pauses and breaks.
// For final matches, uses endedAt instead of Date.now() so the clock shows
// the actual game duration rather than time-since-kickoff.
export function getElapsedMs(match) {
  if (!match?.startedAt) return 0
  const started     = toMillis(match.startedAt)
  if (started == null) return 0
  const totalPaused = match.totalPausedMs ?? 0
  const pausingNow  = match.pausedAt ? (Date.now() - toMillis(match.pausedAt)) : 0
  const refNow = (match.status === 'final' && match.endedAt)
    ? (toMillis(match.endedAt) ?? Date.now())
    : Date.now()
  return Math.max(0, (refNow - started) - totalPaused - pausingNow)
}

// mm:ss formatting for the running clock and timeline rows.
export function formatClock(ms) {
  const total = Math.floor((ms ?? 0) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Countdown clock ─────────────────────────────────────────────────────────
// The scorer's clock counts DOWN from the period length to 00:00 and then
// keeps going into negative time (-00:14) until the period is ended manually
// — hockey periods only end at a stoppage, never on the buzzer.

// Nominal period length in ms from the fixture config.
export function periodLengthMs(match) {
  return (match?.periodMinutes ?? DEFAULT_PERIOD_MINUTES) * 60 * 1000
}

// Cumulative elapsed-ms at which the current period began, read from the last
// match_start / period_start entry in the control log. The clock is frozen
// during breaks, so this equals the total ACTUAL play time of all completed
// periods — which is why each new period restarts the countdown at full
// length regardless of how long earlier periods ran.
export function currentPeriodStartMs(match) {
  const log = match?.controlLog ?? []
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === 'match_start' || log[i].type === 'period_start') {
      return log[i].matchTimestamp ?? 0
    }
  }
  return 0
}

// Time remaining in the current period; negative once play runs past the
// nominal length. Nothing in the model stops the clock at zero.
export function periodRemainingMs(match) {
  return periodLengthMs(match) - (getElapsedMs(match) - currentPeriodStartMs(match))
}

// mm:ss countdown display; negative values carry a leading minus (-00:14).
export function formatCountdown(ms) {
  const secs = Math.ceil((ms ?? 0) / 1000)
  const abs = Math.abs(secs)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${secs < 0 ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Game-minute labels (timeline) ───────────────────────────────────────────
// Timeline stamps count UP in game minutes and are period-aware: completed
// periods contribute their NOMINAL length, never their actual duration, so a
// Q1 that ran 14 real minutes still hands Q2 a 12' baseline (for 12-minute
// quarters). An event during a period's overtime is capped at the period's
// nominal end and flagged: 12' (ET).
export function gameMinuteLabel(match, matchTimestamp) {
  const ts = matchTimestamp ?? 0
  const nominalMs  = periodLengthMs(match)
  const nominalMin = nominalMs / 60000
  // Cumulative elapsed-ms at which each period began, in order.
  const starts = (match?.controlLog ?? [])
    .filter(e => e.type === 'match_start' || e.type === 'period_start')
    .map(e => e.matchTimestamp ?? 0)
    .sort((a, b) => a - b)
  if (starts.length === 0) starts.push(0)
  let idx = 0
  for (let i = 0; i < starts.length; i++) if (ts >= starts[i]) idx = i
  const within   = ts - starts[idx]
  const baseline = idx * nominalMin
  if (within > nominalMs) return `${Math.floor(baseline + nominalMin)}' (ET)`
  return `${Math.floor(baseline + within / 60000)}'`
}

// ── Period model ────────────────────────────────────────────────────────────
// Derive period labels from the fixture's `periods` setting. Defaults to a
// 2-period match (1st/2nd Half) for any legacy fixture without the field.

export function periodLabels(periods) {
  const n = periods ?? 2
  if (n === 4) return ['Q1', 'Q2', 'Q3', 'Q4']
  if (n === 2) return ['1st Half', '2nd Half']
  return Array.from({ length: n }, (_, i) => `Period ${i + 1}`)
}

// Match progression states used to decide which single control to show.
// currentPeriod stores either a play label, a break marker, or null.
export function isBreak(currentPeriod) {
  return currentPeriod === 'break' || currentPeriod === 'half_time'
}

// Given the fixture settings and current period, return the next action.
// Returns one of: { kind, label, period }
//   kind: 'end_period' | 'start_period' | 'end_match'
export function nextPeriodAction(match) {
  const labels = periodLabels(match?.periods)
  const current = match?.currentPeriod

  // Between periods → start next
  if (isBreak(current)) {
    const nextIndex = match?.nextPeriodIndex ?? 1
    if (nextIndex < labels.length) {
      return { kind: 'start_period', label: `Start ${labels[nextIndex]}`, period: labels[nextIndex], index: nextIndex }
    }
    return { kind: 'end_match', label: 'End match', period: null }
  }

  const idx = labels.indexOf(current)
  // If the stored label isn't in the current scheme — e.g. the period COUNT was
  // edited mid-match, flipping '1st/2nd Half' to 'Q1..Q4' — fall back to the
  // explicitly tracked position. During active play the current period's index
  // is always nextPeriodIndex - 1, so a count change is honoured immediately.
  const resolvedIdx = idx >= 0 ? idx : ((match?.nextPeriodIndex ?? 1) - 1)
  const isLast = resolvedIdx >= labels.length - 1

  if (isLast) {
    return { kind: 'end_match', label: 'End match', period: null }
  }
  return { kind: 'end_period', label: `End ${current}`, period: current, index: resolvedIdx }
}

// Default fixture format when none is set — modern hockey: four 12-minute
// quarters with short breaks (2 min between quarters, 5 min at half-time).
export const DEFAULT_PERIODS = 4
export const DEFAULT_PERIOD_MINUTES = 12
// Default break between periods in minutes (one entry per gap = periods - 1).
export const DEFAULT_BREAK_MINUTES = [2, 5, 2]

// The match format new fixtures should default to: the competition's configured
// `matchFormat` when set, otherwise the platform default. Callers spread this
// into a new fixture; the per-fixture form can still override it (e.g. a final
// played to a different format).
export function competitionMatchFormat(competition) {
  const f = competition?.matchFormat
  if (f && Number(f.periods) > 0) {
    return {
      periods:       Number(f.periods),
      periodMinutes: Number(f.periodMinutes ?? DEFAULT_PERIOD_MINUTES),
      breakMinutes:  Array.isArray(f.breakMinutes) ? f.breakMinutes : DEFAULT_BREAK_MINUTES,
      indoor:        f.indoor === true,
    }
  }
  return { periods: DEFAULT_PERIODS, periodMinutes: DEFAULT_PERIOD_MINUTES, breakMinutes: DEFAULT_BREAK_MINUTES, indoor: false }
}

// Rough expected full-time, in epoch ms: kickoff + all period minutes + breaks
// + a buffer. Used ONLY to surface a possibly-unfinished match to humans (the
// scorer nudge and the admin dashboard flag — spec §7); never to change state.
// Wall-clock based (an abandoned match is detected by real time elapsed, not
// game clock). Returns null when the match has not started.
export function expectedEndMs(match, bufferMinutes = 30) {
  const raw = match?.startedAt
  const startMs = raw?.toMillis ? raw.toMillis()
    : (typeof raw === 'number' ? raw : (raw ? new Date(raw).getTime() : null))
  if (startMs == null || Number.isNaN(startMs)) return null
  const periods   = match.periods ?? DEFAULT_PERIODS
  const periodMin = match.periodMinutes ?? DEFAULT_PERIOD_MINUTES
  const breakMin  = Array.isArray(match.breakMinutes)
    ? match.breakMinutes.reduce((a, b) => a + (Number(b) || 0), 0) : 0
  return startMs + (periods * periodMin + breakMin + bufferMinutes) * 60000
}

// Is a started match past its rough expected end (+ buffer)? A signal that a
// tracked match may have been abandoned without the scorer tapping End.
export function isPastExpectedEnd(match, bufferMinutes = 30) {
  const end = expectedEndMs(match, bufferMinutes)
  return end != null && Date.now() > end
}
