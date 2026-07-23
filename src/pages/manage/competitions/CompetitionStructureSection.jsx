import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, X, Trophy, Users, ShieldCheck, Lock, AlertTriangle, Check, Loader2,
  Wand2, Calendar, Info, Flag, UserCog, RotateCcw, Medal, Trash2,
} from 'lucide-react'
import {
  fetchCompetitionMembers, fetchCompetitionFixtureMembers, fetchMatch,
  fetchCompetitionStages, fetchCompetitionPools, fetchCompetitionKnockout,
  fetchCompetitionAdvancement,
} from '../../../lib/queries'
import {
  createStage,
  createPool, deletePool, addPoolSlot, removePoolSlot, assignTeamToPoolSlot, setFixturePool,
  verifyPool, unverifyPool, resetPlayoffHoldingFixtureToPlaceholders, setPoolManualPlacement,
  createKnockoutSlot, updateKnockoutSlot, deleteKnockoutSlot, lockAdvancement,
  overrideSlotWithTeam, setSlotWalkover, revertSlotOverride, setPlayoffConfig,
  createPlayoffHoldingFixtures, stampPlayoffFixtureTeams, schedulePlayoffFixture,
  generatePoolFixtures, finalizePool,
} from '../../../lib/adminQueries'
import { computePoolStandings } from '../../../lib/standings'
import {
  ADVANCEMENT_SOURCE_TYPES, SLOT_STATUS,
  resolveBracket, computeBestPlacedAtPosition, knockoutResult,
} from '../../../lib/competitionStructure'
import {
  playoffRouter, planPlayoff, planKnockoutFirstRound, knockoutRoundCounts,
  knockoutSizeOptions, roundLabelForMatches, roundPrefix, BRONZE_ROUND_LABEL,
  PLAYOFF_TYPES, playoffFixtureSlug,
} from '../../../lib/playoffs'
import { competitionTeamLabel } from '../../../lib/teamNaming'
import { competitionMatchFormat } from '../../../lib/matchClock'
import StandingsTable from '../../../components/StandingsTable'

const CONFIRMED = new Set(['accepted', 'admin_approved'])
const POOL_LETTERS = 'ABCDEFGH'

function MicroLabel({ children }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{children}</p>
}

const STATUS_STYLE = {
  [SLOT_STATUS.resolved]:        { cls: 'text-emerald-700 bg-emerald-50', label: 'Confirmed' },
  [SLOT_STATUS.provisional]:     { cls: 'text-slate-500 bg-slate-100',    label: 'Provisional' },
  [SLOT_STATUS.manual_required]: { cls: 'text-amber-700 bg-amber-50',     label: 'Decision needed' },
  [SLOT_STATUS.unresolved]:      { cls: 'text-slate-400 bg-slate-50',     label: 'Awaiting' },
}

function ordinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th` }

// Strip the Home/Away suffix from a slot name to get the match label ("SF1").
function matchNameOf(slot) {
  return (slot?.name ?? '').replace(/\s+(Home|Away)$/i, '') || slot?.name || 'Match'
}

// Plain-sporting-language description of an advancement source. The raw
// source object is an implementation detail — organisers only ever see this.
function humanSource(source, { pools, knockout, teamName }) {
  if (!source) return 'Not configured'
  switch (source.type) {
    case 'pool_position': {
      const pool = pools.find(p => p.poolId === source.poolId)
      const pos = source.position === 1 ? 'Winner'
        : source.position === 2 ? 'Runner-up'
        : `${ordinal(source.position)} place`
      return `${pool?.name ?? 'Pool'} ${pos}`
    }
    case 'best_runner_up':
      return `Best ${ordinal(source.position)}-placed team (rank ${source.rank})`
    case 'bracket_winner': {
      const ref = knockout.find(k => k.slotId === source.matchSlotId)
      return `Winner of ${ref ? matchNameOf(ref) : 'previous match'}`
    }
    case 'bracket_loser': {
      const ref = knockout.find(k => k.slotId === source.matchSlotId)
      return `Loser of ${ref ? matchNameOf(ref) : 'previous match'}`
    }
    case 'manual_selection': return 'Chosen by organiser'
    case 'direct_team':      return teamName(source.teamId)
    default: return source.type
  }
}

// Group knockout slots into rounds (by roundLabel, in slot order) and pair
// consecutive slots within each round into matches.
function groupRounds(knockout) {
  const sorted = [...knockout].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const map = new Map()
  for (const s of sorted) {
    const key = s.roundLabel || 'Knockout'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(s)
  }
  return [...map.entries()].map(([label, slots]) => {
    const matches = []
    for (let i = 0; i < slots.length; i += 2) matches.push(slots.slice(i, i + 2))
    return { label, slots, matches }
  })
}

// Existing 2-slot games, as { slotId (home, the reference anchor), name, roundLabel }.
// A later game's winner/loser source points at the home slotId of the game it reads.
function bracketGames(knockout) {
  return groupRounds(knockout).flatMap(round =>
    round.matches
      .filter(pair => pair.length >= 2)
      .map(pair => ({ slotId: pair[0].slotId, name: matchNameOf(pair[0]), roundLabel: round.label })))
}

// Generate the pool structure (a pool stage + named pools with empty slots)
// from the organiser's plain-language configuration. Knockout/playoff brackets
// are NOT created here — they are set up separately in the Playoffs tab. Slots
// can be added or removed per pool afterwards (e.g. one pool of 7 and one of 6).
async function generateStructure(competitionId, { poolCount, teamsPerPool }) {
  let poolStage = null
  if (poolCount > 0) {
    poolStage = await createStage(competitionId, { type: 'pool', name: 'Pool Stage', order: 0 })
  }
  for (let i = 0; i < poolCount; i++) {
    await createPool(competitionId, {
      stageId: poolStage?.id ?? null,
      name: `Pool ${POOL_LETTERS[i]}`,
      slotCount: teamsPerPool,
      order: i,
    })
  }
  return { poolCount }
}

// ── Playoffs generators ───────────────────────────────────────────────────────
// Convert the existing pools into a planning shape (size = number of ranked
// positions = the pool's slot count).
function poolsForPlanning(pools) {
  return pools.map(p => ({ poolId: p.poolId, name: p.name, size: (p.slots ?? []).length }))
}

// Playoff (like-for-like ranking). Each game is two contiguous slots under its
// own unique round label. An odd team with no opposite number is dropped.
async function generatePlayoff(competitionId, pools, { depth }, startOrder = 0) {
  const { games } = planPlayoff({ pools: poolsForPlanning(pools), depth })
  let order = startOrder
  for (const g of games) {
    await createKnockoutSlot(competitionId, { name: g.home.name, roundLabel: g.roundLabel, order: order++, source: g.home.source })
    await createKnockoutSlot(competitionId, { name: g.away.name, roundLabel: g.roundLabel, order: order++, source: g.away.source })
  }
  return { gameCount: games.length }
}

// Knockout round (elimination). First round wired from pool positions; later
// rounds wired to bracket_winner of the previous round (Home slot by convention,
// matching the existing engine). Optional bronze wired from semi-final losers.
async function generateKnockoutRound(competitionId, pools, { qualifiers, bronze }, startOrder = 0) {
  const firstRound = planKnockoutFirstRound({ pools: poolsForPlanning(pools), qualifiers })
  const counts = knockoutRoundCounts(firstRound.length)
  let order = startOrder
  let prevHome = []
  let semiHome = []
  for (let r = 0; r < counts.length; r++) {
    const matches = counts[r]
    const label   = roundLabelForMatches(matches)
    const prefix  = roundPrefix(label)
    const homeIds = []
    for (let mi = 0; mi < matches; mi++) {
      const matchName = matches === 1 ? 'Final' : `${prefix}${mi + 1}`
      const homeSource = r === 0 ? firstRound[mi].homeSource : { type: 'bracket_winner', matchSlotId: prevHome[mi * 2] }
      const awaySource = r === 0 ? firstRound[mi].awaySource : { type: 'bracket_winner', matchSlotId: prevHome[mi * 2 + 1] }
      const hRef = await createKnockoutSlot(competitionId, { name: `${matchName} Home`, roundLabel: label, order: order++, source: homeSource })
      await createKnockoutSlot(competitionId, { name: `${matchName} Away`, roundLabel: label, order: order++, source: awaySource })
      homeIds.push(hRef.id)
    }
    if (matches === 2) semiHome = homeIds
    prevHome = homeIds
  }
  if (bronze && semiHome.length === 2) {
    await addBronzeGame(competitionId, semiHome, order)
  }
  return { rounds: counts.length, bronze: bronze && semiHome.length === 2 }
}

// Once a holding fixture's source pools are VERIFIED (slots resolve to confirmed
// teams), stamp the real teams onto the fixture. Pure resolution + idempotent
// writes (skips already-stamped games). Returns true if anything was stamped.
async function stampResolvedHoldingFixtures({ competition, members, pools, knockout, advancement, matches, fxMembers }) {
  const holdings = Object.values(matches).filter(m => m.isPlayoffHolding && (!m.homeTeamId || !m.awayTeamId))
  if (!holdings.length) return false

  const poolStandings = {}
  for (const pool of pools) {
    const pf = fxMembers.filter(f => f.poolId === pool.poolId)
    const poolTeamIds = (pool.slots ?? []).map(s => s.teamId).filter(Boolean)
    poolStandings[pool.poolId] = computePoolStandings(competition, members, pf, matches, { poolTeamIds, manualOverrides: pool.manualOverrides ?? [] })
  }
  const poolsCtx = {}
  for (const pool of pools) poolsCtx[pool.poolId] = { rows: poolStandings[pool.poolId]?.rows ?? [], verified: !!pool.verified }
  const maxPoolSize = Math.max(0, ...pools.map(p => (poolStandings[p.poolId]?.rows?.length ?? 0)))
  const maxRefPos   = Math.max(0, ...knockout.map(s => Number(s.source?.position) || 0))
  const maxPos = Math.max(maxPoolSize, maxRefPos, 1)
  const bestPlaced = {}
  for (let pos = 1; pos <= maxPos; pos++) {
    bestPlaced[pos] = computeBestPlacedAtPosition(
      pools.map(p => ({ poolId: p.poolId, verified: !!p.verified, rows: poolStandings[p.poolId]?.rows ?? [] })),
      pos, competition.rules?.tieBreakers ?? [])
  }
  const bracketResults = {}
  for (const slot of knockout) {
    if (slot.matchId && matches[slot.matchId]) {
      const r = knockoutResult(matches[slot.matchId])
      if (r) bracketResults[slot.slotId] = r
    }
  }
  const lockedTeams = {}
  for (const a of advancement) lockedTeams[a.slotId] = a.teamId
  const resolved = resolveBracket(knockout, { pools: poolsCtx, bestPlaced, bracketResults, lockedTeams })

  const detail = (teamId) => {
    const m = members.find(x => x.teamId === teamId)
    const snap = m?.displaySnapshot ?? {}
    return { teamId, teamName: snap.teamName ?? teamId, orgName: snap.orgName ?? null,
      color: snap.primaryColor ?? null, shortCode: snap.shortCode ?? null, orgId: m?.organizationId ?? null }
  }

  let any = false
  for (const m of holdings) {
    const hr = resolved[m.playoffHomeSlotId]
    const ar = resolved[m.playoffAwaySlotId]
    const home = (!m.homeTeamId && hr?.status === SLOT_STATUS.resolved && hr.teamId) ? detail(hr.teamId) : null
    const away = (!m.awayTeamId && ar?.status === SLOT_STATUS.resolved && ar.teamId) ? detail(ar.teamId) : null
    if (home || away) { await stampPlayoffFixtureTeams(competition.id, m.id, home, away); any = true }
  }
  return any
}

// Create the 3rd/4th play-off as two loser-of-semi-final slots.
async function addBronzeGame(competitionId, semiHomeSlotIds, startOrder) {
  await createKnockoutSlot(competitionId, {
    name: '3rd/4th Home', roundLabel: BRONZE_ROUND_LABEL, order: startOrder,
    source: { type: 'bracket_loser', matchSlotId: semiHomeSlotIds[0] },
  })
  await createKnockoutSlot(competitionId, {
    name: '3rd/4th Away', roundLabel: BRONZE_ROUND_LABEL, order: startOrder + 1,
    source: { type: 'bracket_loser', matchSlotId: semiHomeSlotIds[1] },
  })
}

export default function CompetitionStructureSection({ competition, panel = 'all' }) {
  const competitionId = competition.id
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  function flash(msg) { setNote(msg); setError(''); setTimeout(() => setNote(''), 4000) }

  async function reload() {
    try {
      const [members, fxMembers, stages, pools, knockout, advancement] = await Promise.all([
        fetchCompetitionMembers(competitionId),
        fetchCompetitionFixtureMembers(competitionId),
        fetchCompetitionStages(competitionId),
        fetchCompetitionPools(competitionId),
        fetchCompetitionKnockout(competitionId),
        fetchCompetitionAdvancement(competitionId),
      ])
      const matchIds = [...new Set(fxMembers.map(f => f.matchId).filter(Boolean))]
      const matchDocs = await Promise.all(matchIds.map(id => fetchMatch(id).catch(() => null)))
      const matches = {}
      matchDocs.forEach(m => { if (m) matches[m.id] = m })
      // Auto-stamp resolved teams onto playoff holding fixtures once their source
      // pools are verified. Idempotent: only writes unstamped, now-resolved games.
      const stamped = await stampResolvedHoldingFixtures({ competition, members, pools, knockout, advancement, matches, fxMembers }).catch(() => false)
      if (stamped) {
        const fresh = await Promise.all(matchIds.map(id => fetchMatch(id).catch(() => null)))
        fresh.forEach(m => { if (m) matches[m.id] = m })
      }
      setData({ members, fxMembers, matches, stages, pools, knockout, advancement })
    } catch {
      setError('Could not load tournament structure.')
    }
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [competitionId])

  async function run(fn, okMsg) {
    setBusy(true); setError('')
    try { await fn(); if (okMsg) flash(okMsg); await reload() }
    catch (err) { setError(err.message ?? 'Action failed.') }
    finally { setBusy(false) }
  }

  if (!data) {
    return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 text-emerald-500 animate-spin" /></div>
  }

  const confirmedMembers = data.members.filter(m => CONFIRMED.has(m.status))
  const teamName = id => {
    const m = data.members.find(m => m.teamId === id)
    return m ? (competitionTeamLabel(m.displaySnapshot) || id) : id
  }

  // Per-pool live standings (computed from the pool's assigned, counting
  // fixtures, scoped to the teams in the pool's slots — the source of truth
  // for pool membership).
  const poolStandings = {}
  for (const pool of data.pools) {
    const poolFixtures = data.fxMembers.filter(f => f.poolId === pool.poolId)
    const poolTeamIds = (pool.slots ?? []).map(s => s.teamId).filter(Boolean)
    poolStandings[pool.poolId] = computePoolStandings(competition, data.members, poolFixtures, data.matches, {
      poolTeamIds, manualOverrides: pool.manualOverrides ?? [],
    })
  }

  const hasStructure = data.pools.length > 0 || data.knockout.length > 0

  // Distribute unassigned confirmed teams evenly across unverified pools'
  // empty slots (one slot per pool per cycle). Teams are sorted alphabetically
  // before distribution so the order is deterministic. Leftover slots stay TBC.
  function autoAllocate() {
    const assigned = new Set(data.pools.flatMap(p => (p.slots ?? []).map(s => s.teamId).filter(Boolean)))
    const unassigned = confirmedMembers
      .filter(m => !assigned.has(m.teamId))
      .sort((a, b) => (a.displaySnapshot?.teamName ?? '').localeCompare(b.displaySnapshot?.teamName ?? ''))
    const queues = data.pools
      .filter(p => !p.verified)
      .map(p => ({ poolId: p.poolId, empty: (p.slots ?? []).filter(s => !s.teamId).map(s => s.slotId) }))
    const ops = []
    let teamIdx = 0
    while (teamIdx < unassigned.length) {
      const active = queues.filter(q => q.empty.length > 0)
      if (active.length === 0) break
      for (const q of active) {
        if (teamIdx >= unassigned.length) break
        ops.push({ poolId: q.poolId, slotId: q.empty.shift(), teamId: unassigned[teamIdx++].teamId })
      }
    }
    if (ops.length === 0) {
      setError(unassigned.length === 0
        ? 'All confirmed teams are already in a pool.'
        : 'No empty pool slots available — add a pool or increase slots.')
      return
    }
    const leftover = unassigned.length - ops.length
    run(async () => {
      for (const op of ops) await assignTeamToPoolSlot(competitionId, op.poolId, op.slotId, op.teamId)
    }, `${ops.length} team${ops.length !== 1 ? 's' : ''} allocated.${leftover > 0 ? ` ${leftover} could not be placed — add more pool slots.` : ''}`)
  }

  return (
    <section className="space-y-4">
      {note && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700 flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> {note}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>}

      {panel === 'standings' && (
        <PoolStandingsPanel pools={data.pools} poolStandings={poolStandings} />
      )}

      {(panel === 'all' || panel === 'structure') && (
        !hasStructure ? (
          <StructureWizard
            confirmedCount={confirmedMembers.length} busy={busy}
            onGenerate={cfg => run(() => generateStructure(competitionId, cfg), 'Structure generated.')}
          />
        ) : (
          <>
            <PoolsPanel
              competition={competition} pools={data.pools} stages={data.stages}
              confirmedMembers={confirmedMembers} fxMembers={data.fxMembers} matches={data.matches}
              poolStandings={poolStandings} teamName={teamName} busy={busy}
              onAutoAllocate={autoAllocate}
              onRefresh={() => run(async () => {}, 'Teams refreshed.')}
              onCreatePool={(stageId, name, slotCount) => run(() => createPool(competitionId, { stageId, name, slotCount, order: data.pools.length }), 'Pool created.')}
              onDeletePool={id => run(() => deletePool(competitionId, id), 'Pool deleted.')}
              onAddSlot={poolId => run(() => addPoolSlot(competitionId, poolId), 'Slot added.')}
              onRemoveSlot={(poolId, slotId) => run(() => removePoolSlot(competitionId, poolId, slotId), 'Slot removed.')}
              onAssignTeam={(poolId, slotId, teamId) => run(() => assignTeamToPoolSlot(competitionId, poolId, slotId, teamId), 'Team assigned.')}
              onAssignFixture={(matchId, poolId, crossPool) => run(() => setFixturePool(competitionId, matchId, poolId, { crossPool }), 'Fixture grouped.')}
              onVerify={(poolId, payload) => run(() => verifyPool(competitionId, poolId, payload), 'Pool verified — snapshot stored.')}
              onUnverify={(poolId) => {
                // Guard: a played playoff fixture means teams have already advanced —
                // reverting the pool could change who qualified, so refuse.
                const playedPlayoff = Object.values(data.matches).some(m =>
                  m.isPlayoffHolding && (['final', 'live', 'paused'].includes(m.status) || (m.goals?.length > 0)))
                if (playedPlayoff) {
                  setError('Cannot unverify: a playoff fixture has already been played. Reverting the pool could change who qualified.')
                  return
                }
                run(async () => {
                  await unverifyPool(competitionId, poolId)
                  // Reset every unplayed playoff holding fixture to its placeholders so
                  // it re-resolves from whatever pools remain verified (reload re-stamps
                  // the still-verified sides; sides from this pool stay as placeholders).
                  for (const m of Object.values(data.matches)) {
                    if (!m.isPlayoffHolding || m.isBye || m.status === 'final') continue
                    if (!m.homeTeamId && !m.awayTeamId) continue
                    const hSlot = data.knockout.find(s => s.slotId === m.playoffHomeSlotId)
                    const aSlot = data.knockout.find(s => s.slotId === m.playoffAwaySlotId)
                    const ctx = { pools: data.pools, knockout: data.knockout, teamName }
                    const hName = hSlot ? humanSource(hSlot.source, ctx) : (m.playoffGameName ? `${m.playoffGameName} Home` : 'TBC')
                    const aName = aSlot ? humanSource(aSlot.source, ctx) : (m.playoffGameName ? `${m.playoffGameName} Away` : 'TBC')
                    await resetPlayoffHoldingFixtureToPlaceholders(competitionId, m.id, hName, aName)
                  }
                }, 'Pool unverified — correct it, then re-verify once every fixture is scored.')
              }}
              onManualPlace={(poolId, placements, reason) => run(() => setPoolManualPlacement(competitionId, poolId, { placements, reason }), 'Manual placement recorded.')}
              onGenerateFixtures={async (poolId) => {
                setBusy(true); setError('')
                try {
                  const fmt = competitionMatchFormat(competition)
                  const result = await generatePoolFixtures(competitionId, poolId, {
                    season:        competition.season,
                    ownerOrgId:    competition.ownerOrgId || null,
                    scheduleConfig: competition.scheduleConfig ?? null,
                    periods:       fmt.periods,
                    periodMinutes: fmt.periodMinutes,
                    breakMinutes:  fmt.breakMinutes,
                    indoor:        fmt.indoor,
                  })
                  await reload()
                  const warns = result.warnings.length > 0 ? ` Warning: ${result.warnings.join(' ')}` : ''
                  flash(`${result.ids.length} fixture${result.ids.length !== 1 ? 's' : ''} generated.${warns}`)
                } catch (err) { setError(err.message ?? 'Fixture generation failed.') }
                finally { setBusy(false) }
              }}
              onFinalizePool={async (poolId) => {
                setBusy(true); setError('')
                try {
                  const result = await finalizePool(competitionId, poolId)
                  await reload()
                  const byeMsg = result.byeCount > 0 ? ` ${result.byeCount} bye${result.byeCount !== 1 ? 's' : ''} recorded.` : ''
                  const clashMsg = result.clashWarnings.length > 0 ? ` Warning: ${result.clashWarnings[0]}` : ''
                  flash(`Pool finalized.${byeMsg}${clashMsg}`)
                } catch (err) { setError(err.message ?? 'Finalize failed.') }
                finally { setBusy(false) }
              }}
            />
          </>
        )
      )}

      {(panel === 'all' || panel === 'knockout') && (
        <KnockoutPanel
          competition={competition} knockout={data.knockout} pools={data.pools} stages={data.stages}
          poolStandings={poolStandings} matches={data.matches} fxMembers={data.fxMembers}
          confirmedMembers={confirmedMembers} advancement={data.advancement} teamName={teamName} busy={busy} run={run}
          onCreate={payload => run(() => createKnockoutSlot(competitionId, { ...payload, order: data.knockout.length }), 'Knockout slot added.')}
          onCreateGame={({ name, roundLabel, homeSource, awaySource }) => run(async () => {
            const base  = data.knockout.length
            const label = roundLabel || name
            await createKnockoutSlot(competitionId, { name: `${name} Home`, roundLabel: label, order: base,     source: homeSource })
            await createKnockoutSlot(competitionId, { name: `${name} Away`, roundLabel: label, order: base + 1, source: awaySource })
          }, `Game “${name}” added.`)}
          onDeleteGame={slotIds => run(async () => { for (const id of slotIds) await deleteKnockoutSlot(competitionId, id) }, 'Game removed.')}
          onUpdate={(slotId, patch) => run(() => updateKnockoutSlot(competitionId, slotId, patch), 'Slot updated.')}
          onDelete={slotId => run(() => deleteKnockoutSlot(competitionId, slotId), 'Slot removed.')}
          onLock={(slotId, teamId, source) => run(() => lockAdvancement(competitionId, slotId, teamId, { source }), 'Advancement locked.')}
        />
      )}
    </section>
  )
}

// ── Structure wizard ─────────────────────────────────────────────────────────
// Plain-language pool setup. Creates the pools and their slots. The knockout /
// playoff bracket is set up separately in the Playoffs tab. Slots can be added
// or removed per pool afterwards, so uneven pools (e.g. 7 and 6) are supported.

function StructureWizard({ confirmedCount, busy, onGenerate }) {
  const [poolCount, setPoolCount]   = useState(2)
  const [teamsPerPool, setTeamsPerPool] = useState(4)

  const nothing = poolCount === 0
  const poolLabel = poolCount > 0
    ? `${poolCount} pool${poolCount !== 1 ? 's' : ''} (${POOL_LETTERS[0]}–${POOL_LETTERS[poolCount - 1]}) · ${teamsPerPool} slots each`
    : 'No pools'

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Wand2 className="w-4 h-4 text-emerald-500" />
        <h3 className="text-sm font-bold text-slate-800">Set up pools</h3>
      </div>
      <p className="text-[12px] text-slate-500 mb-4">
        Choose how many pools and how many team slots each starts with. You can add or remove slots
        per pool afterwards. Set up the knockout or playoff bracket later in the <span className="font-semibold">Playoffs</span> tab.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <MicroLabel>Number of pools</MicroLabel>
          <input type="number" min={0} max={8} value={poolCount}
            onChange={e => setPoolCount(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        {poolCount > 0 && (
          <div>
            <MicroLabel>Slots per pool</MicroLabel>
            <input type="number" min={2} max={16} value={teamsPerPool}
              onChange={e => setTeamsPerPool(Math.max(2, Math.min(16, Number(e.target.value) || 2)))}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}
      </div>

      {/* Plain-language preview */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-3 space-y-1">
        <p className="text-sm text-slate-700"><span className="font-bold">Pools:</span> {poolLabel}</p>
        {confirmedCount > 0 && poolCount > 0 && (
          <p className="text-[11px] text-slate-400 pt-1">
            {confirmedCount} confirmed team{confirmedCount !== 1 ? 's' : ''} · {poolCount * teamsPerPool} pool slot{poolCount * teamsPerPool !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      <button onClick={() => onGenerate({ poolCount, teamsPerPool })}
        disabled={busy || nothing}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-3 transition-colors">
        <Wand2 className="w-4 h-4" />
        {busy ? 'Generating…' : 'Create pools'}
      </button>
    </div>
  )
}

// ── Pool standings (read-only panel) ─────────────────────────────────────────

function PoolStandingsPanel({ pools, poolStandings }) {
  if (pools.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
        <p className="text-slate-500 text-sm">No pools yet.</p>
        <p className="text-slate-400 text-xs mt-1">Set up the tournament structure in the Structure tab first.</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {pools.map(pool => (
        <div key={pool.poolId} className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-slate-800">{pool.name}</span>
            {pool.verified
              ? <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Verified</span>
              : <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Live</span>}
          </div>
          <StandingsTable rows={poolStandings[pool.poolId]?.rows ?? []} />
        </div>
      ))}
    </div>
  )
}

// ── Pools ─────────────────────────────────────────────────────────────────

function fmtMatchTime(val) {
  if (!val) return null
  const d = val?.toDate ? val.toDate() : new Date(val)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function PoolsPanel({
  competition, pools, stages, confirmedMembers, fxMembers, matches, poolStandings, teamName, busy,
  onAutoAllocate, onRefresh, onCreatePool, onDeletePool, onAddSlot, onRemoveSlot,
  onAssignTeam, onAssignFixture, onVerify, onUnverify, onManualPlace,
  onGenerateFixtures, onFinalizePool,
}) {
  const poolStages = stages.filter(s => s.type === 'pool')
  const [name, setName] = useState('')
  const [stageId, setStageId] = useState('')
  const [slotCount, setSlotCount] = useState(4)
  const [showAddPool, setShowAddPool] = useState(false)

  // Fixtures eligible to be grouped: confirmed-member fixtures not yet in a pool.
  const groupableFixtures = fxMembers.filter(f => {
    const m = matches[f.matchId]
    return m && !f.poolId
  })

  const assignedIds = new Set(pools.flatMap(p => (p.slots ?? []).map(s => s.teamId).filter(Boolean)))
  const unassignedCount = confirmedMembers.filter(m => !assignedIds.has(m.teamId)).length
  const emptySlotCount = pools.filter(p => !p.verified).reduce((n, p) => n + (p.slots ?? []).filter(s => !s.teamId).length, 0)
  const overflow = unassignedCount - emptySlotCount

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" /><MicroLabel>Pools</MicroLabel></div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button onClick={onRefresh} disabled={busy} title="Reload teams added in the Teams tab"
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 border border-slate-200 rounded-md px-2.5 py-1 disabled:opacity-40">
              <RotateCcw className="w-3 h-3" /> Refresh teams
            </button>
          )}
          {pools.length > 0 && unassignedCount > 0 && emptySlotCount > 0 && (
            <button onClick={onAutoAllocate} disabled={busy}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 border border-emerald-200 rounded-md px-2.5 py-1 disabled:opacity-40">
              <Wand2 className="w-3 h-3" /> Auto-allocate teams
            </button>
          )}
          <button onClick={() => setShowAddPool(v => !v)}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 border border-slate-200 rounded-md px-2.5 py-1">
            <Plus className="w-3 h-3" /> Add pool
          </button>
        </div>
      </div>

      {overflow > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700 mb-3 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {unassignedCount} unplaced team{unassignedCount !== 1 ? 's' : ''} but only {emptySlotCount} empty slot{emptySlotCount !== 1 ? 's' : ''} — {overflow} team{overflow !== 1 ? 's' : ''} cannot be placed. Add another pool or increase slots.
        </div>
      )}

      {showAddPool && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 mb-4">
          <MicroLabel>New pool</MicroLabel>
          <div className="flex flex-wrap gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Pool name (e.g. Pool A)"
              className="flex-1 min-w-[140px] bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm placeholder-slate-400" />
            {poolStages.length > 0 && (
              <select value={stageId} onChange={e => setStageId(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
                <option value="">No stage</option>
                {poolStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <input type="number" min={2} max={12} value={slotCount} onChange={e => setSlotCount(Number(e.target.value))}
              className="w-20 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm" title="Slots" />
            <button onClick={() => { onCreatePool(stageId || null, name, slotCount); setName(''); setShowAddPool(false) }} disabled={busy || !name.trim()}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Create pool
            </button>
          </div>
        </div>
      )}

      {pools.length === 0 ? (
        <p className="text-[12px] text-slate-400">No pools yet.</p>
      ) : (
        <div className="space-y-4">
          {pools.map(pool => (
            <PoolCard
              key={pool.poolId} competition={competition} pool={pool}
              standings={poolStandings[pool.poolId]} confirmedMembers={confirmedMembers}
              fxMembers={fxMembers.filter(f => f.poolId === pool.poolId)} matches={matches}
              groupableFixtures={groupableFixtures} teamName={teamName} busy={busy}
              assignedTeamIds={assignedIds}
              onDeletePool={onDeletePool} onAddSlot={onAddSlot} onRemoveSlot={onRemoveSlot}
              onAssignTeam={onAssignTeam} onAssignFixture={onAssignFixture}
              onVerify={onVerify} onUnverify={onUnverify} onManualPlace={onManualPlace}
              onGenerateFixtures={onGenerateFixtures} onFinalizePool={onFinalizePool}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PoolCard({
  competition, pool, standings, confirmedMembers, fxMembers, matches, groupableFixtures,
  teamName, busy, assignedTeamIds, onDeletePool, onAddSlot, onRemoveSlot, onAssignTeam, onAssignFixture, onVerify, onUnverify, onManualPlace,
  onGenerateFixtures, onFinalizePool,
}) {
  // Teams for the slot dropdowns, sorted alphabetically by their full
  // (org + team) label so they're easy to find.
  const sortedMembers = [...confirmedMembers].sort((a, b) =>
    competitionTeamLabel(a.displaySnapshot).localeCompare(competitionTeamLabel(b.displaySnapshot)))
  const [showManual, setShowManual] = useState(false)
  const rows = standings?.rows ?? []
  const tied = (standings?.manualDecisionRequired ?? []).length > 0
  const poolMatchList = fxMembers
    .map(f => matches[f.matchId])
    .filter(Boolean)
    .sort((a, b) => (a.scheduledAt?.toMillis?.() ?? 0) - (b.scheduledAt?.toMillis?.() ?? 0))
  const unfilledCount = (pool.slots ?? []).filter(s => !s.teamId).length
  // Slots can only be resized before fixtures are generated and before the pool
  // is verified — fixtures reference slot ids.
  const canEditSlots = !pool.verified && !pool.finalized && poolMatchList.length === 0
  const slots = pool.slots ?? []
  // Verify is only allowed once every real fixture has a final result — a pool's
  // standings aren't official (and can't safely feed the playoffs) while games
  // are still outstanding. Byes need no score.
  const scorableFixtures = poolMatchList.filter(m => !m.isBye && m.status !== 'bye')
  const unscoredCount = scorableFixtures.filter(m => m.status !== 'final').length
  const allScored = poolMatchList.length > 0 && unscoredCount === 0

  function handleVerify() {
    if (!allScored) { alert('Score every fixture in this pool before verifying.'); return }
    if (tied) { alert('This pool has an unresolved tie. Record a manual placement before verifying.'); return }
    onVerify(pool.poolId, {
      rows,
      inputFixtureIds: fxMembers.map(f => f.matchId),
      tieBreakerChain: competition.rules?.tieBreakers ?? [],
      rulesHash: competition.rulesHash ?? null,
      manualOverrides: pool.manualOverrides ?? [],
    })
  }

  return (
    <div className="border border-slate-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-800">{pool.name}</span>
          {pool.verified
            ? <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Verified</span>
            : pool.finalized
            ? <span className="text-[10px] font-bold uppercase tracking-widest text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 flex items-center gap-1"><Flag className="w-3 h-3" /> Finalized</span>
            : <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Provisional</span>}
        </div>
        <button onClick={() => onDeletePool(pool.poolId)} disabled={busy} className="text-red-500 hover:text-red-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
      </div>

      {/* Slots → team assignment */}
      <div className="flex items-center justify-between mb-1.5">
        <MicroLabel>Teams</MicroLabel>
        <span className="text-[10px] text-slate-400">{slots.length} slot{slots.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        {slots.map((slot, i) => (
          <div key={slot.slotId} className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 w-12 shrink-0">{slot.label || `Slot ${i + 1}`}</span>
            <select value={slot.teamId ?? ''} disabled={busy || pool.verified}
              onChange={e => onAssignTeam(pool.poolId, slot.slotId, e.target.value || null)}
              className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm disabled:bg-slate-50">
              <option value="">— No team —</option>
              {sortedMembers
                // A team already placed in another slot is hidden, so it can't be
                // assigned twice. The team in THIS slot stays selectable.
                .filter(m => m.teamId === slot.teamId || !assignedTeamIds?.has(m.teamId))
                .map(m => (
                  <option key={m.teamId} value={m.teamId}>{competitionTeamLabel(m.displaySnapshot) || m.teamId}</option>
                ))}
            </select>
            {canEditSlots && onRemoveSlot && (
              <button
                onClick={() => {
                  if (slot.teamId) { alert('Set this slot to “No team” before removing it.'); return }
                  if (slots.length <= 1) { alert('A pool must keep at least one slot. Delete the pool instead.'); return }
                  onRemoveSlot(pool.poolId, slot.slotId)
                }}
                disabled={busy} title="Remove slot"
                className="text-slate-300 hover:text-red-500 disabled:opacity-40 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEditSlots && onAddSlot && (
        <button onClick={() => onAddSlot(pool.poolId)} disabled={busy}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 border border-emerald-200 rounded-md px-2.5 py-1 mb-3 disabled:opacity-40">
          <Plus className="w-3 h-3" /> Add slot
        </button>
      )}

      {/* Pool fixtures list */}
      {poolMatchList.length > 0 && (
        <div className="mb-3">
          <MicroLabel>Fixtures</MicroLabel>
          <ul className="space-y-1.5">
            {poolMatchList.map(m => (
              <li key={m.id} className="flex items-center gap-2 text-[12px] bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2">
                <span className="flex-1 truncate text-slate-700">
                  {m.homeOrgName ? `${m.homeOrgName} ${m.homeTeamName}` : (m.homeTeamName ?? "")} <span className="text-slate-400">v</span> {m.awayOrgName ? `${m.awayOrgName} ${m.awayTeamName}` : (m.awayTeamName ?? "")}
                </span>
                {fmtMatchTime(m.scheduledAt) && (
                  <span className="text-slate-400 shrink-0 tabular-nums">{fmtMatchTime(m.scheduledAt)}</span>
                )}
                {m.pitch && (
                  <span className="text-slate-500 shrink-0 text-[11px]">{m.pitch}</span>
                )}
                {m.isBye && (
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">Bye</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Auto-generate fixtures */}
      {!pool.verified && !pool.finalized && (
        <div className="mb-3">
          <MicroLabel>Generate fixtures</MicroLabel>
          {poolMatchList.length > 0 ? (
            <div className="flex items-start gap-1.5 text-[12px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>Fixtures already generated. Add cross-pool or extra fixtures manually if needed.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-[12px] text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-400" />
                <span>Auto-generation creates one fixture between each pair of teams in the pool. For cross-pool fixtures or extra matches against the same team, create them manually.</span>
              </div>
              <button onClick={() => onGenerateFixtures(pool.poolId)} disabled={busy}
                className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-500 rounded-md px-3 py-2 disabled:opacity-40 transition-colors">
                <Calendar className="w-3.5 h-3.5" /> Generate fixtures
              </button>
            </div>
          )}
        </div>
      )}

      {/* Group fixtures into this pool */}
      {groupableFixtures.length > 0 && !pool.verified && (
        <div className="mb-3">
          <MicroLabel>Add fixture to pool</MicroLabel>
          <div className="space-y-1.5">
            {groupableFixtures.map(f => {
              const m = matches[f.matchId]
              return (
                <div key={f.matchId} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 truncate text-slate-600">{m.homeOrgName ? `${m.homeOrgName} ${m.homeTeamName}` : (m.homeTeamName ?? "")} v {m.awayOrgName ? `${m.awayOrgName} ${m.awayTeamName}` : (m.awayTeamName ?? "")}</span>
                  <button onClick={() => onAssignFixture(f.matchId, pool.poolId, false)} disabled={busy}
                    className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 border border-emerald-200 rounded px-2 py-0.5 disabled:opacity-40">Add</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Live pool standings */}
      <MicroLabel>Pool standings {pool.verified ? '(verified)' : '(live)'}</MicroLabel>
      <StandingsTable rows={rows} />

      {/* Manual override history */}
      {(pool.manualOverrides ?? []).length > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {pool.manualOverrides.map((o, i) => (
            <div key={i} className="text-[11px] text-amber-700">
              <span className="font-bold uppercase tracking-widest">Manual placement:</span> {o.reason}
            </div>
          ))}
        </div>
      )}

      {/* Finalize pool */}
      {!pool.verified && !pool.finalized && poolMatchList.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => {
              const msg = unfilledCount > 0
                ? `Finalizing will convert fixtures for ${unfilledCount} unfilled slot${unfilledCount !== 1 ? 's' : ''} to byes. Continue?`
                : 'Finalize this pool? This locks the team roster.'
              if (window.confirm(msg)) onFinalizePool(pool.poolId)
            }}
            disabled={busy}
            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white bg-slate-600 hover:bg-slate-500 rounded-md px-3 py-1.5 disabled:opacity-40 transition-colors">
            <Flag className="w-3.5 h-3.5" /> Finalize pool
          </button>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Locks the team roster and turns any fixture with an empty slot into a bye. Use this to close off the group schedule — it does <span className="font-semibold">not</span> publish standings.
          </p>
        </div>
      )}

      {/* Verify / manual placement actions */}
      {!pool.verified && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {tied && (
              <button onClick={() => setShowManual(s => !s)} disabled={busy}
                className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700 border border-amber-300 rounded-md px-2.5 py-1 hover:bg-amber-50 disabled:opacity-40">
                <AlertTriangle className="w-3.5 h-3.5" /> Record manual placement
              </button>
            )}
            <button onClick={handleVerify} disabled={busy || rows.length === 0 || !allScored}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md px-3 py-1 disabled:opacity-40">
              <ShieldCheck className="w-3.5 h-3.5" /> Verify pool
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Publishes these standings as official, freezes a snapshot and locks the team assignments. Playoff games that reference this pool (e.g. “1st Pool A”) then fill in with the real teams.
            {!allScored && (
              <span className="block text-amber-600 font-medium mt-0.5">
                Available once every fixture is scored{unscoredCount > 0 ? ` — ${unscoredCount} still to play` : ''}.
              </span>
            )}
          </p>
        </div>
      )}

      {/* Unverify — reverse a verification (guarded: blocked once a playoff game
          has been played; resets auto-filled playoff fixtures to placeholders). */}
      {pool.verified && (
        <div className="mt-3">
          <button
            onClick={() => { if (window.confirm('Unverify this pool? Its standings return to provisional, the team assignments unlock, and any playoff games filled from this pool go back to placeholders so they re-resolve. Nothing that has already been played is changed.')) onUnverify(pool.poolId) }}
            disabled={busy}
            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-amber-700 border border-amber-300 rounded-md px-3 py-1.5 hover:bg-amber-50 disabled:opacity-40 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Unverify pool
          </button>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Reverses the verification so you can correct results or team assignments. Blocked if a playoff fixture fed by this pool has already been played.
          </p>
        </div>
      )}

      {showManual && (
        <ManualPlacementForm pool={pool} standings={standings} teamName={teamName} busy={busy}
          onSubmit={(placements, reason) => { onManualPlace(pool.poolId, placements, reason); setShowManual(false) }} />
      )}
    </div>
  )
}

function ManualPlacementForm({ pool, standings, teamName, busy, onSubmit }) {
  // Pre-populate placements with the tied teams in the order they currently sit.
  const tiedGroups = standings?.manualDecisionRequired ?? []
  const tiedIds = tiedGroups.flatMap(g => g.teamIds)
  const [order, setOrder] = useState(tiedIds)
  const [reason, setReason] = useState('')

  function move(i, delta) {
    setOrder(prev => {
      const next = [...prev]; const j = i + delta
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]; return next
    })
  }
  const basePos = tiedGroups[0]?.pos ?? 1
  const ready = reason.trim().length >= 5

  return (
    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
      <p className="text-[11px] text-amber-700 mb-2">
        The tie-breaker chain is exhausted. Order these teams manually. A reason is required and shown publicly.
      </p>
      <ol className="space-y-1 mb-2">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 bg-white border border-amber-200 rounded px-2 py-1.5">
            <span className="w-5 text-[11px] font-bold text-amber-700">{basePos + i}</span>
            <span className="flex-1 text-sm text-slate-700">{teamName(id)}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="text-amber-600 disabled:opacity-30 text-xs">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="text-amber-600 disabled:opacity-30 text-xs">↓</button>
          </li>
        ))}
      </ol>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason for manual placement (min 5 chars)…"
        className="w-full bg-white border border-amber-200 rounded-lg px-2.5 py-2 text-sm resize-none mb-2" />
      <button onClick={() => onSubmit(order.map((id, i) => ({ teamId: id, position: basePos + i })), reason.trim())}
        disabled={busy || !ready}
        className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold text-sm rounded-lg py-2">
        Record manual placement
      </button>
    </div>
  )
}

// ── Playoffs ──────────────────────────────────────────────────────────────────
// Default view: the bracket grouped into games by round, in plain sporting
// language. When no playoffs exist yet, the builder reads the pool count and
// offers the allowed types (Playoff / Knockout round / Custom). Slot/source
// internals live behind "Advanced bracket rules".

function KnockoutPanel({
  competition, knockout, pools, poolStandings, matches, fxMembers, confirmedMembers,
  advancement, teamName, busy, run, onCreate, onCreateGame, onDeleteGame, onUpdate, onDelete, onLock,
}) {
  const [addGameOpen, setAddGameOpen] = useState(false)
  const competitionId = competition.id
  const [advanced, setAdvanced] = useState(false)

  // Build resolution context for provisional/verified bracket display. The
  // best-placed ceiling is derived from the actual pools + referenced positions
  // (NOT a hard-coded 1–6) so "rank everyone" and pools of 7+ resolve correctly.
  const context = useMemo(() => {
    const poolsCtx = {}
    for (const pool of pools) {
      poolsCtx[pool.poolId] = { rows: poolStandings[pool.poolId]?.rows ?? [], verified: !!pool.verified }
    }
    const maxPoolSize = Math.max(0, ...pools.map(p => (poolStandings[p.poolId]?.rows?.length ?? (p.slots ?? []).length ?? 0)))
    const maxRefPos   = Math.max(0, ...knockout.map(s => Number(s.source?.position) || 0))
    const maxPos = Math.max(maxPoolSize, maxRefPos, 1)
    const bestPlaced = {}
    for (let pos = 1; pos <= maxPos; pos++) {
      bestPlaced[pos] = computeBestPlacedAtPosition(pools.map(p => ({
        poolId: p.poolId, verified: !!p.verified, rows: poolStandings[p.poolId]?.rows ?? [],
      })), pos, competition.rules?.tieBreakers ?? [])
    }
    // Bracket match results — a knockout slot with a linked match feeds winners/losers.
    const bracketResults = {}
    for (const slot of knockout) {
      if (slot.matchId && matches[slot.matchId]) {
        const r = knockoutResult(matches[slot.matchId])
        if (r) bracketResults[slot.slotId] = r
      }
    }
    const lockedTeams = {}
    for (const a of advancement) lockedTeams[a.slotId] = a.teamId
    return { pools: poolsCtx, bestPlaced, bracketResults, lockedTeams }
  }, [pools, poolStandings, knockout, matches, advancement, competition])

  const resolved = resolveBracket(knockout, context)
  const anyProvisional = Object.values(resolved).some(r => r.status === SLOT_STATUS.provisional)
  const rounds = groupRounds(knockout)

  // A semi-final round (exactly two games) is what bronze hangs off.
  const semis = rounds.find(r => r.label === 'Semi-final')
  const canBronze = !!semis && semis.matches.length === 2
  const bronzeOn  = knockout.some(s => s.roundLabel === BRONZE_ROUND_LABEL)

  // Toggle the 3rd/4th play-off after generation (incl. on match day). Wires the
  // existing loser-of-semi-final references into a game, or removes it.
  function toggleBronze(on) {
    run(async () => {
      await setPlayoffConfig(competitionId, { bronze: on })
      const existing = knockout.filter(s => s.roundLabel === BRONZE_ROUND_LABEL)
      if (on && existing.length === 0 && canBronze) {
        const semiHome = semis.matches.map(pair => pair[0].slotId)
        await addBronzeGame(competitionId, semiHome, knockout.length)
      } else if (!on) {
        for (const s of existing) await deleteKnockoutSlot(competitionId, s.slotId)
      }
    }, on ? '3rd/4th play-off added.' : '3rd/4th play-off removed.')
  }

  function clearAll() {
    if (!window.confirm('Clear all playoff games and start over? Locked advancements are removed too. Any holding fixtures created stay in the Fixtures tab.')) return
    run(async () => {
      for (const s of knockout) await deleteKnockoutSlot(competitionId, s.slotId)
    }, 'Playoffs cleared.')
  }

  // Games (2-slot) that don't yet have a holding fixture linked. Each becomes a
  // real, schedulable fixture with a stable game-type URL and placeholder teams.
  const fixtureGames = []
  rounds.forEach(round => round.matches.forEach((pair, i) => {
    if (pair.length < 2 || pair.some(s => s.matchId)) return
    fixtureGames.push({
      homeSlotId: pair[0].slotId, awaySlotId: pair[1].slotId,
      homeName: humanSource(pair[0].source, { pools, knockout, teamName }),
      awayName: humanSource(pair[1].source, { pools, knockout, teamName }),
      slug: playoffFixtureSlug(round.label, i, round.matches.length),
      roundLabel: round.label, gameName: matchNameOf(pair[0]),
    })
  }))
  function createFixtures() {
    run(() => createPlayoffHoldingFixtures(competition, fixtureGames, competitionMatchFormat(competition)),
      `${fixtureGames.length} playoff fixture${fixtureGames.length !== 1 ? 's' : ''} created.`)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Trophy className="w-4 h-4 text-slate-400" /><MicroLabel>Playoffs</MicroLabel></div>
        {/* The advanced toggle is ALWAYS available — a Custom bracket is built
            entirely from "Add slot" here, so it must be reachable before any
            slot exists (otherwise Custom has no way to add its first game). */}
        <div className="flex items-center gap-2">
          {knockout.length > 0 && (
            <button onClick={clearAll} disabled={busy}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 border border-red-200 rounded-md px-2 py-1 disabled:opacity-40">
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          )}
          <button onClick={() => setAdvanced(a => !a)}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 border border-slate-200 rounded-md px-2.5 py-1 transition-colors">
            {advanced ? 'Hide advanced bracket rules' : 'Advanced bracket rules'}
          </button>
        </div>
      </div>

      {anyProvisional && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-500 mb-3">
          Playoff positions are based on current pool standings and have not yet been verified.
        </div>
      )}

      {knockout.length === 0 ? (
        <PlayoffsBuilder
          competition={competition} pools={pools} busy={busy} run={run}
          onCreateGame={onCreateGame}
        />
      ) : (
        <div className="space-y-4">
          {fixtureGames.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
              <p className="text-[12px] text-emerald-800 flex-1">
                Turn {fixtureGames.length} game{fixtureGames.length !== 1 ? 's' : ''} into schedulable fixtures. They appear in the Fixtures tab as holding cards and fill in teams automatically once pools are verified.
              </p>
              <button onClick={createFixtures} disabled={busy}
                className="shrink-0 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-1.5">
                Create fixtures
              </button>
            </div>
          )}
          {rounds.map(round => (
            <div key={round.label}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                {round.label}{round.matches.length > 1 ? 's' : ''}
              </p>
              <div className="space-y-2">
                {round.matches.map((pair) => (
                  <KnockoutMatchCard
                    key={pair[0].slotId} pair={pair} resolved={resolved}
                    pools={pools} knockout={knockout} matches={matches} fxMembers={fxMembers}
                    confirmedMembers={confirmedMembers} competitionId={competitionId} run={run}
                    teamName={teamName} busy={busy} onUpdate={onUpdate} onLock={onLock}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Bronze (3rd/4th) — off by default; toggleable any time. */}
          {canBronze && (
            <label className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={bronzeOn} disabled={busy} onChange={e => toggleBronze(e.target.checked)} />
              <Medal className="w-4 h-4 text-amber-500" />
              <span className="text-[12px] text-slate-700">Include 3rd/4th play-off (bronze) — losers of the semi-finals</span>
            </label>
          )}

          {/* Add another game — chain a new fixture off pool positions or the
              winner/loser of any game already in the bracket. */}
          {addGameOpen ? (
            <div className="border border-emerald-200 rounded-xl p-3 bg-emerald-50/40">
              <div className="flex items-center justify-between mb-2">
                <MicroLabel>Add a game</MicroLabel>
                <button onClick={() => setAddGameOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              </div>
              <CustomGameForm pools={pools} games={bracketGames(knockout)} busy={busy}
                onCreateGame={onCreateGame} onDone={() => setAddGameOpen(false)} />
            </div>
          ) : (
            <button onClick={() => setAddGameOpen(true)}
              className="w-full flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700 border border-emerald-200 rounded-xl py-2.5 hover:bg-emerald-50 transition-colors">
              <Plus className="w-4 h-4" /> Add a game
            </button>
          )}
        </div>
      )}

      {advanced && (
        <AdvancedKnockout
          knockout={knockout} pools={pools} confirmedMembers={confirmedMembers}
          resolved={resolved} teamName={teamName} busy={busy}
          onCreate={onCreate} onDelete={onDelete}
        />
      )}
    </div>
  )
}

// ── Playoffs builder ──────────────────────────────────────────────────────────
// Reads the EXISTING pool count and routes to the allowed types. Generates the
// bracket via the existing knockout slot model — no new data model.
function PlayoffsBuilder({ competition, pools, busy, run, onCreateGame }) {
  const competitionId = competition.id
  const router = playoffRouter(pools.length)
  const [type, setType] = useState(router.types[0] ?? 'custom')

  // Playoff depth.
  const [depthMode, setDepthMode] = useState('all')   // 'all' | 'downTo'
  const [downTo, setDownTo] = useState(8)
  // Knockout size + bronze.
  const sizeOptions = knockoutSizeOptions(pools.length)
  const [qualifiers, setQualifiers] = useState(sizeOptions[0]?.qualifiers ?? 2)
  const [bronze, setBronze] = useState(false)

  if (pools.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-slate-500">No pools yet.</p>
        <p className="text-[12px] text-slate-400 mt-1">Create pools in the Structure tab, then set up playoffs here.</p>
      </div>
    )
  }

  const planPreview = (() => {
    if (type !== 'playoff') return null
    const depth = depthMode === 'downTo' ? { mode: 'downTo', position: Number(downTo) } : { mode: 'all' }
    const { games } = planPlayoff({ pools: poolsForPlanning(pools), depth })
    return { games: games.length, max: games.length * 2 }
  })()

  function generate() {
    if (type === 'playoff') {
      const depth = depthMode === 'downTo' ? { mode: 'downTo', position: Number(downTo) } : { mode: 'all' }
      run(() => generatePlayoff(competitionId, pools, { depth }), 'Playoff games generated.')
    } else if (type === 'knockout') {
      run(async () => {
        await setPlayoffConfig(competitionId, { bronze })
        await generateKnockoutRound(competitionId, pools, { qualifiers, bronze })
      }, 'Knockout round generated.')
    }
  }

  return (
    <div>
      <p className="text-[12px] text-slate-500 mb-3">
        {pools.length} pool{pools.length !== 1 ? 's' : ''} detected. Choose how the playoffs are decided.{' '}
        <Link to="/support/playoffs/build-a-knockout-stage" className="text-emerald-600 hover:text-emerald-500 font-semibold">Learn more</Link>
      </p>

      {router.message && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-[12px] text-blue-700 mb-3 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {router.message}
        </div>
      )}

      {/* Type chooser — only the allowed types for this pool count. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {router.types.map(t => (
          <button key={t} onClick={() => setType(t)}
            className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
              type === t ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'
            }`}>
            <div className="text-sm font-bold text-slate-800">{PLAYOFF_TYPES[t].label}</div>
            <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{PLAYOFF_TYPES[t].summary}</div>
          </button>
        ))}
      </div>

      {/* Playoff config */}
      {type === 'playoff' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3 mb-3">
          <div>
            <MicroLabel>How far to rank</MicroLabel>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setDepthMode('all')}
                className={`text-[12px] font-bold rounded-lg px-3 py-1.5 border ${depthMode === 'all' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                Rank everyone
              </button>
              <button onClick={() => setDepthMode('downTo')}
                className={`text-[12px] font-bold rounded-lg px-3 py-1.5 border ${depthMode === 'downTo' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                Choose a number
              </button>
              {depthMode === 'downTo' && (
                <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
                  down to
                  <input type="number" min={2} value={downTo}
                    onChange={e => setDownTo(Math.max(2, Number(e.target.value) || 2))}
                    className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm" />
                  place
                </span>
              )}
            </div>
          </div>
          {planPreview && (
            <p className="text-[11px] text-slate-500">
              {planPreview.games} game{planPreview.games !== 1 ? 's' : ''}
              {planPreview.max ? ` · ranks down to ${poOrdinalLabel(planPreview.max)}` : ''}
              {' · an unpaired odd team is dropped'}
            </p>
          )}
        </div>
      )}

      {/* Knockout config */}
      {type === 'knockout' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3 mb-3">
          <div>
            <MicroLabel>Bracket size</MicroLabel>
            <select value={qualifiers} onChange={e => setQualifiers(Number(e.target.value))}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
              {sizeOptions.map(o => <option key={o.value} value={o.qualifiers}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={bronze} onChange={e => setBronze(e.target.checked)} />
            <Medal className="w-4 h-4 text-amber-500" />
            <span className="text-[12px] text-slate-700">Include 3rd/4th play-off (bronze) — off by default</span>
          </label>
        </div>
      )}

      {/* Custom — build each game directly: name it, pick who plays who. */}
      {type === 'custom' && (
        <div className="space-y-3 mb-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[12px] text-slate-600 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>Build each game below: name it, then choose the home and away side — a pool position (e.g. “1st Pool A”), or the winner/loser of a game you already added. Add your first games from pool positions, then chain later games off their winners.</span>
          </div>
          <CustomGameForm pools={pools} games={[]} busy={busy} onCreateGame={onCreateGame} />
        </div>
      )}

      {type !== 'custom' && (
        <button onClick={generate} disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-3 transition-colors">
          <Wand2 className="w-4 h-4" />
          {busy ? 'Generating…' : `Generate ${PLAYOFF_TYPES[type].label.toLowerCase()}`}
        </button>
      )}
    </div>
  )
}

