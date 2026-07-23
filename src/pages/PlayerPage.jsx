import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { fetchPerson, fetchCareerForPerson, fetchOrganization, toDate } from '../lib/queries'
import { orgUrl } from '../lib/slugify'
import { monogram } from '../lib/names'

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

function EmptyCard({ message }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center shadow-sm">
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  )
}

function OrgCard({ org }) {
  const color = org.primaryColor || '#334155'
  const url   = org.slug ? orgUrl(org) : null
  const inner = (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors shadow-sm">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
        style={{ backgroundColor: color + '20', border: `1.5px solid ${color}` }}>
        {org.logoUrl
          ? <img src={org.logoUrl} alt="" className="w-full h-full object-contain" />
          : <span className="text-[10px] font-bold font-mono" style={{ color }}>{monogram(org.name)}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-slate-900 text-sm font-semibold truncate">{org.name}</div>
        {org.type && <div className="micro-label capitalize">{org.type}</div>}
      </div>
      {url && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
    </div>
  )
  return url ? <Link to={url}>{inner}</Link> : <div>{inner}</div>
}

function CareerCard({ player }) {
  const total = (player.cards?.green ?? 0) + (player.cards?.yellow ?? 0) + (player.cards?.red ?? 0)
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="h-1" style={{ backgroundColor: player.teamPrimaryColor || '#94a3b8' }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3">
            <div className="w-3 h-3 rounded-sm mt-1 shrink-0"
              style={{ backgroundColor: player.teamPrimaryColor || '#94a3b8' }} />
            <div>
              <div className="text-slate-900 font-semibold text-sm leading-tight">{player.teamDisplayName}</div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="micro-label">{player.competitionName || (!player.competitionId ? 'Friendlies & other fixtures' : 'Fixtures')}</span>
                {(player.competitionSeason || player.season) && (
                  <><span className="micro-label text-slate-300">·</span>
                  <span className="micro-label">{player.competitionSeason || player.season}</span></>
                )}
              </div>
            </div>
          </div>
          <span className="micro-label text-slate-400 shrink-0">#{player.shirtNumber}</span>
        </div>
        <div className="grid grid-cols-4 gap-0 border-t border-slate-200 pt-3">
          {[
            { val: player.caps,  label: 'Caps',  cls: 'text-slate-900' },
            { val: player.goals, label: 'Goals', cls: 'text-emerald-600' },
            {
              val: player.goals > 0 && player.caps > 0
                ? (player.goals / player.caps).toFixed(2) : '—',
              label: 'Avg', cls: 'text-slate-900'
            },
            { val: total || '—', label: 'Cards', cls: 'text-slate-900' },
          ].map(({ val, label, cls }, i) => (
            <div key={label} className={`flex flex-col items-center${i > 0 ? ' border-l border-slate-200' : ''}`}>
              <span className={`font-mono font-black text-xl tabular-nums ${cls}`}>{val}</span>
              <span className="micro-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function PlayerPage() {
  const { id } = useParams()
  const [person,  setPerson]  = useState(null)
  const [career,  setCareer]  = useState([])
  const [orgs,    setOrgs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setNotFound(false)
    fetchPerson(id)
      .then(async p => {
        if (!alive) return
        if (!p) { setNotFound(true); return }
        setPerson(p)
        document.title = `${p.fullName} · MatchPulse`
        const [c, orgDocs] = await Promise.all([
          fetchCareerForPerson(p.id),
          Promise.all((p.representativeOrgs ?? []).map(o => fetchOrganization(o.orgId))),
        ])
        if (alive) {
          setCareer(c)
          setOrgs(orgDocs.filter(Boolean))
        }
      })
      .catch(() => { if (alive) setNotFound(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  if (loading) return <Spinner />

  if (notFound || !person) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-slate-500 text-sm mb-4">Player not found.</p>
        <Link to="/players" className="text-emerald-600 text-sm hover:underline">← Back to players</Link>
      </div>
    )
  }

  const initials = person.fullName
    .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  const totalCards =
    (person.careerCards?.green  ?? 0) +
    (person.careerCards?.yellow ?? 0) +
    (person.careerCards?.red    ?? 0)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">

      {/* Hero */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="h-2 bg-gradient-to-r from-emerald-500 to-emerald-400" />
        <div className="p-5 flex items-start gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
            {person.photoUrl
              ? <img src={person.photoUrl} alt={person.fullName} className="w-full h-full object-cover object-top" />
              : <span className="text-lg font-bold font-mono text-slate-500">{initials}</span>}
          </div>

          {/* Name + meta */}
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

        {/* Career stats bar */}
        <div className="grid grid-cols-4 divide-x divide-slate-200 border-t border-slate-200">
          <div className="flex flex-col items-center py-3">
            <span className="font-mono font-black text-2xl tabular-nums text-slate-900 leading-none">{person.careerCaps ?? 0}</span>
            <span className="micro-label mt-0.5">Caps</span>
          </div>
          <div className="flex flex-col items-center py-3">
            <span className="font-mono font-black text-2xl tabular-nums text-emerald-600 leading-none">{person.careerGoals ?? 0}</span>
            <span className="micro-label mt-0.5">Goals</span>
          </div>
          <div className="flex flex-col items-center py-3">
            <span className="font-mono font-black text-2xl tabular-nums text-slate-900 leading-none">{person.careerAssists ?? 0}</span>
            <span className="micro-label mt-0.5">Assists</span>
          </div>
          <div className="flex flex-col items-center py-3">
            <span className="font-mono font-black text-2xl tabular-nums text-slate-900 leading-none">{totalCards || 0}</span>
            <span className="micro-label mt-0.5">Cards</span>
          </div>
        </div>
      </div>

      {/* Representative organisations */}
      <section>
        <SectionHeader title="Represents" />
        {orgs.length === 0 ? (
          <EmptyCard message="No representative organisations listed." />
        ) : (
          <div className="space-y-2">
            {orgs.map(org => <OrgCard key={org.id} org={org} />)}
          </div>
        )}
      </section>

      {/* Career history */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Career history" />
          <Link to={`/people/${person.id}`} className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:underline">
            Full stats →
          </Link>
        </div>
        {career.length === 0 ? (
          <EmptyCard message="No fixtures recorded yet." />
        ) : (
          <div className="space-y-2">
            {career.slice(0, 5).map(p => <CareerCard key={p.id} player={p} />)}
            {career.length > 5 && (
              <Link to={`/people/${person.id}`}
                className="block text-center text-sm text-emerald-600 hover:underline py-2">
                View all {career.length} records →
              </Link>
            )}
          </div>
        )}
      </section>

    </div>
  )
}
