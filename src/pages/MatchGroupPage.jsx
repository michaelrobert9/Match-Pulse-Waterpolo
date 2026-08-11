import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  subscribeMatchGroup, subscribeMatchGroupChildren,
  fetchMatchGroup, fetchMatchGroupChildren,
  toDate,
} from '../lib/queries'
import { updateMatchGroup, deleteMatchGroup } from '../lib/adminQueries'
import { configured } from '../firebase'
import ResultsSpine from '../components/ResultsSpine'
import { computeTally, scoreNoun } from '../lib/matchTally'
import { ageLabel } from '../lib/matchPaths'
import { matchUrl } from '../lib/slugify'
import { teamAccent } from '../lib/teamAccent'

// Live red — the ONE colour that means "a match is in play". Kept identical to
// ResultsSpine's `live` default and teamAccent's LIVE_RED so the day strip and
// the ladder speak the same visual language.
const LIVE_RED = '#E5484D'

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
}

// matchDate is a plain "YYYY-MM-DD" string — a calendar day, not an instant, so
// there is no timezone math to do. Rendered long-form in en-ZA.
function fmtDayDate(matchDate) {
  if (!matchDate) return ''
  const d = new Date(matchDate)
  if (isNaN(d)) return matchDate
  return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// A child's kickoff time as HH:MM (24h, en-ZA). Blank when unscheduled — the
// ladder then shows the venue / TBC in its place, which is the intended fallback.
function fmtTime(scheduledAt) {
  const d = toDate(scheduledAt)
  if (!d) return ''
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

// One legend entry under the day-tally bar: colour chip · label · count.
function Leg({ color, label, n }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
      <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      {label} <b className="tabular-nums font-bold text-slate-900">{n}</b>
    </span>
  )
}

// Section header: eyebrow title on the left, small note on the right.
function SecHead({ title, note }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</div>
      {note && <div className="text-[11px] text-slate-400 truncate ml-3">{note}</div>}
    </div>
  )
}

// The marquee "Main match" card — the most senior match, shown large. Live gets a
// red left accent + pulse; a played match shows the big score (winner tinted); an
// unplayed one shows its time/venue (or TBC).
function FeatureCard({ child, homeName, awayName, homeC, awayC }) {
  const played = child.status === 'final'
  const isLive = child.status === 'live' || child.status === 'paused'
  const hs = Number(child.homeScore ?? 0)
  const as = Number(child.awayScore ?? 0)
  const homeWin = played && hs > as
  const awayWin = played && hs < as
  const timeStr = fmtTime(child.scheduledAt)
  const accent  = isLive ? LIVE_RED : homeC
  const metaBits = [timeStr, child.pitch].filter(Boolean).join(' · ')
  return (
    <Link to={matchUrl(child)}
      className="relative block bg-white rounded-[10px] border border-slate-200 shadow-sm p-4 overflow-hidden hover:border-slate-300 transition-colors">
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: accent }} />
      <div className="flex items-center gap-2 mb-3">
        <div className="font-display font-semibold text-[14px] tracking-[-.01em] text-slate-900">{ageLabel(child.ageSlug)}</div>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-white px-1.5 py-0.5 rounded-[5px]" style={{ backgroundColor: LIVE_RED }}>
            <span className="w-1 h-1 rounded-full bg-white animate-pulse" />Live
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-[.1em] px-1.5 py-0.5 rounded-[5px] bg-slate-100 text-slate-600">
            {played ? 'Full time' : (timeStr || 'TBC')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="text-[13px] font-medium text-slate-700">{homeName}</div>
        {(played || isLive) ? (
          <div className="tabular-nums font-bold text-[30px] tracking-[-.02em] leading-none">
            <span style={homeWin ? { color: homeC } : undefined}>{hs}</span>
            <span className="text-slate-300 font-normal px-1">–</span>
            <span style={awayWin ? { color: awayC } : undefined}>{as}</span>
          </div>
        ) : (
          <div className="text-[12px] text-slate-400 font-medium whitespace-nowrap">{metaBits || 'TBC'}</div>
        )}
        <div className="text-[13px] font-medium text-slate-700 text-right">{awayName}</div>
      </div>
      {metaBits && (
        <div className="mt-3 pt-3 border-t border-slate-100 text-[12px] text-slate-400">{metaBits}</div>
      )}
    </Link>
  )
}

