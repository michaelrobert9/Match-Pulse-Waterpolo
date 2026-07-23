// Legal content access layer. Content is built from src/legal/content/*.md by
// scripts/build-legal-content.mjs into content.generated.json — imported at build
// time (never loaded from Firestore), so it ships in the bundle and is fully
// crawlable (the bot renderer serves the same content from functions/legal-content.json).

import data from './content.generated.json'

export const legalDocs  = data.docs
export const legalOrder = data.order

export function getLegalDoc(slug) {
  return data.docs[slug] ?? null
}

// For the shared footer + related-links list, in document order.
export const LEGAL_LINKS = data.order.map(slug => ({
  slug,
  title: data.docs[slug].title,
  path: `/legal/${slug}`,
}))
