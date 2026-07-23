// Session-scoped cache for team and organisation documents.
//
// Registered-team display names are resolved live from Firestore (team doc +
// parent org doc) rather than from denormalised match fields. To keep that
// affordable, every fetched document is memoised in a module-level Map for the
// lifetime of the session, and list pages can warm the cache with a couple of
// batched `in` queries before rendering.
//
// Reads are deduplicated: concurrent requests for the same id share one
// in-flight Promise. A document that does not exist is cached as `null` so we
// never re-query a known-missing id.

import { db, configured } from '../firebase'
import { doc, getDoc, getDocs, collection, query, where, documentId } from 'firebase/firestore'

const teamCache = new Map()      // id -> teamDoc | null
const orgCache  = new Map()      // id -> orgDoc | null
const teamInflight = new Map()   // id -> Promise
const orgInflight  = new Map()

function fetchOne(coll, id, cache, inflight) {
  if (cache.has(id)) return Promise.resolve(cache.get(id))
  if (inflight.has(id)) return inflight.get(id)
  const p = getDoc(doc(db, coll, id))
    .then(snap => {
      const val = snap.exists() ? { id: snap.id, ...snap.data() } : null
      cache.set(id, val)
      inflight.delete(id)
      return val
    })
    .catch(err => {
      inflight.delete(id)
      console.warn(`teamCache: failed to fetch ${coll}/${id}`, err)
      return null
    })
  inflight.set(id, p)
  return p
}

export function getTeam(id) {
  if (!configured || !id) return Promise.resolve(null)
  return fetchOne('teams', id, teamCache, teamInflight)
}

export function getOrg(id) {
  if (!configured || !id) return Promise.resolve(null)
  return fetchOne('organizations', id, orgCache, orgInflight)
}

// Synchronous cache peek. Returns the document, `null` if known-missing, or
// `undefined` if it has not been fetched yet. Used to seed display without a
// loading flicker once the cache is warm.
export function peekTeam(id) { return id ? teamCache.get(id) : undefined }
export function peekOrg(id)  { return id ? orgCache.get(id)  : undefined }

// Firestore allows up to 30 values in an `in` filter (SDK v10).
const IN_LIMIT = 30

async function prefetch(coll, ids, cache, inflight) {
  const missing = [...new Set(ids.filter(Boolean))].filter(id => !cache.has(id) && !inflight.has(id))
  if (missing.length === 0) return
  const chunks = []
  for (let i = 0; i < missing.length; i += IN_LIMIT) chunks.push(missing.slice(i, i + IN_LIMIT))
  await Promise.all(chunks.map(async chunk => {
    try {
      const snap = await getDocs(query(collection(db, coll), where(documentId(), 'in', chunk)))
      const found = new Set()
      snap.docs.forEach(d => { cache.set(d.id, { id: d.id, ...d.data() }); found.add(d.id) })
      // Cache `null` for any id the query did not return — it does not exist.
      chunk.forEach(id => { if (!found.has(id)) cache.set(id, null) })
    } catch (err) {
      console.warn(`teamCache: batch prefetch failed for ${coll}`, err)
    }
  }))
}

export async function prefetchTeams(ids) {
  if (!configured) return
  return prefetch('teams', ids, teamCache, teamInflight)
}

export async function prefetchOrgs(ids) {
  if (!configured) return
  return prefetch('organizations', ids, orgCache, orgInflight)
}
