import { venueUrl } from '../lib/mainSite'

// Render a match's venue consistently everywhere it appears.
//   • linked venue (venueId + venueSlug present) → the name links to the venue
//     page on the main site (built from the slug snapshot — no cross-database
//     read needed to render it).
//   • typed venue (no id)                        → plain text.
//   • no venue at all                            → nothing (no empty label).
//
// `as` picks the wrapping element for the plain-text/empty case ('div' by
// default, 'span' for inline rows). The link always renders as an <a>.
export default function VenueLabel({ pitch, venueId, venueSlug, className = '', as = 'div' }) {
  if (!pitch) return null
  const url = venueId && venueSlug ? venueUrl(venueSlug) : null
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener"
        className={`${className} hover:underline`}>
        {pitch}
      </a>
    )
  }
  const Tag = as
  return <Tag className={className}>{pitch}</Tag>
}
