// Resolves a match side into a display identity.
//
//   Primary line:   School/Club Name + Gender/Division + Team   (e.g. "Fatima Girls U16A")
//   Secondary line: optional identifier / descriptor            (e.g. "Durban")
//
// Registered teams (those with a team id) resolve from live Firestore data —
// the team document supplies the team label (its displayName already encodes
// gender/division + team), the parent org supplies the name prefix and the
// optional identifier. Manual / unregistered opponents fall back to the
// denormalised fields stored on the match document.
//
// The optional identifier is NEVER merged into the primary line.

import { getTeam, getOrg, peekTeam, peekOrg, prefetchTeams, prefetchOrgs } from './teamCache'
import { generatedTeamName } from './teamNaming'

// Compose an identity from a (possibly null) team doc, its (possibly null) org
// doc, and the match-side fallback fields.
export function buildIdentity({ team, org, fallback }) {
  const fb = fallback ?? {}
  // Team-label portion. For registered teams the canonical label is generated
  // live from the structured fields (gender/division + teamLabel); the stored
  // displayName is only a cache/fallback for legacy teams that predate the
  // structured model. Manual opponents use the stored match name.
  const teamLabel = team
    ? (generatedTeamName({ ...team, orgGenderProfile: org?.genderProfile }) || team.displayName || fb.teamName || '')
    : (fb.teamName ?? '')
  // Name prefix: live org name, else the team's denormalised orgName, else the
  // match's stored org name.
  const orgName = org?.name ?? team?.orgName ?? fb.orgName ?? null
  const primary = orgName
    ? `${orgName} ${teamLabel}`.replace(/\s+/g, ' ').trim()
    : teamLabel
  // Logo: apply the same inherit-vs-own rule as resolveTeamProfileIdentity —
  // a team's own logo only when team-level management is on, otherwise the
  // org's logo. Manual opponents fall back to the match-side stored logo.
  const mgmtOn = org?.teamLevelManagement === true
  const logo = (mgmtOn && team?.logoUrl)
    ? team.logoUrl
    : (org?.logoUrl ?? fb.logo ?? null)
  // Display policy: the name IS the identity. Stored shortCodes are ignored
  // for display (kept in the database for legacy/export use only), so no
  // identifier line is emitted.
  return {
    primary:    primary || 'Unknown team',
    identifier: null,
    slug:       team?.slug ?? fb.slug ?? null,
    orgSlug:    org?.slug ?? fb.orgSlug ?? null,
    color:      team?.primaryColor ?? fb.color ?? null,
    logo,
  }
}

// Resolve a team's PROFILE identity (image / name / bio) applying the
// org-level inherit-vs-own rule, field by field:
//   - team-level management ON  + team has its own value → use the team's value
//   - otherwise                                          → inherit the org's value
// Hide-not-clear: stored team values are never read when the toggle is off, but
// they are not deleted — turning the toggle back on restores them.
export function resolveTeamProfileIdentity(team, org) {
  const mgmtOn = org?.teamLevelManagement === true
  const canonicalName =
    generatedTeamName({ ...(team ?? {}), orgGenderProfile: org?.genderProfile })
    || team?.displayName || team?.name || ''
  return {
    name:  (mgmtOn && team?.name)    ? team.name    : canonicalName,
    image: (mgmtOn && team?.logoUrl) ? team.logoUrl : (org?.logoUrl ?? null),
    bio:   (mgmtOn && team?.bio)     ? team.bio     : (org?.bio ?? null),
  }
}

function sideFallback(match, side) {
  return {
    teamName:  match[`${side}TeamName`],
    orgName:   match[`${side}OrgName`],
    orgSlug:   match[`${side}OrgSlug`] ?? null,
    slug:      match[`${side}TeamSlug`],
    color:     match[`${side}TeamColor`],
    logo:      match[`${side}LogoUrl`] ?? null,
  }
}

function isRegistered(match, side) {
  return match[`${side}Registered`] !== false && !!match[`${side}TeamId`]
}

// Synchronous resolution from cache only. Always returns a usable identity:
// live data when the cache is warm, otherwise the match-side fallback. Used to
// seed display without a loading flicker.
export function resolveTeamSideSync(match, side) {
  const fallback = sideFallback(match, side)
  if (!isRegistered(match, side)) return buildIdentity({ team: null, org: null, fallback })
  const team  = peekTeam(match[`${side}TeamId`]) ?? null
  const orgId = team?.organizationId ?? match[`${side}OrgId`]
  const org   = (orgId ? peekOrg(orgId) : null) ?? null
  return buildIdentity({ team, org, fallback })
}

// Authoritative async resolution. Reads the team + org docs (cache or network).
export async function resolveTeamSide(match, side) {
  const fallback = sideFallback(match, side)
  if (!isRegistered(match, side)) {
    // Manual / unregistered opponent — fallback only, no reads.
    return buildIdentity({ team: null, org: null, fallback })
  }
  const team  = await getTeam(match[`${side}TeamId`])
  const orgId = team?.organizationId ?? match[`${side}OrgId`]
  const org   = orgId ? await getOrg(orgId) : null
  return buildIdentity({ team, org, fallback })
}

// Warm the cache for a list of matches in a couple of batched reads, so that
// per-card resolution is a synchronous cache hit.
export async function prefetchMatchTeams(matches) {
  const teamIds = []
  const orgIds  = []
  for (const m of matches ?? []) {
    if (isRegistered(m, 'home')) teamIds.push(m.homeTeamId)
    if (isRegistered(m, 'away')) teamIds.push(m.awayTeamId)
    if (m.homeOrgId) orgIds.push(m.homeOrgId)
    if (m.awayOrgId) orgIds.push(m.awayOrgId)
  }
  await Promise.all([prefetchTeams(teamIds), prefetchOrgs(orgIds)])
}
