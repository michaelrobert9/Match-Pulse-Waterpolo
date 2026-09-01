// Read-only access to the CENTRAL venue registry.
//
// Venues are authored, edited and deleted only on the main site. This app never
// writes a venue — it reads a prebuilt typeahead index and links matches to it.
//
// Two central artefacts, both public reads, both in the (default) database
// reached through the `identityDb` handle (same one used for users/userProfiles):
//   • venues/{id}                  — the full venue record, including its
//     `facilities` array. Read ONE AT A TIME, only when a venue is picked
//     (fetchVenueFacilities), never eagerly — a per-fixture read beats fattening
//     the index every session already fetches.
//   • venueIndex/current           — ONE document holding every active venue as a
//     compact list for the picker: { venues: [{ id, name, nameNormalised, slug,
//     city }, …] }. Venues are no longer owned, so the index carries no owner.
//
// The index document does not exist until the first venue is created on the main
// site. A missing or empty index is NOT an error — it simply means "no
// suggestions available, free text only". The picker must never block on it.
//
// A host organisation's own ground is sorted to the top of the picker via that
// organisation's `homeVenueId` — read from the LOCAL org copy in this app's own
// database (fetchOrgHomeVenueId), not from the central registry.

import { doc, getDoc } from 'firebase/firestore'
import { identityDb, db, SPORT_KEY } from '../firebase'

// Fetch the index once per session and cache the promise, so repeated pickers
// (and re-mounts) share a single network read. Never throws: any failure or a
// missing document resolves to an empty list.
let indexPromise = null

export function fetchVenueIndex() {
  if (indexPromise) return indexPromise
  const p = getDoc(doc(identityDb, 'venueIndex', 'current'))
    .then(snap => {
      if (!snap.exists()) {
        // The index isn't built yet (no venue created on the main site). Don't
        // cache the miss — a later call retries so the picker starts working as
        // soon as the index appears, without a page reload.
        indexPromise = null
        return []
      }
      const list = snap.data()?.venues
      return Array.isArray(list) ? list : []
    })
    .catch(() => {
      // Transient read failure — clear the cache so the next call can retry.
      indexPromise = null
      return []
    })
  indexPromise = p
  return p
}

// Test/edge hook: drop the cached index so the next fetch re-reads. Not used in
// normal flow (the cache is meant to live for the session).
export function _resetVenueIndexCache() { indexPromise = null }

// Normalise a string for matching: lowercase, strip accents, drop punctuation,
// collapse whitespace. The index already carries `nameNormalised`; we normalise
// the user's query the same way so "st a" matches "St Andrew's".
export function normaliseVenueText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')                       // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

// Filter the index for a query and rank it. Matching is on the normalised name
// (primary) and city (secondary hint, so two similarly named schools in
// different towns are distinguishable). The host organisation's own ground —
// identified by its `homeVenueId` — sorts to the top. Returns at most `limit`
// suggestions.
export function searchVenues(index, query, { homeVenueId = null, limit = 8 } = {}) {
  const list = Array.isArray(index) ? index : []
  const q = normaliseVenueText(query)
  const matches = !q
    ? list.slice()
    : list.filter(v => {
        const name = v.nameNormalised || normaliseVenueText(v.name)
        const city = normaliseVenueText(v.city)
        return name.includes(q) || city.includes(q)
      })

  const scored = matches.map(v => {
    const name = v.nameNormalised || normaliseVenueText(v.name)
    const isHome = homeVenueId && v.id === homeVenueId
    // Rank: the org's home ground first, then a name that STARTS with the query,
    // then the rest.
    let rank = 3
    if (isHome) rank = 0
    else if (q && name.startsWith(q)) rank = 1
    else if (q) rank = 2
    return { v, rank, name }
  })

  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  return scored.slice(0, limit).map(s => s.v)
}

// The host organisation's home ground, read from the LOCAL org copy this app
// syncs (the main site is adding `homeVenueId` to that sync). Returns the venue
// id or null. Never throws: a missing field, missing doc, or read failure all
// resolve to null, so the picker simply shows no home-ground badge.
export async function fetchOrgHomeVenueId(orgId) {
  if (!orgId) return null
  try {
    const snap = await getDoc(doc(db, 'organizations', orgId))
    return (snap.exists() && snap.data()?.homeVenueId) || null
  } catch {
    return null
  }
}

// The venue's facilities that are relevant to THIS sport, read from the full
// central record `venues/{id}` on demand (one read per fixture, not from the
// index). A facility is a { id, name, displayNoun, sports: [...], order, active }
// entry; we keep only active ones whose `sports` includes this app's canonical
// sport key (SPORT_KEY), sorted by the main site's `order`. Never throws: any
// failure resolves to an empty list, so the facility selector simply does not
// appear.
export async function fetchVenueFacilities(venueId) {
  if (!venueId) return []
  try {
    const snap = await getDoc(doc(identityDb, 'venues', venueId))
    if (!snap.exists()) return []
    const list = snap.data()?.facilities
    if (!Array.isArray(list)) return []
    return list
      .filter(f => f && f.active !== false && Array.isArray(f.sports) && f.sports.includes(SPORT_KEY))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  } catch {
    return []
  }
}

// Compose the stored `pitch` display string from a base venue name and an
// optional facility name: "Kearsney College" alone, "Kearsney College – Astro 1"
// with a facility. Composed at SAVE time so every display surface reads one
// ready-made string. Empty base with a facility still yields just the facility.
export function composeVenuePitch(base, facilityName) {
  const b = String(base ?? '').trim()
  const f = String(facilityName ?? '').trim()
  if (b && f) return `${b} – ${f}`
  return b || f
}

// Inverse of composeVenuePitch: recover the base venue name from a stored,
// possibly-composed `pitch` so it can be shown in the picker input without the
// facility suffix (which the facility selector shows separately).
//
// Driven by the STORED facility, never by pattern-matching the separator: it
// strips only the exact stored `facilityName` from the end, and ONLY when
// `facilityId` is set (a real facility link). With no link the pitch is free
// text — which may itself legitimately contain " – " — so it is returned
// verbatim, so a re-save can never corrupt it.
export function stripFacilitySuffix(pitch, facilityId, facilityName) {
  const p = String(pitch ?? '')
  if (!facilityId) return p
  const f = String(facilityName ?? '').trim()
  if (!f) return p
  const suffix = ` – ${f}`
  return p.endsWith(suffix) ? p.slice(0, -suffix.length) : p
}
