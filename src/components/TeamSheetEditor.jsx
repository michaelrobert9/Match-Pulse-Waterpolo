import { useEffect, useMemo, useState } from 'react'
import { X, Plus, AlertTriangle, Link2 } from 'lucide-react'
import { fetchAllPeople } from '../lib/queries'
import {
  saveCompetitionTeamSheet, fetchCompetitionTeamSheet, createTeamSheetPerson,
  saveFixtureLineup,
} from '../lib/adminQueries'
import {
  parseTeamSheet, applyNumbersMode, matchRowToPeople,
  duplicateCapNumbers, duplicateNames, nextUnusedCap, splitName,
} from '../lib/teamSheet'

// Team sheet editor (bulk team sheets brief §5–§8). Paste once, review the
// grid, confirm. Nothing writes to the database until the user confirms; the
// grid is the whole safety net.
//
// Two destinations (team-sheets-everywhere §3):
//   • competition squad  — tournaments & festivals: pass competitionId + team,
//     fixtures inherit it (default).
//   • fixture line-up     — leagues & standalone fixtures: pass matchId + side,
//     the confirmed grid writes straight to that fixture's line-up. The box
//     opens EMPTY every time (no prefill, no "same as last week" — §7).

const STAFF_ROLES = ['Coach', 'Manager']

const PLACEHOLDER = '1. Sarah Botha\n2. Amahle Dlamini'

let rowKeyCounter = 0
const newRowKey = () => `tsrow-${++rowKeyCounter}`

function StatusChip({ row }) {
  if (row.unreadable) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      <AlertTriangle className="w-3 h-3" /> Check
    </span>
  )
  if (row.matchStatus === 'linked') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
      <Link2 className="w-3 h-3" /> Linked
    </span>
  )
  if (row.matchStatus === 'ambiguous') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      Choose
    </span>
  )
  return (
    <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
      New
    </span>
  )
}

