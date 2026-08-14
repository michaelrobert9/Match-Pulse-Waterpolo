import { useState, useEffect } from 'react'
import { monogram } from '../lib/names'
import { resolveTeamProfileIdentity } from '../lib/teamIdentity'

// Team crest for admin/manage lists. Shows the team's resolved logo — its own
// when team-level management is on, otherwise the parent org's (the same
// inherit-vs-own rule the front end uses) — on white, else a monogram tinted
// with the team's colour. Mirrors OrgCrest so lists read the same, and falls
// back to the monogram if the image fails to load.
export default function TeamListCrest({ team, org, name, size = 32, className = '' }) {
  const logo = resolveTeamProfileIdentity(team, org).image
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [logo])
  const showImg = !!logo && ok
  const color = team?.primaryColor || '#333'
  return (
    <div
      className={`rounded-lg shrink-0 flex items-center justify-center overflow-hidden ${className}`}
      style={{
        width: size, height: size,
        backgroundColor: showImg ? '#fff' : color + '25',
        border: `2px solid ${showImg ? 'rgba(15,23,42,0.08)' : color}`,
      }}
    >
      {showImg
        ? <img src={logo} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
        : <span className="font-bold font-mono leading-none"
            style={{ color, fontSize: Math.round(size * 0.28) }}>
            {monogram(name || '')}
          </span>
      }
    </div>
  )
}
