// School / club identity governance helpers.
//
// The hardest duplicate surface is the school/club name, where users enter
// variations ("Ashton", "Ashton International", "Ashton International College").
// These helpers normalise names and score similarity so the creation flow can
// SUGGEST possible existing profiles before a new one is created. They never
// decide on their own — the user (or a platform admin) always chooses.

import { slugify } from './slugify'

// Words that carry no distinguishing signal for a school/club and only add
// noise to similarity comparisons.
const ORG_STOPWORDS = new Set([
  'the', 'of', 'and', 'a', 'an',
  'school', 'college', 'high', 'primary', 'junior', 'senior', 'preparatory', 'prep',
  'hockey', 'club', 'hc', 'sports', 'sport', 'academy', 'institution', 'institute',
])

// Reduce a name to its significant lowercase tokens: strip accents, punctuation
// and stopwords. "Ashton International College" → "ashton international".
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !ORG_STOPWORDS.has(w))
    .join(' ')
    .trim()
}

export function nameTokens(name) {
  return new Set(normalizeName(name).split(' ').filter(Boolean))
}

// Jaccard similarity over significant tokens, 0..1.
export function nameSimilarity(a, b) {
  const A = nameTokens(a)
  const B = nameTokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let intersection = 0
  for (const t of A) if (B.has(t)) intersection++
  return intersection / (A.size + B.size - intersection)
}

// Heuristic "is this probably the same organisation" test, combining exact slug
// equality, normalised-name equality and high token overlap. Tunable threshold.
export function isLikelyDuplicate(a, b, threshold = 0.6) {
  if (!a || !b) return false
  const sa = slugify(a)
  const sb = slugify(b)
  if (sa && sa === sb) return true
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na && na === nb) return true
  return nameSimilarity(a, b) >= threshold
}
