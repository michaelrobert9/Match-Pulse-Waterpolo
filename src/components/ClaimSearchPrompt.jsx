import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { auth } from '../firebase'
import { sendEmailVerification } from 'firebase/auth'
import {
  searchUnclaimedProfiles, claimTeamSheetProfile, userHoldsClaimedProfile,
} from '../lib/adminQueries'

// The claim search (ownerless-profiles addendum A4 step 2): on the FIRST
// authenticated session where the account holds no claimed profile, search
// unclaimed team-sheet profiles by name and surface the matches. It lives on
// the session, NOT the sign-up form — a Google/Apple/provider sign-in never
// passes through sign-up, and a claim search built there is silently skipped
// for those accounts. Skipping this step is how duplicates come back.
//
// The name field is editable so a parent can search their child's name.
// Dismissing (or claiming) marks the session check done for this account.

const doneKey = uid => `mp.claimSearch.done.${uid}`

export default function ClaimSearchPrompt() {
  const { user, uid } = useAuth()
  const [matches, setMatches] = useState(null) // null = not surfaced
  const [name,    setName]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [notice,  setNotice]  = useState('')

  useEffect(() => {
    if (!uid || !user) return
    if (localStorage.getItem(doneKey(uid))) return
    let cancelled = false
    ;(async () => {
      try {
        // Only accounts holding NO claimed profile get the prompt.
        if (await userHoldsClaimedProfile(uid)) {
          localStorage.setItem(doneKey(uid), '1')
          return
        }
        const displayName = user.displayName ?? ''
        if (!displayName.trim()) { localStorage.setItem(doneKey(uid), '1'); return }
        const found = await searchUnclaimedProfiles(displayName)
        if (cancelled) return
        if (found.length === 0) { localStorage.setItem(doneKey(uid), '1'); return }
        setName(displayName)
        setMatches(found)
      } catch { /* quietly skip — the profile page claim path still exists */ }
    })()
    return () => { cancelled = true }
  }, [uid, user])

  if (!matches) return null

  function dismiss() {
    localStorage.setItem(doneKey(uid), '1')
    setMatches(null)
  }

  async function research() {
    setBusy(true); setNotice('')
    try { setMatches(await searchUnclaimedProfiles(name)) }
    catch { /* keep current list */ }
    finally { setBusy(false) }
  }

  async function claim(personId, relationship) {
    setBusy(true); setNotice('')
    try {
      await claimTeamSheetProfile(personId, relationship)
      localStorage.setItem(doneKey(uid), '1')
      setNotice('Claimed — the profile is now yours to manage.')
      setTimeout(() => setMatches(null), 1200)
    } catch (err) {
      if (err.code === 'claim/email-unverified' && auth?.currentUser) {
        await sendEmailVerification(auth.currentUser).catch(() => {})
        setNotice('We\'ve emailed you a verification link. Once verified, claim from the player\'s profile page.')
      } else {
        setNotice(err.message || 'Could not claim this profile.')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-4 sm:p-6 pointer-events-none">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-emerald-200 shadow-xl overflow-hidden pointer-events-auto">
        <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-400" />
        <div className="p-4">
          <div className="flex items-start gap-3 mb-2">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-0.5">Are you on a team sheet?</div>
              <p className="text-[12px] text-slate-500 leading-relaxed">
                We found unclaimed player profiles matching your name. Claim yours — or search a
                child's name if you're a parent.
              </p>
            </div>
            <button onClick={dismiss} aria-label="Dismiss"
              className="text-slate-400 hover:text-slate-600 transition-colors p-1 -mr-1 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') research() }}
              aria-label="Search unclaimed profiles by name"
              className="flex-1 min-w-0 h-9 bg-white border border-slate-200 rounded-lg px-2.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-colors" />
            <button onClick={research} disabled={busy || !name.trim()}
              className="h-9 px-3 text-xs font-bold text-emerald-700 hover:text-emerald-600 disabled:opacity-50 transition-colors shrink-0">
              Search
            </button>
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {matches.map(p => (
              <div key={p.id} className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
                <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">{p.fullName ?? p.name}</span>
                <button disabled={busy} onClick={() => claim(p.id, 'player')}
                  className="text-[10px] font-bold uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg px-2.5 py-1.5 transition-colors shrink-0">
                  This is me
                </button>
                <button disabled={busy} onClick={() => claim(p.id, 'parent')}
                  className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 border border-emerald-300 hover:border-emerald-400 disabled:opacity-50 rounded-lg px-2.5 py-1.5 transition-colors shrink-0">
                  My child
                </button>
              </div>
            ))}
            {matches.length === 0 && (
              <p className="text-xs text-slate-400 py-1">No unclaimed profiles match that name.</p>
            )}
          </div>
          {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-2">{notice}</p>}
        </div>
      </div>
    </div>
  )
}
