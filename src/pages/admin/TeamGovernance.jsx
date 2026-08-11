// Admin resolution screen for the team governance migration.
//
// The migration (scripts/migrate-team-governance.mjs) converts every team it can
// map cleanly onto the structured naming standard and flags the rest with
// needsGovernanceReview:true. This screen lists those flagged teams and lets an
// admin resolve each by hand — pick the gender/division and the level with the
// same selector used everywhere else — then writes the structured fields and
// clears the flag. Nothing is auto-guessed here.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { fetchTeamsNeedingGovernanceReview, updateTeam } from '../../lib/adminQueries'
import { fetchOrganization } from '../../lib/queries'
import {
  CLUB_DIVISIONS, schoolGenderProfile, generatedTeamName, divisionLabel,
} from '../../lib/teamNaming'
import { LevelPicker, chipCls, BLANK_LEVEL, levelFieldsOf, levelComplete, levelStateOf } from '../../components/LevelPicker'

const REASON_LABEL = {
  'custom-side':                 'Custom / free-text side',
  'age-missing-letter':          'Age group with no letter',
  'no-level':                    'No level recorded',
  'unparseable-level':           'Level could not be read',
  'club-missing-division':       'Club team with no division',
  'legacy-mixed-division':       'Legacy “mixed” division',
  'school-gender-profile-unset': 'School gender profile not set',
  'coed-team-missing-gender':    'Co-ed team with no gender',
  'org-type-unknown':            'Organisation type unknown',
}

function ResolveCard({ team, org, onResolved }) {
  const isSchool  = org?.type === 'school'
  const orgType   = org?.type || 'club'
  const profile   = schoolGenderProfile(org)                 // boys | girls | coed | null
  const asksGender = isSchool && profile === 'coed'
  const genderUnset = isSchool && profile == null

  const [axis,  setAxis]  = useState(isSchool
    ? (team.gender ?? (asksGender ? '' : (profile ?? '')))
    : (team.division ?? (CLUB_DIVISIONS.some(d => d.value === team.gender) ? team.gender : '')))
  const [level, setLevel] = useState(team.ageGroup || team.teamLevel ? levelStateOf(team) : BLANK_LEVEL)
  const [saving, setSaving] = useState(false)

  const effGender = isSchool && !asksGender ? profile : axis
  const fields = isSchool
    ? { gender: effGender || null, ...levelFieldsOf(level) }
    : { division: axis || null,    ...levelFieldsOf(level) }
  const preview = generatedTeamName({ ...fields, orgGenderProfile: profile })
  const canSave = !genderUnset && levelComplete(level) && (isSchool ? !!effGender : !!axis)

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      await updateTeam(team.id, {
        ...fields, orgGenderProfile: profile,
        needsGovernanceReview: false, governanceReviewReason: null,
      })
      onResolved(team.id)
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-slate-900 font-semibold truncate">{team.displayName || '(no name)'}</div>
          <div className="text-[11px] text-slate-500 truncate">
            {org?.name ?? 'Unknown org'} · {org?.type ?? 'unknown type'}
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          <AlertTriangle className="w-3 h-3" />
          {REASON_LABEL[team.governanceReviewReason] ?? team.governanceReviewReason ?? 'Review'}
        </span>
      </div>

      <div className="text-[11px] text-slate-500">
        Stored: {['gender','division','ageGroup','teamLevel','teamLabel']
          .map(k => team[k] ? `${k}=${team[k]}` : null).filter(Boolean).join(' · ') || '—'}
      </div>

      {genderUnset ? (
        <p className="text-[13px] text-red-600">
          This school has no gender profile set. Set it on the organisation first, then resolve this team.
        </p>
      ) : (
        <>
          {isSchool && asksGender && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[['boys','Boys'],['girls','Girls']].map(([v,l]) => (
                  <button type="button" key={v} onClick={() => setAxis(v)} className={chipCls(axis === v)}>{l}</button>
                ))}
              </div>
            </div>
          )}
          {!isSchool && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Division</p>
              <div className="grid grid-cols-3 gap-1.5">
                {CLUB_DIVISIONS.map(d => (
                  <button type="button" key={d.value} onClick={() => setAxis(d.value)} className={chipCls(axis === d.value)}>{d.label}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Level</p>
            <LevelPicker orgType={orgType} value={level} onChange={setLevel} />
          </div>

          {preview && (
            <div className="text-xs text-slate-400">
              New name: <span className="text-slate-900 font-semibold">{(org?.name ? `${org.name} ` : '') + preview}</span>
            </div>
          )}

          <button type="button" onClick={save} disabled={!canSave || saving}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-lg py-2.5 transition-colors">
            <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Resolve'}
          </button>
        </>
      )}
    </div>
  )
}

export default function TeamGovernance() {
  const [teams, setTeams] = useState(null)
  const [orgs,  setOrgs]  = useState({})

  useEffect(() => {
    let alive = true
    ;(async () => {
      const list = await fetchTeamsNeedingGovernanceReview()
      if (!alive) return
      setTeams(list)
      const ids = [...new Set(list.map(t => t.organizationId).filter(Boolean))]
      const entries = await Promise.all(ids.map(async id => {
        try { return [id, await fetchOrganization(id)] } catch { return [id, null] }
      }))
      if (alive) setOrgs(Object.fromEntries(entries))
    })()
    return () => { alive = false }
  }, [])

  const grouped = useMemo(() => {
    const by = {}
    for (const t of teams ?? []) (by[t.governanceReviewReason ?? 'other'] ??= []).push(t)
    return by
  }, [teams])

  function onResolved(id) { setTeams(prev => (prev ?? []).filter(t => t.id !== id)) }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Team governance review</h1>
        <p className="text-sm text-slate-500 mt-1">
          Teams the migration could not map to the structured naming standard. Resolve each by choosing its
          gender/division and level. Nothing here is auto-guessed.
        </p>
      </div>

      {teams == null && <p className="text-slate-500 text-sm">Loading…</p>}
      {teams != null && teams.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-10 text-center">
          <Check className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
          <p className="text-slate-900 font-semibold">Nothing to review</p>
          <p className="text-slate-500 text-sm mt-0.5">Every team maps to the structured standard.</p>
        </div>
      )}

      {teams != null && teams.length > 0 && (
        <div className="space-y-6">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {teams.length} team{teams.length === 1 ? '' : 's'} to resolve
          </p>
          {Object.entries(grouped).map(([reason, list]) => (
            <div key={reason} className="space-y-3">
              <p className="text-[11px] font-semibold text-slate-500">
                {REASON_LABEL[reason] ?? reason} · {list.length}
              </p>
              {list.map(t => (
                <ResolveCard key={t.id} team={t} org={orgs[t.organizationId] ?? null} onResolved={onResolved} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
