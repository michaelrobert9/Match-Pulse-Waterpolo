import { useEffect, useState } from 'react'
import { Search, BarChart2, Eye, Globe, CheckCircle, Wrench } from 'lucide-react'
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { fetchSeoSettings, saveSeoSettings, DEFAULT_SEO } from '../../lib/seoSettings'
import { slugify, matchSlug as buildMatchSlug } from '../../lib/slugify'
import { useAuth } from '../../contexts/AuthContext'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-800 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, maxLength, mono }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 ${mono ? 'font-mono' : ''}`}
      />
      {maxLength && (
        <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono ${value.length > maxLength * 0.9 ? 'text-amber-500' : 'text-slate-300'}`}>
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
}

function Textarea({ value, onChange, placeholder, maxLength, rows = 3 }) {
  return (
    <div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
      />
      {maxLength && (
        <div className={`text-right text-[10px] font-mono mt-0.5 ${value.length > maxLength * 0.9 ? 'text-amber-500' : 'text-slate-400'}`}>
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  )
}

// Google SERP preview
function SerpPreview({ title, tagline, description, url = 'matchpulse.co.za' }) {
  const displayTitle = [title, tagline].filter(Boolean).join(' — ')
  const snippet = description || 'No description set.'
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Google search preview</p>
      <div className="max-w-xl">
        <div className="text-xs text-slate-500 mb-0.5">{url}</div>
        <div className="text-[#1a0dab] text-lg font-normal hover:underline cursor-pointer leading-snug mb-1 truncate">
          {displayTitle || 'MatchPulse'}
        </div>
        <div className="text-slate-600 text-sm leading-relaxed line-clamp-2">
          {snippet}
        </div>
      </div>
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

function BackfillCompetitionSlugs() {
  const [state, setState] = useState('idle') // idle | running | done | error
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const snap = await getDocs(collection(db, 'competitions'))
      const all  = snap.docs.map(d => ({ ref: d.ref, ...d.data() }))

      // Seed taken-set from slugs already in the DB.
      const taken = new Set(all.map(c => c.slug).filter(Boolean))

      const toUpdate = all.filter(c => !c.slug)
      if (toUpdate.length === 0) {
        addLog('All competitions already have slugs — nothing to do.')
        setState('done')
        return
      }

      addLog(`Found ${toUpdate.length} competition(s) without a slug.`)

      let updated = 0
      for (const comp of toUpdate) {
        const base = slugify(comp.name || '') || 'competition'
        let slug   = base
        let n      = 2
        while (taken.has(slug)) slug = `${base}-${n++}`
        taken.add(slug)

        addLog(`  "${comp.name}" → ${slug}`)
        await updateDoc(doc(db, 'competitions', comp.ref.id), { slug })
        updated++
      }

      addLog(`\nDone — ${updated} competition(s) updated.`)
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="URL backfill">
      <p className="text-sm text-slate-600">
        Competitions created before SEO-friendly URLs were introduced have no slug and show
        a Firebase ID in their URL. Click the button below to generate and save slugs for
        all competitions that are missing one. This is safe to run more than once — existing
        slugs are never changed.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Backfill competition slugs'}
      </button>
    </Section>
  )
}

function BackfillMatchSlugs() {
  const [state, setState] = useState('idle') // idle | running | done | error
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const [matchSnap, compSnap] = await Promise.all([
        getDocs(collection(db, 'matches')),
        getDocs(collection(db, 'competitions')),
      ])

      // Build lookup: competitionId → { slug, season }
      const compById = {}
      for (const d of compSnap.docs) {
        compById[d.id] = { slug: d.data().slug || null, season: d.data().season || null }
      }

      const allMatches = matchSnap.docs.map(d => ({ ref: d.ref, id: d.id, ...d.data() }))

      // Seed per-season taken sets from existing matchSlugs so we never collide.
      const taken = new Map() // season → Set<slug>
      for (const m of allMatches) {
        if (m.matchSlug) {
          const key = m.season ? String(m.season) : '__unseasoned__'
          if (!taken.has(key)) taken.set(key, new Set())
          taken.get(key).add(m.matchSlug)
        }
      }

      const needSlug    = allMatches.filter(m => !m.matchSlug)
      const needCompRef = allMatches.filter(m => m.matchSlug && m.competitionId && !m.competitionSlug)

      if (needSlug.length === 0 && needCompRef.length === 0) {
        addLog('All matches already have slugs and competition references — nothing to do.')
        setState('done')
        return
      }

      addLog(`Found ${needSlug.length} match(es) without a slug.`)
      if (needCompRef.length > 0) {
        addLog(`Found ${needCompRef.length} match(es) missing competitionSlug (will be linked).`)
      }

      let updated = 0

      for (const m of needSlug) {
        const homeDisplay = m.homeOrgName
          ? `${m.homeOrgName} ${m.homeTeamName || ''}`.trim()
          : (m.homeTeamName || 'home')
        const awayDisplay = m.awayOrgName
          ? `${m.awayOrgName} ${m.awayTeamName || ''}`.trim()
          : (m.awayTeamName || 'away')
        const base      = buildMatchSlug(homeDisplay, awayDisplay)
        const seasonKey = m.season ? String(m.season) : '__unseasoned__'
        if (!taken.has(seasonKey)) taken.set(seasonKey, new Set())
        const seasonTaken = taken.get(seasonKey)

        let slug = base
        let n = 2
        while (seasonTaken.has(slug)) slug = `${base}-${n++}`
        seasonTaken.add(slug)

        const update = { matchSlug: slug }
        if (m.season) update.season = String(m.season)
        if (m.competitionId && compById[m.competitionId]?.slug) {
          update.competitionSlug = compById[m.competitionId].slug
          const cSeason = compById[m.competitionId].season || m.season
          if (cSeason) update.competitionSeason = String(cSeason)
        }

        addLog(`  "${homeDisplay} vs ${awayDisplay}" → ${slug}${m.season ? ' (' + m.season + ')' : ''}`)
        await updateDoc(doc(db, 'matches', m.id), update)
        updated++
      }

      for (const m of needCompRef) {
        const comp = compById[m.competitionId]
        if (!comp?.slug) continue
        const update = { competitionSlug: comp.slug }
        const cSeason = comp.season || m.season
        if (cSeason) update.competitionSeason = String(cSeason)
        addLog(`  Match ${m.id}: linked to competition ${comp.slug}`)
        await updateDoc(doc(db, 'matches', m.id), update)
        updated++
      }

      addLog(`\nDone — ${updated} match(es) updated.`)
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="Match URL backfill">
      <p className="text-sm text-slate-600">
        Matches created before SEO-friendly URLs were introduced have no slug and show a
        Firebase ID in their URL. This also links any existing matches to their competition's
        slug (run after backfilling competition slugs above). Safe to run more than once —
        existing slugs are never changed.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Backfill match slugs'}
      </button>
    </Section>
  )
}

function BackfillCompetitionOwners() {
  const [state, setState] = useState('idle') // idle | running | done | error
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const snap = await getDocs(collection(db, 'competitions'))
      const all  = snap.docs.map(d => ({ ref: d.ref, ...d.data() }))

      // Only competitions with no ownerOrgId need attention. The single safe
      // automatic source is the legacy `orgId` field — a participant's org is
      // participation, not ownership, and createdBy is a user, not an org.
      const missing = all.filter(c => !c.ownerOrgId)
      if (missing.length === 0) {
        addLog('All competitions already have an ownerOrgId — nothing to do.')
        setState('done')
        return
      }

      addLog(`Found ${missing.length} competition(s) without ownerOrgId.`)

      let updated = 0
      let manual  = 0
      for (const comp of missing) {
        if (comp.orgId) {
          addLog(`  "${comp.name || comp.ref.id}" → ownerOrgId = ${comp.orgId} (from legacy orgId)`)
          await updateDoc(doc(db, 'competitions', comp.ref.id), { ownerOrgId: comp.orgId })
          updated++
        } else {
          addLog(`  ⚠ "${comp.name || comp.ref.id}" has no orgId — set the host manually in the competition manager.`)
          manual++
        }
      }

      addLog(`\nDone — ${updated} competition(s) updated${manual ? `, ${manual} need a host set manually.` : '.'}`)
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="Competition owner backfill">
      <p className="text-sm text-slate-600">
        Every competition needs an <span className="font-mono">ownerOrgId</span> identifying the
        single host organisation (the org that pays for and controls it). Competitions created
        before this field existed are normalised here by copying their legacy
        <span className="font-mono"> orgId</span>. Any competition with neither is reported so you
        can set its host manually. Safe to run more than once — existing owners are never changed.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Backfill competition owners'}
      </button>
    </Section>
  )
}

