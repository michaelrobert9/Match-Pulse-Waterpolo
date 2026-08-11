import { matchPath, competitionMatchPath } from './matchPaths'

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function matchSlug(homeTeamName, awayTeamName) {
  return `${slugify(homeTeamName)}-vs-${slugify(awayTeamName)}`
}

// {org-slug}-{season}, e.g. "ashton-ballito-2026"
export function teamSlug(orgSlug, season) {
  return `${orgSlug}-${season}`
}

// ── Public URL helpers ───────────────────────────────────────────────────────
// The platform speaks in "Match" (singular), in two canonical shapes:
//
//   Standalone (non-competition) matches carry their own date:
//     /match/{YYYY-MM-DD}/{home}-vs-{away}            single match, or a group
//     /match/{YYYY-MM-DD}/{home}-vs-{away}/{child}    child of a group
//
//   Competition matches keep the competition-scoped shape (singular segment),
//   with NO date — tournaments and festivals carry dates from competition setup:
//     /competitions/{season}/{competition-slug}/match/{matchSlug}
//
// Path ASSEMBLY is a platform decision and lives in the canonical matchPaths.js
// (shared byte-identical across the four sports); matchUrl owns only the BRANCH
// logic. The resolved `path` is frozen on the match at creation and is the
// source of truth; a later rename changes DISPLAY only, never the URL — matchUrl
// reads the stored `path` first and only rebuilds it as a fallback.

// Canonical match URL. Reads the stored `path`; otherwise rebuilds it by
// branching on whether the match belongs to a competition (competition-scoped,
// dateless) or stands alone (dated). Every match carries `path` after creation
// and the backfill, so the rebuild branches are fallbacks only.
export function matchUrl(match) {
  if (!match) return '/'
  if (match.path) return match.path
  if (match.competitionId && match.competitionSeason && match.competitionSlug && match.matchSlug) {
    return competitionMatchPath(match.competitionSeason, match.competitionSlug, match.matchSlug)
  }
  if (match.matchDate && match.matchSlug) return matchPath(match.matchDate, match.matchSlug)
  return '/'
}

export function profileUrl(person) {
  return person?.slug ? `/profile/${person.slug}` : `/people/${person?.id}`
}

// Competition edition URL: /competitions/:season/:slug (year first, then series name).
// Falls back to the legacy series/ageGroup/season path, then the id route.
export function competitionUrl(comp) {
  if (!comp) return '/competitions'
  if (comp.slug && comp.season) return `/competitions/${comp.season}/${comp.slug}`
  if (comp.competitionPath)     return `/competition/${comp.competitionPath}`
  return `/competitions/${comp.id}`
}

// The team segment of a nested team URL. Team slugs are stored as
// "{orgSlug}-{qualifier}" (e.g. "ashton-ballito-u16a"); the public URL reads
// /{orgSlug}/{qualifier}, so we strip the redundant org prefix when present.
export function teamPathSegment(teamSlug, orgSlug) {
  if (!teamSlug) return null
  if (orgSlug && teamSlug.startsWith(`${orgSlug}-`)) return teamSlug.slice(orgSlug.length + 1)
  return teamSlug
}

// Nested team URL: /{org-slug}/{team-segment} (e.g. /ashton-ballito/u16a).
// Requires the parent org to build the org-slug prefix; without it we fall back
// to the legacy /team/:slug form so old links and unresolved orgs still work.
export function teamUrl(team, org) {
  const teamSlug = team?.slug
  if (!teamSlug) return null
  const orgSlug = org?.slug || (org?.name && slugify(org.name)) || team?.orgSlug || null
  if (!orgSlug) return `/team/${teamSlug}`
  return `/${orgSlug}/${teamPathSegment(teamSlug, orgSlug)}`
}

// Organisations live under /schools or /clubs by type. Slug is frozen at
// creation; fall back to a name-derived slug for any legacy org without one.
export function orgUrl(org) {
  if (!org) return '/'
  const base = org.type === 'club' ? 'clubs' : org.type === 'association' ? 'associations' : 'schools'
  const slug = org.slug || slugify(org.name)
  return `/${base}/${slug}`
}

// Canonical player URL: /player/{slug} when a slug exists, else /players/{id}.
// Slug format: lowercase-hyphenated full name, with -2/-3 suffix on collision.
// The /player/ prefix is intentionally singular to distinguish from the list.
export function playerUrl(person) {
  return person?.slug ? `/player/${person.slug}` : `/players/${person?.id}`
}
