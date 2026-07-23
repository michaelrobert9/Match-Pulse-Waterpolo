import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronLeft, Camera } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { updateProfile } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useAuth } from '../contexts/AuthContext'
import { auth, db, storage } from '../firebase'
import { fetchOrganization } from '../lib/queries'
import { monogram } from '../lib/names'
import { grantOf, grantLabel } from '../lib/capabilities'

const PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
]

const ROLES = [
  { value: 'player',        label: 'Player' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'parent',        label: 'Parent' },
  { value: 'manager',       label: 'Manager' },
]

const POSITIONS = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defence',    label: 'Defence' },
  { value: 'midfield',   label: 'Midfield' },
  { value: 'forward',    label: 'Forward' },
]

// ── Org summary chip ──────────────────────────────────────────────────────────

function OrgChip({ orgId, grant }) {
  const [org, setOrg] = useState(null)

  useEffect(() => {
    fetchOrganization(orgId).then(setOrg).catch(() => {})
  }, [orgId])

  const g       = grantOf(grant)
  const isOwner = g?.role === 'owner'
  const color   = org?.primaryColor || '#555'

  if (!org) return (
    <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 animate-pulse shadow-sm">
      <div className="w-8 h-8 rounded-lg bg-slate-200 shrink-0" />
      <div className="flex-1 h-3 bg-slate-200 rounded" />
    </div>
  )

  return (
    <Link to={`/manage/orgs/${orgId}`}
      className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + '25', border: `2px solid ${color}` }}>
        {org.logoUrl
          ? <img src={org.logoUrl} alt="" className="w-full h-full rounded-lg object-cover" />
          : <span className="text-[9px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 text-sm font-semibold truncate">{org.name}</div>
        <span className={`text-[9px] font-bold uppercase tracking-widest ${isOwner ? 'text-emerald-600' : 'text-slate-500'}`}>
          {grantLabel(grant) || (isOwner ? 'Owner' : 'Staff')}
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </Link>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Profile() {
  const { user, isPlatformAdmin, orgRoles, canScore, logout } = useAuth()
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [bio,         setBio]         = useState('')
  const [photoURL,    setPhotoURL]    = useState(user?.photoURL ?? '')
  const [dob,         setDob]         = useState('')
  const [gender,      setGender]      = useState('')
  const [province,    setProvince]    = useState('')
  const [phone,       setPhone]       = useState('')
  const [role,        setRole]        = useState('')
  const [position,    setPosition]    = useState('')
  const [sahaNumber,  setSahaNumber]  = useState('')
  const [saving,      setSaving]      = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState('')

  const orgEntries = Object.entries(orgRoles ?? {})
  const hasOrgs    = orgEntries.length > 0

  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (!snap.exists()) return
      const data = snap.data()
      setBio(data.bio ?? '')
      if (data.photoURL)    setPhotoURL(data.photoURL)
      if (data.displayName) setDisplayName(data.displayName)
      setDob(data.dateOfBirth ?? '')
      setGender(data.gender ?? '')
      setProvince(data.province ?? '')
      setPhone(data.phone ?? '')
      setRole(data.role ?? '')
      setPosition(data.position ?? '')
      setSahaNumber(data.sahaNumber ?? '')
    }).catch(() => {})
  }, [user])

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !storage) return
    setUploading(true)
    setError('')
    try {
      const storageRef = ref(storage, `avatars/${user.uid}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateProfile(auth.currentUser, { photoURL: url })
      await updateDoc(doc(db, 'users', user.uid), { photoURL: url, updatedAt: serverTimestamp() })
      setDoc(doc(db, 'userProfiles', user.uid), { photoURL: url }, { merge: true }).catch(() => {})
      setPhotoURL(url)
    } catch (err) {
      setError('Photo upload failed: ' + (err.message ?? 'unknown error'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      if (displayName !== (user.displayName ?? '')) {
        await updateProfile(auth.currentUser, { displayName })
      }
      await updateDoc(doc(db, 'users', user.uid), {
        displayName,
        bio,
        dateOfBirth: dob,
        gender,
        province,
        phone,
        role,
        position: role === 'player' ? position : '',
        sahaNumber,
        updatedAt: serverTimestamp(),
      })
      setDoc(doc(db, 'userProfiles', user.uid), {
        displayName,
        email: (user.email ?? '').toLowerCase(),
        photoURL: photoURL || null,
      }, { merge: true }).catch(() => {})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  if (!user) return null

  const initials = (displayName || user.email)?.[0]?.toUpperCase() ?? '?'

  const roleLabel = isPlatformAdmin
    ? 'Platform Admin'
    : orgEntries.some(([, g]) => grantOf(g)?.role === 'owner' && grantOf(g)?.teamId == null)
      ? 'Organisation Owner'
      : hasOrgs
        ? 'Organisation Staff'
        : 'Member'

  const roleBadgeColor = isPlatformAdmin
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : hasOrgs
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-slate-100 border-slate-200 text-slate-600'

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors shrink-0"
          aria-label="Go back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-display font-bold text-slate-900">Profile</h1>
      </div>

      {/* Access summary */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${roleBadgeColor}`}>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5 opacity-70">Access level</div>
          <div className="text-sm font-bold">{roleLabel}</div>
        </div>
        <Link to="/manage" className="text-[10px] font-bold uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity">
          Manage →
        </Link>
      </div>

      {/* Avatar */}
      <div className="flex flex-col items-center gap-2">
        <button type="button" onClick={() => storage && fileRef.current?.click()}
          className={`relative ${storage ? 'group' : ''}`}>
          {photoURL ? (
            <img src={photoURL} alt="Avatar"
              className="w-20 h-20 rounded-full object-cover border-2 border-slate-200 group-hover:border-emerald-500 transition-colors" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-emerald-100 border-2 border-emerald-300 flex items-center justify-center group-hover:border-emerald-500 transition-colors">
              <span className="text-2xl font-black text-emerald-600">{initials}</span>
            </div>
          )}
          {storage && (
            <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shadow-lg">
              <Camera className="w-3.5 h-3.5 text-white" />
            </div>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
        {uploading && <span className="text-xs text-slate-500">Uploading…</span>}
        {storage && !uploading && <span className="text-[10px] text-slate-400">Tap to change photo</span>}
      </div>

      {/* Edit form */}
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Display name</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name"
            className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Email</label>
          <input value={user.email ?? ''} readOnly
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-400 text-sm cursor-default focus:outline-none" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Bio</label>
          <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
            placeholder="Tell us about yourself…"
            className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors resize-none" />
        </div>
      </div>

      {/* Hockey profile */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-100" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Hockey profile</span>
          <div className="flex-1 h-px bg-slate-100" />
        </div>

        {/* Role */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">Your role</label>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(r => (
              <button key={r.value} type="button"
                onClick={() => { setRole(r.value); if (r.value !== 'player') setPosition('') }}
                className={`px-2 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                  role === r.value
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Position — player only */}
        {role === 'player' && (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">Position</label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map(p => (
                <button key={p.value} type="button" onClick={() => setPosition(p.value)}
                  className={`px-2 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                    position === p.value
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SAHA number */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
            SAHA number
            <span className="ml-1.5 text-slate-400 normal-case tracking-normal font-normal">· visible on public profile</span>
          </label>
          <input value={sahaNumber} onChange={e => setSahaNumber(e.target.value)}
            placeholder="e.g. WP-2024-00123"
            className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-900 text-sm font-mono placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
          <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
            South African Hockey Association (SAHA) registration number.
          </p>
        </div>
      </div>

      {/* Personal details */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-100" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Personal details</span>
          <div className="flex-1 h-px bg-slate-100" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Date of birth</label>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Gender</label>
            <select value={gender} onChange={e => setGender(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
              <option value="">Select…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="prefer_not">Prefer not to say</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Province</label>
            <select value={province} onChange={e => setProvince(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
              <option value="">Select…</option>
              {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="+27 82 000 0000" autoComplete="tel"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <button onClick={handleSave} disabled={saving}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-lg px-4 py-3 transition-colors">
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
      </button>

      {/* Schools & clubs */}
      {hasOrgs && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">My schools & clubs</h2>
            <Link to="/manage" className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
              Manage →
            </Link>
          </div>
          <div className="space-y-2">
            {orgEntries.map(([orgId, grant]) => (
              <OrgChip key={orgId} orgId={orgId} grant={grant} />
            ))}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Quick actions</h2>
        <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200 bg-white shadow-sm">
          {isPlatformAdmin && (
            <Link to="/admin"
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
              <span className="text-sm text-amber-600 font-medium">Admin dashboard</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>
          )}
          {canScore && (
            <Link to="/score"
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
              <span className="text-sm text-slate-700">Score matches</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>
          )}
          <Link to="/my-players"
            className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
            <span className="text-sm text-slate-700">My players</span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </Link>
          <Link to="/manage"
            className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
            <span className="text-sm text-slate-700">
              {hasOrgs ? 'Manage schools & clubs' : 'Create school or club'}
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </Link>
          {!hasOrgs && (
            <Link to="/manage/new-org"
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
              <span className="text-sm text-emerald-600 font-medium">Create school or club</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>
          )}
        </div>
      </section>

      <button onClick={handleLogout}
        className="w-full border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-900 font-bold text-sm uppercase tracking-wider rounded-lg px-4 py-3 transition-colors bg-white shadow-sm">
        Sign out
      </button>
    </div>
  )
}
