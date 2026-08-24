// Support Centre content access layer. The content is built statically from
// markdown by scripts/build-support-content.mjs into content.generated.json —
// it is imported at build time (never loaded from Firestore at runtime), so it
// ships in the bundle and is fully crawlable.

import data from './content.generated.json'

export const indexMeta = data.index
export const sections  = data.sections

export function getSection(slug) {
  return sections.find(s => s.slug === slug) ?? null
}

export function getArticle(category, slug) {
  return data.articles[`${category}/${slug}`] ?? null
}

// Sibling articles in the same section (for the section nav), in order.
export function siblings(sectionSlug) {
  return getSection(sectionSlug)?.articles ?? []
}

export const ORIGIN = 'https://matchpulse.co.za'
export const supportArticleUrl = (category, slug) => `/support/${category}/${slug}`