// ── Shared modal shell ───────────────────────────────────────────────────────
// A centred card over a dimmed backdrop. Backdrop click and the × both close;
// the card stops propagation so clicks inside never dismiss. Matches the
// scorer screen's confirm-dialog language (rounded-2xl, slate borders).
function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <div className="font-display font-bold text-slate-900 text-base leading-tight">{title}</div>
            {subtitle && <div className="text-[12px] text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="shrink-0 text-slate-400 hover:text-slate-700 p-1 -mr-1 -mt-1 text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto px-5 pb-5 flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}

// ── Edit match-day dialog ────────────────────────────────────────────────────
// Date + venue with a live preview of exactly what a save changes. A date change
// moves every child (links redirect, handled server-side); a venue change flows
// only to children that did NOT set their own venue — children with an override
// are listed separately so nothing is silently overwritten.
function EditGroupDialog({ group, children, onClose }) {
  const [matchDate, setMatchDate] = useState(group.matchDate ?? '')
  const [venue,     setVenue]     = useState(group.venue ?? '')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const origDate  = group.matchDate ?? ''
  const origVenue = group.venue ?? ''
  // A cleared date is not a change — we never write an empty match date.
  const dateChanged  = !!matchDate && matchDate !== origDate
  const venueChanged = venue.trim() !== origVenue.trim()
  const changed = dateChanged || venueChanged

  const willTake = venueChanged ? children.filter(c => c.venueOverride !== true) : []
  const willKeep = venueChanged ? children.filter(c => c.venueOverride === true) : []

  async function handleConfirm() {
    if (!changed || saving) return
    setSaving(true); setError('')
    try {
      const patch = {}
      if (dateChanged)  patch.matchDate = matchDate
      if (venueChanged) patch.venue = venue.trim()
      await updateMatchGroup(group.id, patch)
      onClose()   // page is live-subscribed — it refreshes itself
    } catch (e) {
      setError(e?.message ?? 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  const n = children.length

  return (
    <Modal title="Edit match day" subtitle={`${group.homeName} vs ${group.awayName}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Date</label>
          <input type="date" value={matchDate}
            onChange={ev => setMatchDate(ev.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">
            Venue <span className="text-slate-400 normal-case tracking-normal font-normal">day-wide</span>
          </label>
          <input type="text" value={venue} placeholder="e.g. St Mary's College"
            onChange={ev => setVenue(ev.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
        </div>

        {/* Live preview — only what will actually change. */}
        {changed && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">What changes</div>

            {dateChanged && (
              <p className="text-[13px] text-slate-700 leading-relaxed">
                All {n} match{n !== 1 ? 'es' : ''} move to <b className="font-semibold">{fmtDayDate(matchDate)}</b>.
                Their links change — old links will redirect.
              </p>
            )}

            {venueChanged && (
              <div className="space-y-2">
                {willTake.length > 0 ? (
                  <div>
                    <div className="text-[12px] text-slate-700">
                      {willTake.length} match{willTake.length !== 1 ? 'es' : ''} will take the new venue
                      {venue.trim() ? <> <b className="font-semibold">{venue.trim()}</b></> : <> <span className="italic text-slate-500">(cleared)</span></>}:
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {willTake.map(c => (
                        <li key={c.id} className="text-[12px] text-slate-600 flex gap-1.5">
                          <span className="font-semibold text-slate-500 shrink-0">{ageLabel(c.ageSlug)}</span>
                          <span className="truncate">{c.homeTeamName} vs {c.awayTeamName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-[12px] text-slate-500">No matches take the day venue — every match has its own.</div>
                )}

                {willKeep.length > 0 && (
                  <div>
                    <div className="text-[12px] text-slate-700">
                      {willKeep.length} match{willKeep.length !== 1 ? 'es' : ''} keep their own venue (not overwritten):
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {willKeep.map(c => (
                        <li key={c.id} className="text-[12px] text-slate-600 flex gap-1.5">
                          <span className="font-semibold text-slate-500 shrink-0">{ageLabel(c.ageSlug)}</span>
                          <span className="truncate">{c.pitch || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={saving}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 font-bold text-sm rounded-xl py-2.5 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={!changed || saving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {!changed && !error && (
          <p className="text-[11px] text-slate-400 text-center">Change the date or venue to enable saving.</p>
        )}
      </div>
    </Modal>
  )
}

// ── Delete match-day dialog ──────────────────────────────────────────────────
// Two explicit, separately-confirmed paths: cascade (remove the day + every
// match) or detach (keep the matches as standalone, links redirect). Each choice
// arms a second confirming click before anything is written.
function DeleteGroupDialog({ group, children, onClose, onDeleted }) {
  const [armed, setArmed] = useState(null)   // null | 'cascade' | 'detach'
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const n = children.length

  async function run(mode) {
    if (busy) return
    setBusy(true); setError('')
    try {
      await deleteMatchGroup(group.id, mode)
      onDeleted()   // the group no longer exists → leave the page
    } catch (e) {
      setError(e?.message ?? 'Could not complete. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Delete match day" subtitle={`${group.homeName} vs ${group.awayName}`} onClose={onClose}>
      <div className="space-y-4">

        {/* Cascade */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="font-display font-bold text-slate-900 text-sm">Delete match day and all {n} match{n !== 1 ? 'es' : ''}</div>
          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
            Permanently removes the match day and every match below, including any results.
          </p>
          {n > 0 && (
            <ul className="mt-2.5 space-y-0.5 rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              {children.map(c => (
                <li key={c.id} className="text-[12px] text-slate-600 flex gap-1.5">
                  <span className="font-semibold text-slate-500 shrink-0">{ageLabel(c.ageSlug)}</span>
                  <span className="truncate">{c.homeTeamName} vs {c.awayTeamName}</span>
                </li>
              ))}
            </ul>
          )}
          {armed === 'cascade' ? (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button type="button" onClick={() => setArmed(null)} disabled={busy}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 font-bold text-sm rounded-xl py-2.5 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={() => run('cascade')} disabled={busy}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
                {busy ? 'Deleting…' : 'Yes, delete all'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setArmed('cascade'); setError('') }} disabled={busy}
              className="w-full mt-3 border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40 font-bold text-sm rounded-xl py-2.5 transition-colors">
              Delete match day and all {n} match{n !== 1 ? 'es' : ''}
            </button>
          )}
        </div>

        {/* Detach */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="font-display font-bold text-slate-900 text-sm">Detach — keep the {n} match{n !== 1 ? 'es' : ''} as standalone</div>
          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
            The match day is removed, but every match (and any results) stays — just no longer grouped.
            Each becomes its own standalone match with a new link; old links redirect.
          </p>
          {armed === 'detach' ? (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button type="button" onClick={() => setArmed(null)} disabled={busy}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 font-bold text-sm rounded-xl py-2.5 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={() => run('detach')} disabled={busy}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
                {busy ? 'Detaching…' : 'Yes, detach matches'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setArmed('detach'); setError('') }} disabled={busy}
              className="w-full mt-3 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 font-bold text-sm rounded-xl py-2.5 transition-colors">
              Detach and keep matches
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">{error}</div>
        )}
      </div>
    </Modal>
  )
}

export default function MatchGroupPage() {
  const { date, slug } = useParams()
  const navigate = useNavigate()
  const { canScore, isPlatformAdmin } = useAuth()
  const [group, setGroup]       = useState(null)
  const [children, setChildren] = useState([])
  const [loading, setLoading]   = useState(true)
  const [editOpen,   setEditOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Resolve the group by (date, slug). Live subscription when Firebase is
  // configured; a single fetch otherwise (sample-data mode).
  useEffect(() => {
    setLoading(true)
    setGroup(null)
    setChildren([])
    if (!configured) {
      let live = true
      fetchMatchGroup(date, slug).then(g => {
        if (!live) return
        setGroup(g)
        setLoading(false)
        if (g?.id) fetchMatchGroupChildren(g.id).then(c => { if (live) setChildren(c) })
      })
      return () => { live = false }
    }
    return subscribeMatchGroup(date, slug, g => {
      setGroup(g)
      setLoading(false)
    })
  }, [date, slug])

  // Once the group resolves, subscribe to its children (needs group.id).
  useEffect(() => {
    if (!configured || !group?.id) return
    return subscribeMatchGroupChildren(group.id, setChildren)
  }, [group?.id])

  // Day tally is DERIVED from the children on every read — never stored on or
  // read off the group document (matchTally.js §"Derived, not stored").
  const tally = useMemo(() => computeTally(children), [children])

  // The most-senior match is the marquee ("Main match"); the rest form the
  // ladder ("All matches"). Children arrive already sorted by groupOrder.
  const feature = children[0] ?? null
  const rest    = children.slice(1)

  const rows = useMemo(() => rest.map(c => ({
    key:       c.id,
    ageLabel:  ageLabel(c.ageSlug),
    href:      matchUrl(c),
    status:    c.status,
    homeScore: c.homeScore,
    awayScore: c.awayScore,
    time:      fmtTime(c.scheduledAt),
    venue:     c.pitch || '',
  })), [rest])

  // Colours come from the first child's team colours, passed through teamAccent
  // so they are legible on white and never collide with live-red. No children →
  // undefined, letting ResultsSpine fall back to its own defaults.
  const homeColor = children.length ? teamAccent(children[0]?.homeTeamColor) : undefined
  const awayColor = children.length ? teamAccent(children[0]?.awayTeamColor) : undefined

  // Advertise the canonical (clean) group URL, same pattern as MatchDetail.
  useEffect(() => {
    if (!group) return
    const href = window.location.origin + `/match/${date}/${slug}`
    let link = document.querySelector('link[rel="canonical"]')
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link) }
    link.setAttribute('href', href)
  }, [group, date, slug])

  if (loading) return <Spinner />
  if (!group) return <div className="px-4 py-12 text-center text-slate-500 text-sm">Match day not found.</div>

  const isLive     = tally.status === 'live'
  const homeC      = homeColor ?? '#7B1E3C'
  const awayC      = awayColor ?? '#1B3B6F'
  const sportLabel = group.sport ? group.sport[0].toUpperCase() + group.sport.slice(1) : ''
  // Same group-level gender derivation as the slug prefix: show it in the eyebrow
  // only when every match in the day shares one gender ("Boys Netball"); omit it
  // when mixed, because the rows already carry it (Boys U14A / Girls U16A).
  const genderSet    = new Set(children.map(c => c.gender).filter(Boolean))
  const sharedGender = genderSet.size === 1 ? [...genderSet][0] : null
  const genderWord   = sharedGender ? sharedGender[0].toUpperCase() + sharedGender.slice(1) : ''
  const sportBit     = [genderWord, sportLabel].filter(Boolean).join(' ')
  const eyebrow      = [fmtDayDate(group.matchDate), sportBit, `${children.length} match${children.length !== 1 ? 'es' : ''}`]
    .filter(Boolean).join(' · ')
  const initial = s => (s ?? '').trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12">

      {/* Hero — the two schools, the day, and the signature day tally. */}
      <header className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">{eyebrow}</div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="w-[38px] h-[38px] rounded-[9px] grid place-items-center text-white font-display font-bold text-[15px]" style={{ backgroundColor: homeC }}>{initial(group.homeName)}</div>
            <div className="font-display font-semibold leading-[1.05] tracking-[-.025em] text-[clamp(19px,5.4vw,26px)] text-slate-900">{group.homeName}</div>
            <div className="text-[11px] text-slate-500">{group.venue ? `Home · ${group.venue}` : 'Home'}</div>
          </div>
          <div className="font-display text-[12px] font-medium tracking-[.1em] text-slate-400">V</div>
          <div className="flex flex-col gap-1.5 items-end text-right">
            <div className="w-[38px] h-[38px] rounded-[9px] grid place-items-center text-white font-display font-bold text-[15px]" style={{ backgroundColor: awayC }}>{initial(group.awayName)}</div>
            <div className="font-display font-semibold leading-[1.05] tracking-[-.025em] text-[clamp(19px,5.4vw,26px)] text-slate-900">{group.awayName}</div>
            <div className="text-[11px] text-slate-500">Away</div>
          </div>
        </div>

        {group.venue && <div className="mt-4 text-[13px] text-slate-600">{group.venue}</div>}

        {/* Day tally — split bar + legend, DERIVED from the children on read. */}
        <div className="mt-6">
          <div className="flex items-baseline justify-between mb-2 gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 flex items-center gap-2">
              Day tally · {tally.played} of {tally.total} played
              {isLive && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: LIVE_RED }} />
                  <span className="text-[10px] font-bold" style={{ color: LIVE_RED }}>LIVE</span>
                </span>
              )}
            </div>
            <div className="text-[12px] text-slate-600 whitespace-nowrap">
              {scoreNoun(group.sport)} <b className="tabular-nums font-bold text-slate-900">{tally.goalsFor}</b> – <b className="tabular-nums font-bold text-slate-900">{tally.goalsAgainst}</b>
            </div>
          </div>
          <div className="flex h-3 rounded-md overflow-hidden gap-0.5">
            {tally.homeWins > 0 && <div style={{ flexGrow: tally.homeWins, backgroundColor: homeC }} />}
            {tally.draws    > 0 && <div style={{ flexGrow: tally.draws,    backgroundColor: '#7C8B85' }} />}
            {tally.awayWins > 0 && <div style={{ flexGrow: tally.awayWins, backgroundColor: awayC }} />}
            {tally.toPlay   > 0 && <div style={{ flexGrow: tally.toPlay,   backgroundColor: '#E2E7E4' }} />}
            {tally.total === 0  && <div style={{ flexGrow: 1, backgroundColor: '#E2E7E4' }} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
            <Leg color={homeC} label={group.homeName} n={tally.homeWins} />
            <Leg color="#7C8B85" label="Drawn" n={tally.draws} />
            <Leg color={awayC} label={group.awayName} n={tally.awayWins} />
            <Leg color="#E2E7E4" label="To play" n={tally.toPlay} />
          </div>
        </div>
      </header>

      {/* Scorer / admin quick actions — set times, edit the day, delete/detach. */}
      {(canScore || isPlatformAdmin) && (
        <div className="flex justify-end items-center gap-4 mt-3">
          <button type="button" onClick={() => setEditOpen(true)}
            className="text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 transition-colors">
            Edit
          </button>
          <button type="button" onClick={() => setDeleteOpen(true)}
            className="text-[11px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors">
            Delete
          </button>
          <Link to={`/match/${date}/${slug}/times`}
            className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
            Set times →
          </Link>
        </div>
      )}

      {/* Main match — the marquee (most senior) match. */}
      {feature && (
        <section className="mt-6">
          <SecHead title="Main match" note={feature.pitch || ''} />
          <FeatureCard child={feature} homeName={group.homeName} awayName={group.awayName} homeC={homeC} awayC={awayC} />
        </section>
      )}

      {/* All matches — the signature results ladder (canonical ResultsSpine). */}
      {rows.length > 0 && (
        <section className="mt-6">
          <SecHead title="All matches" note="Seniority order" />
          <ResultsSpine rows={rows} homeColor={homeColor} awayColor={awayColor} />
        </section>
      )}

      {!feature && (
        <div className="mt-6 bg-white rounded-2xl border border-slate-200 px-5 py-8 text-center text-slate-400 text-sm shadow-sm">
          No matches in this match day yet.
        </div>
      )}

      <p className="mt-6 text-[12px] text-slate-400 leading-relaxed">
        Times are set by the host and can be added after the match day is created. Each match has its own page.
      </p>

      {/* Organiser dialogs — gated identically to the actions above. */}
      {(canScore || isPlatformAdmin) && editOpen && (
        <EditGroupDialog group={group} children={children} onClose={() => setEditOpen(false)} />
      )}
      {(canScore || isPlatformAdmin) && deleteOpen && (
        <DeleteGroupDialog group={group} children={children}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => navigate('/')} />
      )}
    </div>
  )
}
