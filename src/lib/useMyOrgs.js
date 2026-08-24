import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchOrganization } from './queries'
import { grantOf } from './capabilities'

// Loads the organisations the signed-in user belongs to (from orgRoles), each
// enriched with its type/name so callers can group by school / club /
// association. Used by the management nav (which org categories to show) and by
// the per-type "My schools / clubs / associations" pages.
//
// orgRoles only stores { role, teamId } per orgId — the org's type lives on the
// org document, so we fetch each one. N is the number of orgs a single user
// belongs to (typically one or two), so this stays cheap.
export function useMyOrgs() {
  const { orgRoles } = useAuth()
  const [orgs, setOrgs]       = useState([])
  const [loading, setLoading] = useState(true)

  const ids = Object.keys(orgRoles ?? {})
  const key = ids.slice().sort().join(',')

  useEffect(() => {
    let live = true
    if (ids.length === 0) { setOrgs([]); setLoading(false); return }
    setLoading(true)
    Promise.all(ids.map(id =>
      fetchOrganization(id)
        .then(o => (o ? { ...o, id, role: grantOf(orgRoles[id])?.role ?? null } : null))
        .catch(() => null)
    )).then(list => {
      if (!live) return
      setOrgs(list.filter(Boolean))
      setLoading(false)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { orgs, loading }
}

// The set of org types the user belongs to, e.g. { school: true, club: true }.
export function orgTypesOf(orgs) {
  const set = { school: false, club: false, association: false }
  for (const o of orgs) {
    if (o.type === 'school') set.school = true
    else if (o.type === 'association') set.association = true
    else set.club = true
  }
  return set
}