function BackfillLineupPersonIds() {
  const [state, setState] = useState('idle') // idle | running | done | error
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const snap = await getDocs(collection(db, 'matches'))
      const all  = snap.docs.map(d => ({ ref: d.ref, id: d.id, ...d.data() }))

      const toUpdate = []
      for (const m of all) {
        const homeIds  = (m.homeLineup ?? []).map(e => e.personId).filter(Boolean)
        const awayIds  = (m.awayLineup ?? []).map(e => e.personId).filter(Boolean)
        const expected = [...new Set([...homeIds, ...awayIds])]
        const current  = m.lineupPersonIds ?? null

        const needsUpdate = current === null
          || expected.some(id => !current.includes(id))
          || current.some(id => !expected.includes(id))

        if (needsUpdate) toUpdate.push({ id: m.id, expected, homeTeam: m.homeTeamName, awayTeam: m.awayTeamName })
      }

      if (toUpdate.length === 0) {
        addLog('All matches already have a correct lineupPersonIds index — nothing to do.')
        setState('done')
        return
      }

      addLog(`Found ${toUpdate.length} match(es) with missing or stale lineupPersonIds.`)

      let updated = 0
      for (const { id, expected, homeTeam, awayTeam } of toUpdate) {
        addLog(`  "${homeTeam ?? 'Home'} vs ${awayTeam ?? 'Away'}" (${id}) → ${expected.length} player id(s)`)
        await updateDoc(doc(db, 'matches', id), { lineupPersonIds: expected })
        updated++
      }

      addLog(`\nDone — ${updated} match(es) updated.`)
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="Lineup index backfill">
      <p className="text-sm text-slate-600">
        Player profiles show fixtures by querying the{' '}
        <span className="font-mono">lineupPersonIds</span> index on each match. Matches
        created before this index was introduced are missing it, so those fixtures don't
        appear on a player's profile. This button rebuilds the index from the actual lineup
        arrays on every affected match. Safe to run more than once — only matches with a
        missing or out-of-sync index are touched.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Backfill lineup index'}
      </button>
    </Section>
  )
}

