import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Info, Trophy, ListOrdered, Sparkles, Lock } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { fetchOrganization } from '../../../lib/queries'
import { createManagedCompetition, updateManagedCompetition } from '../../../lib/adminQueries'
import { orgEntitlementStatus, userEntitlementStatus, consumeEventCredit, consumeUserEventCredit } from '../../../lib/entitlement'
import { slugify } from '../../../lib/slugify'

// Sentinel owner id for a personal (individual) competition — no org.
const PERSONAL = '__personal__'
import {
  COMPETITION_TYPES, COMPETITION_TYPE_ORDER,
  DEFAULT_POINTS, POINTS_PRESETS, DEFAULT_TIE_BREAKERS, defaultRulesForType,
} from '../../../lib/competitionRules'

const GENDERS    = [{ value: '', label: 'Any' }, { value: 'men', label: 'Men' }, { value: 'women', label: 'Women' }, { value: 'boys', label: 'Boys' }, { value: 'girls', label: 'Girls' }]
const AGE_GROUPS = [{ value: '', label: 'Any' }, { value: 'senior', label: 'Senior' }, { value: 'u21', label: 'U21' }, { value: 'u19', label: 'U19' }, { value: 'u18', label: 'U18' }, { value: 'u17', label: 'U17' }, { value: 'u16', label: 'U16' }, { value: 'u15', label: 'U15' }, { value: 'u14', label: 'U14' }, { value: 'u13', label: 'U13' }, { value: 'u12', label: 'U12' }]

const TYPE_ICON = { league: Trophy, tournament: ListOrdered, festival: Sparkles }

function MicroLabel({ children }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">{children}</p>
}

