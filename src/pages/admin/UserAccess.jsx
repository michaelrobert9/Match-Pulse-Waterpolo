import { useEffect, useState } from 'react'
import { Search, X, Plus, Trophy } from 'lucide-react'
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  fetchAllUsers, setOrgStaff, removeOrgStaff, fetchCompetitionsForOrg,
  fetchCompetitionStaff, setCompetitionStaff, removeCompetitionStaff,
} from '../../lib/adminQueries'
import { userDisplayName, userInitial, monogram } from '../../lib/names'

const ROLES = [
  { value: 'owner', label: 'Owner', desc: 'Full control — edit org, manage competitions, score matches' },
  { value: 'staff', label: 'Staff', desc: 'Score matches and manage fixtures' },
]

function OrgBadge({ org, size = 32 }) {
  const color = org?.primaryColor || '#555'
  return (
    <div className="rounded-lg shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, backgroundColor: color + '20', border: `2px solid ${color}` }}>
      <span className="font-mono font-bold leading-none"
        style={{ fontSize: Math.round(size * 0.28), color }}>
        {monogram(org?.name)}
      </span>
    </div>
  )
}

function UserAccessPanel({ user, orgsById, orgsArr, onUserChanged }) {
  const [mode, setMode] = useState(null) // null | 'grant' | 'grant-comp'
  const [orgSearch, setOrgSearch] = useState('')
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [role, setRole] = useState('staff')
  const [teamId, setTeamId] = useState('')
  const [teams, setTeams] = useState([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [comps, setComps] = useState([])
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(null) // orgId being removed
  const [error, setError] = useState('')

  // Competition access state
  const [allComps, setAllComps] = useState([])
  const [allCompsLoading, setAllCompsLoading] = useState(false)
  const [compSearch, setCompSearch] = useState('')
  const [selectedComp, setSelectedComp] = useState(null)
  const [compSaving, setCompSaving] = useState(false)
  const [compRemoving, setCompRemoving] = useState(null)
  const [compError, setCompError] = useState('')

  const orgRoles = user.orgRoles ?? {}
  const competitionRoles = user.competitionRoles ?? {}

  // Load competition names upfront when the panel mounts for a user who already
  // has competition access, so existing grants show names instead of raw IDs.
  useEffect(() => {
    if (Object.keys(competitionRoles).length > 0 && allComps.length === 0) {
      setAllCompsLoading(true)
      getDocs(query(collection(db, 'competitions'), orderBy('name')))
        .then(snap => setAllComps(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
        .catch(() => {})
        .finally(() => setAllCompsLoading(false))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function pickOrg(org) {
    setSelectedOrg(org)
    setOrgSearch(org.name)
    setTeamId('')
    setTeams([])
    setComps([])
    setTeamsLoading(true)
    try {
      const [teamSnap, compList] = await Promise.all([
        getDocs(query(collection(db, 'teams'), where('organizationId', '==', org.id))),
        fetchCompetitionsForOrg(org.id).catch(() => []),
      ])
      setTeams(
        teamSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
      )
      setComps(compList)
    } catch { /* ignore */ }
    finally { setTeamsLoading(false) }
  }

  function cancelGrant() {
    setMode(null)
    setOrgSearch('')
    setSelectedOrg(null)
    setRole('staff')
    setTeamId('')
    setTeams([])
    setComps([])
    setError('')
  }

  function openCompGrant() {
    setMode('grant-comp')
    setCompSearch('')
    setSelectedComp(null)
    setCompError('')
    if (allComps.length === 0) {
      setAllCompsLoading(true)
      getDocs(query(collection(db, 'competitions'), orderBy('name')))
        .then(snap => setAllComps(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
        .catch(() => {})
        .finally(() => setAllCompsLoading(false))
    }
  }

  function cancelCompGrant() {
    setMode(null)
    setCompSearch('')
    setSelectedComp(null)
    setCompError('')
  }

  async function handleGrantComp(e) {
    e.preventDefault()
    if (!selectedComp) { setCompError('Select a competition first.'); return }
    setCompError('')
    setCompSaving(true)
    try {
      await setCompetitionStaff(selectedComp.id, user.id, 'admin')
      onUserChanged({
        ...user,
        competitionRoles: { ...competitionRoles, [selectedComp.id]: { role: 'admin' } },
      })
      cancelCompGrant()
    } catch (err) {
      setCompError(err.message || 'Could not grant competition access.')
    } finally { setCompSaving(false) }
  }

  async function handleRevokeComp(compId) {
    const comp = allComps.find(c => c.id === compId)
    const compName = comp?.name ?? compId
    if (!confirm(`Remove competition access to "${compName}" for ${userDisplayName(user)}?`)) return
    setCompRemoving(compId)
    try {
      await removeCompetitionStaff(compId, user.id)
      const next = { ...competitionRoles }
      delete next[compId]
      onUserChanged({ ...user, competitionRoles: next })
    } catch { /* ignore */ }
    finally { setCompRemoving(null) }
  }

  async function handleGrant(e) {
    e.preventDefault()
    if (!selectedOrg) { setError('Select an organisation first.'); return }
    setError('')
    setSaving(true)
    try {
      await setOrgStaff(selectedOrg.id, user.id, role, { teamId: teamId || null })
      const grant = { role, teamId: teamId || null }
      onUserChanged({ ...user, orgRoles: { ...orgRoles, [selectedOrg.id]: grant } })
      cancelGrant()
    } catch (err) {
      setError(err.message || 'Could not grant access.')
    } finally { setSaving(false) }
  }

  async function handleRevoke(orgId) {
    const orgName = orgsById[orgId]?.name ?? orgId
    if (!confirm(`Remove access to "${orgName}" for ${userDisplayName(user)}?`)) return
    setRemoving(orgId)
    try {
      await removeOrgStaff(orgId, user.id)
      const next = { ...orgRoles }
      delete next[orgId]
      onUserChanged({ ...user, orgRoles: next })
    } catch { /* ignore */ }
    finally { setRemoving(null) }
  }

  const filteredOrgs = orgSearch.trim() && !selectedOrg
    ? orgsArr.filter(o => o.name.toLowerCase().includes(orgSearch.toLowerCase()))
    : orgsArr

  const filteredComps = compSearch.trim() && !selectedComp
    ? allComps.filter(c => (c.name ?? '').toLowerCase().includes(compSearch.toLowerCase()))
    : allComps

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-4">

      {/* Current memberships */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
          Current org access
        </div>
        {Object.keys(orgRoles).length === 0 ? (
          <p className="text-sm text-slate-400 italic">No org memberships — this user can't manage any team or competition.</p>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(orgRoles).map(([oId, grant]) => {
              const org = orgsById[oId]
              return (
                <div key={oId} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5 shadow-sm">
                  {org && <OrgBadge org={org} size={30} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{org?.name ?? oId}</div>
                    <div className="text-[11px] text-slate-500">
                      {grant.role}
                      {grant.teamId ? ' · team-scoped' : ' · full org'}
                      {org && <span className="text-slate-400"> · {org.type}</span>}
                    </div>
                  </div>
                  <button onClick={() => handleRevoke(oId)} disabled={removing === oId}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors p-1 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Grant access form */}
      {mode === 'grant' ? (
        <form onSubmit={handleGrant} className="bg-white rounded-xl border border-emerald-200 p-4 space-y-3.5">
          <div className="text-sm font-bold text-slate-900">Grant org access</div>

          {/* Org search */}
          <div>
            <label className="micro-label block mb-1.5">Organisation</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={orgSearch}
                onChange={e => { setOrgSearch(e.target.value); setSelectedOrg(null); setTeams([]); setComps([]) }}
                placeholder="Type to search…"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            {/* Org list — show when not yet selected */}
            {!selectedOrg && orgSearch.trim().length > 0 && (
              <div className="mt-1 border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 max-h-44 overflow-y-auto shadow-sm">
                {filteredOrgs.length === 0 ? (
                  <div className="px-3 py-2.5 text-sm text-slate-400">No results</div>
                ) : filteredOrgs.slice(0, 12).map(org => (
                  <button key={org.id} type="button" onClick={() => pickOrg(org)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                    <OrgBadge org={org} size={28} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{org.name}</div>
                      <div className="text-[10px] text-slate-400">{org.type}{org.region ? ` · ${org.region}` : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* Selected org confirmation + competitions info */}
            {selectedOrg && (
              <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
                <OrgBadge org={selectedOrg} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{selectedOrg.name}</div>
                  {comps.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <Trophy className="w-3 h-3 text-emerald-600 shrink-0" />
                      <span className="text-[11px] text-emerald-700">
                        {comps.map(c => c.name).join(', ')}
                      </span>
                    </div>
                  )}
                  {comps.length === 0 && !teamsLoading && (
                    <div className="text-[11px] text-slate-400">No competitions found for this org</div>
                  )}
                </div>
                <button type="button" onClick={() => { setSelectedOrg(null); setOrgSearch(''); setTeams([]); setComps([]) }}
                  className="text-slate-400 hover:text-slate-600 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Role */}
          <div>
            <label className="micro-label block mb-1.5">Role</label>
            <div className="space-y-1.5">
              {ROLES.map(r => (
                <label key={r.value}
                  className={`flex items-start gap-3 border rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                    role === r.value ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)}
                    className="mt-0.5 accent-emerald-600 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{r.label}</div>
                    <div className="text-[11px] text-slate-500">{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Team scope (only when org is selected and has teams) */}
          {selectedOrg && !teamsLoading && teams.length > 0 && (
            <div>
              <label className="micro-label block mb-1.5">
                Team scope
                <span className="text-slate-400 font-normal ml-1">— leave blank for full org access</span>
              </label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">All teams (full org access)</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}
              </select>
            </div>
          )}
          {selectedOrg && teamsLoading && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              Loading teams…
            </div>
          )}

          {error && <p className="text-red-600 text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving || !selectedOrg}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
              {saving ? 'Saving…' : 'Grant access'}
            </button>
            <button type="button" onClick={cancelGrant}
              className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setMode('grant')}
          className="flex items-center gap-1.5 text-emerald-600 hover:text-emerald-500 text-sm font-bold transition-colors">
          <Plus className="w-4 h-4" />
          Grant org access
        </button>
      )}

      {/* ── Competition access ─────────────────────────────────────────────── */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
          Direct competition access
        </div>
        {Object.keys(competitionRoles).length > 0 && (
          <div className="space-y-1.5 mb-3">
            {Object.entries(competitionRoles).map(([cId, grant]) => {
              const comp = allComps.find(c => c.id === cId)
              return (
                <div key={cId} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5 shadow-sm">
                  <Trophy className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{comp?.name ?? cId}</div>
                    <div className="text-[11px] text-slate-500">{grant.role}</div>
                  </div>
                  <button onClick={() => handleRevokeComp(cId)} disabled={compRemoving === cId}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors p-1 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {Object.keys(competitionRoles).length === 0 && mode !== 'grant-comp' && (
          <p className="text-sm text-slate-400 italic mb-2">No direct competition access.</p>
        )}
      </div>

      {mode === 'grant-comp' ? (
        <form onSubmit={handleGrantComp} className="bg-white rounded-xl border border-emerald-200 p-4 space-y-3.5">
          <div className="text-sm font-bold text-slate-900">Grant competition access</div>

          <div>
            <label className="micro-label block mb-1.5">Competition</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={compSearch}
                onChange={e => { setCompSearch(e.target.value); setSelectedComp(null) }}
                placeholder="Type to search competitions…"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            {allCompsLoading && (
              <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                Loading competitions…
              </div>
            )}
            {!selectedComp && compSearch.trim().length > 0 && !allCompsLoading && (
              <div className="mt-1 border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 max-h-44 overflow-y-auto shadow-sm">
                {filteredComps.length === 0 ? (
                  <div className="px-3 py-2.5 text-sm text-slate-400">No results</div>
                ) : filteredComps.slice(0, 12).map(comp => (
                  <button key={comp.id} type="button" onClick={() => { setSelectedComp(comp); setCompSearch(comp.name) }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                    <Trophy className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{comp.name}</div>
                      <div className="text-[10px] text-slate-400">{comp.season ?? ''}{comp.type ? ` · ${comp.type}` : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selectedComp && (
              <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                <Trophy className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{selectedComp.name}</div>
                  {selectedComp.season && <div className="text-[11px] text-slate-400">{selectedComp.season}</div>}
                </div>
                <button type="button" onClick={() => { setSelectedComp(null); setCompSearch('') }}
                  className="text-slate-400 hover:text-slate-600 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {compError && <p className="text-red-600 text-xs">{compError}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={compSaving || !selectedComp}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
              {compSaving ? 'Saving…' : 'Grant admin access'}
            </button>
            <button type="button" onClick={cancelCompGrant}
              className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </form>
      ) : mode !== 'grant' && (
        <button onClick={openCompGrant}
          className="flex items-center gap-1.5 text-emerald-600 hover:text-emerald-500 text-sm font-bold transition-colors">
          <Plus className="w-4 h-4" />
          Grant competition access
        </button>
      )}
    </div>
  )
}

export default function UserAccess() {
  const [users, setUsers] = useState([])
  const [orgsArr, setOrgsArr] = useState([])
  const [orgsById, setOrgsById] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    document.title = 'User Access · MatchPulse Admin'
    Promise.all([
      fetchAllUsers(),
      getDocs(query(collection(db, 'organizations'), orderBy('name')))
        .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    ])
      .then(([u, o]) => {
        setUsers(u)
        setOrgsArr(o)
        setOrgsById(Object.fromEntries(o.map(org => [org.id, org])))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const visible = search.trim()
    ? users.filter(u =>
        (u.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (u.displayName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (u.name ?? '').toLowerCase().includes(search.toLowerCase()))
    : users

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5 max-w-3xl">
      <h1 className="font-display font-bold text-slate-900 text-lg mb-1">User Access</h1>
      <p className="text-[12px] text-slate-500 mb-4 leading-relaxed">
        Link users to organisations so they can manage their team or competition.
        Competitions are administered through the organisation that owns them — grant access to the owning org.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors shadow-sm" />
      </div>

      <div className="space-y-2">
        {visible.map(u => {
          const open = openId === u.id
          const orgCount = Object.keys(u.orgRoles ?? {}).length
          return (
            <div key={u.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <button onClick={() => setOpenId(open ? null : u.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-black text-emerald-700">{userInitial(u)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-900 text-sm font-semibold truncate">{userDisplayName(u)}</div>
                  <div className="text-[11px] text-slate-400 truncate">{u.email}</div>
                </div>
                {u.platformAdmin && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                    Master Admin
                  </span>
                )}
                <span className={`text-[9px] font-bold uppercase tracking-widest rounded px-1.5 py-0.5 shrink-0 ${
                  orgCount > 0
                    ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
                    : 'text-slate-400 bg-slate-50 border border-slate-200'
                }`}>
                  {orgCount > 0 ? `${orgCount} org${orgCount !== 1 ? 's' : ''}` : 'No access'}
                </span>
              </button>
              {open && (
                <UserAccessPanel
                  user={u}
                  orgsById={orgsById}
                  orgsArr={orgsArr}
                  onUserChanged={updated =>
                    setUsers(prev => prev.map(x => x.id === updated.id ? updated : x))
                  }
                />
              )}
            </div>
          )
        })}
        {visible.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-8">No users found.</p>
        )}
      </div>
    </div>
  )
}
