import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, X, Send, UserPlus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  createChildPlayerProfile, fetchMyPlayerProfiles, updatePerson,
  transferPlayerProfile, grantPlayerManager, revokePlayerManager,
} from '../lib/adminQueries'
import { playerUrl } from '../lib/slugify'
import { controlsPlayerProfile } from '../lib/capabilities'
import { PLAYER_CONSENT_TEXT } from '../lib/consent'

const POSITIONS = ['GK', 'Def', 'Mid', 'Fwd']

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input(props) {
  return (
    <input
      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
      {...props}
    />
  )
}

// ── Create child profile (parent flow) ──────────────────────────────────────

function CreateChildForm({ onCreated, onCancel }) {
  const [form,   setForm]   = useState({ fullName: '', dateOfBirth: '', position: 'Mid', nationality: 'South African' })
  const [relationship, setRelationship] = useState('guardian') // 'guardian' | 'manager'
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.fullName.trim() || !consent) return
    setSaving(true); setError('')
    try {
      const ref = await createChildPlayerProfile({ ...form, fullName: form.fullName.trim() }, relationship, { consented: consent })
      onCreated({ id: ref.id, ...form, roles: ['player'],
        ...(relationship === 'manager' ? { managerUids: ['me'] } : { guardianUids: ['me'] }) })
    } catch (err) {
      setError(err.message ?? 'Could not create the profile.')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-sm">
      <div className="text-sm font-bold text-slate-900">New player profile</div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Create a profile for a player you look after. You control it until it's
        transferred to the player (when they have their own MatchPulse account).
        Please check the player isn't already on MatchPulse first — if they are,
        open their profile and claim it instead of making a duplicate.
      </p>
      <Field label="Your relationship">
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: 'guardian', label: 'Parent / guardian' },
            { v: 'manager',  label: 'Manager' },
          ].map(o => (
            <button key={o.v} type="button" onClick={() => setRelationship(o.v)}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                relationship === o.v
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Full name">
        <Input value={form.fullName} required placeholder="Child's full name"
          onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth">
          <Input type="date" value={form.dateOfBirth}
            onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
        </Field>
        <Field label="Position">
          <select value={form.position}
            onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      {/* Required consent */}
      <label className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
          className="mt-0.5 accent-emerald-600 w-4 h-4 shrink-0" />
        <span className="text-[11px] text-slate-600 leading-relaxed">{PLAYER_CONSENT_TEXT}</span>
      </label>
      <p className="text-[11px] text-slate-400">
        See our <Link to="/legal/terms" className="text-emerald-600 hover:text-emerald-500">Terms</Link> and{' '}
        <Link to="/legal/privacy" className="text-emerald-600 hover:text-emerald-500">Privacy Policy</Link>.
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !form.fullName.trim() || !consent}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
          {saving ? 'Creating…' : 'Create profile'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 border border-slate-200 text-slate-500 hover:text-slate-900 text-sm font-medium rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Player profile card with management actions ─────────────────────────────

function PlayerProfileCard({ person, userId, onUpdated, onRemoved }) {
  const [expanded,      setExpanded]      = useState(false)
  const [transferEmail, setTransferEmail] = useState('')
  const [managerEmail,  setManagerEmail]  = useState('')
  const [busy,          setBusy]          = useState(false)
  const [error,         setError]         = useState('')
  const [notice,        setNotice]        = useState('')

  // Owners/guardians control (transfer + manager grants); managers only edit.
  const controls = controlsPlayerProfile(person, userId)
  const relationship = person.ownerUid === userId
    ? 'Your profile'
    : (person.guardianUids ?? []).includes(userId)
      ? 'Guardian'
      : 'Manager'

  const initials = (person.fullName || '')
    .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  async function run(fn, successMsg) {
    setBusy(true); setError(''); setNotice('')
    try {
      await fn()
      if (successMsg) setNotice(successMsg)
    } catch (err) {
      setError(err.message ?? 'Action failed.')
    } finally { setBusy(false) }
  }

  function handleTransfer() {
    if (!transferEmail.trim()) return
    if (!confirm(`Transfer this profile to ${transferEmail}? Your control will end.`)) return
    run(async () => {
      await transferPlayerProfile(person.id, transferEmail.trim())
      onRemoved(person.id)
    })
  }

  function handleGrantManager() {
    if (!managerEmail.trim()) return
    run(async () => {
      await grantPlayerManager(person.id, managerEmail.trim())
      setManagerEmail('')
    }, 'Manager access granted.')
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
          {person.photoUrl
            ? <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
            : <span className="text-xs font-bold font-mono text-slate-500">{initials || '?'}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <Link to={playerUrl(person)} className="text-slate-900 text-sm font-semibold truncate hover:underline block">
            {person.fullName}
          </Link>
          <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600">{relationship}</span>
        </div>
        <button onClick={() => setExpanded(v => !v)}
          className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors px-2 py-1 shrink-0">
          {expanded ? 'Close' : 'Manage'}
        </button>
        <Link to={playerUrl(person)} className="text-slate-400 shrink-0">
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 px-4 py-4 space-y-4 bg-slate-50">
          {notice && <p className="text-emerald-600 text-sm">{notice}</p>}
          {error  && <p className="text-red-600 text-sm">{error}</p>}

          {controls && (
            <>
              {/* Transfer to the player */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <Send className="w-3 h-3" /> Transfer to player
                </div>
                <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                  Hand control to the player. They take over their own profile and
                  your access ends (they can re-add you as a manager later).
                </p>
                <div className="flex gap-2">
                  <Input type="email" value={transferEmail} placeholder="Player's account email"
                    onChange={e => setTransferEmail(e.target.value)} />
                  <button onClick={handleTransfer} disabled={busy || !transferEmail.trim()}
                    className="px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg shrink-0 transition-colors">
                    Transfer
                  </button>
                </div>
              </div>

              {/* Grant manager / coach access */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <UserPlus className="w-3 h-3" /> Managers & coaches
                </div>
                <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                  Grant a coach or manager access to maintain this profile on your behalf.
                </p>
                {(person.managerUids ?? []).length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {(person.managerUids ?? []).map(m => (
                      <li key={m} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                        <span className="text-xs text-slate-600 font-mono flex-1 truncate">{m}</span>
                        <button onClick={() => run(async () => {
                          await revokePlayerManager(person.id, m)
                          onUpdated({ ...person, managerUids: (person.managerUids ?? []).filter(x => x !== m) })
                        })}
                          className="text-slate-400 hover:text-red-500 transition-colors" title="Revoke">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Input type="email" value={managerEmail} placeholder="Manager's account email"
                    onChange={e => setManagerEmail(e.target.value)} />
                  <button onClick={handleGrantManager} disabled={busy || !managerEmail.trim()}
                    className="px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg shrink-0 transition-colors">
                    Grant
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Quick edits — available to managers as well */}
          <QuickEdit person={person} onUpdated={onUpdated} />
        </div>
      )}
    </div>
  )
}

function QuickEdit({ person, onUpdated }) {
  const [form,   setForm]   = useState({
    position:   person.position   ?? 'Mid',
    sahaNumber: person.sahaNumber ?? '',
    photoUrl:   person.photoUrl   ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await updatePerson(person.id, form)
      onUpdated({ ...person, ...form })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Profile details</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <select value={form.position}
          onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <Input value={form.sahaNumber} placeholder="SAHA number"
          onChange={e => setForm(f => ({ ...f, sahaNumber: e.target.value }))} />
      </div>
      <Input type="url" value={form.photoUrl} placeholder="Photo URL (optional)"
        onChange={e => setForm(f => ({ ...f, photoUrl: e.target.value }))} />
      <button onClick={handleSave} disabled={saving}
        className="mt-2 w-full bg-white border border-slate-300 hover:border-slate-400 disabled:opacity-50 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-lg py-2 transition-colors">
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save details'}
      </button>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function MyPlayers() {
  const { user, uid } = useAuth()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)

  function load() {
    setLoading(true)
    fetchMyPlayerProfiles()
      .then(setProfiles)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    document.title = 'My Players · MatchPulse'
    if (user) load()
  }, [user])

  if (!user) return null

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors shrink-0"
          aria-label="Go back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-display font-bold text-slate-900 flex-1">My Players</h1>
        <button onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {showAdd ? 'Cancel' : 'Add child'}
        </button>
      </div>

      <p className="text-[12px] text-slate-500 leading-relaxed">
        Player profiles you control — your own, your children's, or players you
        manage as a coach. Parents can create profiles for their children and
        transfer them when the time is right.
      </p>

      {showAdd && (
        <CreateChildForm
          onCreated={() => { setShowAdd(false); load() }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : profiles.length === 0 && !showAdd ? (
        <div className="text-center py-12">
          <p className="text-slate-500 text-sm mb-2">No player profiles yet.</p>
          <button onClick={() => setShowAdd(true)}
            className="text-emerald-600 text-sm hover:underline">
            Create a profile for your child →
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => (
            <PlayerProfileCard key={p.id} person={p} userId={uid}
              onUpdated={updated => setProfiles(prev => prev.map(x => x.id === updated.id ? updated : x))}
              onRemoved={id => setProfiles(prev => prev.filter(x => x.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
