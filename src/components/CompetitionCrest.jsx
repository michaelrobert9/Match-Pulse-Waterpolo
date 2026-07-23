import { useState, useEffect } from 'react'
import { monogram } from '../lib/names'

// Competition crest: the competition's logo when set, otherwise a monogram of
// its name on an emerald tile. Falls back to the monogram if the image fails to
// load. Mirrors TeamCrest so competitions read consistently across the app.
export default function CompetitionCrest({ competition, size = 40, className = '' }) {
  const [ok, setOk] = useState(true)
  const logo = competition?.logoUrl
  useEffect(() => setOk(true), [logo])
  const showImg = !!logo && ok
  return (
    <div
      className={`rounded-xl shrink-0 flex items-center justify-center overflow-hidden ${showImg ? 'bg-white border border-slate-200' : 'bg-emerald-50 border border-emerald-100'} ${className}`}
      style={{ width: size, height: size }}
    >
      {showImg
        ? <img src={logo} alt="" className="w-full h-full object-contain" onError={() => setOk(false)} />
        : <span className="font-display font-black text-emerald-700 leading-none"
            style={{ fontSize: Math.round(size * 0.32) }}>
            {monogram(competition?.name)}
          </span>
      }
    </div>
  )
}
