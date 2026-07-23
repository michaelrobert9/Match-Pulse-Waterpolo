import { useEffect, useState } from 'react'
import { Search, ShieldCheck, UserPlus, Trophy } from 'lucide-react'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { db } from '../../firebase'
import { fetchAllUsers, setMasterAdmin, setUserPermissionOverride } from '../../lib/adminQueries'
import { PERMISSION_CATALOG, grantLabel, grantOf, resolveCapability } from '../../lib/capabilities'
import { userDisplayName, userInitial } from '../../lib/names'
import { useAuth } from '../../contexts/AuthContext'
import InviteUserForm from '../../components/InviteUserForm'

// Derive the user's primary role category for grouping and default-resolution.
function primaryRoleCategory(user) {
  if (user.platformAdmin) return 'master_admin'
  const grants = Object.values(user.orgRoles ?? {}).map(grantOf)
  if (grants.some(g => g?.role === 'owner' && g?.teamId == null)) return 'org_owner'
  if (grants.some(g => g?.role === 'owner')) return 'team_owner'
  if (grants.some(g => g?.role === 'staff' && g?.teamId == null)) return 'org_scorer'
  if (grants.some(g => g?.role === 'staff')) return 'team_scorer'
  if (Object.keys(user.competitionRoles ?? {}).length > 0) return 'competition_admin'
  return 'member'
}

// Map role category to ROLE_CAPABILITIES key for default-resolution in TriToggle.
function capabilityRole(category) {
  if (category === 'master_admin') return 'master_admin'
  if (category === 'org_owner' || category === 'team_owner') return 'owner'
  if (category === 'org_scorer' || category === 'team_scorer' || category === 'competition_admin') return 'staff'
  return null
}

// Only roles that carry some administrative access appear in the Administrators
// panel. Plain members (no org/competition/master grant) are intentionally
// omitted — they belong in User Access, not here.
const ROLE_GROUPS = [
  { key: 'master_admin',     label: 'Master Admins'            },
  { key: 'org_owner',        label: 'Organisation Owners'      },
  { key: 'team_owner',       label: 'Team Owners'              },
  { key: 'competition_admin',label: 'Competition Administrators'},
  { key: 'org_scorer',       label: 'Scorers / Administrators' },
  { key: 'team_scorer',      label: 'Team Scorers'             },
]

// "Auto · On" / "Auto · Off" shows the permission's natural state from the
// person's role so there's no ambiguity about what "default" actually means.

