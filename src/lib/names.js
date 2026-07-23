// Resolve a human-readable name for a user / staff / person record.
// Preference order (per product spec): displayName → name → email → UID fallback.
// `fullName` is also honoured since the `people` collection uses it.
export function userDisplayName(record, fallback = 'Unknown user') {
  if (!record) return fallback
  const composed = [record.firstName, record.lastName].filter(Boolean).join(' ').trim()
  return (
    record.displayName ||
    composed ||
    record.name ||
    record.fullName ||
    record.email ||
    record.id ||
    record.uid ||
    fallback
  )
}

// First character for avatar initials, derived from the resolved name.
export function userInitial(record) {
  const name = userDisplayName(record, '')
  return name?.[0]?.toUpperCase() ?? '?'
}

// Avatar/monogram letters derived from a display NAME — never from a stored
// shortCode (display policy: the name is the identity; shortCode is ignored
// for display). Takes the first letter of up to `max` words: "Maritzburg
// College" → "MC", "Fatima" → "F".
export function monogram(name, max = 3) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words.slice(0, max).map(w => w[0].toUpperCase()).join('')
}
