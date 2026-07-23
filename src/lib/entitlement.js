// Entitlement helpers — competition-hosting access.
//
// Entitlement can live on EITHER an org doc OR an individual user doc. Fields
// written by the PayFast ITN webhook (admin SDK — bypasses rules):
//   entitlement          : 'none' | 'event' | 'pro'   (absent → 'none')
//   eventCredits         : number                       (remaining once-off credits)
//   entitlementExpiresAt : Firestore Timestamp          (pro subscription end)
//
// PayFast purchases by an individual land on users/{uid}. Org-level grants
// (manual admin grants, activation codes) land on organizations/{orgId}.

import { doc, getDoc, updateDoc, increment } from 'firebase/firestore'
import { db } from '../firebase'

// Shared status resolver — works for any doc carrying the entitlement fields.
function entitlementStatusOf(data) {
  const e = data?.entitlement ?? 'none'
  if (e === 'pro') {
    const exp = data?.entitlementExpiresAt?.toDate?.()
      ?? (data?.entitlementExpiresAt ? new Date(data.entitlementExpiresAt) : null)
    if (exp && exp > new Date()) return { tier: 'pro',        canCreate: true,  unlimited: true  }
    return                               { tier: 'expired',   canCreate: false, unlimited: false }
  }
  if (e === 'event') {
    const credits = data?.eventCredits ?? 0
    if (credits > 0) return              { tier: 'event',     canCreate: true,  unlimited: false, credits }
    return                               { tier: 'no_credits',canCreate: false, unlimited: false, credits: 0 }
  }
  return                                 { tier: 'none',      canCreate: false, unlimited: false }
}

export function orgEntitlementStatus(org) {
  return entitlementStatusOf(org)
}

// Entitlement status for an individual user (PayFast purchases land here).
export function userEntitlementStatus(user) {
  return entitlementStatusOf(user)
}

// Decrement one event credit after successfully creating a competition.
// Call immediately after createManagedCompetition() succeeds for event-tier orgs.
export async function consumeEventCredit(orgId) {
  await updateDoc(doc(db, 'organizations', orgId), { eventCredits: increment(-1) })
}

// Decrement one event credit on a USER's profile (personal competitions).
export async function consumeUserEventCredit(uid) {
  await updateDoc(doc(db, 'users', uid), { eventCredits: increment(-1) })
}

// Fetch an org doc and return its entitlement status.
export async function fetchOrgEntitlement(orgId) {
  const snap = await getDoc(doc(db, 'organizations', orgId))
  return orgEntitlementStatus(snap.exists() ? snap.data() : null)
}
