// Per-organisation media library.
//
// A lightweight registry of images an organisation has uploaded, so a logo,
// crest or banner can be re-selected next season instead of re-uploaded. Stored
// per-sport (this app's named database) as a subcollection of the org doc:
//   organizations/{orgId}/media/{mediaId}
//
// It is populated automatically whenever an image is uploaded through
// <ImageUpload> with an `orgId`, and by direct uploads from the library picker.
// Registration is best-effort: if the Firestore rules for this subcollection
// have not been deployed yet, registration silently no-ops and the underlying
// image upload still succeeds — the library just stays empty until the rules
// ship (see docs/PROVISIONING or the media-library rollout notes).

import {
  collection, addDoc, deleteDoc, doc, getDocs, query, orderBy, where, limit, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase'

const mediaCol = (orgId) => collection(db, 'organizations', orgId, 'media')

// Newest first. Returns [] on any error (e.g. rules not yet deployed) so callers
// can render an empty library without special-casing.
export async function fetchOrgMedia(orgId) {
  if (!orgId) return []
  try {
    const snap = await getDocs(query(mediaCol(orgId), orderBy('uploadedAt', 'desc')))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch {
    return []
  }
}

// Register an already-uploaded image URL into the library. De-duplicates by URL
// so re-uploading to the same deterministic path never creates a second entry.
// Best-effort: swallows errors and returns null (never breaks the caller's flow).
export async function registerOrgMedia(orgId, { url, name, path = null, contentType = null, size = null } = {}) {
  if (!orgId || !url) return null
  try {
    const dup = await getDocs(query(mediaCol(orgId), where('url', '==', url), limit(1)))
    if (!dup.empty) return dup.docs[0].id
    const ref = await addDoc(mediaCol(orgId), {
      url,
      name: (name || 'Image').slice(0, 120),
      path,
      contentType,
      size,
      uploadedBy: auth?.currentUser?.uid ?? null,
      uploadedAt: serverTimestamp(),
    })
    return ref.id
  } catch {
    return null
  }
}

// Remove one library entry. This deletes the registry record only, not the
// underlying storage blob (other records/entities may reference the same URL).
export async function removeOrgMedia(orgId, mediaId) {
  if (!orgId || !mediaId) return
  await deleteDoc(doc(db, 'organizations', orgId, 'media', mediaId))
}
