// Match URL slug + path helpers.
//
// CANONICAL — authored by netball and copied VERBATIM into hockey, rugby and
// water polo, like teamAccent.js and pom.js. Self-contained: no imports. Keep
// byte-identical across the four repos.
//
// The URL SHAPE is a platform decision, so path assembly lives here — repos must
// import these builders, never re-assemble paths locally (that is how shapes
// drift). Two shapes:
//   standalone   /match/{YYYY-MM-DD}/{home}-vs-{away}            single match / group
//   standalone   /match/{YYYY-MM-DD}/{home}-vs-{away}/{child}    group child
//   competition  /competitions/{season}/{competition-slug}/match/{matchSlug}
//
// Home is ALWAYS first — ordering is by role, never by who was typed first.

// Lowercase, accents stripped, & → "and", everything else → single hyphens.
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Deterministic team-pair slug. Caller passes home then away (role order), so
// the canonical slug never depends on input order.
export function pairSlug(homeName, awayName) {
  return `${slugify(homeName)}-vs-${slugify(awayName)}`
}

// Age slug: lowercase, no spaces. "U16B" → "u16b", "1st Team" → "1st-team".
// A gender prefix is added by the caller ONLY when a group spans both genders
// (e.g. "girls-u14a"); leave it off for a single-gender group.
export function ageSlug(label) {
  return slugify(label)
}

// Display an age slug per the naming convention: capital U, no space (U14A),
// numbered sides Title Cased ("1st Team"), any gender prefix Title Cased.
export function ageLabel(slug) {
  return String(slug ?? '').split('-').map(part => {
    if (/^u\d{1,2}[a-z]?$/.test(part)) return 'U' + part.slice(1).toUpperCase()
    if (/^\d+(st|nd|rd|th)$/.test(part)) return part
    if (part === 'xi' || part === 'xv') return part.toUpperCase()
    return part ? part[0].toUpperCase() + part.slice(1) : part
  }).join(' ')
}

// Canonical STANDALONE match path. `date` is "YYYY-MM-DD"; `slug` is a pairSlug;
// `child` is a child's age slug for a group child, omitted otherwise.
export function matchPath(date, slug, child = null) {
  const base = `/match/${date}/${slug}`
  return child ? `${base}/${child}` : base
}

// Canonical COMPETITION match path. Dateless — the competition owns the timing;
// the match is addressed within its competition edition (season + slug).
export function competitionMatchPath(season, competitionSlug, matchSlug) {
  return `/competitions/${season}/${competitionSlug}/match/${matchSlug}`
}

// Collision suffix. Uniqueness is on the slug within its scope: standalone by
// (matchDate, slug), competition by competition — same base already taken →
// append -2, then -3. `existing` is the slugs already used in that scope.
export function dedupeSlug(base, existing = []) {
  const taken = existing instanceof Set ? existing : new Set(existing)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// True when `slug` is the reversed pairing of `canonical` (away-vs-home of a
// home-vs-away). Routing uses this to 301 a hand-typed reverse to the one home.
export function isReversedPair(slug, canonical) {
  const m = String(slug ?? '').match(/^(.*)-vs-(.*)$/)
  if (!m) return false
  return `${m[2]}-vs-${m[1]}` === canonical && slug !== canonical
}