function Input({ label, hint, ...props }) {
  return (
    <div>
      {label && <MicroLabel>{label}</MicroLabel>}
      <input
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        {...props}
      />
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      {label && <MicroLabel>{label}</MicroLabel>}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Type comparison ───────────────────────────────────────────────────────────

const COMPARISON_ROWS = [
  ['bestFor',       'Best for'],
  ['standings',     'Standings'],
  ['knockouts',     'Knockouts'],
  ['pools',         'Pools'],
  ['rankings',      'Rankings'],
  ['shootouts',     'Shootouts'],
  ['teamSchedules', 'Team schedules'],
]

function ComparisonTable() {
  const types = COMPETITION_TYPE_ORDER.map(t => COMPETITION_TYPES[t])
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Capability</th>
            {types.map(t => (
              <th key={t.value} className="px-3 py-2.5 text-[11px] font-bold text-slate-700">{t.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map(([key, label]) => (
            <tr key={key} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2 text-[11px] font-medium text-slate-500">{label}</td>
              {types.map(t => (
                <td key={t.value} className="px-3 py-2 text-[11px] text-slate-700">{t.features[key] ?? t[key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CreateCompetition() {
  const navigate = useNavigate()
  const { orgRoles, uid, userEntitlement, isPlatformAdmin } = useAuth()
  const orgIds = useMemo(() => Object.keys(orgRoles ?? {}), [orgRoles])

  const [orgs, setOrgs]   = useState([])
  // Owner of the competition: PERSONAL (default) or an org id.
  const [ownerId, setOwnerId] = useState(PERSONAL)
  const [type, setType]   = useState('league')
  const [showCompare, setShowCompare] = useState(false)

  const [seriesName, setSeriesName] = useState('')
  const [season, setSeason] = useState(String(new Date().getFullYear()))
  const [gender, setGender] = useState('')
  const [ageGroup, setAgeGroup] = useState('')

  const [pointsKey, setPointsKey] = useState('3-1-0')
  const [customPoints, setCustomPoints] = useState({ ...DEFAULT_POINTS })

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // Resolve org names + entitlements for the selector / single-org display.
  useEffect(() => {
    let alive = true
    Promise.all(orgIds.map(id => fetchOrganization(id).catch(() => null)))
      .then(list => { if (alive) setOrgs(list.filter(Boolean)) })
    return () => { alive = false }
  }, [orgIds])

  const isPersonal = ownerId === PERSONAL
  const selectedOrg = isPersonal ? null : (orgs.find(o => o.id === ownerId) ?? null)
  // The platform master admin always has full rights — no plan required and no
  // credit is consumed. Everyone else is gated on their own / their org's plan.
  const entitlement = isPlatformAdmin
    ? { tier: 'admin', canCreate: true, credits: Infinity }
    : (isPersonal
        ? userEntitlementStatus(userEntitlement)
        : (selectedOrg ? orgEntitlementStatus(selectedOrg) : null))

  const points = pointsKey === 'custom'
    ? customPoints
    : POINTS_PRESETS.find(p => `${p.points.win}-${p.points.draw}-${p.points.loss}` === pointsKey)?.points ?? DEFAULT_POINTS

  const isDefaultPoints = points.win === DEFAULT_POINTS.win && points.draw === DEFAULT_POINTS.draw && points.loss === DEFAULT_POINTS.loss

  // The competition name is composed from the four entered variables, in order:
  // [series name] [gender] [age] [season]. Empty gender/age are skipped.
  const genderLabel = gender   ? (GENDERS.find(g => g.value === gender)?.label ?? '')      : ''
  const ageLabel    = ageGroup ? (AGE_GROUPS.find(a => a.value === ageGroup)?.label ?? '') : ''
  const previewName = [seriesName.trim(), genderLabel, ageLabel, season.trim()]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  // The slug omits the season — it is already the /competitions/:season/ URL
  // segment, so we don't repeat it: [series-name]-[gender]-[age].
  const slugBase = [seriesName.trim(), genderLabel, ageLabel].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const previewSlug = slugify(slugBase)
  const canSubmit = ownerId && seriesName.trim() && season.trim() && !saving

  async function handleCreate(e) {
    e.preventDefault()
    if (!canSubmit) return
    if (entitlement && !entitlement.canCreate) {
      setError(isPersonal
        ? 'You need an active plan to host a competition. See Plans to get started.'
        : 'Your organisation does not have an active plan to host competitions.')
      return
    }
    setSaving(true); setError('')
    try {
      const ref = await createManagedCompetition({
        seriesName: seriesName.trim(),
        name:       previewName,
        slugBase,
        season:     season.trim(),
        type,
        ...(isPersonal ? { ownerUserId: uid } : { orgId: ownerId }),
        gender:     gender || null,
        ageGroup:   ageGroup || null,
      })
      // Custom points: apply via an update so rulesHash is recomputed correctly
      // by the data layer (it never desyncs the hash this way).
      if (!isDefaultPoints) {
        const rules = defaultRulesForType(type)
        rules.points = { win: Number(points.win), draw: Number(points.draw), loss: Number(points.loss) }
        await updateManagedCompetition(ref.id, { rules }, { reason: 'Points configured at creation' })
      }
      // Decrement event credit for one-off plans (from the user or the org).
      if (entitlement?.tier === 'event') {
        if (isPersonal) await consumeUserEventCredit(uid).catch(() => {})
        else            await consumeEventCredit(ownerId).catch(() => {})
      }
      navigate(`/manage/competitions/${ref.id}`, { replace: true, state: { justCreated: true } })
    } catch (err) {
      setError(err.code === 'competition/edition-exists'
        ? `An edition of "${seriesName.trim()}" already exists for ${season.trim()}.`
        : (err.message ?? 'Could not create the competition.'))
      setSaving(false)
    }
  }

  const selectedType = COMPETITION_TYPES[type]
  const hasOrgs = orgIds.length > 0

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-lg mx-auto px-4 py-8">
        <button onClick={() => navigate('/manage/competitions')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm mb-6">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">New competition</h1>
        <p className="text-slate-500 text-sm mt-2 leading-relaxed">
          Create the competition shell. Teams, fixtures and standings come later — you can keep it in draft until it is ready.
        </p>
        <p className="text-xs text-slate-400 mt-1 mb-8">
          New to this? <Link to="/support/competitions/create-a-competition" className="text-emerald-600 hover:text-emerald-500 font-semibold">Read: Create a competition</Link>
        </p>

        <form onSubmit={handleCreate} className="space-y-8">

          {/* 1 — Type */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <MicroLabel>Competition type</MicroLabel>
              <button type="button" onClick={() => setShowCompare(v => !v)}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors">
                {showCompare ? 'Hide comparison' : 'Compare types'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {COMPETITION_TYPE_ORDER.map(t => {
                const meta = COMPETITION_TYPES[t]
                const Icon = TYPE_ICON[t]
                const active = type === t
                return (
                  <button type="button" key={t} onClick={() => setType(t)}
                    className={`p-3 rounded-xl border text-left transition-colors ${active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                    <Icon className={`w-4 h-4 mb-2 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                    <div className={`text-sm font-bold ${active ? 'text-emerald-700' : 'text-slate-700'}`}>{meta.label}</div>
                    <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{meta.bestFor}</div>
                  </button>
                )
              })}
            </div>
            <p className="text-[12px] text-slate-500 mt-3 leading-relaxed">{selectedType.summary}</p>
            {showCompare && <div className="mt-3"><ComparisonTable /></div>}
          </section>

          {/* 2 — Basic details */}
          <section className="space-y-4">
            <MicroLabel>Details</MicroLabel>

            {/* Owner — personal by default; orgs offered if the user has any */}
            {hasOrgs ? (
              <Select label="Run by" value={ownerId} onChange={setOwnerId}
                options={[
                  { value: PERSONAL, label: 'Just me (personal)' },
                  ...orgs.map(o => ({ value: o.id, label: o.name })),
                ]} />
            ) : (
              <div className="text-[12px] text-slate-500">Run by <span className="font-semibold text-slate-700">you (personal)</span></div>
            )}

            {/* Entitlement gate */}
            {entitlement && !entitlement.canCreate && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  Hosting a competition requires a Plus or Pro plan.{' '}
                  <Link to="/plans" className="font-semibold underline hover:text-amber-900">See Plans</Link>
                </p>
              </div>
            )}
            {entitlement?.tier === 'event' && entitlement.canCreate && (
              <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 text-xs text-sky-700">
                <span className="font-semibold">{entitlement.credits} event credit{entitlement.credits !== 1 ? 's' : ''} remaining.</span>{' '}
                Creating this competition will use one credit.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Select label="Gender" value={gender} onChange={setGender} options={GENDERS} />
              <Select label="Age group" value={ageGroup} onChange={setAgeGroup} options={AGE_GROUPS} />
            </div>

            <Input label="Series name" value={seriesName} onChange={e => setSeriesName(e.target.value)}
              placeholder="e.g. Premier Hockey League" required
              hint="The recurring name shared across seasons." />

            <Input label="Season" value={season} onChange={e => setSeason(e.target.value)} placeholder="2026" required />

            {previewName && (
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Will be created as</div>
                <div className="text-slate-900 text-sm font-semibold">{previewName}</div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono break-all">/competitions/{season.trim() || '…'}/{previewSlug || '…'}</div>
                <div className="text-[11px] text-slate-500 mt-1">{selectedType.label} · Draft</div>
              </div>
            )}
          </section>

          {/* 3 — Points */}
          {type !== 'festival' ? (
            <section>
              <MicroLabel>Points</MicroLabel>
              <div className="flex flex-wrap gap-2">
                {POINTS_PRESETS.map(p => {
                  const key = `${p.points.win}-${p.points.draw}-${p.points.loss}`
                  const active = pointsKey === key
                  return (
                    <button type="button" key={key} onClick={() => setPointsKey(key)}
                      className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {p.label}
                    </button>
                  )
                })}
                <button type="button" onClick={() => setPointsKey('custom')}
                  className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${pointsKey === 'custom' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  Custom
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">Win / Draw / Loss</p>

              {pointsKey === 'custom' && (
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {['win', 'draw', 'loss'].map(k => (
                    <Input key={k} label={k} type="number" min="0" max="10" value={customPoints[k]}
                      onChange={e => setCustomPoints(c => ({ ...c, [k]: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section>
              <MicroLabel>Points</MicroLabel>
              <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <p className="text-[12px] text-slate-500 leading-relaxed">Festivals have no standings or points — results are recorded for display only.</p>
              </div>
            </section>
          )}

          {/* 4 — Tie-breakers (display only at creation) */}
          {type !== 'festival' && (
            <section>
              <MicroLabel>Tie-breaker order</MicroLabel>
              <ol className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                {DEFAULT_TIE_BREAKERS.map((tb, i) => (
                  <li key={tb.key} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-5 h-5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="text-sm text-slate-700">{tb.label}</span>
                  </li>
                ))}
              </ol>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Default hockey order. This can be changed after creation, with confirmation. Alphabetical ordering is never used to decide an outcome.
              </p>
            </section>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}

          <button type="submit" disabled={!canSubmit}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors">
            {saving ? 'Creating…' : 'Create competition'}
          </button>
          <p className="text-[11px] text-slate-400 text-center">It will be created as a draft. You can edit details before publishing.</p>
        </form>
      </div>
    </div>
  )
}
