import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { claimPendingInvites } from '../lib/invites'
import { updateProfile } from 'firebase/auth'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Camera, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { auth, db, storage, configured } from '../firebase'

const PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
]

const ROLES = [
  { value: 'player',  label: 'Player' },
  { value: 'coach',   label: 'Coach' },
  { value: 'umpire',  label: 'Umpire' },
  { value: 'manager', label: 'Manager' },
  { value: 'parent',  label: 'Parent' },
  { value: 'other',   label: 'Other' },
]

const POSITIONS = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defence',    label: 'Defence' },
  { value: 'midfield',   label: 'Midfield' },
  { value: 'forward',    label: 'Forward' },
]

const inputClass =
  'w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors'

const labelClass =
  'text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5'

function Label({ children, optional }) {
  return (
    <label className={labelClass}>
      {children}
      {optional && <span className="ml-1.5 text-slate-400 normal-case tracking-normal font-normal text-[10px]">optional</span>}
    </label>
  )
}

export default function Signup() {
  const { signUp } = useAuth()
  const navigate   = useNavigate()
  const fileRef    = useRef(null)

  const [step, setStep] = useState(1)

  // Step 1
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  // Step 2
  const [bio,        setBio]        = useState('')
  const [dob,        setDob]        = useState('')
  const [gender,     setGender]     = useState('')
  const [province,   setProvince]   = useState('')
  const [phone,      setPhone]      = useState('')
  const [role,       setRole]       = useState('')
  const [position,   setPosition]   = useState('')
  const [sahaNumber, setSahaNumber] = useState('')
  const [photoURL,   setPhotoURL]   = useState('')

  const [createdUid, setCreatedUid] = useState(null)
  const [error,      setError]      = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [uploading,  setUploading]  = useState(false)

  // ── Step 1 ────────────────────────────────────────────────────────────────

  async function handleStep1(e) {
    e.preventDefault()
    if (!configured) { setError('Firebase is not configured yet.'); return }
    if (password !== confirmPw) { setError('Passwords do not match.'); return }
    setLoading(true)
    setError(null)
    try {
      const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
      const cred = await signUp(email, password, displayName)
      setCreatedUid(cred.user.uid)
      setStep(2)
    } catch (err) {
      const msg = {
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/weak-password':        'Password must be at least 6 characters.',
        'auth/invalid-email':        'Please enter a valid email address.',
      }
      setError(msg[err.code] ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Photo upload ──────────────────────────────────────────────────────────

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !storage || !createdUid) return
    setUploading(true)
    try {
      const storageRef = ref(storage, `avatars/${createdUid}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateProfile(auth.currentUser, { photoURL: url })
      setPhotoURL(url)
    } catch {
      // silently ignore — photo can be added from profile settings later
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────

  async function saveProfile() {
    if (!createdUid) return
    const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    await setDoc(doc(db, 'users', createdUid), {
      email:          email.toLowerCase(),
      displayName,
      firstName:      firstName.trim(),
      lastName:       lastName.trim(),
      bio:            bio.trim(),
      photoURL,
      dateOfBirth:    dob,
      gender,
      province,
      phone:          phone.trim(),
      role,
      position:       role === 'player' ? position : '',
      sahaNumber:     sahaNumber.trim(),
      profileComplete: true,
      platformAdmin:  false,
      orgRoles:       {},
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    }, { merge: true })
    setDoc(doc(db, 'userProfiles', createdUid), {
      email:       email.toLowerCase(),
      displayName,
      photoURL:    photoURL || null,
    }, { merge: true }).catch(() => {})
  }

  async function handleStep2(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await saveProfile()
      // Claim any pending invites for this email (best-effort, never blocks signup)
      await claimPendingInvites(email, createdUid).catch(() => {})
      navigate('/portal')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSkip() {
    try { await saveProfile() } catch { /* best-effort */ }
    navigate('/portal')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const initials = (firstName[0] ?? '') + (lastName[0] ?? '') || '?'

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="font-display font-black text-3xl text-slate-900">
            Match<span className="text-emerald-600">Pulse</span>
          </Link>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">
            {step === 1 ? 'Create your account' : 'Complete your profile'}
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8">
          {[
            { n: 1, label: 'Account' },
            { n: 2, label: 'Profile' },
          ].map(({ n, label }, i) => (
            <div key={n} className="flex items-center flex-1">
              {i > 0 && <div className={`flex-1 h-px mx-2 ${step > i ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
              <div className="flex items-center gap-1.5 shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                  step === n ? 'bg-emerald-600 text-white'
                  : step > n  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-400'
                }`}>{n}</div>
                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  step === n ? 'text-slate-900' : 'text-slate-400'
                }`}>{label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <form onSubmit={handleStep1} className="space-y-4">

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name</Label>
                <input type="text" required value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder="Jane" autoComplete="given-name"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
              <div>
                <Label>Last name</Label>
                <input type="text" required value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder="Smith" autoComplete="family-name"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
            </div>

            <div>
              <Label>Email</Label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email" className={inputClass} />
            </div>

            <div>
              <Label>Password</Label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Minimum 6 characters" autoComplete="new-password" className={inputClass} />
            </div>

            <div>
              <Label>Confirm password</Label>
              <input type="password" required value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repeat password" autoComplete="new-password" className={inputClass} />
            </div>

            {error && <ErrorBox>{error}</ErrorBox>}

            <button type="submit" disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-lg px-4 py-3 transition-colors flex items-center justify-center gap-2">
              {loading ? 'Creating account…' : <><span>Continue</span><ChevronRight className="w-4 h-4" /></>}
            </button>

            <p className="text-center text-[11px] text-slate-400">
              Already have an account?{' '}
              <Link to="/login" className="text-emerald-600 hover:text-emerald-500 font-semibold transition-colors">Sign in</Link>
            </p>
          </form>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <form onSubmit={handleStep2} className="space-y-5">

            {/* Photo */}
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={() => storage && fileRef.current?.click()}
                className={`relative ${storage ? 'group cursor-pointer' : 'cursor-default'}`}
                aria-label="Upload profile photo">
                {photoURL
                  ? <img src={photoURL} alt="Profile photo"
                      className="w-20 h-20 rounded-full object-cover border-2 border-slate-200 group-hover:border-emerald-500 transition-colors" />
                  : <div className={`w-20 h-20 rounded-full flex items-center justify-center border-2 font-black text-2xl transition-colors ${
                      storage
                        ? 'bg-emerald-100 border-emerald-300 text-emerald-600 group-hover:border-emerald-500'
                        : 'bg-slate-100 border-slate-200 text-slate-400'
                    }`}>
                      {initials.toUpperCase()}
                    </div>
                }
                <div className={`absolute bottom-0 right-0 w-6 h-6 rounded-full flex items-center justify-center shadow-md ${
                  storage ? 'bg-emerald-600' : 'bg-slate-300'
                }`}>
                  <Camera className="w-3.5 h-3.5 text-white" />
                </div>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              <span className="text-[10px] text-slate-400">
                {uploading ? 'Uploading…' : storage ? 'Tap to add a photo' : 'Photo upload — coming soon'}
              </span>
            </div>

            {/* Bio */}
            <div>
              <Label optional>About you</Label>
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2}
                placeholder="Coach at Stellenbosch Girls, ex-SA U21…"
                className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors resize-none" />
            </div>

            {/* DOB + Gender */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label optional>Date of birth</Label>
                <input type="date" value={dob} onChange={e => setDob(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
              <div>
                <Label optional>Gender</Label>
                <select value={gender} onChange={e => setGender(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="prefer_not">Prefer not to say</option>
                </select>
              </div>
            </div>

            {/* Province + Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label optional>Province</Label>
                <select value={province} onChange={e => setProvince(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm focus:outline-none focus:border-emerald-500 transition-colors">
                  <option value="">Select…</option>
                  {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <Label optional>Phone</Label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+27 82 000 0000" autoComplete="tel"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-3 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
            </div>

            {/* Role in hockey */}
            <div>
              <Label optional>Your role in hockey</Label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map(r => (
                  <button key={r.value} type="button"
                    onClick={() => { setRole(r.value); if (r.value !== 'player') setPosition('') }}
                    className={`px-2 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                      role === r.value
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                    }`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Position — only if player */}
            {role === 'player' && (
              <div>
                <Label optional>Position</Label>
                <div className="grid grid-cols-4 gap-2">
                  {POSITIONS.map(p => (
                    <button key={p.value} type="button" onClick={() => setPosition(p.value)}
                      className={`px-2 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        position === p.value
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* SAHA number */}
            <div>
              <Label optional>SAHA number</Label>
              <input type="text" value={sahaNumber} onChange={e => setSahaNumber(e.target.value)}
                placeholder="e.g. WP-2024-00123"
                className={`${inputClass} font-mono`} />
              <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                Your South African Hockey Association (SAHA) registration number. Once entered, it will be visible on your public profile.
              </p>
            </div>

            {error && <ErrorBox>{error}</ErrorBox>}

            <div className="flex flex-col gap-2 pt-1">
              <button type="submit" disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-lg px-4 py-3 transition-colors">
                {loading ? 'Saving…' : 'Save profile'}
              </button>
              <button type="button" onClick={handleSkip} disabled={loading}
                className="w-full text-slate-400 hover:text-slate-700 text-sm font-medium py-2 transition-colors">
                Skip for now
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link to="/" className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors">
            ← Back to MatchPulse
          </Link>
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ children }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
      {children}
    </div>
  )
}
