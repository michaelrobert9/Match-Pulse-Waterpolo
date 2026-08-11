// Seniority sort for match-group children. Most senior first.
//
// CANONICAL — authored by netball and copied VERBATIM into hockey, rugby and
// water polo, like teamAccent.js and pom.js. Self-contained: no imports, no
// repo-specific anything. Keep byte-identical across the four repos.
//
// This module NEVER parses a display name or a slug. It orders STRUCTURED
// descriptors built by teamNaming.seniorityDescriptor() from a team's discrete
// fields (gender/division, ageGroup, teamLevel). A descriptor is:
//
//   { group, number, age, letter, gender }
//     group 0 = senior side  — `number` is the ordinal (1st=1 … 10th=10)
//     group 1 = age side      — `age` is the years (U19=19…), `letter` is A=1…J=10
//     group 2 = unrecognised  — sorts last, then alphabetically by gender axis
//
// Order, most senior first:
//   1. Senior sides by ordinal ascending: 1st, 2nd, 3rd …
//   2. Age bands descending: U19, U18, U17 …
//   3. Within a band, letter ascending: A, B, C …
//   4. Gender is a final tiebreak only — it never reorders across seniority.

// Comparator: negative if `a` is more senior than `b`. Both are descriptors.
// Feed straight to sort().
export function compareSeniority(a, b) {
  const pa = a ?? {}
  const pb = b ?? {}
  const ga = pa.group ?? 2
  const gb = pb.group ?? 2
  if (ga !== gb) return ga - gb
  if (ga === 0) {
    if ((pa.number ?? 0) !== (pb.number ?? 0)) return (pa.number ?? 0) - (pb.number ?? 0)  // 1st before 2nd
  } else if (ga === 1) {
    if ((pa.age ?? 0) !== (pb.age ?? 0)) return (pb.age ?? 0) - (pa.age ?? 0)               // U19 before U14
    if ((pa.letter ?? 0) !== (pb.letter ?? 0)) return (pa.letter ?? 0) - (pb.letter ?? 0)   // A before B
  }
  const na = pa.gender ?? ''
  const nb = pb.gender ?? ''
  if (na !== nb) return na < nb ? -1 : 1                                                    // tiebreak only
  return 0
}

// Sort a list of items, most senior first. `keyFn` extracts each item's
// seniority DESCRIPTOR (defaults to the item itself already being one).
export function sortBySeniority(items, keyFn = x => x) {
  return [...items].sort((a, b) => compareSeniority(keyFn(a), keyFn(b)))
}
