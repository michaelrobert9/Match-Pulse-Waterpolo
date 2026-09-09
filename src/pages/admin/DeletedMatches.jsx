import { useEffect, useState } from 'react'
import { ChevronLeft, RotateCcw, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toDate } from '../../lib/queries'
import { fetchDeletedMatches, restoreMatch, purgeMatch } from '../../lib/adminQueries'
import { prefetchMatchTeams, resolveTeamSideSync } from '../../lib/teamIdentity'
import { MatchTeamIdentity } from '../../components/TeamIdentity'

// Matches auto-purge from the recycle bin this many days after deletion (a
// daily Cloud Function does the permanent removal). Keep in sync with
// functions/index.js RECYCLE_BIN_TTL_DAYS.
const RECYCLE_BIN_TTL_DAYS = 90

// Recycle bin — every soft-deleted match. Restore returns a match to all
// listings and stats; Permanently delete removes it for good (and clears its
// competition fixture-membership). Deleted matches never count toward standings
// or records while they sit here, and auto-purge after RECYCLE_BIN_TTL_DAYS.
export default function DeletedMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId,  setBusyId]  = useState(null)

  useEffect(() => {
    fetchDeletedMatches()
      .then(list => { prefetchMatchTeams(list); setMatches(list) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const fmtWhen = val => {
    const d = toDate(val)
    return d
      ? d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Date TBD'
  }

  // The date a soft-deleted match will be permanently auto-purged.
  const purgeDate = deletedAt => {
    const d = toDate(deletedAt)
    if (!d) return null
    const p = new Date(d); p.setDate(p.getDate() + RECYCLE_BIN_TTL_DAYS)
    return p.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  async function handleRestore(m) {
    setBusyId(m.id)
    try {
      await restoreMatch(m.id)
      setMatches(prev => prev.filter(x => x.id !== m.id))
    } catch (e) { alert(e.message || 'Restore failed.') }
    finally { setBusyId(null) }
  }

  async function handlePurge(m) {
    if (!confirm(`Permanently delete "${resolveTeamSideSync(m, 'home').primary} vs ${resolveTeamSideSync(m, 'away').primary}"? This cannot be undone.`)) return
    setBusyId(m.id)
    try {
      await purgeMatch(m.id)
      setMatches(prev => prev.filter(x => x.id !== m.id))
    } catch (e) { alert(e.message || 'Permanent delete failed.') }
    finally { setBusyId(null) }
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5">
      <Link to="/admin/matches"
        className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 transition-colors mb-3">
        <ChevronLeft className="w-4 h-4" /> Matches
      </Link>
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-slate-900 text-lg">Deleted matches</h1>
        <span className="text-xs text-slate-400">{matches.length} in bin</span>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        These matches are hidden everywhere and don’t count toward any standings or records.
        Restore one to bring it back, or permanently delete it to remove it for good.
      </p>

      {matches.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500 text-sm">The recycle bin is empty.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {matches.map(m => (
            <div key={m.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <MatchTeamIdentity match={m} side="home" hideIdentifier
                    nameClass="text-slate-900 text-sm font-semibold truncate" />
                  <span className="text-slate-400 text-xs shrink-0">vs</span>
                  <MatchTeamIdentity match={m} side="away" hideIdentifier
                    nameClass="text-slate-900 text-sm font-semibold truncate" />
                </div>
                <div className="micro-label flex items-center gap-2 flex-wrap">
                  <span>{fmtWhen(m.scheduledAt)}</span>
                  {(m.competitionName || m.competitionSlug) && <span className="text-slate-300">·</span>}
                  {(m.competitionName || m.competitionSlug) && <span className="truncate">{m.competitionName || m.competitionSlug}</span>}
                  {m.deletedAt && <span className="text-slate-300">·</span>}
                  {m.deletedAt && <span>deleted {fmtWhen(m.deletedAt)}</span>}
                  {purgeDate(m.deletedAt) && <span className="text-slate-300">·</span>}
                  {purgeDate(m.deletedAt) && <span className="text-amber-600">removes on {purgeDate(m.deletedAt)}</span>}
                </div>
              </div>

              <button onClick={() => handleRestore(m)} disabled={busyId === m.id}
                className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 disabled:opacity-40 transition-colors">
                <RotateCcw className="w-4 h-4" /> Restore
              </button>
              <button onClick={() => handlePurge(m)} disabled={busyId === m.id}
                className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
                title="Permanently delete">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