function BackfillTeamSlugs() {
  const [state, setState] = useState('idle')
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const [teamSnap, orgSnap] = await Promise.all([
        getDocs(collection(db, 'teams')),
        getDocs(collection(db, 'organizations')),
      ])

      const orgById = {}
      for (const d of orgSnap.docs) orgById[d.id] = d.data()

      const all  = teamSnap.docs.map(d => ({ ref: d.ref, id: d.id, ...d.data() }))
      const taken = new Set(all.map(t => t.slug).filter(Boolean))

      const toUpdate = all.filter(t => !t.slug)
      if (toUpdate.length === 0) {
        addLog('All teams already have slugs — nothing to do.')
        setState('done')
        return
      }

      addLog(`Found ${toUpdate.length} team(s) without a slug.`)

      let updated = 0
      for (const team of toUpdate) {
        const org     = orgById[team.organizationId]
        const orgSlug = (org?.slug) || slugify(org?.name || team.orgName || 'org')
        const label   = slugify(team.displayName || team.orgName || 'team')
        const base    = `${orgSlug}-${label}`
        let slug = base
        let n = 2
        while (taken.has(slug)) slug = `${base}-${n++}`
        taken.add(slug)

        addLog(`  "${team.displayName ?? team.id}" → ${slug}`)
        await updateDoc(doc(db, 'teams', team.id), { slug })
        updated++
      }

      addLog(`\nDone — ${updated} team(s) updated.`)
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="Team URL backfill">
      <p className="text-sm text-slate-600">
        Teams created before SEO-friendly profile URLs were introduced have no slug,
        so their profile page is not reachable. This button generates and saves a slug
        for every team that is missing one. Safe to run more than once — existing slugs
        are never changed.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Backfill team slugs'}
      </button>
    </Section>
  )
}