// Small ordinal helper for previews (kept local to avoid importing under an alias).
function poOrdinalLabel(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function KnockoutMatchCard({
  pair, resolved, pools, knockout, matches, fxMembers, confirmedMembers,
  competitionId, run, teamName, busy, onUpdate, onLock,
}) {
  const mName = matchNameOf(pair[0])
  // A single-slot entry is a ranked standing position, NOT a played game — it has
  // no result fixture to link.
  const isGame = pair.length >= 2
  // The fixture is linked to whichever slot of the pair carries matchId
  // (Home slot by convention) so bracket_winner references can resolve.
  const linkedSlot = pair.find(s => s.matchId) ?? pair[0]
  const linkedMatch = linkedSlot.matchId ? matches[linkedSlot.matchId] : null
  const allLocked = pair.every(s => resolved[s.slotId]?.locked)
  // The result-fixture linker only matters when a game's outcome FEEDS the
  // bracket — i.e. another slot reads its winner/loser, or this game's own slots
  // come from a winner/loser reference. Like-for-like playoff games are terminal
  // (both sides are pool positions and nothing reads their result), so we don't
  // clutter them with a linker.
  const slotIds = new Set(pair.map(s => s.slotId))
  const feedsBracket = knockout.some(s => slotIds.has(s.source?.matchSlotId))
  const fromBracket  = pair.some(s => s.source?.type === 'bracket_winner' || s.source?.type === 'bracket_loser')
  const needsResultLink = feedsBracket || fromBracket

  return (
    <div className="border border-slate-200 rounded-lg px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold text-slate-500">{mName}</span>
        {linkedMatch?.status === 'final' && (
          <span className="font-mono text-[11px] text-slate-500">{linkedMatch.homeScore ?? 0}–{linkedMatch.awayScore ?? 0}</span>
        )}
      </div>

      {pair.map(slot => {
        const r = resolved[slot.slotId] ?? { status: SLOT_STATUS.unresolved }
        const st = STATUS_STYLE[r.status] ?? STATUS_STYLE[SLOT_STATUS.unresolved]
        const canLock = !r.locked && r.teamId && r.status === SLOT_STATUS.resolved
        const ov = slot.manualOverride
        return (
          <div key={slot.slotId} className="py-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-semibold ${r.teamId ? (r.status === SLOT_STATUS.provisional ? 'text-slate-400' : 'text-slate-900') : 'text-slate-300 italic'}`}>
                  {r.teamId ? teamName(r.teamId) : 'TBC'}
                </span>
                <span className="text-[11px] text-slate-400 ml-2">
                  {humanSource(slot.source, { pools, knockout, teamName })}
                </span>
              </div>
              {r.locked
                ? <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                : <span className={`text-[9px] font-bold uppercase tracking-widest rounded px-1.5 py-0.5 shrink-0 ${st.cls}`}>{st.label}</span>}
              {canLock && (
                <button onClick={() => onLock(slot.slotId, r.teamId, slot.source)} disabled={busy}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-0.5 disabled:opacity-40 shrink-0">
                  <Lock className="w-3 h-3" /> Lock
                </button>
              )}
              <SlotOverrideControl
                slot={slot} confirmedMembers={confirmedMembers} competitionId={competitionId}
                run={run} busy={busy} />
            </div>
            {ov && (
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-violet-700">
                <UserCog className="w-3 h-3 shrink-0" />
                <span className="font-bold uppercase tracking-widest">
                  {ov.type === 'walkover' ? 'Walkover — set by organiser' : 'Manually set by organiser'}
                </span>
                {ov.reason && <span className="text-violet-500 normal-case font-normal tracking-normal">· {ov.reason}</span>}
              </div>
            )}
          </div>
        )
      })}

      {/* Holding fixture → schedule it (date / time / venue) here. */}
      {isGame && linkedMatch?.isPlayoffHolding && (
        <PlayoffScheduleRow fixture={linkedMatch} competitionId={competitionId} run={run} busy={busy} />
      )}

      {/* Manual result-fixture link — only when there's no auto holding fixture. */}
      {isGame && needsResultLink && !linkedMatch?.isPlayoffHolding && !allLocked && (
        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Result fixture</span>
          <select value={linkedSlot.matchId ?? ''} disabled={busy}
            onChange={e => onUpdate(linkedSlot.slotId, { matchId: e.target.value || null })}
            className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[12px] disabled:bg-slate-50">
            <option value="">No fixture linked</option>
            {fxMembers.map(f => {
              const m = matches[f.matchId]
              if (!m) return null
              return (
                <option key={f.matchId} value={f.matchId}>
                  {m.homeOrgName ? `${m.homeOrgName} ${m.homeTeamName}` : (m.homeTeamName ?? "")} v {m.awayOrgName ? `${m.awayOrgName} ${m.awayTeamName}` : (m.awayTeamName ?? "")}{m.status === 'final' ? ` (${m.homeScore ?? 0}–${m.awayScore ?? 0})` : ''}
                </option>
              )
            })}
          </select>
        </div>
      )}
    </div>
  )
}

// Convert a stored timestamp/date to a value an <input type="datetime-local">
// accepts (YYYY-MM-DDTHH:mm in local time).
function toLocalInput(val) {
  if (!val) return ''
  const d = val?.toDate ? val.toDate() : new Date(val)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Schedule a playoff holding fixture from the bracket card — set its date, time
// and (optionally) venue, just like any other fixture. Teams fill in
// automatically once the source pools are verified.
function PlayoffScheduleRow({ fixture, competitionId, run, busy }) {
  const [open, setOpen]   = useState(false)
  const [when, setWhen]   = useState(() => toLocalInput(fixture.scheduledAt))
  const [pitch, setPitch] = useState(fixture.pitch ?? '')
  const scheduled = fmtMatchTime(fixture.scheduledAt)

  function save() {
    run(() => schedulePlayoffFixture(competitionId, fixture.id, {
      scheduledAt: when ? new Date(when) : null,
      pitch: pitch.trim(),
    }), 'Fixture scheduled.')
    setOpen(false)
  }

  return (
    <div className="mt-1.5 pt-1.5 border-t border-slate-100">
      {!open ? (
        <button onClick={() => setOpen(true)} disabled={busy}
          className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-800 disabled:opacity-40">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          {scheduled
            ? <span>{scheduled}{fixture.pitch ? ` · ${fixture.pitch}` : ''}</span>
            : <span className="font-bold uppercase tracking-widest text-[10px]">Schedule date &amp; time</span>}
        </button>
      ) : (
        <div className="space-y-1.5">
          <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[12px]" />
          <input value={pitch} onChange={e => setPitch(e.target.value)} placeholder="Venue / pitch (optional)"
            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[12px] placeholder-slate-400" />
          <div className="flex gap-1.5">
            <button onClick={save} disabled={busy}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg py-1">Save</button>
            <button onClick={() => setOpen(false)}
              className="px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold rounded-lg">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Organiser override (failsafe). The system NEVER auto-assigns a replacement —
// the organiser picks a specific team, marks a walkover (opponent advances), or
// reverts to the automatic reference. Every override is recorded with who/when
// and an optional reason, and shows a "Manually set by organiser" marker.
function SlotOverrideControl({ slot, confirmedMembers, competitionId, run, busy }) {
  const [open, setOpen] = useState(false)
  const [teamId, setTeamId] = useState('')
  const [reason, setReason] = useState('')
  const overridden = !!slot.manualOverride

  function pickTeam() {
    if (!teamId) return
    run(() => overrideSlotWithTeam(competitionId, slot.slotId, teamId, { reason }), 'Slot overridden.')
    setOpen(false); setTeamId(''); setReason('')
  }
  function walkover() {
    run(() => setSlotWalkover(competitionId, slot.slotId, { reason }), 'Walkover recorded.')
    setOpen(false); setReason('')
  }
  function revert() {
    run(() => revertSlotOverride(competitionId, slot.slotId), 'Reverted to automatic.')
    setOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)} disabled={busy}
        title="Organiser override"
        className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest rounded px-1.5 py-0.5 border disabled:opacity-40 ${
          overridden ? 'text-violet-700 border-violet-300 bg-violet-50' : 'text-slate-500 border-slate-200 hover:border-slate-300'
        }`}>
        <UserCog className="w-3 h-3" /> Override
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-2">
          <MicroLabel>Organiser override</MicroLabel>
          <p className="text-[11px] text-slate-400 leading-snug">The system never picks for you. Choose a team, mark a walkover, or revert.</p>
          <select value={teamId} onChange={e => setTeamId(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm">
            <option value="">Pick a specific team…</option>
            {confirmedMembers.map(m => (
              <option key={m.teamId} value={m.teamId}>{competitionTeamLabel(m.displaySnapshot) || m.teamId}</option>
            ))}
          </select>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)"
            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm placeholder-slate-400" />
          <div className="flex flex-wrap gap-1.5">
            <button onClick={pickTeam} disabled={busy || !teamId}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg py-1.5">
              Set team
            </button>
            <button onClick={walkover} disabled={busy}
              className="flex-1 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg py-1.5">
              Walkover
            </button>
          </div>
          {overridden && (
            <button onClick={revert} disabled={busy}
              className="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg py-1.5">
              <RotateCcw className="w-3 h-3" /> Revert to automatic
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Advanced bracket rules: raw slot list with source details, delete, and the
// typed-source slot creation form. Hidden by default — organisers use the
// generated structure; this exists for unusual formats and corrections.
function AdvancedKnockout({ knockout, pools, confirmedMembers, resolved, teamName, busy, onCreate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false)
  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <MicroLabel>Advanced bracket rules</MicroLabel>
        <button onClick={() => setShowAdd(s => !s)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 border border-emerald-200 rounded-md px-2.5 py-1">
          <Plus className="w-3.5 h-3.5" /> Add slot
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        Each bracket position is filled from exactly one source rule. Delete and re-add a slot to change its rule.
      </p>

      {knockout.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {knockout.map(slot => (
            <li key={slot.slotId} className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {slot.roundLabel ? <span className="text-slate-400">{slot.roundLabel} · </span> : null}{slot.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  {humanSource(slot.source, { pools, knockout, teamName })}
                  <span className="text-slate-300"> · {slot.source?.type ?? 'no source'}</span>
                </div>
              </div>
              {resolved[slot.slotId]?.locked && <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
              <button onClick={() => onDelete(slot.slotId)} disabled={busy}
                className="text-red-500 hover:text-red-600 disabled:opacity-40 shrink-0"><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {showAdd && (
        <AddKnockoutSlotForm pools={pools} knockout={knockout} confirmedMembers={confirmedMembers} busy={busy}
          onCreate={p => { onCreate(p); setShowAdd(false) }} />
      )}
    </div>
  )
}

function AddKnockoutSlotForm({ pools, knockout, confirmedMembers, busy, onCreate }) {
  const [name, setName] = useState('')
  const [roundLabel, setRoundLabel] = useState('')
  const [type, setType] = useState('pool_position')
  const [poolId, setPoolId] = useState('')
  const [position, setPosition] = useState(1)
  const [rank, setRank] = useState(1)
  const [matchSlotId, setMatchSlotId] = useState('')
  const [teamId, setTeamId] = useState('')

  function build() {
    const base = { type }
    if (type === 'pool_position') Object.assign(base, { poolId, position: Number(position) })
    if (type === 'best_runner_up') Object.assign(base, { position: Number(position), rank: Number(rank) })
    if (type === 'bracket_winner' || type === 'bracket_loser') Object.assign(base, { matchSlotId })
    if (type === 'direct_team') Object.assign(base, { teamId })
    return base
  }
  const valid = name.trim() && (
    (type === 'pool_position' && poolId) ||
    (type === 'best_runner_up') ||
    ((type === 'bracket_winner' || type === 'bracket_loser') && matchSlotId) ||
    (type === 'manual_selection') ||
    (type === 'direct_team' && teamId)
  )

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-3 space-y-2">
      <MicroLabel>New knockout slot</MicroLabel>
      <div className="flex gap-2">
        <input value={roundLabel} onChange={e => setRoundLabel(e.target.value)} placeholder="Round (e.g. Semi-final)"
          className="w-40 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm placeholder-slate-400" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Slot name (e.g. SF1 Home)"
          className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm placeholder-slate-400" />
      </div>
      <select value={type} onChange={e => setType(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
        {Object.values(ADVANCEMENT_SOURCE_TYPES).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      {type === 'pool_position' && (
        <div className="flex gap-2">
          <select value={poolId} onChange={e => setPoolId(e.target.value)} className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
            <option value="">Select pool…</option>
            {pools.map(p => <option key={p.poolId} value={p.poolId}>{p.name}</option>)}
          </select>
          <input type="number" min={1} value={position} onChange={e => setPosition(e.target.value)} className="w-20 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm" title="Position" />
        </div>
      )}
      {type === 'best_runner_up' && (
        <div className="flex gap-2">
          <input type="number" min={1} value={position} onChange={e => setPosition(e.target.value)} className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm" title="Pool position (e.g. 2 = runners-up)" />
          <input type="number" min={1} value={rank} onChange={e => setRank(e.target.value)} className="w-20 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm" title="Rank among them" />
        </div>
      )}
      {(type === 'bracket_winner' || type === 'bracket_loser') && (
        <select value={matchSlotId} onChange={e => setMatchSlotId(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
          <option value="">Source slot…</option>
          {knockout.map(s => <option key={s.slotId} value={s.slotId}>{s.name}</option>)}
        </select>
      )}
      {type === 'direct_team' && (
        <select value={teamId} onChange={e => setTeamId(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
          <option value="">Select team…</option>
          {confirmedMembers.map(m => <option key={m.teamId} value={m.teamId}>{competitionTeamLabel(m.displaySnapshot) || m.teamId}</option>)}
        </select>
      )}

      <button onClick={() => onCreate({ name, roundLabel: roundLabel || null, source: build() })} disabled={busy || !valid}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm rounded-lg py-2">
        Add slot
      </button>
    </div>
  )
}

// One side of a custom game: either a pool position ("1st Pool A") or the
// winner / loser of an already-created game. Returns its choice via onChange as
// { kind, poolId, position, gameSlotId }; the parent turns it into a source.
function GameSidePicker({ label, value, onChange, pools, games }) {
  const set = patch => onChange({ ...value, ...patch })
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <select value={value.kind} onChange={e => set({ kind: e.target.value })}
        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
        <option value="pool">Pool position</option>
        <option value="winner">Winner of a game</option>
        <option value="loser">Loser of a game</option>
      </select>

      {value.kind === 'pool' && (
        <div className="flex gap-2">
          <select value={value.poolId} onChange={e => set({ poolId: e.target.value })}
            className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
            <option value="">Select pool…</option>
            {pools.map(p => <option key={p.poolId} value={p.poolId}>{p.name}</option>)}
          </select>
          <input type="number" min={1} value={value.position} title="Finishing position in the pool"
            onChange={e => set({ position: Math.max(1, Number(e.target.value) || 1) })}
            className="w-20 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />
        </div>
      )}

      {(value.kind === 'winner' || value.kind === 'loser') && (
        games.length > 0 ? (
          <select value={value.gameSlotId} onChange={e => set({ gameSlotId: e.target.value })}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm">
            <option value="">Select a game…</option>
            {games.map(g => <option key={g.slotId} value={g.slotId}>{g.name}</option>)}
          </select>
        ) : (
          <p className="text-[11px] text-slate-400">No games to reference yet — add a game from pool positions first.</p>
        )
      )}
    </div>
  )
}

// Game-oriented custom builder: name a game and choose both sides (pool position
// or winner/loser of a prior game). Creates the two knockout slots (home + away)
// as a single match, so organisers hand-build a bracket and chain winners
// forward without touching the raw slot model.
function CustomGameForm({ pools, games, busy, onCreateGame, onDone }) {
  const blank = { kind: 'pool', poolId: '', position: 1, gameSlotId: '' }
  const [name, setName]   = useState('')
  const [round, setRound] = useState('')
  const [home, setHome]   = useState(blank)
  const [away, setAway]   = useState(blank)

  const sourceOf = s => {
    if (s.kind === 'pool')   return s.poolId ? { type: 'pool_position', poolId: s.poolId, position: Number(s.position) || 1 } : null
    if (s.kind === 'winner') return s.gameSlotId ? { type: 'bracket_winner', matchSlotId: s.gameSlotId } : null
    if (s.kind === 'loser')  return s.gameSlotId ? { type: 'bracket_loser',  matchSlotId: s.gameSlotId } : null
    return null
  }
  const homeSource = sourceOf(home)
  const awaySource = sourceOf(away)
  const valid = name.trim() && homeSource && awaySource

  function submit() {
    onCreateGame({ name: name.trim(), roundLabel: round.trim() || null, homeSource, awaySource })
    setName(''); setRound(''); setHome(blank); setAway(blank)
    onDone?.()
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Game name (e.g. Semi-final 1)"
          className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm placeholder-slate-400" />
        <input value={round} onChange={e => setRound(e.target.value)} placeholder="Round (optional)"
          title="Group games under a round label (e.g. Semi-finals). Leave blank to use the game name."
          className="w-36 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm placeholder-slate-400" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <GameSidePicker label="Home" value={home} onChange={setHome} pools={pools} games={games} />
        <GameSidePicker label="Away" value={away} onChange={setAway} pools={pools} games={games} />
      </div>
      <button onClick={submit} disabled={busy || !valid}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5">
        <Plus className="w-4 h-4" /> Add game
      </button>
    </div>
  )
}
