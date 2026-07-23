import { outcomeBanner } from '../lib/fixtureResult'

// Red status banner shown ABOVE the normal score slot when a fixture ended
// without a normal played result. Names the state and, where present, the
// reason. The score below it is read by standings/stats per the banner flag.
export default function FixtureBanner({ match, className = '' }) {
  const b = outcomeBanner(match)
  if (!b) return null
  const tone = b.tone === 'slate'
    ? 'bg-slate-100 border-slate-200 text-slate-600'
    : 'bg-red-50 border-red-200 text-red-700'
  return (
    <div className={`rounded-lg border px-3 py-1.5 text-center ${tone} ${className}`}>
      <span className="text-[11px] font-bold uppercase tracking-widest">{b.label}</span>
      {b.reason && <span className="block text-[11px] font-normal normal-case tracking-normal opacity-80 mt-0.5">{b.reason}</span>}
    </div>
  )
}
