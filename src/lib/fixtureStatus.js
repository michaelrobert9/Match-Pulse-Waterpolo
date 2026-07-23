// Fixture (match) lifecycle — the single source of truth for the six canonical
// statuses and the helpers that gate behaviour off them.
//
// SPEC: a fixture has EXACTLY six statuses. Distinctions *within* a status are
// presentation, driven by flags (e.g. `tracked`, `isPaused`) — never new
// statuses. The decision rule: if it changes whether a fixture counts toward
// standings or what actions are available, it's a status; if it only changes
// what's displayed, it's a flag.
//
//   scheduled        — on the calendar, not started. No clock, no result.
//   live             — match window is open. `tracked` distinguishes a
//                      human-scored match from an unattended auto-flip.
//   awaiting_result  — over by the clock, no confirmed result. Non-counting.
//                      Sits in the admin confirmation queue.
//   final            — human-confirmed result. The ONLY status that counts
//                      toward standings.
//   postponed        — not happening as planned, may return. Not terminal.
//                      Setting a new time returns it to `scheduled`.
//   cancelled        — terminal. Not happening, never counts.
//
// TRANSITIONAL NOTE — `paused`: the scorer clock currently stores a 7th status,
// `paused`. Per spec this is not a status (it changes only what's displayed, not
// counting or available actions) and is being collapsed into `live` + an
// `isPaused` flag in a later, isolated step. Until then, EVERY behavioural
// status check must go through the helpers below — never compare
// `status === 'live'` inline in new code — so the collapse is a one-function
// change here rather than a codebase-wide edit.

export const FIXTURE_STATUS = {
  SCHEDULED:       'scheduled',
  LIVE:            'live',
  AWAITING_RESULT: 'awaiting_result',
  FINAL:           'final',
  POSTPONED:       'postponed',
  CANCELLED:       'cancelled',
}

// The six canonical statuses, in lifecycle order. `paused` is deliberately
// absent — it is a transitional stored value folded into `live` by isLive().
export const FIXTURE_STATUSES = [
  FIXTURE_STATUS.SCHEDULED,
  FIXTURE_STATUS.LIVE,
  FIXTURE_STATUS.AWAITING_RESULT,
  FIXTURE_STATUS.FINAL,
  FIXTURE_STATUS.POSTPONED,
  FIXTURE_STATUS.CANCELLED,
]

// Accept either a match object or a bare status string.
function statusOf(m) {
  return typeof m === 'string' ? m : m?.status
}

// LEGACY: fixtures created before the rename store `status: 'upcoming'`. Reads
// tolerate it; writes only ever produce 'scheduled'. The migration script
// (scripts/migrate-fixture-status.mjs) rewrites old docs; once it has run
// everywhere, remove 'upcoming' from here and from SCHEDULED_QUERY_VALUES.
const LEGACY_SCHEDULED = 'upcoming'

// Status values to pass to a Firestore `where('status','in',…)` when querying
// for scheduled fixtures, tolerating un-migrated legacy docs.
export const SCHEDULED_QUERY_VALUES = [FIXTURE_STATUS.SCHEDULED, LEGACY_SCHEDULED]

// THE seam. A paused match is still "live" for every behavioural purpose
// (disclaimer, sweep eligibility, public view). When the paused→isPaused
// collapse lands, `paused` disappears as a stored value and this reduces to a
// single equality — and nothing else in the codebase has to change.
export function isLive(m) {
  const s = statusOf(m)
  return s === FIXTURE_STATUS.LIVE || s === 'paused'
}

export function isScheduled(m)       { const s = statusOf(m); return s === FIXTURE_STATUS.SCHEDULED || s === LEGACY_SCHEDULED }
export function isAwaitingResult(m)  { return statusOf(m) === FIXTURE_STATUS.AWAITING_RESULT }
export function isFinal(m)           { return statusOf(m) === FIXTURE_STATUS.FINAL }
export function isPostponed(m)       { return statusOf(m) === FIXTURE_STATUS.POSTPONED }
export function isCancelled(m)       { return statusOf(m) === FIXTURE_STATUS.CANCELLED }

// Only Final counts toward standings. The single predicate the standings engine
// and every stats aggregation must use — never inline `status === 'final'` for
// counting decisions.
export function countsForStandings(m) {
  return statusOf(m) === FIXTURE_STATUS.FINAL
}

// A fixture is "open" (still on the schedule, expected to produce a result) when
// it is scheduled, live, or awaiting a result. Postponed/cancelled/final are not
// open. Useful for "what's left to play" style counts.
export function isOpen(m) {
  return isScheduled(m) || isLive(m) || isAwaitingResult(m)
}

// Presentation metadata — label + Tailwind colour intent per status. Consumed by
// StatusBadge and any other surface that renders a status chip. `paused` is
// included as a transitional alias so the scorer clock still renders correctly
// until the collapse.
export const STATUS_META = {
  scheduled:       { label: 'Scheduled',       tone: 'sky'    },
  upcoming:        { label: 'Scheduled',       tone: 'sky'    }, // legacy alias
  live:            { label: 'Live',            tone: 'red'    },
  paused:          { label: 'Paused',          tone: 'amber'  },
  awaiting_result: { label: 'Awaiting result', tone: 'amber'  },
  final:           { label: 'Final',           tone: 'slate'  },
  postponed:       { label: 'Postponed',       tone: 'violet' },
  cancelled:       { label: 'Cancelled',       tone: 'slate'  },
}
