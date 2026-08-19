import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, X, Plus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, getDocs, doc, getDoc, orderBy, query, where } from 'firebase/firestore'
import { fetchOrganizations, fetchAllPeople } from '../../lib/queries'
import { db } from '../../firebase'
import { createPerson, updatePerson, adminLinkProfileToUser, isProfileClaimed, fetchProfileReports, mergePeople, previewMergePeople } from '../../lib/adminQueries'
import { deleteDoc } from 'firebase/firestore'

const POSITIONS = ['GK', 'Def', 'Mid', 'Fwd']

const AVAILABLE_ROLES = [
  { value: 'player', label: 'Player' },
  { value: 'admin',  label: 'Administrator' },
]

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

function PersonForm({ initial = {}, onSave, onDelete, saving }) {
  const [form, setForm] = useState({
    fullName: '', dateOfBirth: '', nationality: 'South African',
    position: 'Mid', photoUrl: '', roles: [],
    representativeOrgs: [], ...initial,
  })
  const [allOrgs, setAllOrgs]   = useState([])
  const [orgQuery, setOrgQuery] = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'organizations'), orderBy('name')))
      .then(snap => setAllOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function addOrg(org) {
    setForm(f => {
      const already = (f.representativeOrgs ?? []).some(o => o.orgId === org.id)
      if (already) return f
      return { ...f, representativeOrgs: [...(f.representativeOrgs ?? []), { orgId: org.id, orgName: org.name }] }
    })
    setOrgQuery('')
  }

  function removeOrg(orgId) {
    setForm(f => ({ ...f, representativeOrgs: (f.representativeOrgs ?? []).filter(o => o.orgId !== orgId) }))
  }

  function handleSave(e) {
    e.preventDefault()
    const repOrgs = form.representativeOrgs ?? []
    onSave({
      ...form,
      representativeOrgs: repOrgs,
      representativeOrgIds: repOrgs.map(o => o.orgId),
    })
  }

  const filteredOrgs = orgQuery.trim()
    ? allOrgs.filter(o =>
        o.name.toLowerCase().includes(orgQuery.toLowerCase()) &&
        !(form.representativeOrgs ?? []).some(r => r.orgId === o.id)
      )
    : []

  const initials = form.fullName
    .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <form onSubmit={handleSave} className="space-y-4 px-4 py-5">
      <Field label="Full name">
        <Input value={form.fullName} onChange={e => set('fullName', e.target.value)}
          placeholder="Tyrone van der Merwe" required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth">
          <Input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
        </Field>
        <Field label="Position">
          <select
            value={form.position}
            onChange={e => set('position', e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-500"
          >
            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Nationality">
        <Input value={form.nationality} onChange={e => set('nationality', e.target.value)}
          placeholder="South African" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="SAHA number (optional)">
          <Input value={form.sahaNumber ?? ''} onChange={e => set('sahaNumber', e.target.value)}
            placeholder="e.g. SA-12345" />
        </Field>
        <Field label="Photo URL (optional)">
          <Input value={form.photoUrl} onChange={e => set('photoUrl', e.target.value)}
            placeholder="https://…" type="url" />
        </Field>
      </div>

      {/* Roles */}
      <Field label="Roles">
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-0.5">
          {AVAILABLE_ROLES.map(r => (
            <label key={r.value} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={(form.roles ?? []).includes(r.value)}
                onChange={e => set('roles', e.target.checked
                  ? [...(form.roles ?? []), r.value]
                  : (form.roles ?? []).filter(v => v !== r.value)
                )}
                className="w-3.5 h-3.5 accent-emerald-600"
              />
              <span className="text-sm text-slate-700">{r.label}</span>
            </label>
          ))}
        </div>
      </Field>

      {/* Representative organisations */}
      <Field label="Representative organisations">
        <div className="space-y-2">
          {(form.representativeOrgs ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(form.representativeOrgs ?? []).map(o => (
                <span key={o.orgId}
                  className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-full pl-3 pr-1.5 py-1 text-xs font-medium text-slate-700">
                  {o.orgName}
                  <button type="button" onClick={() => removeOrg(o.orgId)}
                    className="text-slate-400 hover:text-red-500 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Input
              value={orgQuery}
              onChange={e => setOrgQuery(e.target.value)}
              placeholder="Search organisations to add…"
            />
            {filteredOrgs.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                {filteredOrgs.slice(0, 8).map(org => (
                  <li key={org.id}>
                    <button type="button" onClick={() => addOrg(org)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 text-left text-sm">
                      <Plus className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="flex-1 text-slate-800 truncate">{org.name}</span>
                      <span className="text-[10px] text-slate-400 capitalize shrink-0">{org.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Field>

      {/* Preview */}
      <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3 border border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
          {form.photoUrl
            ? <img src={form.photoUrl} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none' }} />
            : <span className="text-xs font-bold font-mono text-slate-500">{initials || '?'}</span>
          }
        </div>
        <div>
          <div className="text-slate-900 text-sm font-semibold">{form.fullName || 'Player name'}</div>
          <div className="micro-label">{form.position} · {form.nationality}</div>
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

export function PeopleList() {
  // Two ways to browse the ONE central player list: a flat A–Z roster, or
  // grouped by the school / club / association each player represents, drilling
  // down org → season → team → player (the categorised view §Player-DB request).
  const [view, setView] = useState('all')

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-slate-900 text-lg">People</h1>
        <Link to="/admin/people/new"
          className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors">
          + New
        </Link>
      </div>

      <div className="flex gap-1 mb-4 bg-slate-100 rounded-xl p-1 w-fit">
        {[['all', 'All players'], ['org', 'By organisation']].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={`text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-1.5 transition-colors ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'all' ? <PeopleFlatList /> : <PeopleByOrg />}
    </div>
  )
}

function PeopleFlatList() {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'people'), orderBy('fullName')))
      .then(snap => setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.claimStatus !== 'merged')))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>

  if (people.length === 0) return (
    <div className="text-center py-12">
      <p className="text-slate-500 text-sm mb-4">No people yet.</p>
      <Link to="/admin/people/new" className="text-emerald-600 text-sm hover:underline">Add the first one →</Link>
    </div>
  )

  return (
    <div className="space-y-2">
      {people.map(person => {
        const initials = person.fullName
          .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
        return (
          <Link key={person.id} to={`/admin/people/${person.id}`}
            className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
              {person.photoUrl
                ? <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-[10px] font-bold font-mono text-slate-500">{initials}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-slate-900 text-sm font-semibold truncate">{person.fullName}</div>
              <div className="micro-label">{person.position} · {person.nationality}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-emerald-600 font-mono font-bold text-sm">{person.careerCaps ?? 0}</div>
              <div className="micro-label">caps</div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
          </Link>
        )
      })}
    </div>
  )
}

// ── Grouped-by-organisation browser ─────────────────────────────────────────
// Schools / Clubs / Associations → org → season → team → the players who turned
// out for that team that season. The org list and per-org "linked" counts load
// up front (cheap); each org's season/team/player tree is lazy-loaded from its
// stat slices only when the org is expanded.

const ORG_TYPE_SECTIONS = [
  { key: 'school', label: 'Schools' },
  { key: 'club', label: 'Clubs' },
  { key: 'association', label: 'Associations' },
  { key: 'other', label: 'Other' },
]

function PeopleByOrg() {
  const [orgs, setOrgs] = useState(null)
  const [counts, setCounts] = useState({})

  useEffect(() => {
    Promise.all([fetchOrganizations(), fetchAllPeople()])
      .then(([o, people]) => {
        const c = {}
        for (const p of people)
          for (const id of (p.representativeOrgIds ?? [])) c[id] = (c[id] ?? 0) + 1
        setCounts(c)
        setOrgs(o)
      })
      .catch(() => setOrgs([]))
  }, [])

  if (orgs === null) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>
  if (orgs.length === 0) return <p className="text-slate-500 text-sm py-8 text-center">No organisations yet.</p>

  const byType = { school: [], club: [], association: [], other: [] }
  for (const o of orgs) (byType[o.type] ?? byType.other).push(o)

  return (
    <div className="space-y-6">
      {ORG_TYPE_SECTIONS.map(sec => {
        const list = byType[sec.key] ?? []
        if (!list.length) return null
        return (
          <div key={sec.key}>
            <h2 className="micro-label mb-2">{sec.label} · {list.length}</h2>
            <div className="space-y-1.5">
              {list.map(o => <OrgNode key={o.id} org={o} linkedCount={counts[o.id] ?? 0} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OrgNode({ org, linkedCount }) {
  const [open, setOpen] = useState(false)
  const [tree, setTree] = useState(null)   // null = not loaded yet

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || tree !== null) return
    try {
      const [sliceSnap, teamSnap] = await Promise.all([
        getDocs(query(collection(db, 'players'), where('organizationId', '==', org.id))),
        getDocs(query(collection(db, 'teams'), where('organizationId', '==', org.id))),
      ])
      const teamNames = {}
      teamSnap.docs.forEach(d => { teamNames[d.id] = d.data().displayName ?? d.data().teamName ?? null })
      // season → teamId → { name, players: Map(personId → personName) }
      const years = {}
      for (const d of sliceSnap.docs) {
        const s = d.data()
        if (!s.personId) continue
        const year = String(s.season || s.competitionSeason || '').trim() || 'Undated'
        const teamId = s.teamId || 'none'
        ;(years[year] ??= {})
        ;(years[year][teamId] ??= { name: teamNames[teamId] || s.teamDisplayName || 'Team', players: new Map() })
        if (!years[year][teamId].players.has(s.personId))
          years[year][teamId].players.set(s.personId, s.personName || 'Unknown')
      }
      setTree(years)
    } catch { setTree({}) }
  }

  const yearKeys = tree ? Object.keys(tree).sort((a, b) => b.localeCompare(a)) : []

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
        <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-left text-sm font-semibold text-slate-900 truncate">{org.name}</span>
        <span className="micro-label shrink-0">{linkedCount} linked</span>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-slate-100">
          {tree === null ? (
            <div className="py-3 text-slate-400 text-xs">Loading…</div>
          ) : yearKeys.length === 0 ? (
            <div className="py-3 text-slate-400 text-xs">No team records yet.</div>
          ) : yearKeys.map(year => (
            <div key={year} className="mt-3">
              <div className="micro-label text-slate-500 mb-1">{year}</div>
              {Object.entries(tree[year]).map(([teamId, t]) => (
                <div key={teamId} className="mb-2 pl-2 border-l-2 border-slate-100">
                  <div className="text-[13px] font-semibold text-slate-700 mb-1">{t.name}</div>
                  <div className="space-y-0.5">
                    {[...t.players.entries()]
                      .sort((a, b) => (a[1] || '').localeCompare(b[1] || ''))
                      .map(([pid, pname]) => (
                        <Link key={pid} to={`/admin/people/${pid}`}
                          className="block text-[13px] text-emerald-700 hover:text-emerald-800 hover:underline truncate">
                          {pname}
                        </Link>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Create ─────────────────────────────────────────────────────────────────

export function NewPerson() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  async function handleSave(form) {
    setSaving(true)
    try {
      await createPerson(form)
      navigate('/admin/people')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 border-b border-slate-200">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-900">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-slate-900 text-lg">New Person</h1>
      </div>
      <PersonForm onSave={handleSave} saving={saving} />
    </div>
  )
}

// ── Edit ───────────────────────────────────────────────────────────────────

export function EditPerson() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [person, setPerson] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'people', id)).then(snap => {
      if (snap.exists()) setPerson({ id: snap.id, ...snap.data() })
    })
  }, [id])

  async function handleSave(form) {
    setSaving(true)
    try { await updatePerson(id, form); navigate('/admin/people') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm('Delete this person? This cannot be undone.')) return
    await deleteDoc(doc(db, 'people', id))
    navigate('/admin/people')
  }

  if (!person) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div>
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 border-b border-slate-200">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-900">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-slate-900 text-lg truncate">{person.fullName}</h1>
      </div>
      <PersonForm initial={person} onSave={handleSave} onDelete={handleDelete} saving={saving} />
      <LinkUserSection person={person} onLinked={patch => setPerson(p => ({ ...p, ...patch }))} />
      <MergeSection person={person} />
      <ProfileReportsSection personId={person.id} />
    </div>
  )
}

// "This isn't me" reports filed against this profile (no account needed to
// file one) — surfaced here so a wrong claim gets acted on.
function ProfileReportsSection({ personId }) {
  const [reports, setReports] = useState(null)

  useEffect(() => {
    fetchProfileReports(personId).then(setReports).catch(() => setReports([]))
  }, [personId])

  if (!reports?.length) return null

  return (
    <div className="px-4 pb-8">
      <div className="bg-white rounded-xl border border-red-200 p-4">
        <div className="text-sm font-bold text-slate-900 mb-2">
          Profile reports <span className="text-red-600">({reports.length})</span>
        </div>
        <div className="space-y-2">
          {reports.map(r => (
            <div key={r.id} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
              <p className="text-[12px] text-slate-700 leading-relaxed">{r.message || '(no message)'}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {r.contact && <>Contact: {r.contact} · </>}
                {r.reporterUid ? `uid ${r.reporterUid}` : 'anonymous'}
                {r.createdAt?.toDate && <> · {r.createdAt.toDate().toLocaleDateString('en-ZA')}</>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Master-admin recovery tool: link a user account to this profile as the player
// (owner), a parent (guardian) or a manager. Works even if already claimed — the
// fix for lost/changed emails and mis-claims.
// Master-admin merge: fold a DUPLICATE record (source) into this one (target).
// All of the duplicate's matches, goals and stat slices repoint to this profile,
// its org links are unioned in, and the duplicate is retired. Shown with a
// preview of what will move before it commits.
function MergeSection({ person }) {
  const navigate = useNavigate()
  const [people, setPeople]   = useState(null)
  const [q, setQ]             = useState('')
  const [dup, setDup]         = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')

  async function loadPeople() {
    if (people !== null) return
    const snap = await getDocs(query(collection(db, 'people'), orderBy('fullName')))
    setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.id !== person.id && p.claimStatus !== 'merged'))
  }
  async function choose(p) {
    setDup(p); setErr(''); setPreview(null)
    try { setPreview(await previewMergePeople(p.id, person.id)) }
    catch (e) { setErr(e.message || 'Could not preview.') }
  }
  async function confirmMerge() {
    if (!dup) return
    if (!confirm(`Merge "${dup.fullName}" into "${person.fullName}"? The duplicate's matches, goals and stats move to ${person.fullName}, and "${dup.fullName}" is retired. This can't be auto-undone.`)) return
    setBusy(true); setErr('')
    try { await mergePeople(dup.id, person.id); navigate(0) }
    catch (e) { setErr(e.message || 'Merge failed.'); setBusy(false) }
  }

  const matches = (people ?? []).filter(p => q.trim() && (p.fullName || '').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)

  return (
    <div className="px-4 py-4 border-t border-slate-200">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Merge a duplicate into this player</h2>
      <p className="text-[12px] text-slate-500 mb-3">If the system made a second record for {person.fullName}, fold it in here — its matches, goals and stats all move onto this profile.</p>
      {dup ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-slate-900">Merge <span className="text-amber-700">{dup.fullName}</span> → {person.fullName}</div>
          {preview
            ? <p className="text-[12px] text-slate-600 mt-1">{preview.matchCount} match{preview.matchCount === 1 ? '' : 'es'} · {preview.sliceCount} stat record{preview.sliceCount === 1 ? '' : 's'} will move.</p>
            : !err && <p className="text-[12px] text-slate-400 mt-1">Checking…</p>}
          {err && <p className="text-red-600 text-sm mt-1">{err}</p>}
          <div className="flex gap-2 mt-3">
            <button disabled={busy} onClick={confirmMerge}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-3 py-2">
              {busy ? 'Merging…' : 'Merge'}
            </button>
            <button onClick={() => { setDup(null); setPreview(null); setErr('') }}
              className="text-slate-500 text-[11px] font-bold uppercase tracking-widest px-3 py-2">Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <input value={q} onFocus={loadPeople} onChange={e => { setQ(e.target.value); loadPeople() }}
            placeholder="Search the duplicate's name…"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          {q.trim() && (
            <div className="mt-1 space-y-1">
              {matches.length === 0
                ? <p className="text-slate-400 text-xs py-1">No match.</p>
                : matches.map(p => (
                  <button key={p.id} onClick={() => choose(p)}
                    className="w-full text-left text-sm text-slate-700 hover:bg-slate-50 rounded-lg px-2 py-1.5">
                    {p.fullName}{p.claimStatus === 'unclaimed' ? ' · unclaimed' : ''}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LinkUserSection({ person, onLinked }) {
  const [email, setEmail] = useState('')
  const [rel,   setRel]   = useState('player')
  const [busy,  setBusy]  = useState(false)
  const [msg,   setMsg]   = useState('')
  const [err,   setErr]   = useState('')

  async function link() {
    if (!email.trim()) return
    setBusy(true); setMsg(''); setErr('')
    try {
      const res = await adminLinkProfileToUser(person.id, email.trim(), rel)
      const patch = rel === 'player' ? { ownerUid: res.userId }
        : rel === 'parent' ? { guardianUids: [...(person.guardianUids ?? []), res.userId] }
        : { managerUids: [...(person.managerUids ?? []), res.userId] }
      onLinked(patch)
      setMsg(`Linked ${res.email} as ${rel}.`)
      setEmail('')
    } catch (e) {
      setErr(e.message || 'Could not link that account.')
    } finally { setBusy(false) }
  }

  return (
    <div className="px-4 pb-8">
      <div className="bg-white rounded-xl border border-amber-200 p-4">
        <div className="text-sm font-bold text-slate-900 mb-1">Link a user to this profile</div>
        <p className="text-[12px] text-slate-500 leading-relaxed mb-3">
          Assign an account as the player (owner), a parent (guardian) or a manager — the recovery path
          for a lost/changed email or a mis-claim. The person must already have a MatchPulse account.
          {' '}Currently {isProfileClaimed(person)
            ? <span className="text-emerald-700 font-semibold">claimed</span>
            : <span className="text-slate-500 font-semibold">unclaimed</span>}.
        </p>
        <div className="flex flex-wrap gap-2">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="flex-1 min-w-[180px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm placeholder-slate-400" />
          <select value={rel} onChange={e => setRel(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
            <option value="player">Player (owner)</option>
            <option value="parent">Parent (guardian)</option>
            <option value="manager">Manager</option>
          </select>
          <button onClick={link} disabled={busy || !email.trim()}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-widest rounded-lg px-4 py-2">
            {busy ? 'Linking…' : 'Link'}
          </button>
        </div>
        {msg && <p className="text-emerald-600 text-xs mt-2">{msg}</p>}
        {err && <p className="text-red-600 text-xs mt-2">{err}</p>}
      </div>
    </div>
  )
}
