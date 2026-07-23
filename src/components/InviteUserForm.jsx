import { useEffect, useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { createInvite } from '../lib/invites'
import { ROLE_DISPLAY, invitableRoles } from '../lib/capabilities'

const ROLE_HINT = {
  master_admin: 'Full platform control — handle with extreme care.',
  owner:        'Owners manage teams, competitions, and invite scorers.',
  staff:        'Scorers can create and score fixtures only.',
}

export default function InviteUserForm({
  inviterRole, inviterTeamId = null, teamMgmtOn = false,
  orgId, orgName, teams, uid, onClose,
}) {
  // A team-scoped owner may only ever grant a Team Scorer (role 'staff') for
  // their own team — the invite ceiling, enforced again server-side.
  const isTeamScopedInviter = !!inviterTeamId
  const roles = isTeamScopedInviter ? ['staff'] : invitableRoles(inviterRole)
  const [email,          setEmail]          = useState('')
  const [role,           setRole]           = useState(roles[0] ?? '')
  const [selectedOrgId,  setSelectedOrgId]  = useState(orgId ?? '')
  const [teamId,         setTeamId]         = useState(inviterTeamId ?? '')
  const [allOrgs,        setAllOrgs]        = useState([])
  const [saving,         setSaving]         = useState(false)
  const [result,         setResult]         = useState(null)  // { immediate, displayName? }
  const [error,          setError]          = useState('')

  const needOrgPicker = inviterRole === 'master_admin' && !orgId && role !== 'master_admin'
  const resolvedOrgId = orgId ?? selectedOrgId

  // Team scope is offered only when the org has team-level management on, the
  // role is org-scoped (not master_admin), and there are teams to pick from.
  const canScopeToTeam = teamMgmtOn && role !== 'master_admin' && (teams?.length ?? 0) > 0
  // A team-scoped inviter's team is fixed.
  const lockedTeamId   = isTeamScopedInviter ? inviterTeamId : null

  useEffect(() => {
    if (!needOrgPicker) return
    getDocs(query(collection(db, 'organizations'), orderBy('name')))
      .then(snap => setAllOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [needOrgPicker])

  // Reset team when org changes (unless the inviter's team is locked).
  useEffect(() => { if (!lockedTeamId) setTeamId('') }, [resolvedOrgId, lockedTeamId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !role) return
    if (needOrgPicker && !selectedOrgId) { setError('Please select an organisation.'); return }
    const effectiveTeamId = lockedTeamId ?? (canScopeToTeam ? (teamId || null) : null)
    setSaving(true)
    setError('')
    try {
      const res = await createInvite({
        email: email.trim(),
        role,
        orgId:     role === 'master_admin' ? null : (resolvedOrgId || null),
        teamId:    effectiveTeamId,
        invitedBy: uid,
      })
      setResult(res)
    } catch (err) {
      setError(err.message ?? 'Could not create invite.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-emerald-600" />
          <h3 className="font-semibold text-slate-900 text-sm">Invite user</h3>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {result ? (
        <div className="space-y-3">
          {result.immediate ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold text-emerald-800 mb-0.5">Role granted</p>
              <p className="text-emerald-700 text-xs leading-relaxed">
                <span className="font-semibold">{result.displayName}</span> has been given the{' '}
                <span className="font-semibold">{ROLE_DISPLAY[role] ?? role}</span> role immediately.
              </p>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold text-blue-800 mb-0.5">Invite created</p>
              <p className="text-blue-700 text-xs leading-relaxed">
                When <span className="font-mono font-semibold">{email}</span> signs up at
                matchpulse.co.za with that email address, they will automatically receive
                the <span className="font-semibold">{ROLE_DISPLAY[role] ?? role}</span> role.
                Share the sign-up link with them directly.
              </p>
            </div>
          )}
          <button onClick={onClose}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl py-2.5 transition-colors">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Email address
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              placeholder="user@example.com"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Role to assign
            </label>
            <select value={role} onChange={e => { setRole(e.target.value); setTeamId('') }} required
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
              {roles.map(r => (
                <option key={r} value={r}>{ROLE_DISPLAY[r] ?? r}</option>
              ))}
            </select>
            {role && (
              <p className="text-[11px] text-slate-500 mt-1">{ROLE_HINT[role]}</p>
            )}
          </div>

          {needOrgPicker && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
                Organisation
              </label>
              <select value={selectedOrgId} onChange={e => setSelectedOrgId(e.target.value)} required
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
                <option value="">Select organisation…</option>
                {allOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}

          {!needOrgPicker && orgName && role !== 'master_admin' && (
            <p className="text-[11px] text-slate-500">
              Organisation: <span className="font-semibold text-slate-700">{orgName}</span>
            </p>
          )}

          {lockedTeamId ? (
            <p className="text-[11px] text-slate-500">
              Scope: <span className="font-semibold text-slate-700">
                {teams?.find(t => t.id === lockedTeamId)?.displayName ?? 'your team'}
              </span> — you can appoint a Team Scorer for your team only.
            </p>
          ) : canScopeToTeam && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
                Team scope <span className="normal-case tracking-normal font-normal text-slate-400">(optional)</span>
              </label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
                <option value="">Whole organisation</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Team scope grants {role === 'owner' ? 'a Team Owner (edit that team, appoint its scorers)' : 'a Team Scorer (score that team only)'}.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit"
            disabled={saving || !email.trim() || !role || (needOrgPicker && !selectedOrgId)}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-2.5 transition-colors">
            {saving ? 'Inviting…' : 'Send invite'}
          </button>
        </form>
      )}
    </div>
  )
}
