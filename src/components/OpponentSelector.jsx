import { useRef, useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { searchOpponents } from '../lib/adminQueries'
import { monogram } from '../lib/names'
import { composeTeamDisplay } from '../lib/teamNaming'

// Opponent picker — REGISTERED teams only.
//
// A match opponent must be a team that already exists on MatchPulse. There is
// deliberately no "type a name to add an unregistered opponent" path: that
// created duplicate, unlinkable junk teams with no logo or page. To play a team
// that isn't on MatchPulse yet, register its organisation first, then pick it
// here.
export default function OpponentSelector({ orgTeams = [], excludeTeamId, excludeOrgId, value, onChange }) {
  const [inputValue,    setInputValue]    = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)
  const [allowInternal, setAllowInternal] = useState(false)
  const debounce = useRef(null)

  const availableOrgTeams = orgTeams.filter(t => t.id !== excludeTeamId)

  function handleInput(val) {
    setInputValue(val)
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim() || val.trim().length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      try {
        // Only registered MatchPulse teams — the manual/name-only results are no
        // longer offered.
        const res = await searchOpponents(val.trim(), { excludeOrgId: allowInternal ? undefined : excludeOrgId })
        setSearchResults((res.teams ?? []).filter(t => t.id !== excludeTeamId))
      } finally { setSearching(false) }
    }, 350)
  }

  function selectTeam(team) {
    onChange({ id: team.id, displayName: team.displayName, orgName: team.orgName || null, primaryColor: team.primaryColor || null, organizationId: team.organizationId || null, registered: true })
  }

  // ── Selected state ────────────────────────────────────────────────────────
  if (value) {
    const selectedFullName = value.orgName
      ? composeTeamDisplay(value.orgName, value.displayName)
      : value.displayName
    return (
      <div className="flex items-center gap-2 bg-white border border-emerald-300 rounded-lg px-3 py-2.5 shadow-sm">
        <div className="flex-1 min-w-0">
          <span className="text-slate-900 text-sm font-semibold block truncate">{selectedFullName}</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600">MatchPulse team</span>
        </div>
        <button type="button" onClick={() => { onChange(null); setInputValue('') }}
          className="text-slate-400 hover:text-red-500 transition-colors p-1 shrink-0" aria-label="Clear selection">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const hasQuery   = inputValue.trim().length >= 2
  const hasResults = searchResults.length > 0

  return (
    <div className="space-y-2">
      <input
        type="text" autoComplete="off"
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        placeholder="Search registered teams…"
        value={inputValue}
        onChange={e => handleInput(e.target.value)}
      />

      {/* Internal fixture toggle (collapsed by default — same-org teams not shown).
          These are the org's own REGISTERED teams. */}
      {!hasQuery && availableOrgTeams.length > 0 && (
        <div>
          <button type="button"
            onClick={() => setAllowInternal(v => !v)}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 mb-1.5">
            <ChevronDown className={`w-3 h-3 transition-transform ${allowInternal ? '' : '-rotate-90'}`} />
            Allow internal match
          </button>
          {allowInternal && (
            <div className="flex flex-wrap gap-2">
              {availableOrgTeams.map(t => {
                const fullName = composeTeamDisplay(t.teamName || t.orgName, t.displayName)
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

      {/* Search results — registered teams only */}
      {hasQuery && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 shadow-sm">
          {searching && (
            <div className="px-3 py-2 text-slate-500 text-xs">Searching…</div>
          )}
          {!searching && !hasResults && (
            <div className="px-3 py-3 text-slate-500 text-xs leading-relaxed">
              No registered team matches “{inputValue}”. Only teams already on MatchPulse can be
              picked — if the team isn’t here yet, register its organisation first, then come back.
            </div>
          )}

          {hasResults && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-3 pt-2 pb-1">MatchPulse teams</p>
              {searchResults.map(t => {
                const fullName = composeTeamDisplay(t.teamName || t.orgName, t.displayName)
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
        </div>
      )}
    </div>
  )
}
