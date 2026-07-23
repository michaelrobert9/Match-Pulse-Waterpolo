// Competition-admin authorisation.
//
// A "competition admin" is the single administrative authority over one
// competition edition. The architecture uses a single admin role (no nested
// sub-roles). Authority is granted to:
//
//   1. Platform admins — may administer every competition.
//   2. Owner/staff of the competition's owning organisation (ownerOrgId/orgId).
//   3. The user who created the competition (createdBy) — covers competitions
//      created before an owning org was attached.
//
// This is a PURE function so it can be used identically in route guards, page
// components, and the data layer. It never reads Firestore — callers pass the
// already-resolved auth state.

import { grantOf } from './capabilities'

export function canAdministerCompetition(competition, { uid, isPlatformAdmin = false, orgRoles = {}, competitionRoles = {} } = {}) {
  if (!competition) return false
  if (isPlatformAdmin) return true

  const owningOrgId = competition.ownerOrgId ?? competition.orgId ?? null
  // Only an ORG-WIDE grant (teamId == null) administers competitions. A
  // team-scoped grant is participation/scoring authority for one team and must
  // never confer org-wide competition control.
  if (owningOrgId && orgRoles) {
    const grant = grantOf(orgRoles[owningOrgId])
    if (grant && grant.teamId == null) return true
  }

  if (uid && competition.createdBy && competition.createdBy === uid) return true

  // Direct competition staff (independent of org membership)
  const compId = competition.id ?? null
  if (uid && compId && competitionRoles[compId]) return true

  return false
}

// Throwing variant for the data layer. Mutations that change a competition
// (rules, lifecycle, invites, participation) call this so authorisation is
// enforced at the source, not only at the route.
export function assertCanAdministerCompetition(competition, authState) {
  if (!canAdministerCompetition(competition, authState)) {
    const err = new Error('You are not authorised to administer this competition.')
    err.code = 'competition/not-authorised'
    throw err
  }
}