function TriToggle({ value, onChange, disabled, defaultResolved = null }) {
  const autoLabel  = defaultResolved === true  ? 'Auto · On'
                   : defaultResolved === false ? 'Auto · Off'
                   : 'Auto'
  const autoActive = defaultResolved === true
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-slate-200 text-slate-600'

  const opts = [
    { v: undefined, label: autoLabel, active: autoActive },
    { v: true,      label: 'On',      active: 'bg-emerald-600 text-white' },
    { v: false,     label: 'Off',     active: 'bg-red-500 text-white' },
  ]
  return (
    <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
      {opts.map((o, i) => (
        <button key={i} disabled={disabled}
          onClick={() => onChange(o.v ?? null)}
          className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 ${
            value === o.v ? o.active : 'bg-white text-slate-400 hover:text-slate-600'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function UserPermissionsPanel({ user, selfUid, onUserChanged, orgMap }) {
  const [busyKey,   setBusyKey]   = useState(null)
  const [compNames, setCompNames] = useState({}) // { compId: name }
  const overrides   = user.permissionOverrides ?? {}
  const isSelf      = user.id === selfUid

  const category    = primaryRoleCategory(user)
  const naturalRole = capabilityRole(category)

  // Lazy-load competition names when the panel opens.
  useEffect(() => {
    const ids = Object.keys(user.competitionRoles ?? {})
    if (ids.length === 0) return
    Promise.all(ids.map(id =>
      getDoc(doc(db, 'competitions', id))
        .then(s => [id, s.exists() ? (s.data().name ?? id.slice(0, 10)) : id.slice(0, 10)])
        .catch(() => [id, id.slice(0, 10)])
    )).then(entries => setCompNames(Object.fromEntries(entries)))
  }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMasterToggle() {
    const next = !(user.platformAdmin === true)
    if (!next && !confirm(`Remove Master Admin status from ${userDisplayName(user)}?`)) return
    setBusyKey('master')
    try {
      await setMasterAdmin(user.id, next)
      onUserChanged({ ...user, platformAdmin: next })
    } finally { setBusyKey(null) }
  }

  async function handleOverride(capability, value) {
    setBusyKey(capability)
    try {
      await setUserPermissionOverride(user.id, capability, value)
      const next = { ...overrides }
      if (value === null) delete next[capability]
      else next[capability] = value
      onUserChanged({ ...user, permissionOverrides: next })
    } finally { setBusyKey(null) }
  }

  const orgEntries  = Object.entries(user.orgRoles ?? {})
  const compEntries = Object.entries(user.competitionRoles ?? {})

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-4">

      {/* Master Admin assignment */}
      <div className="flex items-center gap-3 bg-white rounded-xl border border-amber-200 px-4 py-3">
        <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-900">Master Admin</div>
          <div className="text-[11px] text-slate-500">
            Full platform control, including adding other Master Admins and editing per-person permissions.
          </div>
        </div>
        <button onClick={handleMasterToggle}
          disabled={busyKey === 'master' || isSelf}
          title={isSelf ? 'You cannot change your own Master Admin status' : undefined}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 shrink-0 ${
            user.platformAdmin
              ? 'bg-amber-500 text-white hover:bg-amber-400'
              : 'bg-white border border-slate-300 text-slate-600 hover:border-slate-400'
          }`}>
          {user.platformAdmin ? 'Master Admin ✓' : 'Make Master Admin'}
        </button>
      </div>

      {/* Org memberships with resolved org names */}
      {orgEntries.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {orgEntries.map(([orgId, grant]) => {
            const orgName = orgMap?.[orgId]?.name
            return (
              <div key={orgId} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-800">
                    {orgName ?? <span className="font-mono text-slate-400">{orgId.slice(0, 10)}…</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                    {grantLabel(grant)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Competition access */}
      {compEntries.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Trophy className="w-3.5 h-3.5 text-slate-400" />
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Competition access
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {compEntries.map(([compId, grant]) => (
              <div key={compId} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-slate-800">
                    {compNames[compId]
                      ? compNames[compId]
                      : <span className="text-slate-300 animate-pulse">Loading…</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                    {grant?.role ?? 'admin'}
                    <span className="ml-2 normal-case not-italic text-slate-300">
                      · can create &amp; score fixtures
                    </span>
                  </div>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 shrink-0">
                  Competition Admin
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-permission overrides */}
      {PERMISSION_CATALOG.map(group => (
        <div key={group.group}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
            {group.group}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {group.permissions.map(p => {
              const defaultResolved = resolveCapability(p.key, { role: naturalRole, overrides: {} })
              return (
                <div key={p.key} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-slate-800">{p.label}</div>
                    <div className="font-mono text-[10px] text-slate-400">{p.key}</div>
                  </div>
                  <TriToggle
                    value={overrides[p.key]}
                    disabled={busyKey === p.key}
                    onChange={v => handleOverride(p.key, v)}
                    defaultResolved={defaultResolved}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Administrators() {
  const { uid: selfUid } = useAuth()
  const [users,      setUsers]      = useState([])
  const [orgMap,     setOrgMap]     = useState({}) // { orgId: { name, ... } }
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [openId,     setOpenId]     = useState(null)
  const [showInvite, setShowInvite] = useState(false)

  useEffect(() => {
    document.title = 'Administrators · MatchPulse Admin'
    Promise.all([
      fetchAllUsers(),
      getDocs(collection(db, 'organizations'))
        .then(s => Object.fromEntries(s.docs.map(d => [d.id, d.data()]))),
    ])
      .then(([u, om]) => { setUsers(u); setOrgMap(om) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const visible = search.trim()
    ? users.filter(u =>
        (u.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (u.displayName ?? '').toLowerCase().includes(search.toLowerCase()))
    : users

  // Plain members are hidden by default (they belong in User Access), but a
  // search reveals them so an admin can still find and promote someone.
  const groupsToShow = search.trim()
    ? [...ROLE_GROUPS, { key: 'member', label: 'Members' }]
    : ROLE_GROUPS
  const grouped = groupsToShow
    .map(g => ({ ...g, users: visible.filter(u => primaryRoleCategory(u) === g.key) }))
    .filter(g => g.users.length > 0)

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-slate-900 text-lg">Administrators</h1>
        <button onClick={() => setShowInvite(v => !v)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
          <UserPlus className="w-3.5 h-3.5" />
          {showInvite ? 'Cancel' : 'Invite user'}
        </button>
      </div>
      <p className="text-[12px] text-slate-500 mb-4 leading-relaxed">
        Assign Master Admin status and toggle individual permissions per person.
        "Auto · On" / "Auto · Off" shows what the person's role gives by default;
        "On" / "Off" force the permission regardless of role.
      </p>

      {showInvite && (
        <div className="mb-4">
          <InviteUserForm
            inviterRole="master_admin"
            uid={selfUid}
            onClose={() => setShowInvite(false)}
          />
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors shadow-sm" />
      </div>

      {grouped.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-8">No users found.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.key}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {group.label}
                </span>
                <span className="text-[10px] text-slate-300">· {group.users.length}</span>
              </div>
              <div className="space-y-2">
                {group.users.map(u => {
                  const overrideCount = Object.keys(u.permissionOverrides ?? {}).length
                  const open = openId === u.id

                  // Context subtitle shown under email in the row
                  const orgLines = Object.entries(u.orgRoles ?? {})
                    .map(([orgId, grant]) => {
                      const name = orgMap[orgId]?.name
                      return name ? `${grantLabel(grant)} · ${name}` : null
                    })
                    .filter(Boolean)

                  const compCount = Object.keys(u.competitionRoles ?? {}).length

                  return (
                    <div key={u.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <button onClick={() => setOpenId(open ? null : u.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-black text-emerald-700">
                            {userInitial(u)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-900 text-sm font-semibold truncate">
                            {userDisplayName(u)}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{u.email}</div>
                          {/* Org names for owners */}
                          {orgLines.length > 0 && (
                            <div className="text-[10px] text-emerald-600 truncate mt-0.5">
                              {orgLines.join(' · ')}
                            </div>
                          )}
                          {/* Competition count for competition admins */}
                          {group.key === 'competition_admin' && compCount > 0 && (
                            <div className="text-[10px] text-blue-500 truncate mt-0.5">
                              {compCount} competition{compCount !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                        {u.platformAdmin && (
                          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                            Master Admin
                          </span>
                        )}
                        {overrideCount > 0 && (
                          <span className="text-[9px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 shrink-0">
                            {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </button>
                      {open && (
                        <UserPermissionsPanel user={u} selfUid={selfUid} orgMap={orgMap}
                          onUserChanged={updated =>
                            setUsers(prev => prev.map(x => x.id === updated.id ? updated : x))
                          }
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
