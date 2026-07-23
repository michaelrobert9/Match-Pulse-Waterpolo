import { useEffect, useState } from 'react'
import { resolveTeamSide, resolveTeamSideSync } from '../lib/teamIdentity'

// Resolve one match side into a display identity { primary, identifier, slug, color }.
//
// Seeds synchronously from the cache (or match fallback) to avoid a loading
// flicker, then resolves authoritatively from Firestore and updates if the live
// data differs. On list pages that called prefetchMatchTeams first, the initial
// sync value is already the live identity.
export function useTeamIdentity(match, side) {
  const [identity, setIdentity] = useState(() =>
    match ? resolveTeamSideSync(match, side) : null)

  const teamId = match?.[`${side}TeamId`]

  useEffect(() => {
    let alive = true
    if (!match) { setIdentity(null); return }
    setIdentity(resolveTeamSideSync(match, side))
    resolveTeamSide(match, side).then(id => { if (alive) setIdentity(id) })
    return () => { alive = false }
  }, [match?.id, teamId, side])

  return identity
}