// Rebuilds every user's orgRoles mirror from the authoritative staff records on
// each organisation. Repairs memberships dropped by the historical orgRoles
// overwrite bug (a school/club no longer appearing on a user's Manage page).
function ReconcileOrgRoles() {
  const [state, setState] = useState('idle')
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const orgSnap = await getDocs(collection(db, 'organizations'))
      addLog(`Scanning ${orgSnap.size} organisation(s)…`)

      // userId → { orgId: { role, teamId } } from the authoritative staff docs.
      // The staff doc id IS the user's uid.
      const byUser = {}
      for (const orgDoc of orgSnap.docs) {
        const staffSnap = await getDocs(collection(db, 'organizations', orgDoc.id, 'staff'))
        for (const s of staffSnap.docs) {
          const d = s.data()
          ;(byUser[s.id] ??= {})[orgDoc.id] = { role: d.role, teamId: d.teamId ?? null }
        }
      }

      const userIds = Object.keys(byUser)
      addLog(`Found staff memberships for ${userIds.length} user(s).`)

      let repaired = 0
      for (const userId of userIds) {
        // Field-path update: add/correct each membership without disturbing any
        // other orgRoles entry (and never removing one).
        const update = {}
        for (const [orgId, grant] of Object.entries(byUser[userId])) {
          update[`orgRoles.${orgId}`] = grant
        }
        try {
          await updateDoc(doc(db, 'users', userId), update)
          repaired++
        } catch (e) {
          addLog(`  ! could not update user ${userId}: ${e.message}`)
        }
      }

      addLog(`\nDone — reconciled orgRoles for ${repaired} user(s).`)
      addLog('Affected users will see their schools/clubs after their next page load.')
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="Reconcile org memberships">
      <p className="text-sm text-slate-600">
        Rebuilds every user's <span className="font-mono">orgRoles</span> from the authoritative
        staff records on each organisation. Fixes schools or clubs that stopped appearing on a
        user's Manage page. Safe to run repeatedly — it only adds or corrects entries, never
        removes a membership.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Reconcile memberships'}
      </button>
    </Section>
  )
}

