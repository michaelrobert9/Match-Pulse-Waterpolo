import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile as fbUpdateProfile,
  signOut as fbSignOut,
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, identityDb, configured, googleProvider } from '../firebase'
import { canAdministerCompetition as canAdminComp } from '../lib/competitionAuth'
import { resolveScopedCapability, grantOf } from '../lib/capabilities'
import { userEntitlementStatus } from '../lib/entitlement'

const AuthContext = createContext(null)

// Plan state is mirrored onto the Auth token as CUSTOM CLAIMS by the main
// site's syncUserClaims function (platform brief §5). Firestore rules cannot
// read across databases, so the claim — not a document — is the source of
// truth here. Claims travel with the user, so they are already present after
// the handoff. They refresh about hourly; call getIdToken(true) after a
// purchase to pick a new plan up immediately.
function entitlementFieldsOfClaims(claims) {
  return {
    entitlement:          claims?.entitlement ?? 'none',
    eventCredits:         claims?.eventCredits ?? 0,
    entitlementExpiresAt: claims?.entitlementExpiresAt ?? null,
  }
}

export function AuthProvider({ children }) {
  const [user,              setUser]             = useState(null)
  const [isPlatformAdmin,   setIsPlatformAdmin]   = useState(false)
  const [orgRoles,          setOrgRoles]         = useState({})
  const [competitionRoles,  setCompetitionRoles] = useState({})
  const [overrides,         setOverrides]        = useState({})
  const [userEntitlement,   setUserEntitlement]  = useState(null)
  const [loading,           setLoading]          = useState(true)

  useEffect(() => {
    if (!configured) { setLoading(false); return }

    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u)
        // Plan + platform-admin state come from the token's custom claims,
        // mirrored centrally by the main site (brief §5) — not from a document.
        try {
          const tok = await u.getIdTokenResult()
          setIsPlatformAdmin(tok.claims.platformAdmin === true)
          setUserEntitlement(entitlementFieldsOfClaims(tok.claims))
        } catch {
          setIsPlatformAdmin(false)
          setUserEntitlement(null)
        }
        try {
          const userRef = doc(identityDb, 'users', u.uid)
          const snap    = await getDoc(userRef)

          if (!snap.exists()) {
            const profile = {
              email:          (u.email ?? '').toLowerCase(),
              displayName:    u.displayName ?? '',
              platformAdmin:  false,
              orgRoles:       {},
              createdAt:      serverTimestamp(),
              updatedAt:      serverTimestamp(),
            }
            await setDoc(userRef, profile)
            setDoc(doc(identityDb, 'userProfiles', u.uid), {
              email:       (u.email ?? '').toLowerCase(),
              displayName: u.displayName ?? '',
              photoURL:    u.photoURL ?? null,
            }, { merge: true }).catch(() => {})
            setIsPlatformAdmin(false)
            setOrgRoles({})
            setCompetitionRoles({})
            setOverrides({})
            setUserEntitlement(null)
          } else {
            const data = snap.data()
            // Self-heal a profile that predates this fix: if the stored name is
            // empty but the auth account carries one (from sign-up / Google),
            // backfill it so the back-end panels show the name, not the email.
            if (!data.displayName && u.displayName) {
              updateDoc(userRef, { displayName: u.displayName, updatedAt: serverTimestamp() }).catch(() => {})
              setDoc(doc(identityDb, 'userProfiles', u.uid), { displayName: u.displayName }, { merge: true }).catch(() => {})
            }
            setOrgRoles(data.orgRoles ?? {})
            setCompetitionRoles(data.competitionRoles ?? {})
            setOverrides(data.permissionOverrides ?? {})
          }
        } catch {
          setIsPlatformAdmin(false)
          setOrgRoles({})
          setCompetitionRoles({})
          setOverrides({})
          setUserEntitlement(null)
        }
      } else {
        setUser(null)
        setIsPlatformAdmin(false)
        setOrgRoles({})
        setCompetitionRoles({})
        setOverrides({})
        setUserEntitlement(null)
      }
      setLoading(false)
    })
  }, [])

  // Force a re-read of the user's Firestore profile (orgRoles, platformAdmin).
  // Call this after operations that modify the user's own document — e.g. after
  // self-creating an org so the new orgRoles mirror is reflected without signing out.
  async function refreshUserData() {
    if (!auth?.currentUser) return
    // force:true re-mints the token so a just-granted plan is visible without
    // waiting for the ~hourly refresh (brief §5).
    try {
      const tok = await auth.currentUser.getIdTokenResult(true)
      setIsPlatformAdmin(tok.claims.platformAdmin === true)
      setUserEntitlement(entitlementFieldsOfClaims(tok.claims))
    } catch { /* keep the current claim state */ }
    try {
      const snap = await getDoc(doc(identityDb, 'users', auth.currentUser.uid))
      if (snap.exists()) {
        const data = snap.data()
        setOrgRoles(data.orgRoles ?? {})
        setCompetitionRoles(data.competitionRoles ?? {})
        setOverrides(data.permissionOverrides ?? {})
      }
    } catch { /* silently ignore — will pick up on next sign-in */ }
  }

  // Sign-in happens LOCALLY, on this origin, against the shared Firebase Auth
  // project (platform brief v2 §1/§2). No redirect to the main site: an
  // installed iOS home-screen app can't be redirected back into. Every origin
  // gets its own valid session for the same underlying account the moment it
  // signs in. Account settings, password/email change and billing still live on
  // the main site (goAccount) — only the login form is local.
  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
  }

  async function signUp(email, password, displayName) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (displayName) await fbUpdateProfile(cred.user, { displayName })
    // Seed the central identity doc so back-office panels show the name even if
    // the user never completes the optional profile step. Merge so it coexists
    // with the onAuthStateChanged bootstrap. NOTE: never write plan/billing
    // fields here — those are central and rules reject them.
    await setDoc(doc(identityDb, 'users', cred.user.uid), {
      email:         (email ?? '').toLowerCase(),
      displayName:   displayName ?? '',
      updatedAt:     serverTimestamp(),
    }, { merge: true }).catch(() => {})
    setDoc(doc(identityDb, 'userProfiles', cred.user.uid), {
      email:       (email ?? '').toLowerCase(),
      displayName: displayName ?? '',
    }, { merge: true }).catch(() => {})
    return cred
  }

  function signInWithGoogle() {
    return signInWithPopup(auth, googleProvider)
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email)
  }

  // Sign-out is per-origin by design — it does not sign the user out of the
  // main site or another sport.
  const logout = () => fbSignOut(auth)

  // True if the user owns or is staff at the given org, or is a platform admin.
  const isOrgMember = (orgId) => isPlatformAdmin || !!orgRoles[orgId]
  // True if the user can reach the scorer/manage area at all. Includes anyone
  // who has bought a plan (personal entitlement) so they can set up and run
  // their own competition without belonging to an org.
  const canScore = isPlatformAdmin
    || Object.keys(orgRoles).length > 0
    || Object.keys(competitionRoles).length > 0
    || userEntitlementStatus(userEntitlement).canCreate
  // True if the user may administer a given competition (single admin role).
  const canAdministerCompetition = (competition) =>
    canAdminComp(competition, { uid: user?.uid, isPlatformAdmin, orgRoles, competitionRoles })
  // The caller's grant in a given org, normalised to { role, teamId } | null.
  const grantFor = (orgId) => grantOf(orgRoles[orgId])

  // Capability check, resolved per the catalogue: a Master Admin's per-person
  // override wins outright (on OR off); otherwise the natural role's fixed set
  // applies. Platform admins pass everything not explicitly switched off.
  //
  // Optional third argument carries TARGET context for scope-aware checks:
  //   canDo(orgId, 'team.profile.edit', { teamId, teamMgmtOn })
  // Org-wide grants authorise regardless of target team. A team-scoped grant
  // only authorises when teamMgmtOn is true and the target team matches the
  // grant's teamId. Callers that omit the target get the org-wide answer.
  const canDo = (orgId, capability, target = {}) => {
    if (overrides[capability] === true)  return true
    if (overrides[capability] === false) return false
    if (isPlatformAdmin) return true
    return resolveScopedCapability(capability, {
      grant:        grantOf(orgRoles[orgId]),
      overrides,
      targetTeamId: target.teamId ?? null,
      teamMgmtOn:   target.teamMgmtOn ?? false,
    })
  }

  return (
    <AuthContext.Provider value={{
      user, uid: user?.uid ?? null, isPlatformAdmin, orgRoles, competitionRoles, permissionOverrides: overrides,
      userEntitlement,
      isOrgMember, canScore, canAdministerCompetition, canDo, grantFor, loading,
      login, signUp, signInWithGoogle, resetPassword, logout, refreshUserData,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
