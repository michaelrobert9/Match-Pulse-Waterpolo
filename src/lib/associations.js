// Association model.
//
// An `association` organisation is one of two kinds:
//   • franchise  — a private/competition association (PSI, PSR, DPL, TPL). It runs
//                  competitions and OWNS franchise clubs; it never owns teams
//                  itself. Its franchise clubs are exclusive — they may only play
//                  in competitions this association runs.
//   • federation — a registered governing body (e.g. KZN Hockey). It runs leagues
//                  that independent clubs enter, AND owns its own representative
//                  teams (interprovincial). It has no control over clubs.
//
// The kind is stored on the org as `associationKind`. It defaults to 'federation'
// when unset, so an association configured before this feature keeps owning its
// teams until an admin explicitly switches it to a franchise association.

export const ASSOCIATION_KINDS = [
  { value: 'franchise',  label: 'Franchise / Private Association',
    desc: 'Runs competitions and owns exclusive franchise clubs. Owns no teams itself.' },
  { value: 'federation', label: 'Federation / Governing Body',
    desc: 'Runs leagues for independent clubs and owns its own representative teams.' },
]

// The resolved kind of an association org ('franchise' | 'federation'), or null
// for non-associations. Unset associations resolve to 'federation' (safe default:
// preserves team ownership until an admin classifies them).
export function associationKind(org) {
  if (org?.type !== 'association') return null
  return org.associationKind === 'franchise' ? 'franchise' : 'federation'
}

export const isFranchiseAssociation  = org => associationKind(org) === 'franchise'
export const isFederationAssociation = org => associationKind(org) === 'federation'

// Whether an org owns teams directly. Schools and clubs always do; a federation
// owns its representative teams; a franchise (private) association never does —
// its teams live in its franchise clubs.
export function orgOwnsTeams(org) {
  return org?.type !== 'association' || isFederationAssociation(org)
}

// A club that belongs to a franchise (private) association. `franchiseOf` holds
// that association's org id. Franchise clubs are exclusive to that association.
export const isFranchiseClub = org => org?.type === 'club' && !!org?.franchiseOf
export const franchiseAssociationId = org => (org?.type === 'club' ? (org?.franchiseOf ?? null) : null)

// Can a club enter a competition owned by `ownerOrgId`?
//   • a franchise club — only its owning association's competitions.
//   • any other club/school/federation team — no franchise restriction.
export function clubMayEnterCompetition(clubOrg, ownerOrgId) {
  const fid = franchiseAssociationId(clubOrg)
  if (!fid) return true
  return !!ownerOrgId && ownerOrgId === fid
}
