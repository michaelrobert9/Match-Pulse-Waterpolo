import {
  collection, addDoc, getDocs, query, where,
  updateDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { findUserByEmail, setOrgStaff, setMasterAdmin } from './adminQueries'

// Create an invite. For an email that already has a MatchPulse account the
// role is granted immediately and the invite is recorded as accepted.
// For new emails a pending record is stored; it is automatically claimed when
// the invitee signs up (claimPendingInvites). Master Admin grants to accounts
// that do not yet exist are intentionally blocked — the high privilege level
// requires a live admin action once the account exists.
export async function createInvite({ email, role, orgId = null, teamId = null, invitedBy }) {
  const normalizedEmail = email.toLowerCase().trim()
  const existing = await findUserByEmail(normalizedEmail)

  if (existing) {
    if (role === 'master_admin') {
      await setMasterAdmin(existing.id, true)
    } else if (orgId) {
      await setOrgStaff(orgId, existing.id, role, { teamId })
    }
    await addDoc(collection(db, 'invites'), {
      email: normalizedEmail, role, orgId, teamId, invitedBy,
      status: 'accepted', claimedBy: existing.id,
      claimedAt: serverTimestamp(), createdAt: serverTimestamp(),
    })
    return { immediate: true, displayName: existing.displayName ?? existing.email }
  }

  if (role === 'master_admin') {
    const err = new Error(
      'That email address does not have a MatchPulse account yet. ' +
      'Ask them to sign up first, then grant Master Admin status from the Permissions page.'
    )
    err.code = 'invite/no-account-for-master-admin'
    throw err
  }

  await addDoc(collection(db, 'invites'), {
    email: normalizedEmail, role, orgId, teamId, invitedBy,
    status: 'pending', createdAt: serverTimestamp(),
  })
  return { immediate: false }
}

// Called after account creation. Finds any pending invites for this email
// and claims them, writing the authoritative staff record and orgRoles mirror
// in one batch per invite. Returns an array of claimed invite data objects.
export async function claimPendingInvites(email, uid) {
  const normalizedEmail = email.toLowerCase()
  let snap
  try {
    snap = await getDocs(query(
      collection(db, 'invites'),
      where('email', '==', normalizedEmail),
      where('status', '==', 'pending'),
    ))
  } catch {
    return []
  }
  if (snap.empty) return []

  const claimed = []
  for (const inviteDoc of snap.docs) {
    const invite = inviteDoc.data()
    try {
      if (invite.orgId) {
        const batch = writeBatch(db)
        // inviteId is included so the Firestore rule can validate the claim
        batch.set(doc(db, 'organizations', invite.orgId, 'staff', uid), {
          role:      invite.role,
          teamId:    invite.teamId || null,
          inviteId:  inviteDoc.id,
          grantedBy: invite.invitedBy,
          grantedAt: serverTimestamp(),
        })
        batch.update(doc(db, 'users', uid), {
          [`orgRoles.${invite.orgId}`]: { role: invite.role, teamId: invite.teamId || null },
        })
        await batch.commit()
      }
      await updateDoc(doc(db, 'invites', inviteDoc.id), {
        status: 'accepted', claimedBy: uid, claimedAt: serverTimestamp(),
      })
      claimed.push(invite)
    } catch (err) {
      console.error('Failed to claim invite', inviteDoc.id, err)
    }
  }
  return claimed
}
