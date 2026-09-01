import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Check, Calendar, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchOrganizations, fetchOrganization, fetchTeamsForOrganization,
} from '../../lib/queries'
import { createMatchGroup } from '../../lib/adminQueries'
import { autoPairTeams, rowFromManualPair, finalizeRows } from '../../lib/matchGroups'
import { levelLabel } from '../../lib/teamNaming'
import { matchPath } from '../../lib/matchPaths'
import VenuePicker from '../../components/VenuePicker'

// ── Shared primitives ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

const TYPE_GROUPS = [
  { key: 'school',      label: 'Schools' },
  { key: 'club',        label: 'Clubs' },
  { key: 'association', label: 'Associations' },
]

// Grouped <select> org picker. Excludes `excludeId` so home and away can never be
// the same organisation.
function OrgPicker({ label, orgs, value, excludeId, onChange }) {
  const available = orgs.filter(o => o.id !== excludeId)
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
        {label}
      </label>
      <select
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}>
        <option value="">Select organisation…</option>
        {TYPE_GROUPS.map(g => {
          const inGroup = available.filter(o => o.type === g.key)
          if (inGroup.length === 0) return null
          return (
            <optgroup key={g.key} label={g.label}>
              {inGroup.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </optgroup>
          )
        })}
        {/* Any org without a recognised type still needs to be selectable. */}
        {available.some(o => !TYPE_GROUPS.find(g => g.key === o.type)) && (
          <optgroup label="Other">
            {available.filter(o => !TYPE_GROUPS.find(g => g.key === o.type))
              .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  )
}

// Org side object passed to createMatchGroup (group-level, not a team).
function orgSide(org) {
  return {
    id:            org.id,
    name:          org.name,
    type:          org.type ?? null,
    primaryColor:  org.primaryColor ?? null,
    genderProfile: org.genderProfile ?? null,
  }
}

// A per-row scheduled Date from the day's date + an optional "HH:MM" time.
// Blank time → null (times are never required).
function combineDateTime(matchDate, time) {
  if (!matchDate || !time) return null
  const d = new Date(`${matchDate}T${time}`)
  return isNaN(d.getTime()) ? null : d
}

// The team's OWN displayName ("Girls U15A") is not ours to control — so the
// wizard never shows it. We compose the side identity ourselves from the org
// name + the gender-neutral level token (built from structured fields); the
// group-aware gender lives in the row header (ageLabel), added only when the day
// is genuinely mixed.
const neutralLevel = t => levelLabel(t) || (t?.displayName ?? '')
const sideName = (org, t) => `${org?.name ?? ''} ${neutralLevel(t)}`.trim()

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CreateMatchGroup() {
  const { orgRoles, isPlatformAdmin } = useAuth()
  const navigate = useNavigate()

  const [orgs,        setOrgs]        = useState([])
  const [loadingOrgs, setLoadingOrgs] = useState(true)

  const [homeOrgId,    setHomeOrgId]    = useState(null)
  const [awayOrgId,    setAwayOrgId]    = useState(null)
  const [matchDate,    setMatchDate]    = useState('')
  const [defaultVenue,        setDefaultVenue]        = useState('')
  const [defaultVenueId,      setDefaultVenueId]      = useState(null)
  const [defaultVenueSlug,    setDefaultVenueSlug]    = useState(null)
  const [defaultFacilityId,   setDefaultFacilityId]   = useState(null)
  const [defaultFacilityName, setDefaultFacilityName] = useState(null)

  const [teamsLoading, setTeamsLoading] = useState(false)
  const [homeTeams,    setHomeTeams]    = useState([])
  const [awayTeams,    setAwayTeams]    = useState([])

  // entries: [{ uid, row, included, time, venue }] — UI state layered over the
  // paired rows. `uid` stays stable across a manual re-pair so the tick / time /
  // venue for a row survive when its away team is swapped.
  const [entries, setEntries] = useState([])

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const orgIds = Object.keys(orgRoles ?? {})
  const depKey = orgIds.slice().sort().join(',')

  const homeOrg = orgs.find(o => o.id === homeOrgId) ?? null
  const awayOrg = orgs.find(o => o.id === awayOrgId) ?? null

  // Load the organisations the user may create a match day for. Platform admins
  // get every org; members get just the ones they belong to (via orgRoles).
  useEffect(() => {
    setLoadingOrgs(true)
    const load = isPlatformAdmin
      ? fetchOrganizations()
      : orgIds.length === 0
        ? Promise.resolve([])
        : Promise.all(orgIds.map(id => fetchOrganization(id))).then(docs => docs.filter(Boolean))
    load.then(list => setOrgs(list ?? [])).catch(() => setOrgs([])).finally(() => setLoadingOrgs(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, isPlatformAdmin])

  // Load both sides' teams once both organisations are chosen.
  useEffect(() => {
    if (!homeOrgId || !awayOrgId) { setHomeTeams([]); setAwayTeams([]); return }
    let alive = true
    setTeamsLoading(true)
    Promise.all([
      fetchTeamsForOrganization(homeOrgId).catch(() => []),
      fetchTeamsForOrganization(awayOrgId).catch(() => []),
    ]).then(([h, a]) => {
      if (!alive) return
      setHomeTeams(h ?? [])
      setAwayTeams(a ?? [])
    }).finally(() => { if (alive) setTeamsLoading(false) })
    return () => { alive = false }
  }, [homeOrgId, awayOrgId])

  const pairing = useMemo(() => {
    if (!homeOrg || !awayOrg) return { rows: [], oneSided: [], mixedGender: false }
    return autoPairTeams(homeTeams, awayTeams, { homeOrg, awayOrg })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeOrgId, awayOrgId, homeTeams, awayTeams])

  // Seed the editable entries whenever a fresh pairing is produced.
  useEffect(() => {
    setEntries(pairing.rows.map(r => ({ uid: r.key, row: r, included: true, time: '', venue: '', venueId: null, venueSlug: null, facilityId: null, facilityName: null })))
  }, [pairing])

  function updateEntry(uid, patch) {
    setEntries(list => list.map(e => e.uid === uid ? { ...e, ...patch } : e))
  }

  function repair(uid, awayTeamId) {
    setEntries(list => list.map(e => {
      if (e.uid !== uid) return e
      const chosen = awayTeams.find(t => t.id === awayTeamId)
      if (!chosen) return e
      const newRow = rowFromManualPair(e.row.home, chosen, homeOrg, awayOrg, pairing.mixedGender, e.row.groupOrder)
      return { ...e, row: newRow }
    }))
  }

  const tickedCount = entries.filter(e => e.included).length
  const canConfirm  = !!homeOrg && !!awayOrg && !!matchDate && tickedCount > 0 && !saving

  async function handleConfirm() {
    if (!canConfirm) return
    setSaving(true)
    setError('')
    try {
      // Finalize the SELECTED rows: the gender prefix is decided from exactly what
      // is being created (unticking every girls row makes the day boys-only and
      // drops the prefix), ageSlugs are de-duped, and the order is recomputed.
      const finalized = finalizeRows(
        entries.filter(e => e.included).map(e => ({
          home:        e.row.home,
          away:        e.row.away,
          scheduledAt: combineDateTime(matchDate, e.time),
          venue:        e.venue || '',
          venueId:      e.venueId || null,
          venueSlug:    e.venueSlug || null,
          facilityId:   e.facilityId || null,
          facilityName: e.facilityName || null,
        })),
        { homeOrg, awayOrg },
      )
      const rows = finalized.map(fr => ({
        ageSlug:     fr.ageSlug,
        groupOrder:  fr.groupOrder,
        gender:      fr.gender,
        home:        fr.home,
        away:        fr.away,
        scheduledAt: fr.scheduledAt,
        venue:        fr.venue || '',
        venueId:      fr.venueId || null,
        venueSlug:    fr.venueSlug || null,
        facilityId:   fr.facilityId || null,
        facilityName: fr.facilityName || null,
      }))
      const result = await createMatchGroup({
        home:       orgSide(homeOrg),
        away:       orgSide(awayOrg),
        matchDate,
        venue:        defaultVenue.trim(),
        venueId:      defaultVenueId || null,
        venueSlug:    defaultVenueSlug || null,
        facilityId:   defaultFacilityId || null,
        facilityName: defaultFacilityName || null,
        sport:      'waterpolo',
        ownerOrgId: homeOrg.id,
        rows,
      })
      navigate(matchPath(result.matchDate, result.slug))
    } catch (err) {
      setError(err?.message ?? 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  const twoOrgsReady = !!homeOrg && !!awayOrg
  const showPairing  = twoOrgsReady && !!matchDate

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-6">
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">Create match day</h1>
          <p className="text-slate-500 text-sm mt-2">
            Pair two organisations' teams age-for-age and create every match in one go.
          </p>
        </div>

        {loadingOrgs && <Spinner />}

        {/* Guard: nothing to create a match day for. */}
        {!loadingOrgs && orgs.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
            <h3 className="text-slate-900 font-display font-bold text-base mb-2">
              {(isPlatformAdmin || orgIds.length === 0) ? 'No organisations yet' : 'Nothing to create a match day for'}
            </h3>
            <p className="text-slate-500 text-sm mb-5 leading-relaxed">
              {(isPlatformAdmin || orgIds.length === 0)
                ? 'Create a school, club or association first, then come back to build a match day.'
                : 'Your organisations couldn’t be loaded. Refresh, or check your access from Manage.'}
            </p>
            <Link to="/manage/new-org"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors">
              Create organisation
            </Link>
          </div>
        )}

        {/* Need at least two distinct organisations. */}
        {!loadingOrgs && orgs.length === 1 && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
            <h3 className="text-slate-900 font-display font-bold text-base mb-2">Only one organisation available</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              A match day is played between two different organisations. You currently have access to only one.
            </p>
          </div>
        )}

        {!loadingOrgs && orgs.length > 1 && (
          <div className="space-y-6">

            {/* Step 1 — the two sides */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">The two sides</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <OrgPicker label="Home (host)" orgs={orgs} value={homeOrgId} excludeId={awayOrgId}
                  onChange={setHomeOrgId} />
                <OrgPicker label="Away (visitor)" orgs={orgs} value={awayOrgId} excludeId={homeOrgId}
                  onChange={setAwayOrgId} />
              </div>
            </section>

            {/* Step 2 — date & default venue */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Date &amp; venue</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
                    Date
                  </label>
                  <input type="date" required
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    value={matchDate}
                    onChange={e => setMatchDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
                    Default venue <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
                  </label>
                  <VenuePicker
                    pitch={defaultVenue} venueId={defaultVenueId} venueSlug={defaultVenueSlug}
                    facilityId={defaultFacilityId} facilityName={defaultFacilityName}
                    hostOrgId={homeOrg?.id ?? null}
                    placeholder="e.g. Main courts"
                    inputClassName="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                    onChange={v => { setDefaultVenue(v.pitch); setDefaultVenueId(v.venueId); setDefaultVenueSlug(v.venueSlug); setDefaultFacilityId(v.facilityId); setDefaultFacilityName(v.facilityName) }} />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Times are optional everywhere — set them per match below, or later from the match day page.
              </p>
            </section>

            {/* Step 3 — the pairings */}
            {twoOrgsReady && !matchDate && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                <Calendar className="w-4 h-4 shrink-0" />
                Pick a date to see the paired matches.
              </div>
            )}

            {showPairing && teamsLoading && <Spinner />}

            {showPairing && !teamsLoading && (
              <section className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Matches</h2>
                  {entries.length > 0 && (
                    <span className="text-[11px] text-slate-400">{tickedCount} of {entries.length} selected</span>
                  )}
                </div>

                {/* No paired rows at all */}
                {entries.length === 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center shadow-sm">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4">
                      <Users className="w-6 h-6 text-slate-400" />
                    </div>
                    <h3 className="text-slate-900 font-display font-bold text-base mb-1">No matching bands</h3>
                    <p className="text-slate-500 text-sm leading-relaxed max-w-xs mx-auto">
                      No matching age/gender bands between these two — check their teams.
                    </p>
                  </div>
                )}

                {/* Paired rows */}
                {entries.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
                    {entries.map(e => (
                      <div key={e.uid} className={`p-4 ${e.included ? '' : 'opacity-50'}`}>
                        <div className="flex items-start gap-3">
                          <input type="checkbox" checked={e.included}
                            onChange={ev => updateEntry(e.uid, { included: ev.target.checked })}
                            className="mt-1 w-4 h-4 accent-emerald-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                              {e.row.ageLabel}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <span className="font-semibold text-slate-900">{sideName(homeOrg, e.row.home)}</span>
                              <span className="text-slate-400 text-xs font-bold uppercase">vs</span>
                              <select
                                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors max-w-[60%]"
                                value={e.row.away.id ?? ''}
                                onChange={ev => repair(e.uid, ev.target.value)}>
                                {/* Guarantee the current away team is present even if
                                    it isn't in the away org's list for some reason. */}
                                {!awayTeams.some(t => t.id === e.row.away.id) && e.row.away.id && (
                                  <option value={e.row.away.id}>{sideName(awayOrg, e.row.away)}</option>
                                )}
                                {awayTeams.map(t => (
                                  <option key={t.id} value={t.id}>{sideName(awayOrg, t)}</option>
                                ))}
                              </select>
                            </div>

                            {/* Per-row time & venue — both optional */}
                            <div className="grid sm:grid-cols-2 gap-2 mt-3">
                              <input type="time"
                                className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                                value={e.time}
                                onChange={ev => updateEntry(e.uid, { time: ev.target.value })} />
                              <VenuePicker
                                pitch={e.venue} venueId={e.venueId} venueSlug={e.venueSlug}
                                facilityId={e.facilityId} facilityName={e.facilityName}
                                hostOrgId={homeOrg?.id ?? null}
                                placeholder={defaultVenue.trim() ? `${defaultVenue.trim()} (default)` : 'Venue (optional)'}
                                inputClassName="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                                onChange={v => updateEntry(e.uid, { venue: v.pitch, venueId: v.venueId, venueSlug: v.venueSlug, facilityId: v.facilityId, facilityName: v.facilityName })} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* One-sided / unpairable — greyed, not selectable */}
                {pairing.oneSided.length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                      Not paired
                    </h3>
                    <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200/60 overflow-hidden">
                      {pairing.oneSided.map(o => (
                        <div key={o.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="text-sm text-slate-500 truncate">{o.ageLabel}</span>
                          <span className="text-[11px] text-slate-400 shrink-0 text-right">{o.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
            )}

            <button type="button" onClick={handleConfirm} disabled={!canConfirm}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors flex items-center justify-center gap-2">
              {saving
                ? 'Creating…'
                : <><Check className="w-4 h-4" /> Create match day{tickedCount > 0 ? ` (${tickedCount})` : ''}</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
