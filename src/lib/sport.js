// Sport skin — the single source of truth for sport-specific terminology.
// See DESIGN_SYSTEM.md §10. The Rugby, Hockey and Netball repos carry this same
// file with their own values; anything that differs between the apps purely by
// *wording* should read from here rather than hardcoding a sport term.
//
// Currently consumed by lib/seoSettings.js (SEO defaults). Next migration
// target: lib/seo.js, which still hardcodes per-page sport copy and the
// schema.org sport value (SPORT.schemaSport) — move those to reference SPORT so
// seo.js can converge across the repos too.

export const SPORT = {
  key:            'waterpolo',
  name:           'Water Polo',
  nameLower:      'water polo',

  // Scoring vocabulary — water polo is decided purely on goals, one goal a point.
  scoreUnit:      'goals',           // a match score is a goal total
  scoreUnitShort: 'goals',
  scoreEvents:    ['goal'],

  // schema.org sport value used by JSON-LD builders
  schemaSport:    'Water polo',

  // Brand copy (consumed by SEO defaults)
  tagline:        'School & Club Water Polo',
  description:    'Live scores, fixtures, results and player records for school and club water polo in South Africa.',
  keywords:       'water polo, school water polo, club water polo, live scores, fixtures, results, players, South Africa',
  longTagline:    'The easiest way to create, score and publish school and club water polo fixtures.',
}
