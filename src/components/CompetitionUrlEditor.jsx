import { useState } from 'react'
import { Link2, Check } from 'lucide-react'
import { slugify } from '../lib/slugify'
import { changeCompetitionSlug } from '../lib/adminQueries'

// Edit a competition's URL slug. The public URL is /competitions/{season}/{slug};
// changing it also re-stamps every match link in the competition and leaves
// redirects from the old URLs. Self-contained: drop it into the competition
// editor with the competition and an onChanged(newSlug) callback.
export default function CompetitionUrlEditor({ competition, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(competition.slug || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const season = competition.season != null ? String(competition.season) : ''
  const cleaned = slugify(value)
  const preview = cleaned || '…'
  const unchanged = cleaned === (competition.slug || '')

  async function save() {
    setBusy(true); setError(''); setDone(null)
    try {
      const res = await changeCompetitionSlug(competition.id, value)
      setDone(res)
      setEditing(false)
      onChanged?.(res.slug)
    } catch (e) {
      setError(e?.message || 'Could not change the URL.')
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Link2 className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Competition URL</span>
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-2">
          <code className="text-xs text-slate-700 break-all">/competitions/{season}/{competition.slug}</code>
          <button type="button" onClick={() => { setValue(competition.slug || ''); setEditing(true); setDone(null); setError('') }}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-500 shrink-0">Edit</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-400 shrink-0">/competitions/{season}/</span>
            <input value={value} onChange={e => setValue(e.target.value)} autoFocus
              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-emerald-400" />
          </div>
          <p className="text-[11px] text-slate-400">New URL: <code className="text-slate-600">/competitions/{season}/{preview}</code></p>
          <p className="text-[11px] text-amber-600">This also updates every match link in the competition. Old links redirect to the new URL.</p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy || !cleaned || unchanged}
              className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-1.5 disabled:opacity-40">
              {busy ? 'Changing…' : 'Change URL'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError('') }}
              className="text-xs font-medium text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {done && (
        <p className="text-[11px] text-emerald-700 mt-1.5 flex items-center gap-1">
          <Check className="w-3 h-3 shrink-0" /> URL changed{done.matchesRestamped ? ` · ${done.matchesRestamped} match link${done.matchesRestamped === 1 ? '' : 's'} updated` : ''}.
        </p>
      )}
    </div>
  )
}
