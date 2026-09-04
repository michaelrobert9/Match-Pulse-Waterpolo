import { useState, useEffect } from 'react'
import { monogram } from '../lib/names'
import { resolveTeamProfileIdentity } from '../lib/teamIdentity'

// Team crest for admin/manage lists, following the public org page template
// (OrgDetail's TeamCard): the team's resolved logo — its own when team-level
// management is on, otherwise the parent org's (the same inherit-vs-own rule
// the front end uses) — on a tile tinted with the team/org colour, else a
// monogram in that colour. Falls back to the monogram if the image fails to
// load.
export default function TeamListCrest({ team, org, name, size = 36, className = '' }) {
  const identity = resolveTeamProfileIdentity(team, org)
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [identity.image])
  const color   = team?.primaryColor || org?.primaryColor || '#555'
  const showImg = !!identity.image && ok
  return (
    <div
      className={`rounded-xl shrink-0 flex items-center justify-center ${className}`}
      style={{ width: size, height: size, backgroundColor: color + '20', border: `1.5px solid ${color}` }}
    >
      {showImg
        ? <img src={identity.image} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
        : <span className="font-bold font-mono" style={{ color, fontSize: Math.round(size * 0.28) }}>
            {monogram(name || '')}
          </span>
      }
    </div>
  )
}
