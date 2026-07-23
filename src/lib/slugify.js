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
// Long-term URL scheme (stable, share-safe, SEO-friendly):
//
//   Standalone fixture     /matches/:season/:fixtureSlug
//   Competition fixture    /competitions/:season/:competitionSlug/matches/:fixtureSlug
//   Competition edition    /competitions/:season/:competitionSlug
//
// Slugs are frozen at creation: a later team/competition rename updates page
// DISPLAY (via the live identity resolver) but never the URL, so shared links
// keep resolving. Firebase IDs stay internal — the legacy /matches/:id,
// /match/:slug and /competition/:series/:ageGroup/:season forms remain only as
// backwards-compatible fallbacks for links shared before this scheme.

// Canonical match URL. Competition-scoped when the match carries its competition
// slug + season; otherwise the standalone season-namespaced URL; then legacy.
export function matchUrl(match) {
  if (!match) return '/'
  if (match.competitionSlug && match.competitionSeason && match.matchSlug)
    return `/competitions/${match.competitionSeason}/${match.competitionSlug}/matches/${match.matchSlug}`
  if (match.season && match.matchSlug)
    return `/matches/${match.season}/${match.matchSlug}`
  if (match.matchSlug) return `/matches/${match.matchSlug}` // legacy unseasoned slug
  if (match.slug) return `/match/${match.slug}`
  return `/matches/${match.id}`
}

// Competition-scoped match URL from an explicit competition + match pairing.
// Falls back to matchUrl(match) when the competition slug/season are unknown.
export function competitionMatchUrl(comp, match) {
  const cSlug   = comp?.slug
  const cSeason = comp?.season ?? match?.season
  if (cSlug && cSeason && match?.matchSlug)
    return `/competitions/${cSeason}/${cSlug}/matches/${match.matchSlug}`
  return matchUrl(match)
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
