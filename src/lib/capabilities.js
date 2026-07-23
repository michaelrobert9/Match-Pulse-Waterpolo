// Permission catalogue + role → capability mapping.
//
// Every role maps to a FIXED set of granular permissions (its "natural role").
// Appointing someone into a role grants exactly that set — appointers can
// never edit it. Only a Master Admin may override individual permissions per
// person, stored as users/{uid}.permissionOverrides: { [capability]: boolean }.
//
// Resolution order (resolveCapability): per-person override → natural role.
//
// Org roles (stored in organizations/{orgId}/staff/{uid} as `role`, optionally
// scoped to one team via `teamId`):
//   owner — full management authority over their team/org
//   staff — the "Scorer": create + score fixtures only
//
// Profile-level access (not org roles): player, parent, manager — control over
// player profiles, granted via fields on the people doc (ownerUid,
// guardianUids, managerUids), never via org membership.

// ── Permission catalogue ──────────────────────────────────────────────────────
// Atomic, individually-toggleable flags. A Master Admin can flip any one of
// these on/off for any person via permissionOverrides.

export const PERMISSION_CATALOG = [
  {
    group: 'Platform',
    permissions: [
      { key: 'platform.manage',   label: 'Manage whole platform' },
      { key: 'masteradmin.add',   label: 'Add other Master Admins' },
      { key: 'role.define',       label: 'Define roles & default permissions' },
      { key: 'permission.toggle', label: 'Toggle individual permissions per person' },
    ],
  },
  {
    group: 'Organisation',
    permissions: [
      { key: 'org.settings.edit',   label: 'Manage org settings / profile' },
      { key: 'team.add',            label: 'Add teams' },
      { key: 'team.remove',         label: 'Remove teams' },
      { key: 'team.profile.edit',   label: 'Edit team profile (image / name / bio)' },
      { key: 'org.teammgmt.toggle', label: 'Toggle team-level management' },
      { key: 'competition.manage',  label: 'Create / manage competitions' },
      { key: 'admin.appoint',       label: 'Appoint administrators' },
    ],
  },
  {
    group: 'Fixtures',
    permissions: [
      { key: 'fixture.create',     label: 'Create fixtures' },
      { key: 'fixture.score',      label: 'Score fixtures' },
      { key: 'fixture.player.add', label: 'Add players to fixtures' },
    ],
  },
  {
    group: 'Player',
    permissions: [
      { key: 'player.profile.manage',     label: 'Manage own player profile' },
      { key: 'player.fixture.selfremove', label: 'Remove self from a fixture' },
    ],
  },
  {
    group: 'Parent / Guardian',
    permissions: [
      { key: 'player.profile.create',   label: 'Create player profile for a child' },
      { key: 'player.profile.transfer', label: 'Transfer player profile to child' },
      { key: 'player.manager.grant',    label: 'Grant manager access over a player' },
    ],
  },
  {
    group: 'Delegated',
    permissions: [
      { key: 'player.manage.delegated', label: 'Manage assigned player profiles' },
    ],
  },
]

export const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => p.key))

// ── Natural roles: fixed default permission sets ──────────────────────────────

const ROLE_CAPABILITIES = {
  master_admin: ALL_PERMISSIONS,
  owner: [
    'org.settings.edit',
    'team.add',
    'team.remove',
    'team.profile.edit',
    'org.teammgmt.toggle',
    'competition.manage',
    'admin.appoint',
    'fixture.create',
    'fixture.score',
    'fixture.player.add',
  ],
  staff: [
    'fixture.create',
    'fixture.score',
    'fixture.player.add',
  ],
  player: [
    'player.profile.manage',
    'player.fixture.selfremove',
    'player.manager.grant',
  ],
  parent: [
    'player.profile.manage',
    'player.fixture.selfremove',
    'player.profile.create',
    'player.profile.transfer',
    'player.manager.grant',
  ],
  manager: [
    'player.manage.delegated',
    'player.profile.manage',
    'player.fixture.selfremove',
  ],
}

// Compatibility aliases kept for older callers: team.manage covers add+remove,
// org.manage covers settings, admin.manage covers appointment.
const CAPABILITY_ALIASES = {
  'team.manage':  ['team.add', 'team.remove'],
  'org.manage':   ['org.settings.edit'],
  'admin.manage': ['admin.appoint'],
}

export function can(role, capability) {
  const caps = ROLE_CAPABILITIES[role] ?? []
  const expanded = CAPABILITY_ALIASES[capability]
  if (expanded) return expanded.every(c => caps.includes(c))
  return caps.includes(capability)
}

