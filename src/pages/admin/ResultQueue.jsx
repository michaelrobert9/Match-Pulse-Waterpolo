import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, AlertTriangle, Plus, X } from 'lucide-react'
import { fetchAwaitingResultMatches, toDate } from '../../lib/queries'
import { submitFixtureResult, postponeFixture, cancelFixture } from '../../lib/adminQueries'

// Admin confirmation queue (spec §6). Lists every fixture in `awaiting_result`
// — placed there by the daily sweep (live → awaiting) or as a submit-only
// fixture. The system has invented nothing: a human confirms or edits the score
// here, which is the ONLY way these reach Final. tracked fixtures arrive with
// their provisional live score pre-filled; untracked fixtures get a blank form
// plus optional goal scorer and card fields (§D stat parity).

const CARD_TYPES = [
  { value: 'green',  label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red',    label: 'Red' },
]

function fmtWhen(val) {
  const d = toDate(val)
  return d
    ? d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Date TBD'
}

// Dynamic scorer name inputs: one row per goal based on the entered score.
function ScorerInputs({ count, side, names, onChange, teamLabel }) {
  if (count <= 0) return null
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{teamLabel} scorers</p>
      {Array.from({ length: count }).map((_, i) => (
        <input key={i} type="text" placeholder={`Goal ${i + 1} scorer (optional)`}
          value={names[i] ?? ''}
          onChange={e => {
            const next = [...names]
            next[i] = e.target.value
            onChange(next)
          }}
          className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
      ))}
    </div>
  )
}

function CardEntry({ card, index, homeLabel, awayLabel, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <select value={card.side} onChange={e => onChange(index, { ...card, side: e.target.value })}
        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-emerald-500">
        <option value="home">{homeLabel}</option>
        <option value="away">{awayLabel}</option>
      </select>
      <select value={card.cardType} onChange={e => onChange(index, { ...card, cardType: e.target.value })}
        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-emerald-500">
        {CARD_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
      </select>
      <input type="text" placeholder="Player name (optional)" value={card.playerName}
        onChange={e => onChange(index, { ...card, playerName: e.target.value })}
        className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
      <button type="button" onClick={() => onRemove(index)}
        className="text-slate-400 hover:text-red-500 transition-colors p-0.5">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function QueueRow({ match, onResolved }) {
  const tracked = match.tracked === true
  // Pre-fill from the provisional live score for tracked matches; blank otherwise.
  const [home,         setHome]         = useState(tracked ? String(match.homeScore ?? 0) : '')
  const [away,         setAway]         = useState(tracked ? String(match.awayScore ?? 0) : '')
  // Scorer names: arrays indexed by goal number for each side (untracked only).
  const [homeScorers,  setHomeScorers]  = useState([])
  const [awayScorers,  setAwayScorers]  = useState([])
  const [cards,        setCards]        = useState([])
  const [busy,         setBusy]         = useState(false)
  const [error,        setError]        = useState('')

  const homeCount = Math.max(0, Math.min(99, parseInt(home, 10) || 0))
  const awayCount = Math.max(0, Math.min(99, parseInt(away, 10) || 0))

  const homeLabel = match.homeOrgName
    ? `${match.homeOrgName} ${match.homeTeamName}` : match.homeTeamName || 'Home'
  const awayLabel = match.awayOrgName
    ? `${match.awayOrgName} ${match.awayTeamName}` : match.awayTeamName || 'Away'

  function addCard() {
    setCards(prev => [...prev, { side: 'home', cardType: 'yellow', playerName: '' }])
  }
  function updateCard(i, val) { setCards(prev => prev.map((c, idx) => idx === i ? val : c)) }
  function removeCard(i) { setCards(prev => prev.filter((_, idx) => idx !== i)) }

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); onResolved(match.id) }
    catch (e) { setError(e.message || 'Action failed.'); setBusy(false) }
  }

  function confirm() {
    if (home === '' || away === '') { setError('Enter a score for both teams.'); return }

    // Build goals array from scorer inputs (only for untracked — tracked already has timeline).
    const goals = !tracked
      ? [
          ...Array.from({ length: homeCount }, (_, i) => ({
            side: 'home', scorerName: homeScorers[i]?.trim() || null,
          })),
          ...Array.from({ length: awayCount }, (_, i) => ({
            side: 'away', scorerName: awayScorers[i]?.trim() || null,
          })),
        ]
      : null

    const cardPayload = !tracked && cards.length > 0
      ? cards.map(c => ({ side: c.side, cardType: c.cardType, playerName: c.playerName.trim() || null }))
      : null

    run(() => submitFixtureResult(match.id, {
      homeScore: Number(home), awayScore: Number(away), method: 'admin_approved',
      goals: goals?.length ? goals : null,
      cards: cardPayload,
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
        <span className="flex-1 text-sm font-semibold text-slate-900 truncate text-right">
          {homeLabel}
        </span>
        <input type="number" min="0" inputMode="numeric" value={home} onChange={e => setHome(e.target.value)}
          className="w-12 text-center font-mono font-black text-lg bg-slate-50 border border-slate-200 rounded-lg py-1 focus:outline-none focus:border-emerald-500" />
        <span className="text-slate-300 text-xs">–</span>
        <input type="number" min="0" inputMode="numeric" value={away} onChange={e => setAway(e.target.value)}
          className="w-12 text-center font-mono font-black text-lg bg-slate-50 border border-slate-200 rounded-lg py-1 focus:outline-none focus:border-emerald-500" />
        <span className="flex-1 text-sm font-semibold text-slate-900 truncate">
          {awayLabel}
        </span>
      </div>

      {/* Scorer + card fields: only for untracked (tracked already has live timeline data) */}
      {!tracked && (homeCount > 0 || awayCount > 0 || cards.length > 0) && (
        <div className="space-y-3 mb-3 pt-3 border-t border-slate-100">
          <ScorerInputs count={homeCount} side="home" names={homeScorers}
            onChange={setHomeScorers} teamLabel={homeLabel} />
          <ScorerInputs count={awayCount} side="away" names={awayScorers}
            onChange={setAwayScorers} teamLabel={awayLabel} />
          {cards.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Cards</p>
              {cards.map((c, i) => (
                <CardEntry key={i} card={c} index={i}
                  homeLabel={homeLabel} awayLabel={awayLabel}
                  onChange={updateCard} onRemove={removeCard} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Card add button for untracked fixtures */}
      {!tracked && (
        <div className="mb-3">
          <button type="button" onClick={addCard}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-emerald-600 transition-colors">
            <Plus className="w-3 h-3" /> Add card
          </button>
        </div>
      )}

      {(match.competitionName || match.competitionSlug) && (
        <div className="text-[11px] text-slate-400 mb-3 truncate">{match.competitionName || match.competitionSlug}</div>
      )}

      {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={confirm} disabled={busy}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-3 py-2 transition-colors">
          <CheckCircle2 className="w-4 h-4" />
          Confirm result
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

export default function ResultQueue() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAwaitingResultMatches().then(setMatches).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function handleResolved(id) {
    setMatches(prev => prev.filter(m => m.id !== id))
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-slate-900 text-lg">Awaiting result</h1>
        <span className="text-xs text-slate-400">{matches.length} to confirm</span>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        These fixtures are over by the clock but have no confirmed result. Approve or edit each
        one to make it Final — nothing counts toward standings until you do.
      </p>

      {matches.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Nothing awaiting confirmation. All caught up.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map(m => <QueueRow key={m.id} match={m} onResolved={handleResolved} />)}
        </div>
      )}
    </div>
  )
}
