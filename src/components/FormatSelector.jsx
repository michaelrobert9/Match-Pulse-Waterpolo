// FormatSelector — outdoor/indoor, periods (1-4), minutes per period
// (0-60 spinner), and per-break duration between each pair of consecutive
// periods. onChange receives { periods, periodMinutes, breakMinutes, indoor }
// where breakMinutes is an array of length (periods - 1).

function clampMinutes(v) { return Math.max(0, Math.min(60, Number(v) || 0)) }
function clampBreak(v)   { return Math.max(0, Math.min(60, Number(v) || 0)) }

function MinuteSpinner({ value, onChange, min = 0, max = 60, label }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-slate-600 min-w-0 flex-1">{label}</span>}
      <div className="flex items-center gap-1 shrink-0">
        <button type="button"
          onClick={() => onChange(Math.max(min, Number(value) - 1))}
          className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-900 text-sm font-bold transition-colors flex items-center justify-center">
          −
        </button>
        <input
          type="number" min={min} max={max}
          value={value}
          onChange={e => onChange(clampMinutes(e.target.value))}
          className="w-12 text-center bg-white border border-slate-200 rounded-lg py-1 text-slate-900 text-sm font-semibold focus:outline-none focus:border-emerald-500 transition-colors"
        />
        <button type="button"
          onClick={() => onChange(Math.min(max, Number(value) + 1))}
          className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-900 text-sm font-bold transition-colors flex items-center justify-center">
          +
        </button>
        <span className="text-xs text-slate-500 w-6">min</span>
      </div>
    </div>
  )
}

export default function FormatSelector({ periods, periodMinutes, breakMinutes = [], indoor = false, onChange }) {
  const numPeriods  = Number(periods) || 2
  const numMins     = Number(periodMinutes) || 0
  const isIndoor    = indoor === true

  // Ensure breakMinutes array length always matches numPeriods - 1,
  // padding with 10 minutes as default.
  const normalizedBreaks = Array.from({ length: Math.max(0, numPeriods - 1) }, (_, i) =>
    breakMinutes[i] ?? 10
  )

  function setPeriods(n) {
    const newBreaks = Array.from({ length: Math.max(0, n - 1) }, (_, i) =>
      breakMinutes[i] ?? 10
    )
    onChange({ periods: n, periodMinutes, breakMinutes: newBreaks, indoor: isIndoor })
  }

  function setMins(m) {
    onChange({ periods, periodMinutes: m, breakMinutes: normalizedBreaks, indoor: isIndoor })
  }

  function setBreak(idx, v) {
    const next = [...normalizedBreaks]
    next[idx] = clampBreak(v)
    onChange({ periods, periodMinutes, breakMinutes: next, indoor: isIndoor })
  }

  function setIndoor(v) {
    onChange({ periods, periodMinutes, breakMinutes: normalizedBreaks, indoor: v })
  }

  const periodLabel = i => {
    if (numPeriods === 2) return i === 0 ? '1st Half' : '2nd Half'
    if (numPeriods === 4) return `Q${i + 1}`
    return `Period ${i + 1}`
  }

  return (
    <div className="space-y-4">
      {/* Outdoor / indoor */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Game type</p>
        <div className="flex gap-2">
          {[{ v: false, label: 'Outdoor' }, { v: true, label: 'Indoor' }].map(opt => (
            <button type="button" key={opt.label}
              onClick={() => setIndoor(opt.v)}
              className={`flex-1 text-sm font-bold py-2 rounded-lg border transition-colors ${
                isIndoor === opt.v
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-400'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Periods */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Periods</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(n => (
            <button type="button" key={n}
              onClick={() => setPeriods(n)}
              className={`flex-1 text-sm font-bold py-2 rounded-lg border transition-colors ${
                numPeriods === n
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-400'
              }`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Minutes per period */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Minutes per period</p>
        <MinuteSpinner value={numMins} onChange={setMins} />
      </div>

      {/* Break durations (one per gap between periods) */}
      {normalizedBreaks.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
            Break{normalizedBreaks.length > 1 ? 's' : ''} between periods
          </p>
          <div className="space-y-2">
            {normalizedBreaks.map((brk, i) => (
              <MinuteSpinner
                key={i}
                value={brk}
                onChange={v => setBreak(i, v)}
                label={normalizedBreaks.length > 1
                  ? `${periodLabel(i)} → ${periodLabel(i + 1)}`
                  : 'Half-time break'
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {numPeriods > 0 && numMins > 0 && (
        <p className="text-[11px] text-slate-500 font-mono">
          {isIndoor ? 'Indoor' : 'Outdoor'} · {numPeriods} × {numMins} min
          {normalizedBreaks.length > 0 &&
            ' · breaks: ' + normalizedBreaks.map(b => `${b}m`).join(' / ')
          }
        </p>
      )}
    </div>
  )
}
