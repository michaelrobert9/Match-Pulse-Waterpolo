import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus, Settings2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSeoMeta } from '../lib/useSeoMeta'
import {
  fetchLiveMatches, fetchTodayMatches, fetchRecentMatches,
  fetchAllCompetitions, fetchOrganizationsByType, toDate,
} from '../lib/queries'
import { matchUrl, competitionUrl, orgUrl } from '../lib/slugify'
import { competitionLifecycle } from '../lib/competitionRules'
import { prefetchMatchTeams } from '../lib/teamIdentity'
import { MatchTeamIdentity, MatchTeamCrest } from '../components/TeamIdentity'
import StatusBadge from '../components/StatusBadge'
import { BADGE_BASE, LIVE_DOT, ACTIVITY_STYLES } from '../lib/statusStyles'
import { monogram } from '../lib/names'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(d) {
  return d ? d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : null
}
function fmtDate(d) {
  return d ? d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : null
}

// Compute activity metadata for a competition from fetched live + today matches.
function compActivity(comp, liveMatches, todayMatches) {
  const live  = liveMatches.filter(m => m.competitionId === comp.id)
  const today = todayMatches.filter(m => m.competitionId === comp.id)
  if (live.length > 0) {
    return {
      pillVariant: 'live',
      line: `Live now · ${live.length} match${live.length !== 1 ? 'es' : ''}`,
      sortScore: 0,
    }
  }
  if (today.length > 0) {
    const t = fmtTime(toDate(today[0].scheduledAt))
    return {
      pillVariant: 'today',
      line: `${today.length} match${today.length !== 1 ? 'es' : ''} today${t ? ` · next ${t}` : ''}`,
      sortScore: 1,
    }
  }
  const startD = comp.startDate ? toDate(comp.startDate) : null
  return {
    pillVariant: 'upcoming',
    line: startD ? `Starts ${fmtDate(startD)}` : null,
    sortScore: 2,
  }
}

// ── Typography tokens ─────────────────────────────────────────────────────────

const LABEL_CLS = 'text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400'
const META_CLS  = 'text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400'

// ── Skeletons ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5 animate-pulse h-14" />
  )
}
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse h-28" />
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ label, action, dot }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {dot && <span className={LIVE_DOT} />}
        <span className={dot ? 'text-[11px] font-bold uppercase tracking-[0.1em] text-red-500' : LABEL_CLS}>
          {label}
        </span>
      </div>
      {action}
    </div>
  )
}

function AllLink({ to }) {
  return (
    <Link to={to} className="text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-600 hover:text-emerald-500 transition-colors">
      All →
    </Link>
  )
}

// ── Activity pill (competition context) ───────────────────────────────────────
// Colour tokens live in lib/statusStyles.js so the palette is defined once.

const PILL_LABEL = { live: 'Live', today: 'Today', upcoming: 'Upcoming' }

function ActivityPill({ variant }) {
  return (
    <span className={`${BADGE_BASE} ${ACTIVITY_STYLES[variant] ?? ACTIVITY_STYLES.upcoming}`}>
      {variant === 'live' && <span className={LIVE_DOT} />}
      {PILL_LABEL[variant] ?? variant}
    </span>
  )
}

// ── Competition logo badge ─────────────────────────────────────────────────────

function CompBadge({ comp, size = 40 }) {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [comp.logoUrl])
  if (comp.logoUrl && ok) {
    return (
      <div className="rounded-xl shrink-0 overflow-hidden bg-white border border-slate-200 flex items-center justify-center"
        style={{ width: size, height: size }}>
        <img src={comp.logoUrl} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
      </div>
    )
  }
  return (
    <div className="rounded-xl shrink-0 flex items-center justify-center bg-emerald-50 border border-emerald-100"
      style={{ width: size, height: size }}>
      <span className="font-display font-black text-emerald-700 leading-none"
        style={{ fontSize: Math.round(size * 0.32) }}>
        {monogram(comp.name)}
      </span>
    </div>
  )
}

// ── Org logo badge ─────────────────────────────────────────────────────────────

