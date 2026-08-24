import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, AlertTriangle, Inbox, RefreshCw, Check, GraduationCap, Landmark, Trophy, CalendarDays, User, ChevronRight } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { isPastExpectedEnd } from '../../lib/matchClock'
import { rebuildAllCareerStats } from '../../lib/adminQueries'

// Platform-admin wholesale career rebuild. Runs the same engine as the nightly
// job on demand — meant for deploy day (populate career totals immediately
// instead of waiting for 03:00) and operator use. Competition stats rebuild on
// finalisation; this fills in the cross-competition career rollup.
function CareerRebuildCard() {
  const [phase,  setPhase]  = useState('idle') // idle | confirm | running | done | error
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  async function run() {
    setPhase('running')
    try {
      setResult(await rebuildAllCareerStats())
      setPhase('done')
    } catch (e) {
      setErrMsg(e.message || 'Rebuild failed.')
      setPhase('error')
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-sm font-semibold text-slate-900 mb-1">Rebuild all career stats now</div>
      <p className="text-[12px] text-slate-500 leading-relaxed mb-3">
        Recomputes every player's career totals (and competition records) from match history across
        all competitions. Runs automatically each night — use this to populate them immediately, e.g.
        right after a deploy. Safe to run repeatedly; results are identical each run.
      </p>

      {phase === 'idle' && (
        <button onClick={() => setPhase('confirm')}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 rounded-lg px-3 py-2 transition-colors">
          <RefreshCw className="w-4 h-4" /> Rebuild career stats
        </button>
      )}

      {phase === 'confirm' && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-700">Rebuild now? This may take a minute.</span>
          <button onClick={run}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-3 py-2 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Yes, rebuild
          </button>
          <button onClick={() => setPhase('idle')} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-2 transition-colors">
            Cancel
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Rebuilding career stats…
        </div>
      )}

      {phase === 'done' && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
            <Check className="w-4 h-4" />
            Done — {result?.matchCount ?? 0} Final matches, {result?.sliceCount ?? 0} team/competition records
            {result?.createdCount > 0 && ` (${result.createdCount} newly created from lineups)`},
            {' '}{result?.personCount ?? 0} player careers rebuilt.
          </span>
          <button onClick={() => setPhase('idle')} className="text-xs text-slate-400 hover:text-slate-600">Reset</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-600">{errMsg}</span>
          <button onClick={() => setPhase('idle')} className="text-xs text-slate-400 hover:text-slate-600">Dismiss</button>
        </div>
      )}
    </div>
  )
}

