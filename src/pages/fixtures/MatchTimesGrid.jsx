import { useEffect, useState } from 'react'
import { ChevronLeft, Clock } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchMatchGroup, fetchMatchGroupChildren } from '../../lib/queries'
import { setMatchTimes } from '../../lib/adminQueries'
import { matchPath, ageLabel } from '../../lib/matchPaths'
import VenuePicker from '../../components/VenuePicker'

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// A child's scheduledAt may be a Firestore Timestamp, a Date, or an ISO string.
function toDateSafe(value) {
  if (!value) return null
  const d = value?.toDate?.() ?? (value instanceof Date ? value : new Date(value))
  return isNaN(d?.getTime?.()) ? null : d
}

// Format a Date to the value a <input type="datetime-local"> expects
// ("YYYY-MM-DDTHH:MM") in local time. Blank when there is no date.
function toLocalInputValue(date) {
  if (!date) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function MatchTimesGrid() {
  const { date, slug } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [group,   setGroup]   = useState(null)
  const [rows,    setRows]    = useState([])   // [{ id, ageSlug, home, away, when, venue }]
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchMatchGroup(date, slug)
      .then(async g => {
        if (!alive) return
        setGroup(g)
        if (!g) return
        const children = await fetchMatchGroupChildren(g.id)
        if (!alive) return
        setRows(children.map(c => ({
          id:      c.id,
          ageSlug: c.ageSlug,
          home:    c.homeTeamName ?? '',
          away:    c.awayTeamName ?? '',
          when:    toLocalInputValue(toDateSafe(c.scheduledAt)),
          venue:   c.pitch ?? '',
          venueId: c.venueId ?? null,
          venueSlug: c.venueSlug ?? null,
        })))
      })
      .catch(() => { if (alive) setGroup(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [date, slug])

  function updateRow(id, patch) {
    setRows(list => list.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const patches = rows.map(r => ({
        matchId:     r.id,
        // Blank datetime is valid — it clears the scheduled time to null.
        scheduledAt: r.when ? new Date(r.when) : null,
        venue:       r.venue || '',
        venueId:     r.venueId || null,
        venueSlug:   r.venueSlug || null,
      }))
      await setMatchTimes(patches)
      navigate(matchPath(date, slug))
    } catch (err) {
      setError(err?.message ?? 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <Link to={matchPath(date, slug)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-6">
            <ChevronLeft className="w-4 h-4" />
            Back to match day
          </Link>
          <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">Set match times</h1>
          {group && (
            <p className="text-slate-500 text-sm mt-2">
              {group.homeName} vs {group.awayName}
            </p>
          )}
        </div>

        {loading && <Spinner />}

        {/* Not found */}
        {!loading && !group && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
            <h3 className="text-slate-900 font-display font-bold text-base mb-2">Match day not found</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              This match day doesn’t exist, or its link has changed.
            </p>
          </div>
        )}

        {/* Empty group */}
        {!loading && group && rows.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4">
              <Clock className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-slate-900 font-display font-bold text-base mb-1">No matches yet</h3>
            <p className="text-slate-500 text-sm leading-relaxed">This match day has no matches to schedule.</p>
          </div>
        )}

        {/* Times grid */}
        {!loading && group && rows.length > 0 && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
              {rows.map(r => (
                <div key={r.id} className="p-4">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                    {ageLabel(r.ageSlug)}
                  </div>
                  <div className="text-sm text-slate-900 mb-3">
                    <span className="font-semibold">{r.home}</span>
                    <span className="text-slate-400 text-xs font-bold uppercase px-1.5">vs</span>
                    <span className="font-semibold">{r.away}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">
                        Date &amp; time <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
                      </label>
                      <input type="datetime-local"
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                        value={r.when}
                        onChange={ev => updateRow(r.id, { when: ev.target.value })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">
                        Venue <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
                      </label>
                      <VenuePicker
                        pitch={r.venue} venueId={r.venueId} venueSlug={r.venueSlug}
                        hostOrgId={group?.ownerOrgId ?? group?.homeOrgId ?? null}
                        placeholder="e.g. Court 1"
                        inputClassName="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                        onChange={v => updateRow(r.id, { venue: v.pitch, venueId: v.venueId, venueSlug: v.venueSlug })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
            )}

            <button type="button" onClick={handleSave} disabled={saving}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors">
              {saving ? 'Saving…' : 'Save times'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
