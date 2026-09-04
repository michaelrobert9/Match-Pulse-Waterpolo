import { useState, useEffect } from 'react'
import { monogram } from '../lib/names'

// Competition crest: the competition's logo when set, otherwise a monogram of
// its name on an emerald tile. Falls back to the monogram if the image fails to
// load. Mirrors TeamCrest so competitions read consistently across the app.
export default function CompetitionCrest({ competition, size = 40, className = '' }) {
  const [ok, setOk] = useState(true)
  const logo = competition?.logoUrl
  const color = competition?.primaryColor || '#059669'
  useEffect(() => setOk(true), [logo])
  const showImg = !!logo && ok
  return (
    <div
      className={`rounded-xl shrink-0 flex items-center justify-center ${className}`}
      style={{
        width: size, height: size,
        backgroundColor: showImg ? '#fff' : color + '14',
        border: `1px solid ${showImg ? 'rgba(15,23,42,0.08)' : color + '33'}`,
      }}
    >
      {showImg
        ? <img src={logo} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
        : <span className="font-display font-black leading-none"
            style={{ fontSize: Math.round(size * 0.32), color }}>
            {monogram(competition?.name)}
          </span>
      }
    </div>
  )
}