// A navigation card mirroring one sidebar destination: icon, label and a live
// count, linking straight to that section. These make the dashboard the visual
// index of the new nav.
function NavCard({ Icon, label, count, to, accent = false }) {
  return (
    <Link to={to}
      className={`group flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors shadow-sm ${
        accent
          ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
          : 'bg-white border-slate-200 hover:border-slate-300'
      }`}>
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
        accent ? 'bg-emerald-100 border border-emerald-200' : 'bg-slate-100 border border-slate-200'
      }`}>
        <Icon className={`w-4.5 h-4.5 ${accent ? 'text-emerald-600' : 'text-slate-500'}`} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 truncate">{label}</div>
        {count != null && (
          <div className="font-mono tabular-nums text-[11px] text-slate-500 mt-0.5">{count}</div>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
    </Link>
  )
}

export default function AdminDashboard() {
  const { user } = useAuth()
  const [counts, setCounts] = useState({})

  const [unfinished, setUnfinished] = useState([])
  const [awaitingCount, setAwaitingCount] = useState(0)

  useEffect(() => {
    async function load() {
      try {
        const [comps, orgs, people, live, paused, awaiting] = await Promise.all([
          getDocs(collection(db, 'competitions')),
          getDocs(collection(db, 'organizations')),
          getDocs(collection(db, 'people')),
          getDocs(query(collection(db, 'matches'), where('status', '==', 'live'))),
          getDocs(query(collection(db, 'matches'), where('status', '==', 'paused'))),
          getDocs(query(collection(db, 'matches'), where('status', '==', 'awaiting_result'))),
        ])
        const liveDocs = [...live.docs, ...paused.docs].map(d => ({ id: d.id, ...d.data() }))
        const orgTypes = orgs.docs.reduce((acc, d) => {
          const t = d.data().type
          if (t === 'school') acc.schools++
          else if (t === 'association') acc.associations++
          else acc.clubs++
          return acc
        }, { schools: 0, clubs: 0, associations: 0 })
        setCounts({
          competitions: comps.size,
          organizations: orgs.size,
          people: people.size,
          live: liveDocs.length,
          ...orgTypes,
        })
        // §7: a tracked match still live well past its expected end may have been
        // abandoned by the scorer. Surface it — the admin can end it on the
        // scorer's behalf from the score screen. (The daily sweep is the backstop;
        // this flag just gets it fixed sooner.)
        setUnfinished(liveDocs.filter(m => m.tracked === true && isPastExpectedEnd(m)))
        setAwaitingCount(awaiting.size)
      } catch { /* Firestore not yet configured */ }
    }
    load()
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-8">
      <div>
        <div className="micro-label text-slate-500">Signed in as</div>
        <div className="text-slate-900 text-sm font-medium mt-0.5">{user?.email}</div>
      </div>

      {counts.live > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <div>
            <div className="text-red-600 text-sm font-semibold">{counts.live} match{counts.live !== 1 ? 'es' : ''} live</div>
            <Link to="/manage/competitions" className="text-[11px] text-red-500 hover:text-red-700 transition-colors">View live →</Link>
          </div>
        </div>
      )}

      {/* Results awaiting human confirmation (spec §6). */}
      {awaitingCount > 0 && (
        <Link to="/admin/result-queue"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 hover:border-amber-300 transition-colors">
          <Inbox className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <div className="text-amber-700 text-sm font-semibold">
              {awaitingCount} result{awaitingCount !== 1 ? 's' : ''} awaiting confirmation
            </div>
            <span className="text-[11px] text-amber-600">Approve or edit to make Final →</span>
          </div>
        </Link>
      )}

      {/* Possibly-unfinished tracked matches (spec §7) — surfaced to a human. */}
      {unfinished.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
            <span className="text-orange-700 text-sm font-semibold">
              {unfinished.length} match{unfinished.length !== 1 ? 'es' : ''} possibly unfinished
            </span>
          </div>
          <p className="text-[11px] text-orange-600 mb-2">
            Live well past expected full-time — a scorer may have walked away. End it on their behalf:
          </p>
          <div className="space-y-1">
            {unfinished.map(m => (
              <Link key={m.id} to={`/score/${m.id}`}
                className="flex items-center justify-between gap-2 text-xs text-orange-800 hover:text-orange-900 bg-white/60 rounded-lg px-3 py-2 transition-colors">
                <span className="truncate">{m.homeTeamName || 'Home'} vs {m.awayTeamName || 'Away'}</span>
                <span className="font-bold uppercase tracking-wider shrink-0">End →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Jump to — the dashboard as a visual index of the nav. */}
      <div>
        <div className="micro-label text-slate-500 mb-3">Jump to</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <NavCard Icon={Trophy}       label="Competitions"     count={counts.competitions != null ? `${counts.competitions} total` : null}       to="/manage/competitions" />
          <NavCard Icon={CalendarDays} label="My matches"       count={counts.live ? `${counts.live} live now` : 'View all'}                        to="/admin/matches" accent={counts.live > 0} />
          <NavCard Icon={Inbox}        label="Awaiting results" count={awaitingCount ? `${awaitingCount} to confirm` : 'All clear'}                  to="/admin/result-queue" accent={awaitingCount > 0} />
          <NavCard Icon={User}         label="People"           count={counts.people != null ? `${counts.people} total` : null}                     to="/admin/people" />
          <NavCard Icon={GraduationCap} label="My schools"      count={counts.schools != null ? `${counts.schools} total` : null}                   to="/admin/schools" />
          <NavCard Icon={Building2}    label="My clubs"         count={counts.clubs != null ? `${counts.clubs} total` : null}                       to="/admin/clubs" />
          <NavCard Icon={Landmark}     label="My associations"  count={counts.associations != null ? `${counts.associations} total` : null}         to="/admin/associations" />
        </div>
      </div>

      {/* Quick create actions. */}
      <div>
        <div className="micro-label text-slate-500 mb-3">Create</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { to: '/match/new',                label: 'Create match',       accent: true },
            { to: '/manage/competitions/new',  label: 'New competition' },
            { to: '/admin/organizations/new',  label: 'New school, club or association' },
            { to: '/admin/people/new',         label: 'New person' },
          ].map(a => (
            <Link key={a.to} to={a.to}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors shadow-sm ${
                a.accent ? 'bg-white border-emerald-200 hover:border-emerald-300' : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                a.accent ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-100 border border-slate-200'
              }`}>
                <Plus className={`w-4 h-4 ${a.accent ? 'text-emerald-600' : 'text-slate-500'}`} />
              </span>
              <span className={`text-sm font-semibold ${a.accent ? 'text-emerald-700' : 'text-slate-900'}`}>{a.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <div className="micro-label text-slate-500 mb-3">Maintenance</div>
        <CareerRebuildCard />
        <Link to="/admin/team-governance"
          className="mt-3 flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
          <span className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-slate-500" />
          </span>
          <span className="text-sm font-medium text-slate-900">Team governance review</span>
        </Link>
      </div>

      <div className="pt-2 border-t border-slate-200">
        <Link to="/" className="text-[11px] text-slate-500 hover:text-slate-700 transition-colors">← View public site</Link>
      </div>
    </div>
  )
}