// Resolve a capability for a person: per-person override (Master Admin set)
// wins outright; otherwise fall back to the natural role's fixed set.
export function resolveCapability(capability, { role = null, overrides = {} } = {}) {
  const expanded = CAPABILITY_ALIASES[capability]
  if (expanded) return expanded.every(c => resolveCapability(c, { role, overrides }))
  if (overrides[capability] === true)  return true
  if (overrides[capability] === false) return false
  return can(role, capability)
}

// ── Grant scope ───────────────────────────────────────────────────────────────
// A grant is one staff record: a role plus an optional team scope.
//   teamId == null → org-wide scope (Org Owner / Org Scorer — today's behaviour)
//   teamId != null → team scope    (Team Owner / Team Scorer — same role, one team)
//
// The users/{uid}.orgRoles mirror historically stored a bare role string per org.
// It now stores { role, teamId }. grantOf() normalises either shape so older
// cached values keep working until the next grant write refreshes them.

export function grantOf(value) {
  if (value == null) return null
  if (typeof value === 'string') return { role: value, teamId: null }
  if (typeof value === 'object') return { role: value.role ?? null, teamId: value.teamId ?? null }
  return null
}

// Capabilities a TEAM-scoped grant may exercise, by role. Anything not listed
// (org.settings.edit, team.add/remove, competition.manage, org.teammgmt.toggle)
// is org-wide only and can never be reached through a team grant. A Team Owner
// may appoint (admin.appoint) — but only Team Scorers for their own team, which
// the invite ceiling enforces separately.
const TEAM_SCOPE_CAPABILITIES = {
  owner: ['team.profile.edit', 'admin.appoint', 'fixture.create', 'fixture.score', 'fixture.player.add'],
  staff: ['fixture.create', 'fixture.score', 'fixture.player.add'],
}

// Scope-aware resolution. An org-wide grant authorises a capability exactly as
// resolveCapability does (and implicitly covers every team). A team grant only
// authorises a capability when:
//   - the org's teamLevelManagement toggle is ON (team grants are inert when off),
//   - the target team matches the grant's teamId, and
//   - the capability is in the team-scoped set for the grant's role.
// Per-person overrides (Master Admin) still win in both directions.
export function resolveScopedCapability(capability, {
  grant = null, overrides = {}, targetTeamId = null, teamMgmtOn = false,
} = {}) {
  if (overrides[capability] === true)  return true
  if (overrides[capability] === false) return false
  if (!grant) return false

  // Org-wide grant: full role authority, every team.
  if (grant.teamId == null) {
    return resolveCapability(capability, { role: grant.role, overrides })
  }

  // Team-scoped grant: inert unless the org enabled team-level management.
  if (!teamMgmtOn) return false
  if (targetTeamId == null || targetTeamId !== grant.teamId) return false
  return (TEAM_SCOPE_CAPABILITIES[grant.role] ?? []).includes(capability)
}

export const ROLE_DISPLAY = {
  master_admin: 'Master Admin',
  owner:        'Owner',
  staff:        'Scorer',
  player:       'Player',
  parent:       'Parent',
  manager:      'Manager',
}

// Human label for a grant, accounting for scope. Team-scoped grants read
// "Team Owner" / "Team Scorer"; org-wide grants keep their plain role label.
export function grantLabel(value) {
  const g = grantOf(value)
  if (!g) return ''
  const base = ROLE_DISPLAY[g.role] ?? g.role ?? ''
  return g.teamId ? `Team ${base}` : base
}

// Roles an inviter can grant — "own role or below" rule.
// Keep in sync with Firestore rules canCreateInvite().
export const INVITE_TIERS = {
  master_admin: ['master_admin', 'owner', 'staff'],
  owner:        ['owner', 'staff'],
  staff:        [],
}

export function invitableRoles(inviterRole) {
  return INVITE_TIERS[inviterRole] ?? []
}

export function roleLabel(role) {
  return ROLE_DISPLAY[role] ?? role ?? ''
}

// ── Player-profile control ────────────────────────────────────────────────────
// Who may manage a given player profile (people doc):
//   - the player themself  (people.ownerUid == uid)
//   - a parent/guardian    (uid in people.guardianUids)
//   - a delegated manager  (uid in people.managerUids)
// Control vs management: owners/guardians additionally transfer ownership and
// grant managers; managers only edit/maintain the profile.

export function controlsPlayerProfile(person, userId) {
  if (!person || !userId) return false
  return person.ownerUid === userId
    || (person.guardianUids ?? []).includes(userId)
}

export function managesPlayerProfile(person, userId) {
  if (!person || !userId) return false
  return controlsPlayerProfile(person, userId)
    || (person.managerUids ?? []).includes(userId)
}
