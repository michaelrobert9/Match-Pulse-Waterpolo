// Sport skin — the single source of truth for sport-specific terminology.
// See DESIGN_SYSTEM.md §10. The Rugby repo carries this same file with rugby
// values; anything that differs between the two apps purely by *wording* should
// read from here rather than hardcoding a sport term.
//
// Currently consumed by lib/seoSettings.js (SEO defaults). Next migration
// target: lib/seo.js, which still hardcodes per-page sport copy and the
// schema.org sport value (SPORT.schemaSport) — move those to reference SPORT so
// seo.js can converge across the two repos too.

export const SPORT = {
  key:            'hockey',
  name:           'Hockey',
  nameLower:      'hockey',

  // Scoring vocabulary
  scoreUnit:      'goals',           // a match score is a goal total
  scoreUnitShort: 'goals',
  scoreEvents:    ['goal'],

  // schema.org sport value used by JSON-LD builders
  schemaSport:    'Field hockey',

  // Brand copy (consumed by SEO defaults)
  tagline:        'School & Club Hockey',
  description:    'Live scores, fixtures, results and player records for school and club hockey in South Africa.',
  keywords:       'hockey, school hockey, club hockey, live scores, fixtures, results, players, South Africa',
  longTagline:    'The easiest way to create, score and publish school and club hockey fixtures.',
}
