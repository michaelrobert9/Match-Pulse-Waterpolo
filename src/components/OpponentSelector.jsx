import { useRef, useState } from 'react'
import { X, Plus, ChevronDown } from 'lucide-react'
import { createManualOpponent, searchOpponents } from '../lib/adminQueries'
import { monogram } from '../lib/names'
import { CLUB_DIVISIONS, schoolTeamName, clubTeamName } from '../lib/teamNaming'

function computeOpponentName(form) {
  const org = form.orgName.trim()
  if (!org) return ''
  if (form.orgType === 'school') {
    const effectiveGender = form.orgGenderProfile !== 'coed' ? form.orgGenderProfile : form.gender
    const suffix = schoolTeamName(effectiveGender, form.teamLabel.trim(), form.orgGenderProfile)
    return `${org} ${suffix}`.replace(/\s+/g, ' ').trim()
  }
  const suffix = clubTeamName(form.division, form.teamLabel.trim() || null, null)
  return `${org} ${suffix}`.replace(/\s+/g, ' ').trim()
}

const BLANK_FORM = {
  orgType:          'school',
  orgName:          '',
  orgGenderProfile: 'coed',
  gender:           'girls',
  division:         'men',
  teamLabel:        '',
  shortCode:        '',
}

export default function OpponentSelector({ orgTeams = [], excludeTeamId, orgId, excludeOrgId, value, onChange }) {
  const [inputValue,    setInputValue]    = useState('')
  const [searchResults, setSearchResults] = useState({ teams: [], manual: [] })
  const [searching,     setSearching]     = useState(false)
  const [showCreate,    setShowCreate]    = useState(false)
  const [newForm,       setNewForm]       = useState(BLANK_FORM)
  const [creating,      setCreating]      = useState(false)
  const [allowInternal, setAllowInternal] = useState(false)
  const debounce = useRef(null)

  const availableOrgTeams = orgTeams.filter(t => t.id !== excludeTeamId)

  function handleInput(val) {
    setInputValue(val)
    setShowCreate(false)
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim() || val.trim().length < 2) {
      setSearchResults({ teams: [], manual: [] })
      setSearching(false)
      return
    }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      try {
        const res = await searchOpponents(val.trim(), { excludeOrgId: allowInternal ? undefined : excludeOrgId })
        setSearchResults({
          teams:  res.teams.filter(t => t.id !== excludeTeamId),
          manual: res.manual,
        })
      } finally { setSearching(false) }
    }, 350)
  }

  function selectTeam(team) {
    onChange({ id: team.id, displayName: team.displayName, orgName: team.orgName || null, shortCode: team.shortCode || null, primaryColor: team.primaryColor || null, organizationId: team.organizationId || null, registered: true })
  }

  function selectManual(opp) {
    onChange({ id: null, displayName: opp.name, shortCode: opp.shortCode || null, primaryColor: null, organizationId: null, manualOpponentId: opp.id, registered: false })
  }

  async function handleCreate() {
    const computedName = computeOpponentName(newForm)
    if (!computedName || !newForm.teamLabel.trim() || creating) return
    setCreating(true)
    const effectiveGender = newForm.orgType === 'school'
      ? (newForm.orgGenderProfile !== 'coed' ? newForm.orgGenderProfile : newForm.gender)
      : newForm.division
    try {
      const ref = await createManualOpponent({
        name:             computedName,
        shortCode:        newForm.shortCode || null,
        type:             newForm.orgType,
        orgName:          newForm.orgName.trim(),
        orgGenderProfile: newForm.orgType === 'school' ? newForm.orgGenderProfile : null,
        gender:           effectiveGender,
        teamLabel:        newForm.teamLabel.trim(),
        createdByOrgId:   orgId,
      })
      onChange({
        id:               null,
        displayName:      computedName,
        shortCode:        newForm.shortCode || null,
        primaryColor:     null,
        organizationId:   null,
        manualOpponentId: ref.id,
        registered:       false,
      })
      setNewForm(BLANK_FORM)
      setShowCreate(false)
    } finally { setCreating(false) }
  }

  // ── Selected state ────────────────────────────────────────────────────────
  if (value) {
    const selectedFullName = value.orgName
      ? `${value.orgName} ${value.displayName}`
      : value.displayName
    return (
      <div className="flex items-center gap-2 bg-white border border-emerald-300 rounded-lg px-3 py-2.5 shadow-sm">
        <div className="flex-1 min-w-0">
          <span className="text-slate-900 text-sm font-semibold block truncate">{selectedFullName}</span>
          <span className={`text-[9px] font-bold uppercase tracking-widest ${value.registered ? 'text-emerald-600' : 'text-sky-600'}`}>
            {value.registered ? 'MatchPulse team' : 'Manual opponent'}
          </span>
        </div>
        <button type="button" onClick={() => { onChange(null); setInputValue(''); setShowCreate(false) }}
          className="text-slate-400 hover:text-red-500 transition-colors p-1 shrink-0" aria-label="Clear selection">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const hasQuery   = inputValue.trim().length >= 2
  const hasResults = searchResults.teams.length > 0 || searchResults.manual.length > 0
  const previewName = showCreate ? computeOpponentName(newForm) : ''
  const canCreate   = previewName.length > 0 && newForm.teamLabel.trim().length > 0

  return (
    <div className="space-y-2">
      <input
        type="text" autoComplete="off"
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        placeholder="Search teams or add opponent…"
        value={inputValue}
        onChange={e => handleInput(e.target.value)}
      />

      {/* Internal fixture toggle (collapsed by default — same-org teams not shown) */}
      {!hasQuery && availableOrgTeams.length > 0 && (
        <div>
          <button type="button"
            onClick={() => setAllowInternal(v => !v)}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 mb-1.5">
            <ChevronDown className={`w-3 h-3 transition-transform ${allowInternal ? '' : '-rotate-90'}`} />
            Allow internal fixture
          </button>
          {allowInternal && (
            <div className="flex flex-wrap gap-2">
              {availableOrgTeams.map(t => {
                const fullName = t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName
                return (
                  <button type="button" key={t.id} onClick={() => selectTeam(t)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200 hover:border-amber-400 text-amber-700 hover:text-amber-900 text-xs font-medium transition-colors bg-amber-50">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.primaryColor || '#555' }} />
                    {fullName}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Search results */}
      {hasQuery && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 shadow-sm">
          {searching && (
            <div className="px-3 py-2 text-slate-500 text-xs">Searching…</div>
          )}
          {!searching && !hasResults && !showCreate && (
            <div className="px-3 py-2 text-slate-500 text-xs">No matches for "{inputValue}"</div>
          )}

          {searchResults.teams.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-3 pt-2 pb-1">MatchPulse teams</p>
              {searchResults.teams.map(t => {
                const fullName = t.orgName ? `${t.orgName} ${t.displayName}` : t.displayName
                return (
                  <button type="button" key={t.id} onClick={() => selectTeam(t)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors text-left">
                    <div className="w-6 h-6 rounded shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: (t.primaryColor || '#555') + '20', border: `1.5px solid ${t.primaryColor || '#555'}` }}>
                      <span className="text-[8px] font-bold" style={{ color: t.primaryColor || '#555' }}>{monogram(fullName)}</span>
                    </div>
                    <span className="flex-1 text-slate-900 text-xs font-semibold truncate">{fullName}</span>
                    <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-widest shrink-0">registered</span>
                  </button>
                )
              })}
            </div>
          )}

          {searchResults.manual.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-3 pt-2 pb-1">Previous opponents</p>
              {searchResults.manual.map(m => (
                <button type="button" key={m.id} onClick={() => selectManual(m)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors text-left">
                  <div className="w-6 h-6 rounded shrink-0 flex items-center justify-center bg-sky-50 border border-sky-200">
                    <span className="text-[8px] font-bold text-sky-600">{monogram(m.name)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-900 text-xs font-semibold truncate">{m.name}</div>
                    {m.type && m.type !== 'unknown' && <div className="text-[9px] text-slate-500 capitalize">{m.type}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!showCreate && (
            <button type="button"
              onClick={() => { setShowCreate(true); setNewForm(f => ({ ...f, orgName: inputValue.trim() })) }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left">
              <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="text-emerald-600 text-xs font-semibold">Add new opponent…</span>
            </button>
          )}
        </div>
      )}

      {/* ── Structured opponent creation panel ────────────────────────────────
           Intentionally a <div>, NOT a <form>. Nesting a <form> inside the outer
           fixture creation <form> is invalid HTML. Use type="button" + onClick. */}
      {showCreate && (
        <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-3 space-y-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-sky-600">New opponent</p>

          {/* Org type */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Type</label>
            <div className="flex gap-2">
              {[{ v: 'school', label: 'School' }, { v: 'club', label: 'Club' }].map(o => (
                <button type="button" key={o.v} onClick={() => setNewForm(f => ({ ...f, orgType: o.v }))}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg border transition-colors ${
                    newForm.orgType === o.v ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Org name */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              {newForm.orgType === 'school' ? 'School name' : 'Club name'}
            </label>
            <input
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-sky-500 transition-colors"
              value={newForm.orgName}
              placeholder={newForm.orgType === 'school' ? 'e.g. Westville Boys High' : 'e.g. Durban HC'}
              onChange={e => setNewForm(f => ({ ...f, orgName: e.target.value }))}
            />
          </div>

          {/* School: gender profile */}
          {newForm.orgType === 'school' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">School gender</label>
              <div className="flex gap-1.5 flex-wrap">
                {[{ v: 'boys', label: 'Boys only' }, { v: 'girls', label: 'Girls only' }, { v: 'coed', label: 'Co-ed' }].map(o => (
                  <button type="button" key={o.v} onClick={() => setNewForm(f => ({ ...f, orgGenderProfile: o.v }))}
                    className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-colors ${
                      newForm.orgGenderProfile === o.v ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Co-ed school: team gender */}
          {newForm.orgType === 'school' && newForm.orgGenderProfile === 'coed' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Team gender</label>
              <div className="flex gap-2">
                {[{ v: 'boys', label: 'Boys' }, { v: 'girls', label: 'Girls' }].map(o => (
                  <button type="button" key={o.v} onClick={() => setNewForm(f => ({ ...f, gender: o.v }))}
                    className={`flex-1 text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg border transition-colors ${
                      newForm.gender === o.v ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Club: division */}
          {newForm.orgType === 'club' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Division</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-sky-500 transition-colors"
                value={newForm.division}
                onChange={e => setNewForm(f => ({ ...f, division: e.target.value }))}>
                {CLUB_DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          )}

          {/* Team label */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">Team</label>
            <input
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-sky-500 transition-colors"
              value={newForm.teamLabel}
              placeholder="e.g. 1st Team, U16A"
              onChange={e => setNewForm(f => ({ ...f, teamLabel: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
            />
          </div>

          {/* Short code */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Short code <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
            </label>
            <input
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-sky-500 transition-colors"
              placeholder="e.g. WBH" value={newForm.shortCode} maxLength={6}
              onChange={e => setNewForm(f => ({ ...f, shortCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
            />
          </div>

          {/* Name preview */}
          {previewName && (
            <div className="bg-white border border-sky-200 rounded-lg px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500 mb-0.5">Preview</p>
              <p className="text-slate-900 text-sm font-semibold">{previewName}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={creating || !canCreate}
              className="flex-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg py-2 transition-colors">
              {creating ? 'Adding…' : 'Add opponent'}
            </button>
            <button type="button" onClick={() => { setShowCreate(false); setNewForm(BLANK_FORM) }}
              className="px-3 py-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 text-xs font-medium transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
