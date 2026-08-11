// Shared team-level selector — the IDENTICAL control used everywhere a team is
// created (org teams, manual opponents). A team is either a senior side (an
// ordinal, "1st Team" … "10th Team") or an age side (an age group + a letter,
// "U14" + "A"). There is no free-text path.

import { TEAM_LEVELS, TEAM_LETTERS, ageGroupsFor } from '../lib/teamNaming'

const CHIP = 'text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg border transition-colors'
export const chipCls = on =>
  `${CHIP} ${on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`

// Blank picker state.
export const BLANK_LEVEL = { mode: 'senior', ordinal: '', ageGroup: '', letter: '' }

// Convert picker state into the structured team fields.
//   senior → { ageGroup: null, teamLevel: '1st Team' }
//   age    → { ageGroup: 'U14', teamLevel: 'A' }
export function levelFieldsOf(lvl) {
  return lvl?.mode === 'age'
    ? { ageGroup: lvl.ageGroup || null, teamLevel: lvl.letter || null }
    : { ageGroup: null, teamLevel: lvl?.ordinal || null }
}

// Whether the picker holds a complete level.
export const levelComplete = lvl => lvl?.mode === 'age'
  ? !!(lvl.ageGroup && lvl.letter)
  : !!lvl?.ordinal

// Rebuild picker state from a stored team's structured fields.
export function levelStateOf(team) {
  if (team?.ageGroup) return { mode: 'age', ordinal: '', ageGroup: team.ageGroup, letter: (team.teamLevel ?? '') }
  return { mode: 'senior', ordinal: (team?.teamLevel ?? ''), ageGroup: '', letter: '' }
}

export function LevelPicker({ orgType, value, onChange }) {
  const v = value ?? BLANK_LEVEL
  const set = patch => onChange({ ...v, ...patch })
  const ages = ageGroupsFor(orgType)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => set({ mode: 'senior' })} className={chipCls(v.mode === 'senior')}>Senior</button>
        <button type="button" onClick={() => set({ mode: 'age' })} className={chipCls(v.mode === 'age')}>Age group</button>
      </div>
      {v.mode === 'age' ? (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {ages.map(a => (
              <button type="button" key={a} onClick={() => set({ ageGroup: a })} className={chipCls(v.ageGroup === a)}>{a}</button>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {TEAM_LETTERS.map(l => (
              <button type="button" key={l} onClick={() => set({ letter: l })} className={chipCls(v.letter === l)}>{l}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {TEAM_LEVELS.map(lvl => (
            <button type="button" key={lvl} onClick={() => set({ ordinal: lvl })} className={chipCls(v.ordinal === lvl)}>
              {lvl.replace(' Team', '')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
