import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { assignPlayer, removePlayer, updatePlayer } from '../lib/adminQueries'
import { fetchTeamLineup, fetchAllPeople } from '../lib/queries'
import { playerUrl } from '../lib/slugify'

// Season-scoped squad. Self-fetches the team's roster. `readOnly` renders a
// display-only squad (the public team profile); without it, org staff get the
// full management surface (add / edit / remove / carry-over) — used in the org
// management portal. A player represents a team for a SEASON (calendar year):
// each new year starts clean, while past seasons' entries (and their stats)
// remain as the permanent record.
function SectionHeader({ title, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h2>
      {right}
    </div>
  )
}
function EmptyCard({ message, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center shadow-sm">
      <p className="text-slate-500 text-sm">{message}</p>
      {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
    </div>
  )
}

export default function SquadManager({ team, readOnly = false }) {
  const { isPlatformAdmin, canDo } = useAuth()
  const canManage = !readOnly && (isPlatformAdmin || canDo(team.organizationId, 'team.manage'))
  const currentYear = String(new Date().getFullYear())

  const [roster, setRoster] = useState([])
  async function reload() {
    const l = await fetchTeamLineup(team.id).catch(() => [])
    setRoster(l ?? [])
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [team.id])

  // Squad rows are ROSTER entries only (no competitionId — per-competition slices
  // are stat records, not squad membership). Legacy unstamped entries display
  // under the current season.
  const entries = roster.filter(p => !p.competitionId)
  const seasons = [...new Set([currentYear, ...entries.map(p => p.season).filter(Boolean).map(String)])]
    .sort().reverse()
  const [season, setSeason] = useState(currentYear)
  const visible = entries
    .filter(p => (p.season ? String(p.season) === season : season === currentYear))
    .sort((a, b) => (a.shirtNumber || 99) - (b.shirtNumber || 99))
  const prevSeason = seasons.find(s => s < season && entries.some(p => String(p.season ?? '') === s))

  // Add-player flow
  const [adding, setAdding] = useState(false)
  const [people, setPeople] = useState(null)
  const [search, setSearch] = useState('')
  const [pick,   setPick]   = useState(null)
  const [shirt,  setShirt]  = useState('')
  const [pos,    setPos]    = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState('')

  // Edit-player flow
  const [editId,    setEditId]    = useState(null)
  const [editDraft, setEditDraft] = useState({ shirtNumber: '', position: '', isCaptain: false })

  function startEdit(p) {
    setEditId(p.id)
    setEditDraft({
      shirtNumber: p.shirtNumber != null ? String(p.shirtNumber) : '',
      position: p.position ?? '',
      isCaptain: !!p.isCaptain,
    })
  }
  function saveEdit() {
    const id = editId
    run(async () => {
      await updatePlayer(id, {
        shirtNumber: editDraft.shirtNumber ? Number(editDraft.shirtNumber) : null,
        position: editDraft.position.trim() || null,
        isCaptain: !!editDraft.isCaptain,
      })
      setEditId(null)
    })
  }

  useEffect(() => {
    if (adding && people === null) fetchAllPeople().then(setPeople).catch(() => setPeople([]))
  }, [adding, people])

  const inSquad = new Set(visible.map(p => p.personId).filter(Boolean))
  const matchesSearch = (people ?? [])
    .filter(p => !inSquad.has(p.id))
    .filter(p => (p.fullName ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 8)

  async function run(fn) {
    setBusy(true); setErr('')
    try { await fn(); await reload() }
    catch (e) { setErr(e.message ?? 'Action failed.') }
    finally { setBusy(false) }
  }

  function addPick() {
    if (!pick) return
    run(async () => {
      await assignPlayer(team, pick, {
        shirtNumber: shirt ? Number(shirt) : null, position: pos.trim() || null,
        competitionId: null, season,
      })
      setPick(null); setShirt(''); setPos(''); setSearch('')
    })
  }

  function remove(p) {
    const hasStats = (p.caps ?? 0) > 0 || (p.goals ?? 0) > 0
    const msg = hasStats
      ? `${p.personName} has ${p.caps ?? 0} caps and ${p.goals ?? 0} goals recorded on this entry — removing it deletes those stats. Remove anyway?`
      : `Remove ${p.personName} from the ${season} squad?`
    if (!window.confirm(msg)) return
    run(() => removePlayer(p.id))
  }

  function carryOver() {
    const prev = entries.filter(p => String(p.season ?? '') === prevSeason)
    if (!prev.length) return
    if (!window.confirm(`Copy ${prev.length} player${prev.length !== 1 ? 's' : ''} from the ${prevSeason} squad into ${season}? Their ${prevSeason} records stay untouched.`)) return
    run(async () => {
      for (const p of prev) {
        await assignPlayer(team, { id: p.personId, fullName: p.personName, slug: p.personSlug ?? null }, {
          shirtNumber: p.shirtNumber ?? null, position: p.position ?? null,
          isCaptain: p.isCaptain ?? false, competitionId: null, season,
        })
      }
    })
  }

  return (
    <section>
      <SectionHeader title="Squad" right={
        <div className="flex items-center gap-2">
          {seasons.length > 1 && (
            <select value={season} onChange={e => setSeason(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {canManage && season === currentYear && (
            <button onClick={() => setAdding(a => !a)}
              className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 border border-emerald-200 rounded-md px-2.5 py-1">
              {adding ? 'Done' : '+ Add player'}
            </button>
          )}
        </div>
      } />

      {err && <p className="text-red-600 text-xs mb-2">{err}</p>}

      {canManage && adding && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 shadow-sm space-y-2">
          {!pick ? (
            <>
              <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
                placeholder={people === null ? 'Loading players…' : 'Search players by name…'}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm placeholder-slate-400" />
              {search.trim() && (
                <ul className="divide-y divide-slate-100">
                  {matchesSearch.map(p => (
                    <li key={p.id}>
                      <button onClick={() => setPick(p)}
                        className="w-full text-left px-2 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg">
                        {p.fullName}
                      </button>
                    </li>
                  ))}
                  {matchesSearch.length === 0 && people !== null && (
                    <li className="px-2 py-2 text-xs text-slate-400">
                      No match. Players must have their own MatchPulse profile — ask the
                      player (or their parent) to sign up and create one, then add them here.
                    </li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800 flex-1 min-w-[120px]">{pick.fullName}</span>
              <input type="number" min={1} max={99} value={shirt} onChange={e => setShirt(e.target.value)}
                placeholder="#" title="Shirt number"
                className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              <input value={pos} onChange={e => setPos(e.target.value)} placeholder="Position (optional)"
                className="w-40 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm placeholder-slate-400" />
              <button onClick={addPick} disabled={busy}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-2">
                Add to {season} squad
              </button>
              <button onClick={() => setPick(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div>
          <EmptyCard message={`No players in the ${season} squad yet.`}
            sub={season === currentYear ? 'A new season starts with a clean slate — past seasons stay on record.' : 'No players were recorded for this season.'} />
          {canManage && prevSeason && season === currentYear && (
            <button onClick={carryOver} disabled={busy}
              className="mt-2 w-full text-[11px] font-bold uppercase tracking-widest text-emerald-700 border border-emerald-200 rounded-xl py-2.5 hover:bg-emerald-50 disabled:opacity-40">
              Carry over the {prevSeason} squad
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(p => (
            editId === p.id ? (
              <div key={p.id} className="bg-white rounded-xl border border-emerald-200 px-4 py-3 shadow-sm space-y-2">
                <div className="text-sm font-semibold text-slate-800">{p.personName}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={1} max={99} value={editDraft.shirtNumber}
                    onChange={e => setEditDraft(d => ({ ...d, shirtNumber: e.target.value }))}
                    placeholder="#" title="Shirt number"
                    className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                  <input value={editDraft.position}
                    onChange={e => setEditDraft(d => ({ ...d, position: e.target.value }))}
                    placeholder="Position (optional)"
                    className="w-40 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm placeholder-slate-400" />
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={editDraft.isCaptain}
                      onChange={e => setEditDraft(d => ({ ...d, isCaptain: e.target.checked }))}
                      className="accent-amber-500 w-4 h-4" />
                    Captain
                  </label>
                  <button onClick={saveEdit} disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-2">
                    Save
                  </button>
                  <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                </div>
              </div>
            ) : (
            <div key={p.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
              <span className="font-mono text-[11px] text-slate-400 w-5 text-right shrink-0">{p.shirtNumber ?? '–'}</span>
              {p.personId
                ? <Link to={playerUrl({ id: p.personId, slug: p.personSlug })}
                    className="text-sm text-slate-700 flex-1 hover:text-emerald-600 transition-colors">
                    {p.personName}
                  </Link>
                : <span className="text-sm text-slate-700 flex-1">{p.personName}</span>
              }
              {p.isCaptain && <span className="text-[9px] text-amber-600 font-bold shrink-0">©</span>}
              {p.position  && <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 shrink-0">{p.position}</span>}
              <span className="font-mono text-[10px] text-slate-400 shrink-0">
                {p.caps ?? 0} caps · <span className="text-emerald-600">{p.goals ?? 0} gls</span>
              </span>
              {canManage && season === currentYear && (
                <>
                  <button onClick={() => startEdit(p)} disabled={busy} title="Edit details"
                    className="text-slate-300 hover:text-emerald-600 transition-colors shrink-0 text-xs font-bold uppercase tracking-widest">Edit</button>
                  <button onClick={() => remove(p)} disabled={busy} title="Remove from squad"
                    className="text-slate-300 hover:text-red-500 transition-colors shrink-0">✕</button>
                </>
              )}
            </div>
            )
          ))}
        </div>
      )}
    </section>
  )
}
