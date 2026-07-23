import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Printer } from 'lucide-react'
import { useSeoMeta } from '../lib/useSeoMeta'
import { createPaymentRequest } from '../lib/adminQueries'
import './WhyMatchPulse.css'
import './Plans.css'

// ── Update these with your actual bank details ────────────────────────────────
const BANK_DETAILS = {
  bankName:      'First National Bank',
  accountHolder: 'MatchPulse (Pty) Ltd',
  accountNumber: '62791013982',
  branchCode:    '250655',
  accountType:   'Cheque',
  reference:     'Your invoice number',
}
const CONTACT_EMAIL = 'billing@matchpulse.co.za'

function useReveal() {
  useEffect(() => {
    const page = document.querySelector('.mp-page')
    if (!page) return
    const items = page.querySelectorAll('.reveal')
    if (!('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('in')); return }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } })
    }, { threshold: 0.12 })
    items.forEach((el, i) => { el.style.transitionDelay = `${Math.min(i % 6, 5) * 55}ms`; io.observe(el) })
    return () => io.disconnect()
  }, [])
}

// ── Purchase modal — contact form ─────────────────────────────────────────────
function PurchaseForm({ plan, planName, price, onClose, onSuccess }) {
  const [form, setForm] = useState({ orgName: '', contactName: '', contactEmail: '', phone: '', eventName: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.contactName.trim() || !form.contactEmail.trim()) return
    setSaving(true); setError('')
    try {
      const invoiceNumber = await createPaymentRequest({ plan, ...form })
      onSuccess({ ...form, plan, planName, price, invoiceNumber })
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors bg-white'
  const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-display font-bold text-slate-900 text-base">{planName} — {price}</h2>
            <p className="text-slate-500 text-xs mt-0.5">Fill in your details and we will send you a proforma invoice.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors ml-4">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          <div>
            <label className={labelCls}>Organisation <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span></label>
            <input className={inputCls} value={form.orgName} onChange={set('orgName')}
              placeholder="School, club or association (if any)" />
          </div>
          {plan === 'event' && (
            <div>
              <label className={labelCls}>Competition / event name</label>
              <input className={inputCls} value={form.eventName} onChange={set('eventName')}
                placeholder="e.g. U18 Provincial Tournament 2026" />
            </div>
          )}
          <div>
            <label className={labelCls}>Your name <span className="text-red-400">*</span></label>
            <input className={inputCls} value={form.contactName} onChange={set('contactName')}
              placeholder="First and last name" required />
          </div>
          <div>
            <label className={labelCls}>Email address <span className="text-red-400">*</span></label>
            <input className={inputCls} type="email" value={form.contactEmail} onChange={set('contactEmail')}
              placeholder="your@email.com" required />
          </div>
          <div>
            <label className={labelCls}>Phone <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span></label>
            <input className={inputCls} type="tel" value={form.phone} onChange={set('phone')}
              placeholder="+27 82 000 0000" />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" disabled={saving || !form.contactName.trim() || !form.contactEmail.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3 transition-colors">
            {saving ? 'Generating invoice…' : 'Get invoice'}
          </button>
          <p className="text-center text-[11px] text-slate-400">
            Once payment is confirmed, your competition access is activated within one business day.
          </p>
        </form>
      </div>
    </div>
  )
}

// ── Invoice modal — printable proforma invoice ────────────────────────────────
function InvoiceModal({ data, onClose }) {
  const today = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
  const amount = data.plan === 'pro' ? 15000 : 2000
  const vatRate = 0.15
  const excl = +(amount / (1 + vatRate)).toFixed(2)
  const vat  = +(amount - excl).toFixed(2)

  function handlePrint() {
    const w = window.open('', '_blank', 'width=800,height=900')
    w.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>MatchPulse Invoice ${data.invoiceNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; font-size: 13px; color: #1e293b; padding: 48px; }
  .hd { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; }
  .logo { font-size: 22px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
  .inv-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; text-align: right; }
  .inv-num { font-size: 18px; font-weight: 700; color: #1e293b; text-align: right; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
  .meta h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 6px; }
  .meta p { font-size: 13px; color: #1e293b; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; text-align: left; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
  thead th:last-child { text-align: right; }
  td { padding: 10px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  td:last-child { text-align: right; font-weight: 600; }
  .totals { display: flex; justify-content: flex-end; }
  .totals table { width: 260px; }
  .totals td { border: none; padding: 4px 0; }
  .totals td:last-child { color: #1e293b; }
  .total-row td { padding-top: 10px; border-top: 2px solid #1e293b; font-size: 15px; font-weight: 800; }
  .bank { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-top: 28px; }
  .bank h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 10px; }
  .bank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .bank-grid span:first-child { font-size: 11px; color: #94a3b8; }
  .bank-grid span:last-child { font-size: 13px; font-weight: 600; color: #1e293b; }
  .note { margin-top: 20px; font-size: 11px; color: #64748b; line-height: 1.6; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  @media print { body { padding: 32px; } }
</style>
</head><body>
<div class="hd">
  <div>
    <div class="logo">MatchPulse</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px">matchpulse.co.za</div>
  </div>
  <div>
    <div class="inv-label">Proforma Invoice</div>
    <div class="inv-num">${data.invoiceNumber}</div>
    <div style="font-size:11px;color:#64748b;text-align:right;margin-top:4px">${today}</div>
  </div>
</div>
<div class="meta">
  <div>
    <h3>Invoice to</h3>
    <p>${data.orgName ? `${data.orgName}<br/>` : ''}${data.contactName}<br/>${data.contactEmail}${data.phone ? `<br/>${data.phone}` : ''}</p>
  </div>
  <div>
    <h3>Payment due</h3>
    <p style="font-weight:700;font-size:16px;color:#1e293b">R${amount.toLocaleString('en-ZA')}</p>
    <p style="font-size:11px;color:#64748b;margin-top:2px">EFT bank transfer</p>
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Amount (excl. VAT)</th></tr></thead>
  <tbody>
    <tr>
      <td>
        <strong>${data.planName} Plan${data.eventName ? ` — ${data.eventName}` : ''}</strong>
        <div style="font-size:11px;color:#64748b;margin-top:2px">${data.plan === 'pro' ? 'Unlimited competitions, 1-year subscription' : 'Single competition — once-off'}</div>
      </td>
      <td>R${excl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td>
    </tr>
  </tbody>
</table>
<div class="totals">
  <table>
    <tr><td>Subtotal (excl. VAT)</td><td>R${excl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td></tr>
    <tr><td>VAT (15%)</td><td>R${vat.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td></tr>
    <tr class="total-row"><td>Total due</td><td>R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td></tr>
  </table>
</div>
<div class="bank">
  <h3>Payment instructions — EFT / bank transfer</h3>
  <div class="bank-grid">
    <span>Bank</span><span>${BANK_DETAILS.bankName}</span>
    <span>Account holder</span><span>${BANK_DETAILS.accountHolder}</span>
    <span>Account number</span><span>${BANK_DETAILS.accountNumber}</span>
    <span>Branch code</span><span>${BANK_DETAILS.branchCode}</span>
    <span>Account type</span><span>${BANK_DETAILS.accountType}</span>
    <span>Reference</span><span style="color:#059669;font-weight:700">${data.invoiceNumber}</span>
  </div>
</div>
<p class="note">
  Please use <strong>${data.invoiceNumber}</strong> as your payment reference.<br/>
  Once payment is received, your MatchPulse competition access will be activated within one business day.<br/>
  Send proof of payment to <strong>${CONTACT_EMAIL}</strong> to expedite activation.
</p>
<div class="footer">MatchPulse · matchpulse.co.za · ${CONTACT_EMAIL}</div>
</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-display font-bold text-slate-900 text-base">Your invoice is ready</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold mb-0.5">Invoice {data.invoiceNumber}</p>
            <p>Print or save it as a PDF, then transfer the amount to the bank details shown.</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold">{data.planName}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Amount due</span><span className="font-semibold font-mono">R{(data.plan === 'pro' ? 15000 : 2000).toLocaleString('en-ZA')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Reference</span><span className="font-mono font-bold text-emerald-700">{data.invoiceNumber}</span></div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Bank transfer details</p>
            <div className="space-y-0.5">
              <div className="flex justify-between text-xs"><span className="text-slate-500">Bank</span><span>{BANK_DETAILS.bankName}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Account</span><span className="font-mono">{BANK_DETAILS.accountNumber}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Branch</span><span className="font-mono">{BANK_DETAILS.branchCode}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Reference</span><span className="font-mono font-bold text-emerald-700">{data.invoiceNumber}</span></div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            Send proof of payment to <span className="font-semibold">{CONTACT_EMAIL}</span>. Access is activated within one business day.
          </p>
          <button onClick={handlePrint}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-3 transition-colors">
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
          <button onClick={onClose}
            className="w-full text-slate-500 hover:text-slate-900 text-sm font-medium py-2 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Purchase CTA — shared by Plus & Pro (paid tiers) ─────────────────────────
// Primary: PayFast — user just needs to be logged in, nothing else required.
// Fallback: EFT invoice — explicit secondary choice.
// PayFast hosted payment links. Recurring billing for Pro is configured on the
// PayFast side (subscription_type=1, annual frequency, indefinite cycles).
const PAYFAST_LINKS = {
  event: 'https://payf.st/k1i9d',  // MatchPulse Plus — single event (once-off)
  pro:   'https://payment.payfast.io/eng/process?cmd=_paynow&receiver=10266957&item_name=MatchPulse+Pro&email_confirmation=1&confirmation_address=michael@robertfamily.co.za&return_url=https://matchpulse.co.za/portal&cancel_url=https://matchpulse.co.za/plans&notify_url=https://matchpulse.co.za/payfast/itn&amount=15000&subscription_type=1&recurring_amount=15000&cycles=0&frequency=6',  // MatchPulse Pro — annual recurring subscription
}

function PaidCTA({ plan, planName, price, label, styleClass }) {
  const [step,        setStep]        = useState('idle')  // idle|form|invoice
  const [invoiceData, setInvoiceData] = useState(null)
  const link = PAYFAST_LINKS[plan]

  const overlay = (modal) => (
    <>
      <div className="tier-cta-slot">
        <button disabled className={`tier-cta ${styleClass} opacity-60`}>{label}</button>
      </div>
      {modal}
    </>
  )

  if (step === 'form') return overlay(
    <PurchaseForm
      plan={plan} planName={planName} price={price}
      onClose={() => setStep('idle')}
      onSuccess={d => { setInvoiceData(d); setStep('invoice') }}
    />
  )

  if (step === 'invoice') return overlay(
    <InvoiceModal data={invoiceData} onClose={() => setStep('idle')} />
  )

  return (
    <div className="tier-cta-slot">
      {/* Pay on PayFast's hosted, secure checkout. After payment, your access is
          activated by the MatchPulse team (you'll get an activation code). */}
      <a href={link} target="_blank" rel="noopener" className={`tier-cta ${styleClass}`}>
        {label}
      </a>
      <button onClick={() => setStep('form')} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 transition-colors mt-1.5 py-0.5">
        Pay by EFT invoice instead
      </button>
    </div>
  )
}

// ── Shared tier-card component — identical template for all three tiers ────────
function TierCard({ tier }) {
  return (
    <div className={`tier-card reveal${tier.featured ? ' featured' : ''}`}>
      {tier.pill && <span className="tier-badge featured">{tier.pill}</span>}
      <p className="tier-eyebrow">{tier.audience}</p>
      <h2 className="tier-name">{tier.name}</h2>
      <p className="tier-tagline">{tier.description}</p>

      <div className="tier-price-row">
        <span className="tier-price tnum">{tier.price}</span>
        {tier.cadence && <span className="tier-per">{tier.cadence}</span>}
      </div>
      <p className="tier-note">{tier.reassurance}</p>

      <hr className="tier-divider" />

      <ul className="tier-diff-list">
        {tier.features.map(f => <li key={f}>{f}</li>)}
      </ul>

      {/* CTA — pushed to the bottom (margin-top:auto) so all three align */}
      {tier.cta.kind === 'link'
        ? (
          <div className="tier-cta-slot">
            <Link to={tier.cta.to} className={`tier-cta ${tier.cta.styleClass}`}>{tier.cta.label}</Link>
          </div>
        )
        : <PaidCTA plan={tier.cta.plan} planName={tier.name} price={tier.price} label={tier.cta.label} styleClass={tier.cta.styleClass} />
      }
    </div>
  )
}

// ── Tier data ─────────────────────────────────────────────────────────────────
const TIERS = [
  {
    key: 'free',
    audience: 'For clubs & schools',
    name: 'Free',
    description: 'Your team, your fixtures, your records. Always free.',
    price: 'R0',
    cadence: null,
    reassurance: 'No card. No trial. No end date.',
    features: ['One organisation', 'Unlimited teams', 'Unlimited fixtures, forever'],
    cta: { kind: 'link', to: '/signup', label: 'Start free', styleClass: 'tier-cta-dark' },
  },
  {
    key: 'plus',
    featured: true,
    pill: 'Single event',
    audience: 'For organisers',
    name: 'Plus',
    description: 'One competition, run beautifully. Pay once. Keep it forever.',
    price: 'R2,000',
    cadence: 'once-off',
    reassurance: 'One price. No setup fee. Nothing more to pay.',
    features: ['One tournament, league or festival', 'Unlimited teams', 'Unlimited fixtures'],
    cta: { kind: 'paid', plan: 'event', label: 'Run an event', styleClass: 'tier-cta-primary' },
  },
  {
    key: 'pro',
    audience: 'For associations',
    name: 'Pro',
    description: 'Your entire season, every division, under one roof.',
    price: 'R15,000',
    cadence: '/ year',
    reassurance: 'Unlimited everything. One annual fee.',
    features: ['Unlimited tournaments, leagues & festivals', 'Unlimited teams', 'Unlimited fixtures, all year'],
    cta: { kind: 'paid', plan: 'pro', label: 'Go Pro', styleClass: 'tier-cta-dark' },
  },
]

// ── "Standard on every package" — grouped feature list ────────────────────────
const FEATURE_GROUPS = [
  {
    title: 'Fixtures & scheduling',
    items: [
      'Auto-generate a full fixture list in seconds',
      'Hand-build your draw when you want full control',
      'Smart auto-scheduler',
      'Automatic knockout rounds: quarters, semis and finals',
      'Run matches across multiple fields at once',
      'Share any fixture list as a print-ready PDF',
    ],
  },
  {
    title: 'Match day & the clock',
    items: [
      'Live scoring, updated the moment it happens',
      'Match countdown timers',
      '30-second warning before full time',
      'Period-break timers with their own 30-second warning',
      'Fully configurable periods: count, length, and break time',
    ],
  },
  {
    title: 'Results, standings & story',
    items: [
      'Points, logs and standings update themselves',
      'Custom tie-breaker rules, applied automatically',
      'Full team and player statistics',
      'A complete match timeline: goals, cards, and every key moment',
      'Every action credited to the player who made it',
      "Your organisation's logo across everything",
    ],
  },
]

export default function Plans() {
  useReveal()
  useSeoMeta({ type: 'plans' })

  return (
    <main className="mp-page">

      {/* HERO */}
      <section className="plans-hero">
        <div className="wrap">
          <p className="eyebrow reveal"><span className="dot" />Pricing</p>
          <h1 className="reveal">One platform. Three ways to run it.</h1>
          <p className="tagline reveal">Free where it should be. Fair where it counts.</p>

          {/* Positioning block — bookend with the closing statement */}
          <div className="plans-callout reveal">
            <p className="co-head">Built for the organiser.</p>
            <p className="co-sub">Not a spreadsheet. Not a WhatsApp group. A platform your competition actually deserves.</p>
          </div>
        </div>
      </section>

      {/* TIER CARDS */}
      <section className="mp-section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="tier-grid">
            {TIERS.map(tier => <TierCard key={tier.key} tier={tier} />)}
          </div>
        </div>
      </section>

      {/* STANDARD FEATURES */}
      <section className="mp-section">
        <div className="wrap">
          <p className="label reveal">Standard on every plan</p>
          <h2 className="h2 reveal">The whole platform. Every time.</h2>
          <p className="sub reveal">There&rsquo;s no cut-down version of MatchPulse. Free or Pro, you get all of it.</p>

          <div className="feat-groups">
            {FEATURE_GROUPS.map(group => (
              <div className="feat-group reveal" key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CLOSING STATEMENT — bookend with the positioning block */}
      <section className="plans-footer">
        <div className="wrap">
          <p className="reveal">Your next competition deserves a proper platform.</p>
          <p className="reveal payoff"><b>Live scores. Instant results. Automatic tables.</b></p>
        </div>
      </section>

    </main>
  )
}