export default function TeamSheetEditor({ competitionId, team, matchId = null, side = null, onClose, onSaved }) {
  const fixtureTarget = !!matchId
  const [phase, setPhase]     = useState('loading') // loading | error | paste | grid
  const [loadError, setLoadError] = useState('')
  const [people, setPeople]   = useState([])
  const [pasteText, setPasteText] = useState('')
  const [rows, setRows]       = useState([])
  const [staff, setStaff]     = useState([])
  const [numbersAreCaps, setNumbersAreCaps] = useState(true)
  const [hadExisting, setHadExisting] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => { load() }, [competitionId, team.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setPhase('loading')
    setLoadError('')
    try {
      // Fixture-line-up target (leagues & standalone, §3): the grid opens EMPTY
      // every time — no squad prefill, no repeat shortcut (§7). We still load
      // people so pasted names can match existing profiles.
      if (fixtureTarget) {
        setPeople(await fetchAllPeople().catch(() => []))
        setPhase('grid')
        return
      }
      const [sheet, allPeople] = await Promise.all([
        fetchCompetitionTeamSheet(competitionId, team.id),
        fetchAllPeople().catch(() => []),
      ])
      setPeople(allPeople)
      setStaff(sheet.staff ?? [])
      if ((sheet.squad ?? []).length > 0) {
        setRows(sheet.squad.map(s => {
          const { firstName, lastName } = splitName(s.playerName ?? '')
          return {
            key: newRowKey(), firstName, surname: lastName,
            capNumber: s.capNumber ?? null, capEdited: true, parsedNumber: s.capNumber ?? null,
            isCaptain: s.isCaptain === true, unreadable: false,
            matchStatus: 'linked', personId: s.playerId, candidates: [], chosen: s.playerId,
          }
        }))
        setHadExisting(true)
      }
      setPhase('grid')
    } catch (err) {
      setLoadError(err.message || 'Could not load the team sheet.')
      setPhase('error')
    }
  }

  function matchRow(row, peopleList) {
    const m = matchRowToPeople(row, peopleList, { competitionId })
    return {
      ...row,
      matchStatus: m.status,
      personId: m.status === 'linked' ? m.personId : null,
      candidates: m.candidates,
      // A confident match links by default (person id); a genuinely new name
      // creates a profile ('new'); an ambiguous row is left UNRESOLVED ('') so
      // the user must pick — the confirm gate blocks until they do, which is
      // what stops a silent duplicate.
      chosen: m.status === 'linked' ? m.personId
        : m.status === 'ambiguous' ? ''
        : 'new',
    }
  }

  // The paste box stays at the top of the screen (netball canonical layout):
  // reading into an empty grid populates it and guesses the interpretation;
  // reading with rows already present APPENDS, following the sheet's current
  // interpretation — a two-line late addition carries no signal of its own.
  function readSheet() {
    const { rows: parsed, numbersAreCaps: caps } = parseTeamSheet(pasteText)
    if (parsed.length === 0) return
    if (rows.length === 0) {
      setNumbersAreCaps(caps)
      setRows(parsed.map(r => matchRow({ ...r, key: newRowKey(), capEdited: false }, people)))
    } else {
      const interpreted = applyNumbersMode(parsed, numbersAreCaps)
      setRows(prev => [...prev, ...interpreted.map(r => matchRow({ ...r, key: newRowKey(), capEdited: false }, people))])
    }
    setPasteText('')
  }

  function flipNumbersMode(caps) {
    // Re-interprets numbers only — name edits already made in the grid survive
    // (§5: flipping re-parses instantly without discarding edits).
    setNumbersAreCaps(caps)
    setRows(prev => applyNumbersMode(prev, caps))
  }

  function patchRow(key, patch, rematch = false) {
    setRows(prev => prev.map(r => {
      if (r.key !== key) return r
      const next = { ...r, ...patch, unreadable: false }
      return rematch ? matchRow(next, people) : next
    }))
  }

  function removeRow(key) {
    setRows(prev => prev.filter(r => r.key !== key))
  }

  function addRow() {
    setRows(prev => [...prev, {
      key: newRowKey(), firstName: '', surname: '',
      capNumber: nextUnusedCap(prev), capEdited: true, parsedNumber: null,
      isCaptain: false, unreadable: false,
      matchStatus: 'new', personId: null, candidates: [], chosen: 'new',
    }])
  }

  // Ambiguous rows sort to the top, then by cap number, blanks last (§7).
  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const aAmb = a.matchStatus === 'ambiguous' ? 0 : 1
    const bAmb = b.matchStatus === 'ambiguous' ? 0 : 1
    if (aAmb !== bAmb) return aAmb - bAmb
    const an = a.capNumber, bn = b.capNumber
    if (an != null && bn != null) return an - bn
    if (an != null) return -1
    if (bn != null) return 1
    return 0
  }), [rows])

  const dupCaps  = useMemo(() => duplicateCapNumbers(rows), [rows])
  const dupNames = useMemo(() => duplicateNames(rows), [rows])
  const readCapsMax = useMemo(() => {
    const caps = rows.map(r => r.capNumber).filter(n => n != null)
    return caps.length ? Math.max(...caps) : null
  }, [rows])
  const newCount = rows.filter(r => r.chosen === 'new' && `${r.firstName}${r.surname}`.trim()).length
  // An ambiguous row with no choice made yet blocks the save (§6): the user
  // must say who it is (or "Create new player") before we write anything.
  const unresolved = rows.filter(r => r.matchStatus === 'ambiguous' && !r.chosen).length

  async function handleConfirm() {
    setSaving(true)
    setSaveError('')
    try {
      const photoById = new Map(people.map(p => [p.id, p.photoUrl ?? null]))
      const usable = rows.filter(r => `${r.firstName} ${r.surname}`.trim())
      const squad = []
      for (const r of usable) {
        const fullName = `${r.firstName} ${r.surname}`.trim().replace(/\s+/g, ' ')
        let playerId = r.chosen
        if (playerId === 'new' || !playerId) {
          // OWNERLESS creation (addendum Part A): no manager, no consent
          // record, no relationship asserted between the confirmer and the
          // player. Claimable later by the player (or a parent).
          const ref = await createTeamSheetPerson(
            { firstName: r.firstName, lastName: r.surname, fullName }, competitionId, team.id)
          playerId = ref.id
        }
        squad.push({
          playerId,
          playerName: fullName,   // squad-entry display name (closing round item 2)
          capNumber: r.capNumber ?? null,
          isCaptain: r.isCaptain === true,
          photoUrl: photoById.get(playerId) ?? null,
        })
      }
      if (fixtureTarget) {
        // Write straight to this fixture's line-up for the side (§3). Replaces
        // that side wholesale; no competition squad, no staff store.
        await saveFixtureLineup(matchId, side, squad)
        onSaved?.({ squad })
      } else {
        const cleanStaff = staff
          .map(s => ({ role: s.role, name: (s.name ?? '').trim() }))
          .filter(s => s.name)
        await saveCompetitionTeamSheet(competitionId, team.id, { squad, staff: cleanStaff })
        onSaved?.({ squad, staff: cleanStaff })
      }
      onClose()
    } catch (err) {
      setSaveError(err.message || 'Could not save the team sheet. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDisabled = saving || rows.length === 0 || unresolved > 0

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-stretch sm:items-center justify-center">
      <div className="bg-canvas w-full sm:max-w-2xl sm:rounded-2xl sm:my-8 flex flex-col max-h-full sm:max-h-[90dvh] overflow-hidden">

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{fixtureTarget ? 'Fixture line-up' : 'Team sheet'}</div>
            <div className="font-display font-bold text-slate-900 truncate">
              {team.orgName ? `${team.orgName} ${team.displayName}` : team.displayName}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-slate-400 hover:text-slate-700 transition-colors p-2 -mr-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {phase === 'loading' && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-11 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          )}

          {phase === 'error' && (
            <div className="text-center py-8">
              <p className="text-sm text-slate-600 mb-3">{loadError}</p>
              <button onClick={load}
                className="text-sm font-bold text-emerald-700 hover:text-emerald-600 transition-colors">
                Try again
              </button>
            </div>
          )}

          {phase === 'grid' && (
            <>
              {/* Paste box — always at the top of the screen (netball
                  canonical layout). Reading into an empty grid populates it;
                  reading again appends a late addition. */}
              <div className="space-y-2">
                {/* How the paste is interpreted — a short, always-visible guide so the
                    coach knows exactly what the parser does with each line. */}
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-[12px] text-slate-600 leading-relaxed">
                  <div className="font-bold text-slate-700 mb-1">How each line is read</div>
                  <ul className="space-y-0.5 list-disc pl-4">
                    <li>One player per line. Bullets, dashes and list markers are stripped.</li>
                    <li>Names go <b>First name, then Surname</b> (“Surname, First name” is flipped automatically).</li>
                    <li>A leading number is read as the player’s <b>cap number</b>.</li>
                    <li>Mark the captain with <b>(c)</b> — they’re set as captain.</li>
                    <li>A <b>GK</b> / “Goalkeeper” tag beside a name is recognised and stripped, so it never lands in the name.</li>
                  </ul>
                </div>
                <textarea rows={4} value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder={PLACEHOLDER}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors resize-y" />
                <button onClick={readSheet} disabled={!pasteText.trim()}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 font-bold text-sm rounded-lg px-4 py-2.5 transition-colors">
                  Read the sheet
                </button>
                {rows.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Paste the whole team sheet — one player per line, as “Cap Name”,
                    e.g. 1 Sarah Botha. Water polo uses cap numbers, not positions; tabs from a
                    spreadsheet and names on their own also work.
                  </p>
                )}
              </div>

              {/* Interpretation toggle — prominent: this is the code where the
                  guess is most likely to be wrong (§5). */}
              {rows.length > 0 && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5 bg-slate-100 rounded-xl p-1.5">
                  {[[true, 'These numbers are cap numbers'], [false, 'These numbers are just a list']].map(([val, label]) => (
                    <button key={String(val)} type="button" onClick={() => flipNumbersMode(val)}
                      className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                        numbersAreCaps === val
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
                {numbersAreCaps && readCapsMax != null && (
                  <p className="text-[11px] text-slate-400">Read as cap numbers 1 to {readCapsMax}</p>
                )}
              </div>
              )}

              {/* Squad grid */}
              <div>
                <p className="text-sm text-slate-600 mb-2">
                  {rows.length} player{rows.length === 1 ? '' : 's'}
                </p>
                <div className="space-y-2">
                  {sortedRows.map(row => {
                    const nameKey = `${row.firstName} ${row.surname}`.trim().toLowerCase()
                    const warnDupCap  = row.capNumber != null && dupCaps.has(row.capNumber)
                    const warnDupName = nameKey && dupNames.has(nameKey)
                    return (
                      <div key={row.key}
                        className={`bg-white rounded-xl border p-2.5 space-y-2 ${row.matchStatus === 'ambiguous' ? 'border-amber-300' : 'border-slate-200'}`}>
                        <div className="flex items-center gap-2">
                          {/* Cap number — fixed-width badge, blank is valid and
                              renders empty (not 0, not a dash). */}
                          <input inputMode="numeric" pattern="[0-9]*" aria-label="Cap number"
                            value={row.capNumber ?? ''}
                            onChange={e => {
                              const v = e.target.value.replace(/\D/g, '')
                              patchRow(row.key, { capNumber: v === '' ? null : parseInt(v, 10), capEdited: true })
                            }}
                            className="w-12 h-10 shrink-0 text-center font-mono tabular-nums text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500 transition-colors" />
                          <input aria-label="First name" value={row.firstName} placeholder="First name"
                            onChange={e => patchRow(row.key, { firstName: e.target.value }, true)}
                            className="flex-1 min-w-0 h-10 bg-white border border-slate-200 rounded-lg px-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
                          <input aria-label="Surname" value={row.surname} placeholder="Surname"
                            onChange={e => patchRow(row.key, { surname: e.target.value }, true)}
                            className="flex-1 min-w-0 h-10 bg-white border border-slate-200 rounded-lg px-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Captain — labelled pill, not a bare glyph (§7). */}
                          <button type="button" aria-pressed={row.isCaptain}
                            onClick={() => patchRow(row.key, { isCaptain: !row.isCaptain })}
                            className={`min-h-[40px] inline-flex items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                              row.isCaptain
                                ? 'bg-amber-50 border-amber-300 text-amber-700'
                                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'
                            }`}>
                            <span className="text-sm font-bold leading-none align-middle normal-case">©</span> Captain
                          </button>
                          {/* A row with candidates shows the chooser (below);
                              only a row with none shows a status chip here. */}
                          {!(row.candidates?.length > 0) && <StatusChip row={row} />}
                          {warnDupCap && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                              Duplicate cap
                            </span>
                          )}
                          {warnDupName && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                              Duplicate name
                            </span>
                          )}
                          <button type="button" onClick={() => removeRow(row.key)} aria-label="Remove row"
                            className="ml-auto min-h-[40px] px-2 text-slate-400 hover:text-red-500 transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {/* Any row with plausible candidates gets the chooser
                            (link to one, or create new) — not just exact-name
                            clashes (§6). A confident match arrives pre-selected;
                            an ambiguous one starts blank and blocks the save. */}
                        {row.candidates?.length > 0 && (
                          <select value={row.chosen} aria-label="Match to an existing player"
                            onChange={e => patchRow(row.key, { chosen: e.target.value })}
                            className="w-full h-10 bg-amber-50/50 border border-amber-200 rounded-lg px-2.5 text-sm text-slate-900 focus:outline-none focus:border-amber-400">
                            <option value="">Which player is this?</option>
                            {row.candidates.map(c => (
                              <option key={c.id} value={c.id}>Link to {c.fullName}</option>
                            ))}
                            <option value="new">Create new player</option>
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button type="button" onClick={addRow}
                  className="mt-2 w-full min-h-[44px] border border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-500 hover:text-emerald-700 hover:border-emerald-300 transition-colors inline-flex items-center justify-center gap-1.5">
                  <Plus className="w-4 h-4" /> Add row
                </button>

              </div>

              {/* Staff — explicitly optional (§8): names only, no accounts.
                  One labelled field per role (netball canonical layout).
                  Only a competition squad carries staff — a fixture line-up does not. */}
              {!fixtureTarget && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                  Team staff <span className="font-normal normal-case tracking-normal text-slate-400">optional</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {STAFF_ROLES.map(role => (
                    <div key={role}>
                      <label className="text-[11px] text-slate-500 block mb-1">{role}</label>
                      <input value={staff.find(s => s.role === role)?.name ?? ''}
                        placeholder="Name" aria-label={role}
                        onChange={e => {
                          const name = e.target.value
                          setStaff(prev => {
                            const rest = prev.filter(s => s.role !== role)
                            return name ? [...rest, { role, name }] : rest
                          })
                        }}
                        className="w-full h-10 bg-white border border-slate-200 rounded-lg px-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
                    </div>
                  ))}
                </div>
              </div>
              )}

              {/* No consent checkbox (addendum A1): profiles are created
                  ownerless — nobody claims rights over anyone, so there is
                  nothing to consent to at creation. */}
              {newCount > 0 && (
                <p className="text-xs text-slate-500 leading-relaxed">
                  {newCount} new player profile{newCount === 1 ? '' : 's'} will be created without an
                  owner. A player (or their parent) can claim theirs at any time by signing up.
                </p>
              )}

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            </>
          )}
        </div>

        {/* Confirm bar — pinned. The button carries no count (§7): this screen
            collects staff as well as players; the count lives on the row-count
            line inside the squad section, where its object is unambiguous. */}
        {phase === 'grid' && (
          <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-3 shrink-0">
            <button onClick={handleConfirm} disabled={confirmDisabled}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-lg py-3 transition-colors">
              {saving ? 'Saving…' : hadExisting ? 'Save' : 'Add'}
            </button>
            {unresolved > 0 && (
              <span className="text-[11px] font-medium text-amber-700">{unresolved} to resolve</span>
            )}
            <button onClick={onClose}
              className="text-sm font-medium text-emerald-700 hover:text-emerald-600 transition-colors px-2 min-h-[44px]">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
