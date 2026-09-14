import { Link } from 'react-router-dom'
import { Info, ArrowRight } from 'lucide-react'

// Compact, read-only summary of the ranking configuration a competition's
// organiser chose — the points system and the tie-breaker chain, in the exact
// order the engine applies them. Shown above pool/standings tables so spectators
// can see how the table is decided. Reads the competition's OWN stored rules
// (competition.rules), so it always reflects what that organiser selected.
export default function RankingRulesCard({ competition }) {
  const rules = competition?.rules ?? {}
  const pts = rules.points ?? { win: 3, draw: 1, loss: 0 }
  const tieBreakers = (rules.tieBreakers ?? []).filter(t => t && t.label)
  const bonusOn = rules.bonusPoints?.enabled === true
  if (tieBreakers.length === 0) return null

  const usesH2H = tieBreakers.some(t => t.key === 'headToHeadMiniTable')

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">How teams are ranked</h3>
      </div>

      {/* Points */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 mb-2.5">
        <span className="font-semibold text-slate-700">Points</span>
        <span className="text-slate-300">·</span>
        <span>Win <b className="font-mono text-slate-900">{pts.win ?? 3}</b></span>
        <span>Draw <b className="font-mono text-slate-900">{pts.draw ?? 1}</b></span>
        <span>Loss <b className="font-mono text-slate-900">{pts.loss ?? 0}</b></span>
        {bonusOn && (<><span className="text-slate-300">·</span><span className="text-slate-500">bonus points on</span></>)}
      </div>

      {/* Tie-breaker chain, in order */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500 mr-0.5">If level, in order:</span>
        {tieBreakers.map((t, i) => (
          <span key={t.key} className="inline-flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-700 bg-slate-100 rounded-full px-2 py-0.5">{t.label}</span>
            {i < tieBreakers.length - 1 && <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />}
          </span>
        ))}
      </div>

      {usesH2H && (
        <Link to="/support/stats-standings/how-head-to-head-works"
          className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-emerald-600 hover:underline">
          Read more about how head-to-head works
          <ArrowRight className="w-3 h-3 shrink-0" />
        </Link>
      )}
    </div>
  )
}