function OrgBadge({ org, size = 36 }) {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [org.logoUrl])
  const color = org.primaryColor || '#555'
  if (org.logoUrl && ok) {
    return (
      <div className="rounded-lg shrink-0 overflow-hidden bg-white border border-slate-200 flex items-center justify-center"
        style={{ width: size, height: size }}>
        <img src={org.logoUrl} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
      </div>
    )
  }
  return (
    <div className="rounded-lg shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
      <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>
    </div>
  )
}

// ── Featured live match card ───────────────────────────────────────────────────

function FeaturedLiveCard({ match }) {
  const homeScore = match.homeScore ?? 0
  const awayScore = match.awayScore ?? 0
  const koStr     = fmtTime(toDate(match.scheduledAt))
  return (
    <Link to={matchUrl(match)}
      className="block relative overflow-hidden bg-white rounded-2xl border border-red-200 px-5 py-4 hover:border-red-300 shadow-sm card-lift">
      <div className="absolute left-0 inset-y-0 w-1 bg-red-500 rounded-l-2xl" />

      <div className="flex items-center gap-2 mb-4">
        <StatusBadge status="live" />
        {match.currentPeriod && (
          <span className="font-mono text-[10px] text-slate-500 uppercase tracking-widest">{match.currentPeriod}</span>
        )}
        {koStr && (
          <span className="font-mono text-[10px] text-slate-400 uppercase tracking-widest">KO {koStr}</span>
        )}
        {match.pitch && <span className="text-[10px] text-slate-400 ml-auto truncate">{match.pitch}</span>}
      </div>

      {/* Score layout: [crest + name] [score] [name + crest] */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2.5">
          <MatchTeamCrest match={match} side="home" size={36} />
          <MatchTeamIdentity match={match} side="home" hideIdentifier
            nameClass="text-slate-900 font-semibold text-sm leading-snug" />
        </div>
        <div className="shrink-0 px-1 text-center">
          <span className="font-mono font-black tabular-nums leading-none text-slate-900"
            style={{ fontSize: 'clamp(36px,7vw,52px)' }}>
            {homeScore}<span className="text-slate-300 font-normal mx-1">–</span>{awayScore}
          </span>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2.5 justify-end">
          <MatchTeamIdentity match={match} side="away" hideIdentifier align="right"
            nameClass="text-slate-900 font-semibold text-sm leading-snug" />
          <MatchTeamCrest match={match} side="away" size={36} />
        </div>
      </div>
    </Link>
  )
}

// ── Match row (collision-fix) ──────────────────────────────────────────────────
// Three-column grid: [home zone | fixed center | away zone]
// Names wrap freely inside their zones; center column never overflows.

function MatchRow({ match, variant = 'upcoming' }) {
  const d         = toDate(match.scheduledAt)
  const timeStr   = fmtTime(d)
  const homeScore = match.homeScore ?? 0
  const awayScore = match.awayScore ?? 0

  const homeName = match.homeTeamName || match.homeOrgName
  const awayName = match.awayTeamName || match.awayOrgName
  if (!homeName && !awayName) return null

  return (
    <Link to={matchUrl(match)}
      className="grid grid-cols-[1fr_72px_1fr] items-center gap-x-2 bg-white rounded-xl border border-slate-200 px-3 py-3 hover:border-slate-300 shadow-sm card-lift min-h-[44px]">

      {/* Home zone: crest left of name */}
      <div className="flex items-center gap-2 min-w-0">
        <MatchTeamCrest match={match} side="home" size={28} />
        <MatchTeamIdentity match={match} side="home" hideIdentifier
          nameClass="text-slate-900 font-semibold text-[13px] leading-snug" />
      </div>

      {/* Fixed center */}
      <div className="flex flex-col items-center justify-center shrink-0 min-h-[1.5rem]">
        {variant === 'result' ? (
          <>
            <span className="font-mono font-black text-base tabular-nums text-slate-900 leading-none">
              {homeScore}–{awayScore}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">FT</span>
          </>
        ) : (
          <>
            {timeStr && (
              <span className="font-mono text-sm font-bold tabular-nums text-slate-700 leading-none">{timeStr}</span>
            )}
            {!timeStr && <span className="text-[10px] text-slate-400">TBC</span>}
            {match.pitch && (
              <span className="text-[10px] text-slate-400 leading-none mt-0.5 truncate max-w-full">{match.pitch}</span>
            )}
          </>
        )}
      </div>

      {/* Away zone: name left of crest */}
      <div className="flex items-center gap-2 min-w-0 justify-end">
        <MatchTeamIdentity match={match} side="away" hideIdentifier align="right"
          nameClass="text-slate-900 font-semibold text-[13px] leading-snug" />
        <MatchTeamCrest match={match} side="away" size={28} />
      </div>
    </Link>
  )
}

// ── Competition hero card ──────────────────────────────────────────────────────

function CompCard({ comp, liveMatches, todayMatches }) {
  const { pillVariant, line } = compActivity(comp, liveMatches, todayMatches)
  const metaParts = [
    comp.type,
    comp.ageGroup,
    comp.gender,
    comp.season,
  ].filter(Boolean)

  return (
    <Link to={competitionUrl(comp)}
      className="flex items-start gap-3.5 bg-white rounded-xl border border-slate-200 px-5 py-4 hover:border-slate-300 shadow-sm card-lift">
      <CompBadge comp={comp} size={40} />
      <div className="flex-1 min-w-0">
        {/* Name — two-line clamp */}
        <div className="font-display font-bold text-slate-900 text-sm leading-snug line-clamp-2 mb-1">
          {comp.name}
        </div>
        {/* Meta + pill row */}
        <div className="flex items-center gap-2 flex-wrap">
          <ActivityPill variant={pillVariant} />
          {metaParts.length > 0 && (
            <span className={META_CLS}>{metaParts.map(p => p.toUpperCase()).join(' · ')}</span>
          )}
        </div>
        {/* Activity line */}
        {line && (
          <div className="text-[11px] text-slate-500 mt-1 leading-snug">{line}</div>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
    </Link>
  )
}

// ── Org row ───────────────────────────────────────────────────────────────────

function OrgRow({ org }) {
  return (
    <Link to={orgUrl(org)}
      className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 shadow-sm card-lift min-h-[44px]">
      <OrgBadge org={org} size={36} />
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 text-sm font-semibold truncate">{org.name}</div>
        {org.region && <div className={`${META_CLS} mt-0.5`}>{org.region}</div>}
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </Link>
  )
}

// ── Home ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const { user, isPlatformAdmin, canScore, loading: authLoading } = useAuth()
  useSeoMeta({ type: 'home' })

  const [dataLoading, setDataLoading] = useState(true)
  const [error,       setError]       = useState(null)
  const [live,        setLive]        = useState([])
  const [today,       setToday]       = useState([])
  const [recent,      setRecent]      = useState([])
  const [comps,       setComps]       = useState([])
  const [schools,     setSchools]     = useState([])
  const [clubs,       setClubs]       = useState([])

  function load() {
    setDataLoading(true)
    setError(null)
    Promise.allSettled([
      fetchLiveMatches(10),
      fetchTodayMatches(),
      fetchRecentMatches(8),
      fetchAllCompetitions(),
      fetchOrganizationsByType('school'),
      fetchOrganizationsByType('club'),
    ]).then(results => {
      const [liveR, todayR, recentR, compsR, schoolsR, clubsR] = results
      const liveM   = liveR.status  === 'fulfilled' ? liveR.value  : []
      const todayM  = todayR.status === 'fulfilled' ? todayR.value : []
      const recentM = recentR.status === 'fulfilled' ? recentR.value : []
      const allComps = compsR.status === 'fulfilled' ? compsR.value : []
      const schoolList = schoolsR.status === 'fulfilled' ? schoolsR.value : []
      const clubList   = clubsR.status   === 'fulfilled' ? clubsR.value   : []

      prefetchMatchTeams([...liveM, ...todayM, ...recentM])

      // Filter + sort competitions for homepage
      const homeComps = allComps
        .filter(c => c.published !== false && competitionLifecycle(c) !== 'completed')
        .map(c => ({ ...c, _activity: compActivity(c, liveM, todayM) }))
        .sort((a, b) =>
          a._activity.sortScore !== b._activity.sortScore
            ? a._activity.sortScore - b._activity.sortScore
            : (a.name || '').localeCompare(b.name || '')
        )
        .slice(0, 8)

      setLive(liveM)
      setToday(todayM)
      setRecent(recentM)
      setComps(homeComps)
      setSchools(schoolList.slice(0, 5))
      setClubs(clubList.slice(0, 5))

      if (results.every(r => r.status === 'rejected')) {
        const reason = results.find(r => r.status === 'rejected')?.reason
        setError({ code: reason?.code ?? 'unknown', message: reason?.message ?? String(reason ?? 'Unknown error') })
      }
    }).finally(() => setDataLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return (
    <div className="px-4 py-20 flex flex-col items-center gap-4">
      <p className="text-slate-600 text-sm text-center">Something went wrong loading the page.</p>
      <p className="text-[11px] font-mono text-red-500 text-center break-words max-w-sm">{error.code}: {error.message}</p>
      <button onClick={load}
        className="text-sm text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors">
        Try again
      </button>
    </div>
  )

  const noOrgYet = !authLoading && user && !isPlatformAdmin && !canScore

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 pb-12 page-enter space-y-8">

      {/* Admin shortcut */}
      {isPlatformAdmin && (
        <Link to="/admin"
          className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 hover:bg-amber-100 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
            <Settings2 className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-700">Admin dashboard</div>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-500 shrink-0" />
        </Link>
      )}

      {/* Create org CTA */}
      {noOrgYet && (
        <Link to="/manage/new-org"
          className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3.5 hover:bg-emerald-100 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900">Create your school or club</div>
            <div className="text-[11px] text-emerald-700 mt-0.5">Start managing fixtures in minutes</div>
          </div>
          <ChevronRight className="w-4 h-4 text-emerald-500 shrink-0" />
        </Link>
      )}

      {/* ── 1. LIVE NOW ─────────────────────────────────────────────────────── */}
      {!dataLoading && live.length > 0 && (
        <section>
          <SectionHead label="Live now" dot />
          <div className="space-y-3">
            {live.map(m => <FeaturedLiveCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* ── 2. COMPETITIONS ──────────────────────────────────────────────── */}
      {(dataLoading || comps.length > 0) && (
        <section>
          <SectionHead label="Competitions" action={<AllLink to="/browse" />} />
          {dataLoading
            ? <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
            : <div className="space-y-2">
                {comps.map(c => (
                  <CompCard key={c.id} comp={c} liveMatches={live} todayMatches={today} />
                ))}
              </div>
          }
        </section>
      )}

      {/* ── 3. TODAY'S FIXTURES ─────────────────────────────────────────────── */}
      {!dataLoading && today.length > 0 && (
        <section>
          <SectionHead
            label={`Today · ${new Date().toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}`}
          />
          <div className="space-y-2">
            {today.map(m => <MatchRow key={m.id} match={m} variant="upcoming" />)}
          </div>
        </section>
      )}

      {/* ── 4. RECENT RESULTS ─────────────────────────────────────────────── */}
      {(dataLoading || recent.length > 0) && (
        <section>
          <SectionHead label="Recent results" />
          {dataLoading
            ? <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonRow key={i} />)}</div>
            : <div className="space-y-2">
                {recent.map(m => <MatchRow key={m.id} match={m} variant="result" />)}
              </div>
          }
        </section>
      )}

      {/* ── 5. BROWSE ───────────────────────────────────────────────────────── */}
      <section>
        <SectionHead label="Browse" />
        {dataLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <SkeletonRow key={i} />)}</div>
        ) : (
          <div className="space-y-4">
            {schools.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={META_CLS}>Schools</span>
                  <AllLink to="/schools" />
                </div>
                <div className="space-y-2">
                  {schools.map(o => <OrgRow key={o.id} org={o} />)}
                </div>
              </div>
            )}
            {clubs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={META_CLS}>Clubs</span>
                  <AllLink to="/clubs" />
                </div>
                <div className="space-y-2">
                  {clubs.map(o => <OrgRow key={o.id} org={o} />)}
                </div>
              </div>
            )}
            {schools.length === 0 && clubs.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No organisations registered yet.</p>
            )}
          </div>
        )}
      </section>

    </div>
  )
}
