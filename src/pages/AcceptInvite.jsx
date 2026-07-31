import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, X, Trophy, LogIn, AlertTriangle, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchCompetition, fetchCompetitionInvite, fetchCompetitionMember,
} from '../lib/queries'
import { acceptCompetitionInvite, declineCompetitionInvite } from '../lib/adminQueries'

function Spinner() {
  return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-emerald-500 animate-spin" /></div>
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-md mx-auto px-4 py-10">{children}</div>
    </div>
  )
}

export default function AcceptInvite() {
  const { competitionId, token } = useParams()
  const { user, isOrgMember, loading: authLoading } = useAuth()

  const [loading, setLoading] = useState(true)
  const [competition, setCompetition] = useState(null)
  const [invite, setInvite] = useState(null)   // null when missing OR not readable (rules)
  const [member, setMember] = useState(null)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [done, setDone] = useState(null)   // 'accepted' | 'declined'

  // Reload when the signed-in user changes — the invite doc is only readable to
  // the competition admin or the invited team's org member, so a fresh sign-in
  // can unlock details that were hidden while signed out.
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetchCompetition(competitionId).catch(() => null),
      fetchCompetitionInvite(competitionId, token).catch(() => null),
    ]).then(async ([comp, inv]) => {
      if (!alive) return
      setCompetition(comp)
      setInvite(inv)
      if (inv?.teamId) {
        const mem = await fetchCompetitionMember(competitionId, inv.teamId).catch(() => null)
        if (alive) setMember(mem)
      } else {
        setMember(null)
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [competitionId, token, user?.uid])

  async function respond(kind) {
    setBusy(true); setActionError('')
    try {
      if (kind === 'accept') await acceptCompetitionInvite(competitionId, invite.teamId, token)
      else                   await declineCompetitionInvite(competitionId, invite.teamId, token)
      setDone(kind === 'accept' ? 'accepted' : 'declined')
    } catch (err) {
      const map = {
        'invite/not-pending':  'This invitation is no longer open.',
        'invite/expired':      'This invitation has expired.',
        'invite/not-found':    'This invitation could not be found.',
        'team/not-authorised': 'You must be an owner or staff member of this team’s school or club to respond.',
      }
      setActionError(map[err.code] ?? err.message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || authLoading) return <Shell><Spinner /></Shell>

  // The competition is publicly readable; if even that is missing the link is bad.
  if (!competition) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-10 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <h1 className="font-display font-bold text-slate-900 text-lg mb-1">Invitation not found</h1>
          <p className="text-slate-500 text-sm mb-6">The link may be invalid or the competition was removed.</p>
          <Link to="/" className="text-emerald-600 text-sm font-bold hover:underline">Go home</Link>
        </div>
      </Shell>
    )
  }

  const teamName = member?.displaySnapshot?.teamName ?? 'your team'
  const orgName  = member?.displaySnapshot?.orgName
  const color    = member?.displaySnapshot?.primaryColor ?? '#10b981'

  function Header() {
    return (
      <>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">
          <Trophy className="w-3.5 h-3.5" /> Competition invitation
        </div>
        <h1 className="font-display font-black text-slate-900 text-xl leading-tight">{competition.name}</h1>
        <p className="text-slate-500 text-sm mt-1">
          {(competition.type ?? 'league')[0].toUpperCase() + (competition.type ?? 'league').slice(1)}
          {competition.season ? ` · ${competition.season}` : ''}
        </p>
      </>
    )
  }

  // Completed in this session.
  if (done) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-10 text-center">
          <div className={`w-12 h-12 mx-auto rounded-2xl flex items-center justify-center mb-3 ${done === 'accepted' ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-100'}`}>
            {done === 'accepted' ? <Check className="w-6 h-6 text-emerald-600" /> : <X className="w-6 h-6 text-slate-500" />}
          </div>
          <h1 className="font-display font-bold text-slate-900 text-lg mb-1">
            {done === 'accepted' ? 'Invitation accepted' : 'Invitation declined'}
          </h1>
          <p className="text-slate-500 text-sm">
            {done === 'accepted'
              ? `${teamName} is now part of ${competition.name}.`
              : `You declined the invitation for ${teamName}.`}
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="px-6 py-8">
          <Header />

          {member && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mt-5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Invited team</div>
              <div className="text-slate-900 font-semibold text-sm">{teamName}</div>
              {orgName && <div className="text-[11px] text-slate-500">{orgName}</div>}
            </div>
          )}

          {/* Case 1 — invite not readable. Could be signed-out, not the team's
              org member, or genuinely missing. Rules hide it either way. */}
          {!invite ? (
            !user ? (
              <div className="mt-6">
                <p className="text-[12px] text-slate-500 leading-relaxed mb-3">
                  Sign in as an owner or staff member of the invited team’s school or club to view and respond to this invitation.
                </p>
                <Link to="/login"
                  className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3.5 transition-colors">
                  <LogIn className="w-4 h-4" /> Sign in to respond
                </Link>
              </div>
            ) : (
              <div className="mt-5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
                You don’t have access to this invitation, or it no longer exists. Only an owner or staff member of the invited team’s school or club can respond.
              </div>
            )
          ) : (() => {
            // Case 2 — invite readable. Decide on its resolved state.
            const status = invite.status   // pending | consumed | revoked | expired
            const memberStatus = member?.status
            const alreadyAccepted = memberStatus === 'accepted' || memberStatus === 'admin_approved'
            const closed = status !== 'pending' || alreadyAccepted

            if (closed) {
              return (
                <div className="mt-5">
                  {alreadyAccepted ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
                      <Check className="w-4 h-4 shrink-0" /> {teamName} has already joined this competition.
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-500">
                      {status === 'expired' ? 'This invitation has expired.'
                        : status === 'revoked' ? 'This invitation was withdrawn by the competition organiser.'
                        : 'This invitation is no longer open.'}
                    </div>
                  )}
                </div>
              )
            }

            if (!isOrgMember(member?.organizationId)) {
              return (
                <div className="mt-5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
                  You’re signed in, but only an owner or staff member of {orgName ?? 'this team’s school or club'} can accept this invitation.
                </div>
              )
            }

            return (
              <div className="mt-6">
                {actionError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-3">{actionError}</div>}
                <div className="flex gap-3">
                  <button onClick={() => respond('decline')} disabled={busy}
                    className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-sm rounded-xl py-3.5 transition-colors disabled:opacity-50">
                    Decline
                  </button>
                  <button onClick={() => respond('accept')} disabled={busy}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3.5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Accept
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </Shell>
  )
}
