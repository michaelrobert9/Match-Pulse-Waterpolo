import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, X, ChevronLeft, Search } from 'lucide-react'
import { collection, getDocs, doc, getDoc, orderBy, query } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  createOrganization, updateOrganization, deleteOrganization,
  findUserByEmail, setOrgStaff, removeOrgStaff, fetchOrgStaff,
} from '../../lib/adminQueries'
import { slugify } from '../../lib/slugify'
import { userDisplayName, userInitial } from '../../lib/names'
import { SCHOOL_GENDER_PROFILES } from '../../lib/teamNaming'
import { useAuth } from '../../contexts/AuthContext'
import { monogram } from '../../lib/names'

const ORG_TYPES = ['school', 'club', 'association']

const ORG_TYPE_LABELS = { school: 'School', club: 'Club', association: 'Association' }

const ORG_BASE_PATHS = { school: 'schools', club: 'clubs', association: 'associations' }

function Field({ label, children }) {
  return (
    <div>
      <label className="micro-label block mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ ...props }) {
  return (
    <input
      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
      {...props}
    />
  )
}

// ── Form ───────────────────────────────────────────────────────────────────

function OrgForm({ initial = {}, onSave, onDelete, saving }) {
  const isNew = !initial.id
  const [form, setForm] = useState({
    name: '', shortCode: '', primaryColor: '#006B3C', secondaryColor: '#FFFFFF',
    type: 'school', region: '', logoUrl: '', website: '', genderProfile: 'coed', ...initial,
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const previewSlug = isNew ? (slugify(form.name) || 'your-org-name') : (initial.slug || slugify(initial.name))
  const previewBase = ORG_BASE_PATHS[form.type] ?? 'schools'

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-4 px-4 py-5">
      <Field label="Full name">
        <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Western Province" required />
      </Field>

      {/* Slug preview — live when creating, frozen when editing */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
        <div className="micro-label text-slate-500 mb-1">Public URL</div>
        <div className="text-sm text-slate-600 font-mono break-all">
          matchpulse.co.za/<span className="text-slate-400">{previewBase}/</span>
          <span className={isNew ? 'text-emerald-600' : 'text-slate-500'}>{previewSlug}</span>
        </div>
        {!isNew && <div className="micro-label text-slate-400 mt-1">URL is frozen and will not change if you rename this organisation.</div>}
      </div>

      <Field label="Type">
        <select
          value={form.type}
          onChange={e => set('type', e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500"
        >
          {ORG_TYPES.map(t => <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>

      <Field label="Region">
        <Input value={form.region} onChange={e => set('region', e.target.value)} placeholder="Western Cape" />
      </Field>

      {form.type === 'school' && (
        <Field label="School gender profile">
          <select
            value={form.genderProfile}
            onChange={e => set('genderProfile', e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500"
          >
            {SCHOOL_GENDER_PROFILES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Primary colour">
          <div className="flex items-center gap-2">
            <input type="color" value={form.primaryColor} onChange={e => set('primaryColor', e.target.value)}
              className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 p-0" />
            <Input value={form.primaryColor} onChange={e => set('primaryColor', e.target.value)} placeholder="#006B3C" />
          </div>
        </Field>
        <Field label="Secondary colour">
          <div className="flex items-center gap-2">
            <input type="color" value={form.secondaryColor} onChange={e => set('secondaryColor', e.target.value)}
              className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 p-0" />
            <Input value={form.secondaryColor} onChange={e => set('secondaryColor', e.target.value)} placeholder="#FFFFFF" />
          </div>
        </Field>
      </div>

      <Field label="Logo URL (optional)">
        <Input value={form.logoUrl} onChange={e => set('logoUrl', e.target.value)} placeholder="https://…" type="url" />
      </Field>
      <Field label="Website (optional)">
        <Input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" type="url" />
      </Field>

      {/* Preview */}
      <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3 border border-slate-200">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: form.primaryColor + '30', border: `2px solid ${form.primaryColor}` }}>
          <span className="text-[10px] font-bold font-mono" style={{ color: form.primaryColor }}>
            {monogram(form.name)}
          </span>
        </div>
        <div>
          <div className="text-slate-900 text-sm font-semibold">{form.name || 'Organisation name'}</div>
          <div className="micro-label">{ORG_TYPE_LABELS[form.type] ?? form.type} · {form.region}</div>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-3 transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={saving}
            className="px-4 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-bold text-sm rounded-lg transition-colors">
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

// ── List ───────────────────────────────────────────────────────────────────

export function OrganizationsList() {
  const [orgs,         setOrgs]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [tab,          setTab]          = useState('school')
  const [search,       setSearch]       = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'organizations'), orderBy('name')))
      .then(snap => setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const tabs = [
    { key: 'school',      label: 'Schools'      },
    { key: 'club',        label: 'Clubs'        },
    { key: 'association', label: 'Associations' },
  ]

  const tabOrgs = orgs.filter(o => o.type === tab)

  const visible = search.trim()
    ? tabOrgs.filter(o =>
        (o.name   ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (o.region ?? '').toLowerCase().includes(search.toLowerCase()))
    : tabOrgs

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="px-4 py-5 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-slate-900 text-lg">Organizations</h1>
        <Link to="/admin/organizations/new"
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
          + New
        </Link>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-xl p-1">
        {tabs.map(t => {
          const count = orgs.filter(o => o.type === t.key).length
          return (
            <button key={t.key}
              onClick={() => { setTab(t.key); setSearch('') }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                tab === t.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
              {count > 0 && (
                <span className={`text-[9px] rounded-full px-1.5 py-0.5 font-bold tabular-nums ${
                  tab === t.key ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${tabs.find(t => t.key === tab)?.label.toLowerCase() ?? 'organisations'}…`}
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors shadow-sm"
        />
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500 text-sm mb-4">
            {search.trim()
              ? `No results for "${search}".`
              : `No ${tabs.find(t => t.key === tab)?.label.toLowerCase() ?? 'organisations'} yet.`}
          </p>
          {!search.trim() && (
            <Link to="/admin/organizations/new" className="text-emerald-600 text-sm hover:underline">
              Add the first one →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(org => (
            <div key={org.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: (org.primaryColor || '#555') + '20', border: `2px solid ${org.primaryColor || '#555'}` }}>
                <span className="text-[9px] font-bold font-mono" style={{ color: org.primaryColor || '#555' }}>
                  {monogram(org.name)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 text-sm font-semibold truncate">{org.name}</div>
                <div className="micro-label">{org.region}</div>
              </div>
              <Link to={`/manage/orgs/${org.id}`}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors shrink-0 px-2 py-1">
                Manage
              </Link>
              <button onClick={() => setDeleteTarget(org)} title="Delete organisation"
                className="text-slate-400 hover:text-red-500 transition-colors p-1 shrink-0">
                <X className="w-4 h-4" />
              </button>
              <Link to={`/admin/organizations/${org.id}`}
                className="text-slate-400 hover:text-slate-700 transition-colors shrink-0">
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteOrgModal
          org={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirmed={() => {
            setOrgs(prev => prev.filter(o => o.id !== deleteTarget.id))
            setDeleteTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ── Create ─────────────────────────────────────────────────────────────────

export function NewOrganization() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  async function handleSave(form) {
    setSaving(true)
    try {
      await createOrganization(form)
      navigate('/admin/organizations')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 border-b border-slate-200">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-900">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-slate-900 text-lg">New organization</h1>
      </div>
      <OrgForm onSave={handleSave} saving={saving} />
    </div>
  )
}

// ── Staff management ─────────────────────────────────────────────────────────

function StaffManager({ orgId }) {
  const [staff, setStaff]     = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail]     = useState('')
  const [role, setRole]       = useState('staff')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  function reload() {
    fetchOrgStaff(orgId)
      .then(setStaff)
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(reload, [orgId])

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const user = await findUserByEmail(email)
      if (!user) { setError('No MatchPulse user found with that email. They must sign in once first.'); return }
      await setOrgStaff(orgId, user.id, role)
      setEmail('')
      reload()
    } catch {
      setError('Could not add staff member.')
    } finally { setBusy(false) }
  }

  async function handleRemove(uid) {
    if (!confirm('Remove this staff member from the organisation?')) return
    await removeOrgStaff(orgId, uid)
    reload()
  }

  return (
    <div className="px-4 py-5 border-t border-slate-200">
      <h2 className="font-display font-bold text-slate-900 text-base mb-1">Staff &amp; scoring access</h2>
      <p className="text-slate-500 text-xs mb-4">
        Owners and staff can create, manage and score this organisation's fixtures.
      </p>

      <form onSubmit={handleAdd} className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
        <Field label="User email">
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="coach@school.co.za" required />
        </Field>
        <Field label="Role">
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </Field>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <button type="submit" disabled={busy || !email}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
          {busy ? 'Adding…' : 'Add staff member'}
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
      ) : staff.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-4">No staff added yet.</p>
      ) : (
        <div className="space-y-2">
          {staff.map(s => (
            <div key={s.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
              <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-emerald-700">{userInitial(s)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 text-sm font-semibold truncate">{userDisplayName(s)}</div>
                <div className="micro-label">{s.email && s.email !== userDisplayName(s) ? `${s.email} · ` : ''}{s.role}</div>
              </div>
              <button onClick={() => handleRemove(s.id)}
                className="text-slate-400 hover:text-red-500 transition-colors p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Delete confirmation (type-to-confirm) ────────────────────────────────────

export function DeleteOrgModal({ org, onCancel, onConfirmed }) {
  const [text, setText]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const entity = ORG_TYPE_LABELS[org.type]?.toLowerCase() ?? 'organisation'
  const canDelete = text === 'DELETE' && !busy

  async function handleConfirm() {
    if (!canDelete) return
    setBusy(true)
    setError('')
    try {
      await deleteOrganization(org.id)
      onConfirmed()
    } catch {
      setError('Could not delete. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-display font-bold text-slate-900 text-lg mb-1">Delete {entity}?</h2>
        <p className="text-sm text-slate-600 mb-4">
          You are about to permanently delete <span className="font-bold text-slate-900">{org.name}</span>.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-[13px] text-red-700 leading-relaxed">
            This cannot be undone. Deletion may affect this {entity}'s teams, fixtures and historical records.
          </p>
        </div>

        <label className="micro-label block mb-1.5 text-slate-500">
          Type <span className="font-mono text-red-600">DELETE</span> to confirm
        </label>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="DELETE"
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-red-400 transition-colors mb-4"
        />
        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-lg py-3 transition-colors">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!canDelete}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg py-3 transition-colors">
            {busy ? 'Deleting…' : `Delete ${entity}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit ───────────────────────────────────────────────────────────────────

export function EditOrganization() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isPlatformAdmin } = useAuth()
  const [org, setOrg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'organizations', id)).then(snap => {
      if (snap.exists()) setOrg({ id: snap.id, ...snap.data() })
    })
  }, [id])

  async function handleSave(form) {
    setSaving(true)
    try { await updateOrganization(id, form); navigate('/admin/organizations') }
    finally { setSaving(false) }
  }

  if (!org) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div>
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 border-b border-slate-200">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-900">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-slate-900 text-lg truncate">{org.name}</h1>
      </div>
      <OrgForm
        initial={org}
        onSave={handleSave}
        onDelete={isPlatformAdmin ? () => setConfirmDelete(true) : undefined}
        saving={saving}
      />
      <StaffManager orgId={id} />

      {confirmDelete && (
        <DeleteOrgModal
          org={org}
          onCancel={() => setConfirmDelete(false)}
          onConfirmed={() => navigate('/admin/organizations')}
        />
      )}
    </div>
  )
}
