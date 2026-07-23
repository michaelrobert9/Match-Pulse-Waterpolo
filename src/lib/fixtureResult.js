// Fixtures without a normal played result — the single source of truth for how
// any outcome contributes to standings and stats.
//
// The model: ONE score slot on the match doc (homeScore/awayScore) with a status
// banner above it, carried in `match.outcome`. The banner's `flag` (awarded /
// frozen / final) tells standings and stats how to treat the score below it:
//
//   Awarded — allocated result (walkover / withdrawal / no-show). Standings read
//             the score. Stats ignore it (no real play happened).
//   Frozen  — a stopped attempt (abandoned, replay pending). Standings and stats
//             both ignore it.
//   Final   — a real result (played, or an abandoned attempt that was let-stand).
//             Standings and stats both read it.
//
// `computePoolStandings` (client) and `statsEngine.js` (functions) both derive
// their behaviour from fixtureContribution() — keep the functions mirror in sync.

export const OUTCOME_KIND = {
  NOT_PLAYED: 'not_played',
  WALKOVER:   'walkover',
  WITHDRAWAL: 'withdrawal',
  NO_SHOW:    'no_show',
  ABANDONED:  'abandoned',
}

export const RESULT_FLAG = { AWARDED: 'awarded', FROZEN: 'frozen', FINAL: 'final' }

// The awarded (allocation) kinds — a credited result, not a played one.
const AWARDED_KINDS = new Set([OUTCOME_KIND.WALKOVER, OUTCOME_KIND.WITHDRAWAL, OUTCOME_KIND.NO_SHOW])

// How a fixture contributes. Returns:
//   standings      — include in the log?
//   stats          — count timeline goals/cards toward stats?
//   home, away     — the scores standings should read
//   countsAllGoals — count EVERY timeline goal (incl. any abandoned-attempt
//                    goals); false means exclude goals flagged abandonedAttempt.
export function fixtureContribution(m) {
  const o = m && typeof m === 'object' ? m.outcome : null

  if (o && o.kind) {
    if (o.kind === OUTCOME_KIND.NOT_PLAYED) {
      return { standings: false, stats: false, home: 0, away: 0, countsAllGoals: false }
    }
    if (o.flag === RESULT_FLAG.AWARDED) {
      // Awarded score sits in the normal slot; stats ignore it.
      return { standings: true, stats: false, home: m.homeScore ?? 0, away: m.awayScore ?? 0, countsAllGoals: false, awarded: true }
    }
    if (o.flag === RESULT_FLAG.FROZEN) {
      return { standings: false, stats: false, home: 0, away: 0, countsAllGoals: false }
    }
    if (o.flag === RESULT_FLAG.FINAL) {
      // Abandoned-stands: the frozen attempt IS the result — count its goals too.
      const stands = o.kind === OUTCOME_KIND.ABANDONED
      return { standings: true, stats: true, home: m.homeScore ?? 0, away: m.awayScore ?? 0, countsAllGoals: stands }
    }
  }

  // No outcome → the normal lifecycle: only Final counts.
  const status = typeof m === 'string' ? m : m?.status
  const isFinal = status === 'final'
  return { standings: isFinal, stats: isFinal, home: m?.homeScore ?? 0, away: m?.awayScore ?? 0, countsAllGoals: false }
}

// Banner presentation for an outcome. Returns null for a normal played fixture.
const BANNER = {
  [OUTCOME_KIND.NOT_PLAYED]: { label: 'Not played',  tone: 'slate' },
  [OUTCOME_KIND.WALKOVER]:   { label: 'Walkover',    tone: 'red'   },
  [OUTCOME_KIND.WITHDRAWAL]: { label: 'Withdrawn',   tone: 'red'   },
  [OUTCOME_KIND.NO_SHOW]:    { label: 'No-show',     tone: 'red'   },
  [OUTCOME_KIND.ABANDONED]:  { label: 'Abandoned',   tone: 'red'   },
}

export function outcomeBanner(m) {
  const o = m?.outcome
  if (!o || !o.kind) return null
  const base = BANNER[o.kind] ?? { label: o.kind, tone: 'red' }
  // Abandoned that was let-stand reads differently.
  if (o.kind === OUTCOME_KIND.ABANDONED && o.flag === RESULT_FLAG.FINAL) {
    return { ...base, label: 'Abandoned — result stands', reason: o.reason ?? null, flag: o.flag }
  }
  return { ...base, reason: o.reason ?? null, flag: o.flag, awardedTo: o.awardedTo ?? null }
}

// The competition's walkover score, with the sides normalised. Default 5–0 to
// the opponent (existing rule shape: { concedingTeam, opposingTeam }).
export function walkoverScore(competition) {
  const w = competition?.rules?.walkoverScore ?? { concedingTeam: 0, opposingTeam: 5 }
  return { conceding: Number(w.concedingTeam ?? 0), opposing: Number(w.opposingTeam ?? 5) }
}
