/**
 * Pure scheduling engine — no Firestore or React dependencies.
 *
 * schedulePoolFixtures(slotPairs, poolId, config) → { assignments, overflow, warnings }
 *
 * slotPairs  : [[homeSlotId, awaySlotId], ...]  — one entry per fixture to schedule
 * poolId     : string — used to look up pinned fields when mode === 'pinned'
 * config     : {
 *   fields                : [{id, name}]
 *   operatingHours        : {start: 'HH:MM', end: 'HH:MM'}  — same every day
 *   matchDurationMinutes  : number
 *   changeoverGapMinutes  : number  — minimum gap between consecutive games on same field
 *   teamRestGapMinutes    : number  — minimum rest between a team's own games
 *   fieldAllocationMode   : 'any' | 'pinned'
 *   fieldPinning          : { [poolId]: [fieldId, ...] }     — only for 'pinned' mode
 *   startDate             : Date | Firestore timestamp | ISO string
 * }
 *
 * Returns:
 *   assignments : [{pairIndex, fieldId, fieldName, startMs}]
 *   overflow    : number — fixtures that could not be placed
 *   warnings    : string[]
 */
export function schedulePoolFixtures(slotPairs, poolId, config) {
  const {
    fields = [],
    operatingHours = { start: '08:00', end: '18:00' },
    matchDurationMinutes = 60,
    changeoverGapMinutes = 10,
    teamRestGapMinutes = 30,
    fieldAllocationMode = 'any',
    fieldPinning = {},
    startDate,
  } = config

  // Resolve eligible fields for this pool
  const eligibleIds = fieldAllocationMode === 'pinned'
    ? (fieldPinning[poolId] ?? [])
    : fields.map(f => f.id)
  const eligible = fields.filter(f => eligibleIds.includes(f.id))

  if (!eligible.length || !startDate) {
    const msg = !startDate ? 'No start date configured.' : !fields.length
      ? 'No fields configured.' : 'No fields assigned to this pool.'
    return { assignments: [], overflow: slotPairs.length, warnings: [msg] }
  }

  const matchMs      = matchDurationMinutes * 60000
  const changeoverMs = changeoverGapMinutes * 60000
  const restMs       = teamRestGapMinutes * 60000

  function toDayBase(d) {
    const copy = new Date(d); copy.setHours(0, 0, 0, 0); return copy.getTime()
  }

  function parseHHMM(s) {
    const [h, m] = s.split(':').map(Number); return (h * 60 + m) * 60000
  }

  const winStartOffset = parseHHMM(operatingHours.start)
  const winEndOffset   = parseHHMM(operatingHours.end)

  // Normalise start date
  let dayBase = toDayBase(
    startDate?.toDate ? startDate.toDate()
      : typeof startDate === 'string' ? new Date(startDate)
      : startDate
  )

  function windowFor(base) {
    return { start: base + winStartOffset, end: base + winEndOffset }
  }

  let win = windowFor(dayBase)

  // Per-field and per-slot-pair (team) availability tracked as absolute ms
  const fieldAvail = Object.fromEntries(eligible.map(f => [f.id, win.start]))
  const teamAvail  = {}  // slotId → ms when slot last became free

  const assignments = []
  let overflow = 0

  function advanceDay() {
    dayBase += 86400000
    win = windowFor(dayBase)
    for (const f of eligible) fieldAvail[f.id] = win.start
  }

  for (let i = 0; i < slotPairs.length; i++) {
    const [hId, aId] = slotPairs[i]
    let placed = false

    for (let d = 0; d < 60 && !placed; d++) {
      let bestField = null
      let bestStart = Infinity

      for (const f of eligible) {
        // Field must respect changeover gap from its last match
        const fLast   = fieldAvail[f.id]
        const fReady  = fLast > win.start ? fLast + changeoverMs : win.start

        // Teams must respect their own rest gap; overnight reset to day start
        const hLast  = teamAvail[hId] ?? 0
        const aLast  = teamAvail[aId] ?? 0
        const hReady = hLast + restMs > win.start ? hLast + restMs : win.start
        const aReady = aLast + restMs > win.start ? aLast + restMs : win.start

        const start = Math.max(fReady, hReady, aReady)

        if (start + matchMs <= win.end && start < bestStart) {
          bestStart = start
          bestField = f
        }
      }

      if (bestField) {
        const end = bestStart + matchMs
        assignments.push({ pairIndex: i, fieldId: bestField.id, fieldName: bestField.name, startMs: bestStart })
        fieldAvail[bestField.id] = end
        teamAvail[hId] = end
        teamAvail[aId] = end
        placed = true
      } else {
        advanceDay()
      }
    }

    if (!placed) overflow++
  }

  const warnings = []
  if (overflow > 0) {
    warnings.push(
      `${overflow} fixture${overflow !== 1 ? 's' : ''} could not fit within the configured schedule.`
    )
  }
  if (fieldAllocationMode === 'pinned' && overflow > 0) {
    const idle = fields.filter(f => !eligibleIds.includes(f.id))
    if (idle.length > 0) {
      warnings.push(
        `Pinned fields overloaded while ${idle.map(f => f.name).join(', ')} ${idle.length === 1 ? 'is' : 'are'} idle.`
      )
    }
  }

  return { assignments, overflow, warnings }
}
