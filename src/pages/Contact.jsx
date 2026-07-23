import { useState } from 'react'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { useSupportHead } from '../support/head'
import Turnstile, { turnstileConfigured } from '../components/Turnstile'

const FIELD_CLASS =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors'

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [captchaToken, setCaptchaToken] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useSupportHead({
    title: 'Contact Us · MatchPulse',
    description: 'Get in touch with the MatchPulse team. Send us a message and we will get back to you.',
    path: '/contact',
  })

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const filled = form.name.trim() && form.email.trim() && form.phone.trim() && form.message.trim()
  // Require a solved captcha only when Turnstile is actually configured.
  const captchaOk = turnstileConfigured ? !!captchaToken : true
  const canSubmit = filled && captchaOk && !sending

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSending(true)
    setError('')
    try {
      const call = httpsCallable(functions, 'submitContactForm')
      await call({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        captchaToken,
      })
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <div className="mb-6">
        <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1.5">Contact</div>
        <h1 className="text-2xl font-bold text-slate-900">Get in touch</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
          Have a question or need a hand? Send us a message and we&rsquo;ll get back to you by email.
        </p>
      </div>

      {sent ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center">
          <div className="text-lg font-bold text-slate-900 mb-1.5">Thanks — your message is on its way.</div>
          <p className="text-sm text-slate-500 leading-relaxed">
            We&rsquo;ve received your enquiry and will reply to <strong className="text-slate-700">{form.email.trim()}</strong> as soon as we can.
          </p>
          <Link to="/" className="inline-block mt-5 text-sm font-semibold text-emerald-600 hover:text-emerald-500">
            Back to home
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
          <Field label="Your name">
            <input type="text" value={form.name} onChange={set('name')} required maxLength={100}
              autoComplete="name" placeholder="Full name" className={FIELD_CLASS} />
          </Field>

          <Field label="Email address">
            <input type="email" value={form.email} onChange={set('email')} required maxLength={200}
              autoComplete="email" placeholder="you@example.com" className={FIELD_CLASS} />
          </Field>

          <Field label="Cellphone number">
            <input type="tel" value={form.phone} onChange={set('phone')} required maxLength={40}
              autoComplete="tel" placeholder="e.g. 082 123 4567" className={FIELD_CLASS} />
          </Field>

          <Field label="Message">
            <textarea value={form.message} onChange={set('message')} required maxLength={5000} rows={5}
              placeholder="How can we help?"
              className={`${FIELD_CLASS} resize-none`} />
          </Field>

          {turnstileConfigured && (
            <div>
              <Turnstile onToken={setCaptchaToken} />
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" disabled={!canSubmit}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
            {sending ? 'Sending…' : 'Send message'}
          </button>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            By sending this message you agree to our{' '}
            <Link to="/legal/terms" className="text-emerald-600 hover:text-emerald-500">Terms</Link> and{' '}
            <Link to="/legal/privacy" className="text-emerald-600 hover:text-emerald-500">Privacy Policy</Link>.
          </p>
        </form>
      )}
    </div>
  )
}
