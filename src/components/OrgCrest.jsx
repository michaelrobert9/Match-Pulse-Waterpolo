import { useState, useEffect } from 'react'
import { monogram } from '../lib/names'

// Organisation crest: the org's logo when set, otherwise a monogram of its name
// on a tile tinted with the org's primary colour. Falls back to the monogram if
// the image fails to load. Keeps org identity consistent wherever an org is
// listed (admin lists, manage panels, pickers) — mirrors TeamCrest /
// CompetitionCrest so every surface reads the same.
export default function OrgCrest({ org, size = 32, className = '' }) {
  const [ok, setOk] = useState(true)
  const logo = org?.logoUrl
  useEffect(() => setOk(true), [logo])
  const showImg = !!logo && ok
  const color = org?.primaryColor || '#555'
  return (
    <div
      className={`rounded-lg shrink-0 flex items-center justify-center ${className}`}
      style={{
        width: size, height: size,
        backgroundColor: showImg ? '#fff' : color + '20',
        border: `2px solid ${showImg ? 'rgba(15,23,42,0.08)' : color}`,
      }}
    >
      {showImg
        ? <img src={logo} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
        : <span className="font-bold font-mono leading-none"
            style={{ color, fontSize: Math.round(size * 0.28) }}>
            {monogram(org?.name)}
          </span>
      }
    </div>
  )
}