// Repairs denormalised team/org fields on match documents. Match display across
// the app (manage pages, competition overview, score screen, player history)
// reads the denormalised homeOrgName/awayOrgName/colour fields rather than
// resolving the org doc per row. When those fields are missing (team created
// before denormalisation) or stale (org renamed after the match), the org name
// silently drops — e.g. a match shows just the team label with no school/club.
// This rewrites every side's org name, team name and colour from the current
// team + org documents. Safe to run repeatedly.
function ReconcileMatchOrgNames() {
  const [state, setState] = useState('idle')
  const [log,   setLog]   = useState([])

  function addLog(msg) { setLog(prev => [...prev, msg]) }

  async function run() {
    setState('running')
    setLog([])
    try {
      const [matchSnap, orgSnap, teamSnap] = await Promise.all([
        getDocs(collection(db, 'matches')),
        getDocs(collection(db, 'organizations')),
        getDocs(collection(db, 'teams')),
      ])
      const orgById  = {}
      const teamById = {}
      orgSnap.docs.forEach(d => { orgById[d.id]  = { id: d.id, ...d.data() } })
      teamSnap.docs.forEach(d => { teamById[d.id] = { id: d.id, ...d.data() } })
      addLog(`Scanning ${matchSnap.size} match(es) against ${orgSnap.size} org(s) / ${teamSnap.size} team(s)…`)

      let repaired = 0
      for (const d of matchSnap.docs) {
        const m = d.data()
        const update = {}

        for (const side of ['home', 'away']) {
          // Manual/unregistered opponents have no team to resolve from — leave
          // their stored fallback fields untouched.
          if (m[`${side}Registered`] === false || !m[`${side}TeamId`]) continue
          const team  = teamById[m[`${side}TeamId`]]
          if (!team) continue
          const orgId = m[`${side}OrgId`] ?? team.organizationId ?? null
          const org   = orgId ? orgById[orgId] : null

          const orgName   = org?.name ?? team.orgName ?? null
          const teamName  = team.displayName ?? m[`${side}TeamName`] ?? null
          const teamColor = team.primaryColor ?? m[`${side}TeamColor`] ?? null

          if (orgName  != null && orgName  !== m[`${side}OrgName`])   update[`${side}OrgName`]   = orgName
          if (orgId    != null && orgId    !== m[`${side}OrgId`])     update[`${side}OrgId`]     = orgId
          if (teamName != null && teamName !== m[`${side}TeamName`])  update[`${side}TeamName`]  = teamName
          if (teamColor!= null && teamColor!== m[`${side}TeamColor`]) update[`${side}TeamColor`] = teamColor
        }

        if (Object.keys(update).length === 0) continue
        try {
          await updateDoc(doc(db, 'matches', d.id), update)
          repaired++
          const label = `${update.homeOrgName ?? m.homeOrgName ?? m.homeTeamName ?? '?'} vs ${update.awayOrgName ?? m.awayOrgName ?? m.awayTeamName ?? '?'}`
          addLog(`  ✓ ${label} — ${Object.keys(update).join(', ')}`)
        } catch (e) {
          addLog(`  ! match ${d.id}: ${e.message}`)
        }
      }

      addLog(`\nDone — repaired ${repaired} match(es).`)
      if (repaired === 0) addLog('All match org/team details were already up to date.')
      setState('done')
    } catch (err) {
      addLog(`Error: ${err.message}`)
      setState('error')
    }
  }

  return (
    <Section icon={Wrench} title="Reconcile match org names">
      <p className="text-sm text-slate-600">
        Rewrites each match's denormalised organisation name, team name and colour from the current
        team and organisation records. Fixes matches where a school or club name is missing or stale
        (e.g. an org renamed after its fixtures were created). Safe to run repeatedly.
      </p>
      {log.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {log.join('\n')}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded-xl px-5 py-2.5 transition-colors"
      >
        {state === 'running' ? 'Running…' : state === 'done' ? 'Run again' : 'Reconcile match details'}
      </button>
    </Section>
  )
}

export default function SeoSettings() {
  const { uid } = useAuth()
  const [form, setForm] = useState(DEFAULT_SEO)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetchSeoSettings().then(s => { setForm(s); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  function set(key) { return val => setForm(f => ({ ...f, [key]: val })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      await saveSeoSettings(form, uid)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="font-display font-bold text-slate-900 text-xl">SEO Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Control how MatchPulse appears in search engines and wire up analytics.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* SERP preview */}
        <SerpPreview
          title={form.siteTitle}
          tagline={form.siteTagline}
          description={form.siteDescription}
        />

        {/* Site identity */}
        <Section icon={Globe} title="Site identity">
          <Field label="Site name" hint="Shown as the bold heading in Google results and the browser tab.">
            <Input value={form.siteTitle} onChange={set('siteTitle')} placeholder="MatchPulse" maxLength={60} />
          </Field>
          <Field label="Tagline" hint='Appended to the site name with an em-dash: "MatchPulse — School & Club Hockey".'>
            <Input value={form.siteTagline} onChange={set('siteTagline')} placeholder="School & Club Hockey" maxLength={60} />
          </Field>
          <Field label="Meta description" hint="The snippet shown under the title in Google results. Aim for 120–160 characters.">
            <Textarea
              value={form.siteDescription}
              onChange={set('siteDescription')}
              placeholder="Live scores, fixtures, results and player records for school and club hockey in South Africa."
              maxLength={160}
              rows={3}
            />
          </Field>
          <Field label="Keywords" hint="Comma-separated. Google ignores this field directly but it helps internal search.">
            <Textarea
              value={form.keywords}
              onChange={set('keywords')}
              placeholder="hockey, school hockey, club hockey, live scores, South Africa"
              maxLength={500}
              rows={2}
            />
          </Field>
          <Field label="Social share image URL" hint="Shown when the site is shared on WhatsApp, Twitter/X, Facebook etc. Use a 1200×630 px image.">
            <Input value={form.ogImageUrl} onChange={set('ogImageUrl')} placeholder="https://matchpulse.co.za/og-image.jpg" mono />
          </Field>
        </Section>

        {/* Google Analytics */}
        <Section icon={BarChart2} title="Google Analytics 4">
          <Field
            label="Measurement ID"
            hint='Found in GA4 → Admin → Data Streams → your stream. Looks like "G-XXXXXXXXXX". Leave blank to disable.'
          >
            <Input value={form.googleAnalyticsId} onChange={set('googleAnalyticsId')} placeholder="G-XXXXXXXXXX" mono />
          </Field>
          {form.googleAnalyticsId && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-xs text-emerald-800">
              <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
              GA4 will be injected on every page load. Events and pageviews will appear in your GA4 dashboard within 24–48 hours.
            </div>
          )}
        </Section>

        {/* Google Search Console */}
        <Section icon={Search} title="Google Search Console">
          <Field
            label="HTML tag verification code"
            hint='In Search Console → Settings → Ownership verification → HTML tag. Copy only the content="…" value, not the full tag.'
          >
            <Input value={form.googleSearchConsoleVerification} onChange={set('googleSearchConsoleVerification')} placeholder="abc123XYZ…" mono />
          </Field>
          {form.googleSearchConsoleVerification && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-600 break-all">
              {`<meta name="google-site-verification" content="${form.googleSearchConsoleVerification}" />`}
            </div>
          )}
          <div className="text-xs text-slate-500 space-y-1 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
            <p className="font-semibold text-blue-800">Submit your sitemap to Google:</p>
            <p>In Search Console → Sitemaps, add <span className="font-mono bg-white/70 px-1 rounded">https://matchpulse.co.za/sitemap.xml</span></p>
            <p className="text-blue-600">The sitemap is already live — you can verify it at <span className="font-mono">/sitemap.xml</span> before submitting.</p>
          </div>
        </Section>

        {/* Stat Counter */}
        <Section icon={Eye} title="Stat Counter">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Project ID" hint="Found in your StatCounter project settings.">
              <Input value={form.statCounterProject} onChange={set('statCounterProject')} placeholder="12345678" mono />
            </Field>
            <Field label="Security code" hint="The sc_security value from your StatCounter tracking code.">
              <Input value={form.statCounterSecurity} onChange={set('statCounterSecurity')} placeholder="abc12def" mono />
            </Field>
          </div>
          {form.statCounterProject && form.statCounterSecurity && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-xs text-emerald-800">
              <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
              Stat Counter will be loaded invisibly on every page. Stats appear in your StatCounter dashboard in real time.
            </div>
          )}
        </Section>

        {/* Data maintenance */}
        <ReconcileOrgRoles />
        <ReconcileMatchOrgNames />
        <BackfillCompetitionSlugs />
        <BackfillMatchSlugs />
        <BackfillCompetitionOwners />
        <BackfillTeamSlugs />
        <BackfillLineupPersonIds />

        {/* Save bar */}
        <div className="flex items-center justify-between gap-4 pt-2">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && (
            <p className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Settings saved — changes apply on the next page load.
            </p>
          )}
          {!saved && !error && <span />}
          <button type="submit" disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl px-6 py-2.5 transition-colors shrink-0">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
