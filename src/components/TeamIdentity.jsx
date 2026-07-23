import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTeamIdentity } from '../hooks/useTeamIdentity'
import { monogram } from '../lib/names'
import { teamPathSegment } from '../lib/slugify'

// Pure display of a resolved team identity.
//
//   identity: { primary, identifier, slug } — see lib/teamIdentity.js
//   Primary line:   full identity (org + gender/division + team), bold
//   Secondary line: optional identifier, small + muted (hidden if absent)
//
// If a slug is present the primary line links to the team profile.
export default function TeamIdentity({
  identity,
  align = 'left',
  nameClass = 'text-sm font-semibold text-slate-900',
  identifierClass = 'text-[11px] text-slate-400',
  hideIdentifier = false,
  noLink = false,
  className = '',
}) {
  if (!identity) return null
  const { primary, identifier, slug, orgSlug } = identity
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
  const outerClass = [alignClass, 'min-w-0', className].filter(Boolean).join(' ')
  const href = slug
    ? (orgSlug ? `/${orgSlug}/${teamPathSegment(slug, orgSlug)}` : `/team/${slug}`)
    : null

  return (
    <div className={outerClass}>
      <div className={`leading-tight ${nameClass}`}>
        {href && !noLink
          ? <Link to={href} className="hover:underline">{primary}</Link>
          : primary}
      </div>
      {!hideIdentifier && identifier && (
        <div className={`leading-tight mt-0.5 ${identifierClass}`}>{identifier}</div>
      )}
    </div>
  )
}

// Match-bound variant: resolves one side of a match (registered teams resolve
// from live data, manual opponents from match fallback) and renders it.
export function MatchTeamIdentity({ match, side, ...props }) {
  const identity = useTeamIdentity(match, side)
  return <TeamIdentity identity={identity} {...props} />
}

// Crest for a resolved identity: the team/org logo when present, otherwise an
// abbreviation (monogram of the full name) on the team's colour. Falls back to
// the monogram if the image fails to load.
export function TeamCrest({ identity, size = 40, className = '' }) {
  const [imgOk, setImgOk] = useState(true)
  const color   = identity?.color ?? '#94a3b8'
  const logo    = identity?.logo
  const showImg = !!logo && imgOk

  return (
    <div
      className={`rounded-xl shrink-0 flex items-center justify-center overflow-hidden ${className}`}
      style={{
        width: size, height: size,
        backgroundColor: showImg ? '#fff' : color,
        border: showImg ? '1px solid rgba(15,23,42,0.08)' : 'none',
      }}
    >
      {showImg
        ? <img src={logo} alt="" className="w-full h-full object-cover" onError={() => setImgOk(false)} />
        : <span className="font-display font-black text-white leading-none"
            style={{ fontSize: Math.round(size * 0.34) }}>
            {monogram(identity?.primary)}
          </span>
      }
    </div>
  )
}

// Match-bound crest: resolves one side of a match and renders its crest.
export function MatchTeamCrest({ match, side, ...props }) {
  const identity = useTeamIdentity(match, side)
  return <TeamCrest identity={identity} {...props} />
}

// Inline "Home vs Away" using resolved primary names only (no identifier line).
// For compact rows where a two-line block would not fit.
export function MatchVersus({ match, className = 'text-slate-900 text-sm font-semibold', vsClass = 'text-slate-400 font-normal' }) {
  const home = useTeamIdentity(match, 'home')
  const away = useTeamIdentity(match, 'away')
  return (
    <div className={className}>
      {home?.primary ?? match.homeTeamName} <span className={vsClass}>vs</span> {away?.primary ?? match.awayTeamName}
    </div>
  )
}
