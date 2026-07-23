import { useState, useEffect } from 'react'
import { monogram } from '../lib/names'

// Person/player avatar. Renders the profile photo when present, otherwise the
// initials of the name on a neutral background. Falls back to initials if the
// image fails to load. Used everywhere a person is shown — directories, match
// timelines, the live scoring console lineup and attribution sheets.
export default function PersonAvatar({ name, photoUrl, size = 32, className = '' }) {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(true), [photoUrl])
  const showImg = !!photoUrl && ok
  return (
    <div
      className={`rounded-lg shrink-0 flex items-center justify-center overflow-hidden bg-slate-100 border border-slate-200 ${className}`}
      style={{ width: size, height: size }}
    >
      {showImg
        ? <img src={photoUrl} alt="" className="w-full h-full object-cover object-top" onError={() => setOk(false)} />
        : <span className="font-mono font-bold text-slate-500 leading-none"
            style={{ fontSize: Math.round(size * 0.36) }}>
            {monogram(name)}
          </span>
      }
    </div>
  )
}
