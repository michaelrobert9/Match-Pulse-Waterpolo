import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Check, X } from 'lucide-react'
import { fetchVenueIndex, searchVenues, fetchOrgHomeVenueId, fetchVenueFacilities } from '../lib/venues'

// A venue field that stays FREE TEXT but checks the central registry as you type,
// plus an OPTIONAL sport-scoped facility selector once a registered venue is
// picked.
//
// Value is: { pitch, venueId, venueSlug, facilityId, facilityName }.
//   • Type freely       → { pitch:<typed>, venueId:null, venueSlug:null, facility*:null }
//   • Pick a suggestion → { pitch:<name>,  venueId:<id>, venueSlug:<slug>, facility*:null }
//   • Pick a facility    → keeps the venue trio, sets facilityId/facilityName
// `pitch` is always the BASE venue name (or typed text) — the facility is never
// folded into it here; the stored display string is composed at save time.
// There is deliberately NO "add a venue" affordance — venues are created only on
// the main site. When nothing matches, the typed text is kept as-is and saved
// with no link. A missing/empty central index just means no suggestions appear.
//
// Props:
//   pitch        current base display string
//   venueId      current link (null when typed)
//   venueSlug    current slug snapshot (null when typed)
//   facilityId   current facility link (null when none)
//   facilityName current facility name snapshot (null when none)
//   hostOrgId    the host org — its home ground (org.homeVenueId) sorts to the top
//   onChange     ({ pitch, venueId, venueSlug, facilityId, facilityName }) => void
//   id, placeholder, className, inputClassName, disabled
export default function VenuePicker({
  pitch = '', venueId = null, venueSlug = null,
  facilityId = null, facilityName = null,
  hostOrgId = null, onChange,
  id, placeholder = 'Venue (optional)', className = '', inputClassName = '', disabled = false,
}) {
  const [index, setIndex]   = useState([])
  const [open, setOpen]     = useState(false)
  const [active, setActive] = useState(-1)
  const [homeVenueId, setHomeVenueId] = useState(null)
  const [facilities, setFacilities]   = useState([])
  // Debounce the SUGGESTIONS (display), not the fetch — the index is fetched once.
  const [debounced, setDebounced] = useState(pitch)
  const rootRef = useRef(null)

  // Fetch the central index once (cached in the lib across mounts). Never throws.
  useEffect(() => { let live = true; fetchVenueIndex().then(v => { if (live) setIndex(v) }); return () => { live = false } }, [])

  // Resolve the host org's home ground (local read). Degrades to no badge when
  // the field is absent or the read fails.
  useEffect(() => {
    let live = true
    if (!hostOrgId) { setHomeVenueId(null); return }
    fetchOrgHomeVenueId(hostOrgId).then(id => { if (live) setHomeVenueId(id) })
    return () => { live = false }
  }, [hostOrgId])

  // Once a registered venue is picked, load its sport-scoped facilities (one read
  // per venue). Cleared when unlinked. Never throws → empty list → no selector.
  useEffect(() => {
    let live = true
    if (!venueId) { setFacilities([]); return }
    fetchVenueFacilities(venueId).then(list => { if (live) setFacilities(list) })
    return () => { live = false }
  }, [venueId])

  // Debounce what we filter on so fast typing doesn't recompute every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(pitch), 120)
    return () => clearTimeout(t)
  }, [pitch])

  // Close on outside click.
  useEffect(() => {
    function onDoc(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const linked = !!venueId
  const suggestions = useMemo(
    () => (index.length ? searchVenues(index, debounced, { homeVenueId }) : []),
    [index, debounced, homeVenueId],
  )
  // Don't show a single suggestion that is just the already-picked venue.
  const visible = useMemo(
    () => suggestions.filter(v => !(linked && v.id === venueId)),
    [suggestions, linked, venueId],
  )
  const showList = open && visible.length > 0

  function type(text) {
    // Any keystroke breaks a link — this is now free text until re-picked, so the
    // facility link (which belonged to the venue) is dropped too.
    onChange?.({ pitch: text, venueId: null, venueSlug: null, facilityId: null, facilityName: null })
    setOpen(true); setActive(-1)
  }

  function pick(v) {
    // A new venue resets any facility choice — facilities belong to a venue.
    onChange?.({ pitch: v.name, venueId: v.id, venueSlug: v.slug ?? null, facilityId: null, facilityName: null })
    setOpen(false); setActive(-1)
  }

  function clear() {
    onChange?.({ pitch: '', venueId: null, venueSlug: null, facilityId: null, facilityName: null })
    setOpen(false); setActive(-1)
  }

  function pickFacility(fid) {
    const f = facilities.find(x => x.id === fid) || null
    onChange?.({ pitch, venueId, venueSlug, facilityId: f?.id ?? null, facilityName: f?.name ?? null })
  }

  // Label the selector with the facilities' shared displayNoun (e.g. "Court",
  // "Field") when they all agree, else a generic fallback. displayNoun labels the
  // selector only — it never enters the composed pitch.
  const facilityNoun = useMemo(() => {
    const nouns = [...new Set(facilities.map(f => String(f.displayNoun || '').trim()).filter(Boolean))]
    return nouns.length === 1 ? nouns[0] : 'facility'
  }, [facilities])
  const facilityLabel = facilityNoun.charAt(0).toUpperCase() + facilityNoun.slice(1)

  function onKeyDown(e) {
    if (!showList) {
      if (e.key === 'ArrowDown' && visible.length) { setOpen(true); setActive(0); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown')      { setActive(i => Math.min(i + 1, visible.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp')   { setActive(i => Math.max(i - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter')     { if (active >= 0 && active < visible.length) { pick(visible[active]); e.preventDefault() } }
    else if (e.key === 'Escape')    { setOpen(false); setActive(-1) }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={pitch}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          placeholder={placeholder}
          onChange={e => type(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`${inputClassName || 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors'} pr-8`}
        />
        {/* Only ONE right-side control so nothing overlaps: a clear button when
            there is text. The linked/typed state is shown on the helper line
            below, not stacked on top of the clear button. */}
        {pitch && !disabled && (
          <button type="button" onClick={clear} title="Clear venue"
            className="absolute inset-y-0 right-0 px-2 flex items-center text-slate-300 hover:text-slate-500">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Linked ↔ typed indicator, so an admin can see at a glance which
          fixtures are properly tagged. Only shown once the field has content. */}
      {pitch && (
        linked
          ? <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600">
              <Check className="w-3 h-3" /> Linked to a registered venue
            </p>
          : <p className="mt-1 text-[11px] text-slate-400">Typed venue — not linked to the registry</p>
      )}

      {/* Optional facility selector — only when a registered venue is picked AND
          it has facilities for this sport. Choosing one is optional: a
          venue-only match is valid, so the default is "no specific facility". */}
      {linked && facilities.length > 0 && (
        <div className="mt-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">
            {facilityLabel} <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
          </label>
          <select
            value={facilityId ?? ''}
            disabled={disabled}
            onChange={e => pickFacility(e.target.value || null)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
            <option value="">No specific {facilityNoun}</option>
            {facilities.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {showList && (
        <ul role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
          {visible.map((v, i) => (
            <li key={v.id} role="option" aria-selected={i === active}>
              <button type="button"
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); pick(v) }}
                className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${i === active ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-800 truncate">{v.name}</span>
                  {v.city && <span className="block text-[11px] text-slate-400 truncate">{v.city}</span>}
                </span>
                {homeVenueId && v.id === homeVenueId && (
                  <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-emerald-600 shrink-0">Home ground</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
