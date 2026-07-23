import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isScheduled } from '../lib/fixtureStatus'
import {
  fetchPersonBySlug, fetchCareerForPerson, fetchOrganization,
  fetchMatchesForPlayer, toDate,
} from '../lib/queries'
import { matchUrl } from '../lib/slugify'
import { monogram } from '../lib/names'
import { useAuth } from '../contexts/AuthContext'
import { managesPlayerProfile } from '../lib/capabilities'
import { removeSelfFromFixture, updatePersonBanner, claimPlayerProfile, isProfileClaimed } from '../lib/adminQueries'
import { storage } from '../firebase'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useSeoMeta } from '../lib/useSeoMeta'

const ROLE_LABELS = {
  player: 'Player',
  admin:  'Administrator',
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function fmtDate(val) {
  if (!val) return null
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

function age(dob) {
  if (!dob) return null
  const d = dob?.toDate ? dob.toDate() : new Date(dob)
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

function SectionHeader({ title }) {
  return <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">{title}</h2>
}

// Group career records by organisationId, then by teamId within each org.
function groupCareer(career, orgMap) {
  const orgOrder = []
  const byOrg = {}
  for (const r of career) {
    const orgKey = r.organizationId || '__none__'
    if (!byOrg[orgKey]) {
      orgOrder.push(orgKey)
      byOrg[orgKey] = {
        orgId: r.organizationId || null,
        org: orgMap[r.organizationId] || null,
        byTeam: {}, teamOrder: [],
      }
    }
    const teamKey = r.teamId || r.teamDisplayName || '__team__'
    if (!byOrg[orgKey].byTeam[teamKey]) {
      byOrg[orgKey].teamOrder.push(teamKey)
      byOrg[orgKey].byTeam[teamKey] = []
    }
    byOrg[orgKey].byTeam[teamKey].push(r)
  }
  return orgOrder.map(orgKey => {
    const group = byOrg[orgKey]
    const teams = group.teamOrder.map(teamKey => {
      const records = [...group.byTeam[teamKey]].sort(
        (a, b) => String(b.competitionSeason ?? b.season ?? '').localeCompare(String(a.competitionSeason ?? a.season ?? ''))
      )
      const caps    = records.reduce((s, r) => s + (r.caps    ?? 0), 0)
      const goals   = records.reduce((s, r) => s + (r.goals   ?? 0), 0)
      const assists = records.reduce((s, r) => s + (r.assists ?? 0), 0)
      return {
        teamId:           records[0].teamId,
        teamDisplayName:  records[0].teamDisplayName,
        teamPrimaryColor: records[0].teamPrimaryColor,
        caps, goals, assists, records,
      }
    })
    return { orgId: group.orgId, org: group.org, teams }
  })
}

// Single competition row inside a team block.
function CompRecord({ record }) {
  // A record is either a competition slice or a season roster entry — the
  // roster entry carries the team's standalone-fixture (friendly) stats.
  const isRoster = !record.competitionId
  const name   = record.competitionName || (isRoster ? 'Friendlies & other fixtures' : 'Fixtures')
  const season = record.competitionSeason || record.season || null
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-600 truncate">{name}</span>
        {season && (
          <span className="text-[10px] text-slate-400 ml-1.5">{season}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-slate-500">
        <span>{record.caps ?? 0} caps</span>
        <span className="text-slate-300">·</span>
        <span className="text-emerald-600">{record.goals ?? 0} gls</span>
        <span className="text-slate-300">·</span>
        <span>{record.assists ?? 0} ast</span>
      </div>
    </div>
  )
}

// Team card: aggregate caps + goals + expandable competition rows.
function TeamBlock({ team }) {
  const [expanded, setExpanded] = useState(false)
  const avg = team.caps > 0 && team.goals > 0
    ? (team.goals / team.caps).toFixed(2) : '—'

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="h-1" style={{ backgroundColor: team.teamPrimaryColor || '#94a3b8' }} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: team.teamPrimaryColor || '#94a3b8' }} />
          <span className="text-slate-900 font-semibold text-sm">{team.teamDisplayName}</span>
          {team.records.length > 1 && (
            <span className="text-[10px] text-slate-400 ml-auto">
              {team.records.length} competition{team.records.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-0 border-t border-slate-200 pt-3">
          {[
            { val: team.caps,    label: 'Caps',     cls: 'text-slate-900' },
            { val: team.goals,   label: 'Goals',    cls: 'text-emerald-600' },
            { val: team.assists, label: 'Assists',  cls: 'text-slate-900' },
            { val: avg,          label: 'Avg/Game', cls: 'text-slate-900' },
          ].map(({ val, label, cls }, i) => (
            <div key={label} className={`flex flex-col items-center${i > 0 ? ' border-l border-slate-200' : ''}`}>
              <span className={`font-mono font-black text-xl tabular-nums ${cls}`}>{val}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
            </div>
          ))}
        </div>
        {team.records.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-100 divide-y divide-slate-100">
            {(expanded ? team.records : team.records.slice(0, 3)).map(r => (
              <CompRecord key={r.id} record={r} />
            ))}
            {team.records.length > 3 && (
              <button onClick={() => setExpanded(e => !e)}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors pt-2">
                {expanded ? 'Show less' : `+${team.records.length - 3} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Org header (display only — no navigation link) + team blocks.
function OrgSection({ orgId, org, teams }) {
  const color   = org?.primaryColor || '#64748b'
  const orgName = org?.name || 'Other'
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 px-1">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 overflow-hidden"
          style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
          {org?.logoUrl
            ? <img src={org.logoUrl} alt="" className="w-full h-full object-contain" />
            : <span className="text-[8px] font-bold font-mono" style={{ color }}>{monogram(orgName)}</span>}
        </div>
        <div>
          <div className="text-slate-900 font-bold text-sm leading-none">{orgName}</div>
          {org?.type && <div className="text-[10px] text-slate-400 capitalize mt-0.5">{org.type}</div>}
        </div>
      </div>
      {teams.length > 0 ? (
        <div className="space-y-2">
          {teams.map((team, i) => <TeamBlock key={team.teamId || i} team={team} />)}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-5 text-center shadow-sm">
          <p className="text-slate-400 text-xs">No fixtures recorded yet.</p>
        </div>
      )}
    </div>
  )
}

function FixtureCard({ match, personId, canSelfRemove, onRemoved }) {
  const [removing, setRemoving] = useState(false)
  const inHome    = (match.homeLineup ?? []).some(e => e.personId === personId)
  const entry     = [...(match.homeLineup ?? []), ...(match.awayLineup ?? [])].find(e => e.personId === personId)
  const teamColor = inHome ? match.homeTeamColor : match.awayTeamColor
  const isFinal   = match.status === 'final'
  const d         = toDate(match.scheduledAt)
  const dateStr   = d
    ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  async function handleSelfRemove(e) {
    e.preventDefault()
    if (!confirm('Remove this player from the fixture lineup?')) return
    setRemoving(true)
    try {
      await removeSelfFromFixture(match.id, personId)
      onRemoved(match.id)
    } catch (err) {
      alert(err.message ?? 'Removal failed.')
      setRemoving(false)
    }
  }

  return (
    <Link to={matchUrl(match)}
      className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:border-slate-300 transition-colors block">
      <div className="h-1" style={{ backgroundColor: teamColor || '#94a3b8' }} />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          {dateStr && <span className="font-mono text-[10px] text-slate-500">{dateStr}</span>}
          <div className="flex items-center gap-1.5 ml-auto">
            {entry?.isStarter && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                Starter
              </span>
            )}
            {entry?.shirtNumber && (
              <span className="font-mono text-[10px] text-slate-400">#{entry.shirtNumber}</span>
            )}
            {canSelfRemove && !isFinal && (
              <button onClick={handleSelfRemove} disabled={removing}
                className="text-[9px] font-bold uppercase tracking-widest text-red-500 hover:text-red-400 disabled:opacity-50 border border-red-200 rounded px-1.5 py-0.5 transition-colors">
                {removing ? 'Removing…' : 'Remove me'}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className={`text-sm font-semibold truncate ${inHome ? 'text-slate-900' : 'text-slate-500'}`}>
              {match.homeOrgName ? `${match.homeOrgName} ${match.homeTeamName}` : (match.homeTeamName ?? '')}
            </div>
            <div className={`text-sm font-semibold truncate ${!inHome ? 'text-slate-900' : 'text-slate-500'}`}>
              {match.awayOrgName ? `${match.awayOrgName} ${match.awayTeamName}` : (match.awayTeamName ?? '')}
            </div>
          </div>
          {isFinal ? (
            <div className="text-right shrink-0 space-y-0.5">
              <div className={`font-mono font-black text-base tabular-nums leading-none ${inHome ? 'text-slate-900' : 'text-slate-400'}`}>
                {match.homeScore ?? 0}
              </div>
              <div className={`font-mono font-black text-base tabular-nums leading-none ${!inHome ? 'text-slate-900' : 'text-slate-400'}`}>
                {match.awayScore ?? 0}
              </div>
            </div>
          ) : (
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 shrink-0 ml-2">
              {match.status === 'live' ? 'Live' : isScheduled(match) ? 'Scheduled' : match.status}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function PlayerProfile() {
  const { slug }         = useParams()
  const { uid, isPlatformAdmin } = useAuth()
  const [person,         setPerson]        = useState(null)
  useSeoMeta({ type: 'player', entity: person })
  const [career,         setCareer]        = useState([])
  const [orgMap,         setOrgMap]        = useState({})
  const [playerMatches,  setPlayerMatches] = useState([])
  const [loading,        setLoading]       = useState(true)
  const [notFound,       setNotFound]      = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setNotFound(false)
    fetchPersonBySlug(slug)
      .then(async p => {
        if (!alive) return
        if (!p) { setNotFound(true); return }
        setPerson(p)

        const [c, matches] = await Promise.all([
          fetchCareerForPerson(p.id),
          fetchMatchesForPlayer(p.id),
        ])
        if (!alive) return
        setCareer(c)
        setPlayerMatches(matches)

        // Collect org IDs from both career records and the person's representativeOrgs.
        const careerOrgIds = c.map(r => r.organizationId).filter(Boolean)
        const repOrgIds    = (p.representativeOrgs ?? []).map(o => o.orgId).filter(Boolean)
        const orgIds       = [...new Set([...careerOrgIds, ...repOrgIds])]
        const orgDocs = await Promise.all(orgIds.map(id => fetchOrganization(id)))
        if (!alive) return
        const map = {}
        orgDocs.filter(Boolean).forEach(o => { map[o.id] = o })
        setOrgMap(map)
      })
      .catch(() => { if (alive) setNotFound(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug])

  if (loading) return <Spinner />

  if (notFound || !person) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-slate-500 text-sm mb-4">Player not found.</p>
        <Link to="/players" className="text-emerald-600 text-sm hover:underline">← Back to players</Link>
      </div>
    )
  }

  const initials      = person.fullName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const canSelfRemove = managesPlayerProfile(person, uid)
  const canEditBanner = isPlatformAdmin || managesPlayerProfile(person, uid)
  // Anyone signed in may claim an UNCLAIMED profile (no owner/guardian yet) that
  // isn't already theirs.
  const canClaim = !!uid && !isProfileClaimed(person) && !managesPlayerProfile(person, uid)

  // Career groups from players-collection records, then append any representative
  // orgs that have no career data yet (so the org header still shows).
  const careerGroups = groupCareer(career, orgMap)
  const careerOrgIds = new Set(careerGroups.map(g => g.orgId).filter(Boolean))
  const extraGroups  = (person.representativeOrgs ?? [])
    .map(o => o.orgId).filter(id => id && !careerOrgIds.has(id))
    .map(id => ({ orgId: id, org: orgMap[id] || null, teams: [] }))
  const allOrgGroups = [...careerGroups, ...extraGroups]

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">

      {/* Hero: banner, photo, name, position, nationality, DOB, SAHA number */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <ProfileBanner person={person} canEdit={canEditBanner}
          onSaved={url => setPerson(p => ({ ...p, bannerUrl: url }))} />
        <div className="h-2 bg-gradient-to-r from-emerald-500 to-emerald-400" />
        <div className="p-5 flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
            {person.photoUrl
              ? <img src={person.photoUrl} alt={person.fullName} className="w-full h-full object-cover object-top" />
              : <span className="text-lg font-bold font-mono text-slate-500">{initials}</span>}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {person.roles?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {person.roles.map(r => (
                  <span key={r} className="inline-flex font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">
                    {ROLE_LABELS[r] ?? r}
                  </span>
                ))}
              </div>
            )}
            <h1 className="font-display font-bold text-slate-900 text-2xl leading-tight">{person.fullName}</h1>
            {(person.position || person.nationality) && (
              <div className="text-slate-500 text-sm mt-0.5">
                {[person.position, person.nationality].filter(Boolean).join(' · ')}
              </div>
            )}
            {person.dateOfBirth && (
              <div className="text-slate-400 text-xs mt-1">
                {fmtDate(person.dateOfBirth)}
                {age(person.dateOfBirth) != null && ` · ${age(person.dateOfBirth)} yrs`}
              </div>
            )}
            {person.sahaNumber && (
              <div className="mt-1.5">
                <span className="inline-flex font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500">
                  SAHA {person.sahaNumber}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Claim: an unclaimed profile can be taken over by the player or a parent */}
      {canClaim && (
        <ClaimCard person={person}
          onClaimed={patch => setPerson(p => ({ ...p, ...patch }))} />
      )}

      {/* Represents: org → team blocks with caps/goals stats */}
      {allOrgGroups.length > 0 && (
        <section>
          <SectionHeader title="Represents" />
          <div className="space-y-6">
            {allOrgGroups.map((group, gi) => (
              <OrgSection key={group.orgId ?? gi} orgId={group.orgId} org={group.org} teams={group.teams} />
            ))}
          </div>
        </section>
      )}

      {/* Fixtures */}
      <section>
        <SectionHeader title={`Fixtures${playerMatches.length > 0 ? ` (${playerMatches.length})` : ''}`} />
        {playerMatches.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center shadow-sm">
            <p className="text-slate-500 text-sm">No fixtures listed yet.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {playerMatches.slice(0, 20).map(m => (
                <FixtureCard key={m.id} match={m} personId={person.id}
                  canSelfRemove={canSelfRemove}
                  onRemoved={matchId => setPlayerMatches(prev => prev.filter(x => x.id !== matchId))}
                />
              ))}
            </div>
            {playerMatches.length > 20 && (
              <p className="text-center text-sm text-slate-400 pt-2">
                Showing 20 of {playerMatches.length} fixtures
              </p>
            )}
          </>
        )}
      </section>

    </div>
  )
}

// Claim card: an unclaimed profile can be taken over by the player themselves or
// a parent/guardian. No verification — the master-admin link tool is the safety
// valve. Once claimed, the profile locks to further self-claims.
function ClaimCard({ person, onClaimed }) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  async function claim(relationship) {
    const label = relationship === 'player' ? 'This is you' : `You are ${person.fullName}'s parent/guardian`
    if (!window.confirm(`${label}? You'll be able to manage this profile.`)) return
    setBusy(true); setErr('')
    try {
      await claimPlayerProfile(person.id, relationship)
      onClaimed(relationship === 'parent'
        ? { guardianUids: [...(person.guardianUids ?? []), 'me'] }
        : { ownerUid: 'me' })
    } catch (e) {
      setErr(e.message || 'Could not claim this profile.')
    } finally { setBusy(false) }
  }

  return (
    <section>
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-400" />
        <div className="p-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1">Unclaimed profile</div>
          <div className="text-slate-900 font-bold text-sm mb-1">Is this you, or your child?</div>
          <p className="text-[12px] text-slate-500 leading-relaxed mb-3">
            Claim <span className="font-semibold">{person.fullName}</span> to manage the profile — edit details,
            add a photo and banner. If you're a parent you can later transfer it to the player.
          </p>
          {err && <p className="text-red-600 text-xs mb-2">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => claim('player')} disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg py-2.5 transition-colors">
              {busy ? '…' : "I'm the player"}
            </button>
            <button onClick={() => claim('parent')} disabled={busy}
              className="bg-white border border-emerald-300 hover:border-emerald-400 disabled:opacity-50 text-emerald-700 font-bold text-xs uppercase tracking-wider rounded-lg py-2.5 transition-colors">
              {busy ? '…' : "I'm a parent"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// Profile banner: a wide hero image at the top of the player card. The player
// (owner/guardian/manager) or a platform admin can upload one — stored at
// player-banners/{personId}, attached to the person doc as bannerUrl.
function ProfileBanner({ person, canEdit, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !storage) return
    setBusy(true); setErr('')
    try {
      const r = storageRef(storage, `player-banners/${person.id}`)
      await uploadBytes(r, file)
      const url = await getDownloadURL(r)
      await updatePersonBanner(person.id, url)
      onSaved(url)
    } catch (e2) {
      setErr(e2.message || 'Upload failed.')
    } finally { setBusy(false) }
  }

  if (!person.bannerUrl && !canEdit) return null

  return (
    <div className="relative">
      {person.bannerUrl ? (
        <img src={person.bannerUrl} alt="" className="w-full h-32 sm:h-44 object-cover" loading="lazy" />
      ) : (
        <label className={`flex items-center justify-center h-16 border-b border-dashed border-slate-200 text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors ${busy ? 'text-slate-300' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50/50'}`}>
          {busy ? 'Uploading…' : '+ Add banner image'}
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={handleUpload} />
        </label>
      )}
      {person.bannerUrl && canEdit && (
        <label className="absolute bottom-2 right-2 bg-white/90 hover:bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 cursor-pointer shadow-sm">
          {busy ? 'Uploading…' : 'Change banner'}
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={handleUpload} />
        </label>
      )}
      {err && <p className="absolute bottom-2 left-2 text-[11px] text-red-600 bg-white/90 rounded px-2 py-0.5">{err}</p>}
    </div>
  )
}
