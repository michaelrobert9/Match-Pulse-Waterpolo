import { AlertTriangle } from 'lucide-react'

function gdLabel(gd) {
  if (gd > 0) return `+${gd}`
  return String(gd)
}

function gdColor(gd) {
  if (gd > 0) return 'text-emerald-600'
  if (gd < 0) return 'text-red-500'
  return 'text-slate-400'
}

// Groups consecutive manual-decision rows into warning banners.
function buildManualGroups(rows) {
  const groups = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].manualDecisionRequired) {
      const start = i
      while (i < rows.length && rows[i].manualDecisionRequired && rows[i].pos === rows[start].pos) i++
      groups.push({ type: 'manual', pos: rows[start].pos, rows: rows.slice(start, i) })
    } else {
      groups.push({ type: 'row', row: rows[i] })
      i++
    }
  }
  return groups
}

const COLS = ['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts']

export default function StandingsTable({ rows = [] }) {
  if (rows.length === 0) {
    return <p className="text-center text-slate-500 text-sm py-12">No results yet — standings will appear once completed fixtures are recorded.</p>
  }

  const items = buildManualGroups(rows)

  return (
    <div className="overflow-x-auto">
      {/* Header */}
      <div className="flex items-center gap-0 px-3 py-2 mb-1">
        <div className="w-6 shrink-0" />
        <div className="flex-1 min-w-0" />
        {COLS.map(c => (
          <div key={c} className={`w-8 text-center text-[9px] font-bold uppercase tracking-widest ${c === 'Pts' ? 'text-emerald-600 w-10' : 'text-slate-500'}`}>
            {c}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {items.map((item, idx) => {
          if (item.type === 'manual') {
            return (
              <div key={`manual-${idx}`} className="rounded-xl border border-amber-300 bg-amber-50 overflow-hidden">
                {item.rows.map(row => (
                  <TeamRow key={row.teamId} row={row} />
                ))}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                    Manual decision required — position {item.pos}{item.rows.length > 1 ? `–${item.pos + item.rows.length - 1}` : ''} cannot be determined automatically
                  </span>
                </div>
              </div>
            )
          }
          return <TeamRow key={item.row.teamId} row={item.row} />
        })}
      </div>
    </div>
  )
}

function TeamRow({ row }) {
  const gd = row.GD ?? 0
  return (
    <div className="flex items-center gap-0 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="w-6 text-center text-[10px] font-bold font-mono text-slate-400 shrink-0 pl-2">
        {row.pos}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-3">
        <span className="text-slate-900 text-sm font-semibold truncate">{row.orgName ? `${row.orgName} ${row.teamName}` : row.teamName}</span>
      </div>
      {[row.P, row.W, row.D, row.L, row.GF, row.GA].map((val, ci) => (
        <div key={ci} className="w-8 text-center font-mono text-xs text-slate-500 py-3">{val ?? 0}</div>
      ))}
      <div className={`w-8 text-center font-mono text-xs py-3 ${gdColor(gd)}`}>{gdLabel(gd)}</div>
      <div className="w-10 text-center font-mono font-black text-sm text-slate-900 py-3 pr-2">{row.Pts ?? 0}</div>
    </div>
  )
}
