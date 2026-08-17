import { useState } from 'react'
import { reportProfileMismatch } from '../lib/adminQueries'

// Addendum A4 report link: "this isn't me", on every profile page, working
// without an account — a parent or coach who spots a wrong claim should not
// have to register in order to say so. Reports land in profileReports for
// the master-admin queue.
export default function ReportProfileLink({ person }) {
  const [open, setOpen]       = useState(false)
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy]       = useState(false)
  const [done, setDone]       = useState(false)
  const [err,  setErr]        = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await reportProfileMismatch(person.id, { personName: person.fullName, message, contact })
      setDone(true)
    } catch (e2) {
      setErr(e2.message || 'Could not send the report. Please try again.')
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <p className="text-center text-xs text-slate-500 py-2">
        Thanks — your report has been sent to the MatchPulse team.
      </p>
    )
  }

  return (
    <div className="text-center py-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors">
          This isn't me — report this profile
        </button>
      ) : (
        <form onSubmit={submit}
          className="max-w-md mx-auto text-left bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
          <div className="text-sm font-bold text-slate-900">Report this profile</div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Tell us what's wrong — for example this profile isn't you, or someone
            else has claimed it. You don't need an account to report it.
          </p>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} required
            placeholder="What's wrong with this profile?"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500" />
          <input value={contact} onChange={e => setContact(e.target.value)}
            placeholder="Your email or phone (optional, so we can follow up)"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500" />
          {err && <p className="text-red-600 text-xs">{err}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !message.trim()}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-4 py-2 transition-colors">
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-900">Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
