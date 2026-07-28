// Water polo sport profile — waterpoloProfiles/{uid} in THIS sport's database,
// keyed by the central UID.
//
// Platform brief §3: sport-specific fields must never be written into the
// central users/{uid} document, which every sport shares. Water polo positions
// (centre forward / centre back / driver / wing / goalkeeper) and a WPSA
// registration number would otherwise collide with hockey's positions
// (goalkeeper|defence|midfield|forward) and netball's (GS|GA|WA|C|WD|GD|GK) on
// the same field.
//
// Identity fields (name, email, photo, bio) stay central and are owned by the
// main site — this module only handles what is genuinely water polo.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, configured } from '../firebase'

export const COLLECTION = 'waterpoloProfiles'

// Positions as used in water polo team sheets.
export const WATERPOLO_POSITIONS = [
  { value: 'goalkeeper',    label: 'Goalkeeper' },
  { value: 'centreForward', label: 'Centre Forward' },
  { value: 'centreBack',    label: 'Centre Back' },
  { value: 'driver',        label: 'Driver' },
  { value: 'wing',          label: 'Wing' },
  { value: 'utility',       label: 'Utility' },
]

// Schema of waterpoloProfiles/{uid}:
//   position        : one of WATERPOLO_POSITIONS[].value  ('' when not a player)
//   preferredHand   : 'right' | 'left'                     (optional)
//   capNumber       : number | null                        (usual cap number)
//   wpsaNumber      : string                               (Water Polo SA reg.)
//   updatedAt       : server timestamp
export async function fetchSportProfile(uid) {
  if (!configured || !uid) return null
  try {
    const snap = await getDoc(doc(db, COLLECTION, uid))
    return snap.exists() ? snap.data() : null
  } catch { return null }
}

export async function saveSportProfile(uid, data) {
  if (!configured || !uid) return
  return setDoc(doc(db, COLLECTION, uid), {
    position:      data.position ?? '',
    preferredHand: data.preferredHand ?? '',
    capNumber:     data.capNumber ?? null,
    wpsaNumber:    data.wpsaNumber ?? '',
    updatedAt:     serverTimestamp(),
  }, { merge: true })
}
