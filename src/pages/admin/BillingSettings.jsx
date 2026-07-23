import { useEffect, useState } from 'react'
import { CreditCard, CheckCircle, Eye, EyeOff, Users, Plus, Building2, X, ClipboardList, KeyRound, Copy, Check } from 'lucide-react'
import {
  doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, Timestamp,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import {
  fetchPaymentRequests, markPaymentRequestPaid,
  issueEntitlementToken, fetchEntitlementTokens,
} from '../../lib/adminQueries'

// PayFast config stored at _meta/payfastConfig.
// Readable/writable only by platform admins (Firestore rules enforce this).
const CONFIG_PATH = '_meta/payfastConfig'

const DEFAULTS = {
  merchantId:  '',
  merchantKey: '',
  passphrase:  '',
  sandbox:     true,
  notifyUrl:   '',
  returnUrl:   '',
  cancelUrl:   '',
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function formatDateForInput(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null)
  if (!d || isNaN(d)) return ''
  return d.toISOString().split('T')[0]
}

const TIER_LABELS = { event: 'Event', pro: 'Pro', none: 'Free' }
const TIER_CLASSES = {
  event: 'text-amber-700 bg-amber-50 border-amber-200',
  pro:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  none:  'text-slate-600 bg-slate-50 border-slate-200',
}
function TierBadge({ tier }) {
  const cls = TIER_CLASSES[tier] ?? TIER_CLASSES.none
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold border ${cls}`}>
      {TIER_LABELS[tier] ?? tier}
    </span>
  )
}

// ── Shared UI atoms ────────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-800 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono, secret }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={secret && !show ? 'password' : 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 ${mono ? 'font-mono' : ''} ${secret ? 'pr-10' : ''}`}
      />
      {secret && (
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
    </div>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-emerald-600" />
        </div>
        <h2 className="font-semibold text-slate-900 text-sm">{title}</h2>
      </div>
      <div className="px-5 py-5 space-y-5">{children}</div>
    </div>
  )
}

const INPUT_CLASS = 'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'

// ── Manual grant modal ─────────────────────────────────────────────────────────

function ManualGrantModal({ org, onClose, onSaved }) {
  const isNew = !org?.id
  const [allOrgs, setAllOrgs]         = useState([])
  const [loadingOrgs, setLoadingOrgs] = useState(false)
  const [search, setSearch]           = useState(org?.name ?? '')
  const [selectedOrg, setSelectedOrg] = useState(org?.id ? org : null)
  const [showDrop, setShowDrop]       = useState(false)
  const [form, setForm] = useState({
    tier:    org?.entitlement ?? 'pro',
    expiry:  org?.entitlementExpiresAt ? formatDateForInput(org.entitlementExpiresAt) : '',
    credits: String(org?.eventCredits ?? 3),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (!isNew) return
    setLoadingOrgs(true)
    getDocs(collection(db, 'organizations'))
      .then(snap =>
        setAllOrgs(
          snap.docs
            .map(d => ({ id: d.id, name: d.data().name ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => {})
      .finally(() => setLoadingOrgs(false))
  }, [isNew])

  const filtered = search.trim()
    ? allOrgs.filter(o => o.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : allOrgs.slice(0, 8)

  async function handleSave() {
    const target = isNew ? selectedOrg : org
    if (!target?.id) { setError('Select an organisation.'); return }
    setSaving(true); setError('')
    try {
      const expDate = form.expiry ? new Date(form.expiry + 'T23:59:59') : null
      await updateDoc(doc(db, 'organizations', target.id), {
        entitlement:          form.tier,
        entitlementExpiresAt: expDate ? Timestamp.fromDate(expDate) : null,
        eventCredits:         form.tier === 'event' ? (parseInt(form.credits, 10) || 0) : null,
        updatedAt:            serverTimestamp(),
      })
      onSaved()
    } catch (err) {
      setError(err.message || 'Save failed.')
      setSaving(false)
    }
  }

  async function handleRevoke() {
    setSaving(true); setError('')
    try {
      await updateDoc(doc(db, 'organizations', org.id), {
        entitlement:          'none',
        entitlementExpiresAt: null,
        eventCredits:         null,
        updatedAt:            serverTimestamp(),
      })
      onSaved()
    } catch (err) {
      setError(err.message || 'Revoke failed.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between mb-5">
          <h2 className="font-display font-bold text-slate-900 text-lg">
            {isNew ? 'Grant plan access' : 'Edit plan'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Org selector (new grant) or display (edit) */}
          {isNew ? (
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">Organisation</label>
              <div className="relative">
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setSelectedOrg(null); setShowDrop(true) }}
                  onFocus={() => setShowDrop(true)}
                  placeholder={loadingOrgs ? 'Loading…' : 'Search by name…'}
                  disabled={loadingOrgs}
                  className={INPUT_CLASS}
                />
                {showDrop && !selectedOrg && filtered.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 border border-slate-200 rounded-lg bg-white shadow-lg max-h-44 overflow-y-auto">
                    {filtered.map(o => (
                      <button key={o.id} type="button"
                        onClick={() => { setSelectedOrg(o); setSearch(o.name); setShowDrop(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                        {o.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedOrg && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle className="w-3.5 h-3.5" /> {selectedOrg.name}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-900">{org.name}</span>
              <TierBadge tier={org.entitlement} />
            </div>
          )}

          {/* Tier */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Plan tier</label>
            <select value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}
              className={INPUT_CLASS}>
              <option value="event">Event — per-competition credits</option>
              <option value="pro">Pro — unlimited competitions</option>
            </select>
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Expiry date <span className="font-normal text-slate-400">(optional — leave blank for no expiry)</span>
            </label>
            <input type="date" value={form.expiry}
              onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))}
              className={INPUT_CLASS} />
          </div>

          {/* Credits (event tier only) */}
          {form.tier === 'event' && (
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">Event credits</label>
              <input type="number" min="0" value={form.credits}
                onChange={e => setForm(f => ({ ...f, credits: e.target.value }))}
                className={INPUT_CLASS} />
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            {!isNew && (
              <button type="button" onClick={handleRevoke} disabled={saving}
                className="flex-1 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 font-bold text-sm rounded-xl py-2.5 transition-colors">
                Revoke
              </button>
            )}
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold text-sm rounded-xl py-2.5 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSave}
              disabled={saving || (isNew && !selectedOrg)}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Subscribers section ────────────────────────────────────────────────────────

function SubscriberRow({ org, onEdit }) {
  const expiry   = org.entitlementExpiresAt ? formatDateForInput(org.entitlementExpiresAt) : null
  const expired  = expiry && new Date(expiry + 'T23:59:59') < new Date()
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900 truncate">{org.name}</div>
        <div className="text-[11px] mt-0.5">
          {expiry ? (
            <span className={expired ? 'text-red-500' : 'text-slate-400'}>
              {expired ? 'Expired ' : 'Expires '}{expiry}
            </span>
          ) : (
            <span className="text-slate-400">No expiry</span>
          )}
          {org.entitlement === 'event' && (
            <span className="text-slate-400"> · {org.eventCredits ?? 0} credits remaining</span>
          )}
        </div>
      </div>
      <TierBadge tier={org.entitlement} />
      <button type="button" onClick={onEdit}
        className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 transition-colors ml-1 shrink-0">
        Edit
      </button>
    </div>
  )
}

function SubscribersSection() {
  const [orgs, setOrgs]   = useState([])
  const [loading, setLd]  = useState(true)
  const [modal, setModal] = useState(null)
  const [tick, setTick]   = useState(0)

  useEffect(() => {
    setLd(true)
    getDocs(query(collection(db, 'organizations'), where('entitlement', 'in', ['event', 'pro'])))
      .then(snap =>
        setOrgs(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
        )
      )
      .catch(() => {})
      .finally(() => setLd(false))
  }, [tick])

  return (
    <>
      <Section icon={Users} title="Subscribers">
        <div className="flex items-center justify-between -mt-2 mb-1">
          <p className="text-xs text-slate-500">Organisations with active paid plans.</p>
          <button type="button" onClick={() => setModal({})}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-600 hover:text-emerald-700 transition-colors shrink-0">
            <Plus className="w-4 h-4" /> Grant access
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No paid subscribers yet.</p>
        ) : (
          <div className="space-y-2">
            {orgs.map(org => (
              <SubscriberRow key={org.id} org={org} onEdit={() => setModal(org)} />
            ))}
          </div>
        )}
      </Section>

      {modal !== null && (
        <ManualGrantModal
          org={modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setTick(t => t + 1) }}
        />
      )}
    </>
  )
}

// ── Payment Requests section ───────────────────────────────────────────────────

const PLAN_LABEL   = { event: 'Plus (event)', pro: 'Pro' }
const STATUS_CLASS = { pending: 'text-amber-700 bg-amber-50 border-amber-200', paid: 'text-emerald-700 bg-emerald-50 border-emerald-200' }

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button type="button" onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors ml-2">
      {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
    </button>
  )
}

function ActivateModal({ request, onClose, onDone }) {
  const IC = 'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'
  const [mode,        setMode]        = useState('link')  // 'link' | 'token'
  const [allOrgs,     setAllOrgs]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState(request.orgName ?? '')
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [showDrop,    setShowDrop]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [issuedToken, setIssuedToken] = useState(null)

  useEffect(() => {
    getDocs(collection(db, 'organizations'))
      .then(snap =>
        setAllOrgs(
          snap.docs.map(d => ({ id: d.id, name: d.data().name ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = search.trim()
    ? allOrgs.filter(o => o.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : allOrgs.slice(0, 8)

  async function handleActivate() {
    if (!selectedOrg) { setError('Select an organisation.'); return }
    setSaving(true); setError('')
    try {
      await markPaymentRequestPaid(request.id, selectedOrg.id, request.plan)
      onDone()
    } catch (err) {
      setError(err.message || 'Activation failed.')
      setSaving(false)
    }
  }

  async function handleIssueToken() {
    setSaving(true); setError('')
    try {
      const code = await issueEntitlementToken(request.id)
      setIssuedToken(code)
    } catch (err) {
      setError(err.message || 'Failed to issue token.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={issuedToken ? undefined : onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-display font-bold text-slate-900 text-base">Confirm payment</h2>
            <p className="text-slate-500 text-xs mt-0.5">{request.invoiceNumber} · {PLAN_LABEL[request.plan]}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-0.5 mb-4">
          <div><span className="text-slate-500">Organisation: </span><span className="font-semibold">{request.orgName}</span></div>
          <div><span className="text-slate-500">Contact: </span>{request.contactName} · {request.contactEmail}</div>
          {request.eventName && <div><span className="text-slate-500">Event: </span>{request.eventName}</div>}
          <div><span className="text-slate-500">Amount: </span><span className="font-semibold">R{request.amount?.toLocaleString('en-ZA')}</span></div>
        </div>

        {/* Token issued — show code and done */}
        {issuedToken ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <p className="text-xs text-emerald-700 mb-2 font-semibold">Activation code issued</p>
              <div className="flex items-center justify-center gap-1">
                <span className="font-mono font-bold text-lg text-emerald-800 tracking-widest">{issuedToken}</span>
                <CopyButton text={issuedToken} />
              </div>
              <p className="text-[11px] text-emerald-600 mt-2">
                Send this code to <strong>{request.contactEmail}</strong>.<br />
                They enter it in their org Settings to activate {request.plan === 'pro' ? 'Pro' : 'their event credit'}.
              </p>
            </div>
            <button onClick={onDone}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              <button type="button" onClick={() => setMode('link')}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-colors ${mode === 'link' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Org exists — link it
              </button>
              <button type="button" onClick={() => setMode('token')}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-colors ${mode === 'token' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                No org yet — issue code
              </button>
            </div>

            {mode === 'link' ? (
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Link to organisation</label>
                <p className="text-xs text-slate-500 mb-1.5">
                  Search for the org to grant {request.plan === 'pro' ? 'Pro access' : 'an event credit'} immediately.
                </p>
                <div className="relative">
                  <input value={search} placeholder={loading ? 'Loading…' : 'Search by name…'} disabled={loading}
                    onChange={e => { setSearch(e.target.value); setSelectedOrg(null); setShowDrop(true) }}
                    onFocus={() => setShowDrop(true)}
                    className={IC} />
                  {showDrop && !selectedOrg && filtered.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 border border-slate-200 rounded-lg bg-white shadow-lg max-h-44 overflow-y-auto">
                      {filtered.map(o => (
                        <button key={o.id} type="button"
                          onClick={() => { setSelectedOrg(o); setSearch(o.name); setShowDrop(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                          {o.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedOrg && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle className="w-3.5 h-3.5" /> {selectedOrg.name}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 space-y-1">
                <p className="font-semibold">Organisation not created yet?</p>
                <p>Confirm payment and issue an activation code. The customer creates their org, then enters the code in their org Settings to activate {request.plan === 'pro' ? 'Pro' : 'their event credit'}.</p>
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} disabled={saving}
                className="flex-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold text-sm rounded-xl py-2.5 transition-colors">
                Cancel
              </button>
              {mode === 'link' ? (
                <button onClick={handleActivate} disabled={saving || !selectedOrg}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
                  {saving ? 'Activating…' : 'Confirm payment + activate'}
                </button>
              ) : (
                <button onClick={handleIssueToken} disabled={saving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
                  {saving ? 'Issuing…' : 'Confirm payment + issue code'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PaymentRequestsSection() {
  const [requests, setRequests] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null)
  const [filter,   setFilter]   = useState('pending')
  const [tick,     setTick]     = useState(0)

  useEffect(() => {
    setLoading(true)
    fetchPaymentRequests()
      .then(setRequests)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tick])

  function fmtDate(ts) {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null)
    if (!d || isNaN(d)) return ''
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const shown = requests.filter(r => filter === 'all' || r.status === filter)

  return (
    <>
      <Section icon={ClipboardList} title="Payment Requests">
        <div className="flex items-center justify-between -mt-2 mb-3">
          <p className="text-xs text-slate-500">Purchase requests submitted from the Plans page.</p>
          <div className="flex gap-1">
            {['pending', 'paid', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                  filter === f ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No {filter !== 'all' ? filter : ''} payment requests.</p>
        ) : (
          <div className="space-y-2">
            {shown.map(r => (
              <div key={r.id} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="font-semibold text-slate-900 truncate">{r.orgName}</div>
                  <div className="text-[11px] text-slate-500">
                    {r.invoiceNumber} · {r.contactName} · {r.contactEmail}
                    {r.eventName ? ` · ${r.eventName}` : ''}
                  </div>
                  <div className="text-[11px] text-slate-400">{fmtDate(r.createdAt)}{r.paidAt ? ` · Paid ${fmtDate(r.paidAt)}` : ''}</div>
                </div>
                <span className="text-[10px] font-bold">{PLAN_LABEL[r.plan]}</span>
                <span className="text-xs font-bold font-mono shrink-0">R{r.amount?.toLocaleString('en-ZA')}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border shrink-0 ${STATUS_CLASS[r.status] ?? STATUS_CLASS.pending}`}>
                  {r.status}
                </span>
                {r.status === 'pending' && (
                  <button onClick={() => setModal(r)}
                    className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 transition-colors shrink-0">
                    Activate
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {modal && (
        <ActivateModal
          request={modal}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); setTick(t => t + 1) }}
        />
      )}
    </>
  )
}

// ── Activation tokens section ─────────────────────────────────────────────────

const TOKEN_STATUS_CLASS = {
  active:   'text-amber-700 bg-amber-50 border-amber-200',
  redeemed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
}

function ActivationTokensSection() {
  const [tokens,  setTokens]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('active')
  const [tick,    setTick]    = useState(0)

  useEffect(() => {
    setLoading(true)
    fetchEntitlementTokens()
      .then(setTokens)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tick])

  function fmtDate(ts) {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null)
    if (!d || isNaN(d)) return ''
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const shown = tokens.filter(t => filter === 'all' || t.status === filter)

  return (
    <Section icon={KeyRound} title="Activation Codes">
      <div className="flex items-center justify-between -mt-2 mb-3">
        <p className="text-xs text-slate-500">Codes issued when orgs didn't exist at payment time.</p>
        <div className="flex gap-1">
          {['active', 'redeemed', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                filter === f ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">No {filter !== 'all' ? filter : ''} activation codes.</p>
      ) : (
        <div className="space-y-2">
          {shown.map(t => (
            <div key={t.id} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-800 text-xs tracking-wider">{t.token}</span>
                  {t.status === 'active' && <CopyButton text={t.token} />}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t.orgName}{t.contactEmail ? ` · ${t.contactEmail}` : ''}
                </div>
                <div className="text-[11px] text-slate-400">
                  Issued {fmtDate(t.createdAt)}
                  {t.status === 'redeemed' && t.redeemedAt ? ` · Redeemed ${fmtDate(t.redeemedAt)}` : ''}
                </div>
              </div>
              <span className="text-[10px] font-bold shrink-0">{PLAN_LABEL[t.plan]}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border shrink-0 ${TOKEN_STATUS_CLASS[t.status] ?? TOKEN_STATUS_CLASS.active}`}>
                {t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── PayFast settings page ──────────────────────────────────────────────────────

export default function BillingSettings() {
  const [form,    setForm]    = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    getDoc(doc(db, CONFIG_PATH))
      .then(snap => { if (snap.exists()) setForm(f => ({ ...f, ...snap.data() })) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set(key) { return val => setForm(f => ({ ...f, [key]: val })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      await setDoc(doc(db, CONFIG_PATH), { ...form, updatedAt: new Date() })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally { setSaving(false) }
  }

  const payfastBase  = form.sandbox
    ? 'https://sandbox.payfast.co.za/eng/process'
    : 'https://www.payfast.co.za/eng/process'
  // Passphrase is optional — set it ONLY if your PayFast account has one.
  const isConfigured = form.merchantId.trim() && form.merchantKey.trim()

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <div className="mb-2">
        <h1 className="font-display font-bold text-slate-900 text-xl">Billing &amp; Payments</h1>
        <p className="text-slate-500 text-sm mt-1">
          Configure PayFast for Plus and Pro subscription payments, and manage subscriber access.
          Credentials are stored securely and only accessible by platform admins.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* Status banner */}
        <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2.5 ${isConfigured ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
          {isConfigured
            ? <><CheckCircle className="w-4 h-4 shrink-0" /> PayFast credentials configured. {form.sandbox ? 'Running in sandbox mode.' : 'Running LIVE.'}</>
            : <><CreditCard className="w-4 h-4 shrink-0" /> Credentials not yet set. Payments are disabled until configured.</>
          }
        </div>

        {/* Mode */}
        <Section icon={CreditCard} title="Environment">
          <div className="flex items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Sandbox mode</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Use PayFast sandbox for testing. No real money is charged.
                Switch to live only when you are ready to accept real payments.
              </p>
            </div>
            <button type="button"
              onClick={() => setForm(f => ({ ...f, sandbox: !f.sandbox }))}
              className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${form.sandbox ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.sandbox ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          {!form.sandbox && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
              <strong>Live mode active.</strong> Real payments will be processed. Ensure all credentials are correct before saving.
            </div>
          )}
        </Section>

        {/* Credentials */}
        <Section icon={CreditCard} title="PayFast credentials">
          <p className="text-xs text-slate-500">
            Find these in your PayFast merchant account under{' '}
            <span className="font-mono">Settings → Integration</span>.
            Use the sandbox merchant account credentials when sandbox mode is on.
          </p>
          <Field label="Merchant ID" hint="Your numeric PayFast merchant ID (e.g. 10000100).">
            <TextInput value={form.merchantId} onChange={set('merchantId')} placeholder="10000100" mono />
          </Field>
          <Field label="Merchant Key" hint="Your PayFast merchant key — treat this as a password.">
            <TextInput value={form.merchantKey} onChange={set('merchantKey')} placeholder="46f0cd694581a" mono secret />
          </Field>
          <Field label="Passphrase" hint="Optional. Must EXACTLY match the passphrase (salt) set on your PayFast account under Settings → Integration. Leave blank if your account has none — a mismatch causes a PayFast 500 / signature error.">
            <TextInput value={form.passphrase} onChange={set('passphrase')} placeholder="leave blank if not set on PayFast" mono secret />
          </Field>
        </Section>

        {/* URLs */}
        <Section icon={CreditCard} title="Redirect &amp; notification URLs">
          <p className="text-xs text-slate-500">
            The notify URL must point to the <span className="font-mono">payfastITN</span> Cloud Function.
            Replace <span className="font-mono">[REGION]</span> with your Functions region (e.g.{' '}
            <span className="font-mono">europe-west1</span>).
          </p>
          <Field label="Notify URL (ITN webhook)"
            hint="PayFast will POST payment confirmations here. This MUST be publicly reachable.">
            <TextInput
              value={form.notifyUrl}
              onChange={set('notifyUrl')}
              placeholder="https://europe-west1-match-pulse-4560e.cloudfunctions.net/payfastITN"
              mono
            />
          </Field>
          <Field label="Return URL" hint="Where PayFast redirects the buyer after a successful payment.">
            <TextInput value={form.returnUrl} onChange={set('returnUrl')} placeholder="https://matchpulse.co.za/portal" mono />
          </Field>
          <Field label="Cancel URL" hint="Where PayFast redirects if the buyer cancels payment.">
            <TextInput value={form.cancelUrl} onChange={set('cancelUrl')} placeholder="https://matchpulse.co.za/plans" mono />
          </Field>
        </Section>

        {/* Reference */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-700 text-sm">PayFast endpoint</p>
          <p className="font-mono break-all">{payfastBase}</p>
          <p className="mt-1">
            Sandbox: <a href="https://sandbox.payfast.co.za" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">sandbox.payfast.co.za</a>
            {' · '}
            Docs: <a href="https://developers.payfast.co.za" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">developers.payfast.co.za</a>
          </p>
        </div>

        {/* Save */}
        <div className="flex items-center justify-between gap-4 pt-2">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && (
            <p className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Settings saved.
            </p>
          )}
          {!saved && !error && <span />}
          <button type="submit" disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl px-6 py-2.5 transition-colors shrink-0">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>

      </form>

      {/* Subscribers — separate from the form so Save doesn't interfere */}
      <SubscribersSection />

      {/* Payment requests from the Plans page */}
      <PaymentRequestsSection />

      {/* Activation codes issued for orgs that didn't exist at payment time */}
      <ActivationTokensSection />
    </div>
  )
}
