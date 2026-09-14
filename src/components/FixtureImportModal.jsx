import { useRef, useState } from 'react'
import { X, Download, Upload, Check, AlertTriangle, FileSpreadsheet, ArrowLeft } from 'lucide-react'
import {
  downloadTemplate, parseFixtureFile, buildImportPlan, commitImportPlan, downloadRejected,
} from '../lib/fixtureImport'

// Bulk import fixtures/results from an .xlsx into ONE competition, with a
// verify-before-commit preview and a saved report of anything not imported.
export default function FixtureImportModal({ competition, onClose, onImported }) {
  const [step, setStep] = useState('intro')   // intro | preview | importing | done
  const [plan, setPlan] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      const { rows } = await parseFixtureFile(file)
      if (!rows.length) { setError('No rows found in the spreadsheet. Use the template and fill in at least one row.'); setBusy(false); return }
      const p = await buildImportPlan(rows, competition)
      setPlan(p); setStep('preview')
    } catch (err) {
      setError(err?.message || 'Could not read that file. Make sure it is an .xlsx from the template.')
    } finally { setBusy(false) }
  }

  async function runImport() {
    setStep('importing'); setBusy(true); setError('')
    try {
      const r = await commitImportPlan(plan, competition)
      setResult(r); setStep('done')
    } catch (err) {
      setError(err?.message || 'Import failed.'); setStep('preview')
    } finally { setBusy(false) }
  }

  const readyCount = plan?.rows.filter(r => r.ok).length ?? 0
  const errorCount = plan?.rows.filter(r => !r.ok).length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-display font-bold text-slate-900 text-base flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Import fixtures &amp; results
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto">
          {error && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {step === 'intro' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Upload a spreadsheet of fixtures for <span className="font-semibold">{competition.name}</span>.
                Fill in both scores to import a completed result, or leave them blank for an upcoming fixture.
                Every row is matched to existing organisations and teams — you'll get a chance to review before anything is created.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadTemplate()}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-3 py-2">
                  <Download className="w-4 h-4" /> Download template
                </button>
                <button type="button" onClick={() => !busy && inputRef.current?.click()} disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-2 disabled:opacity-50">
                  <Upload className="w-4 h-4" /> {busy ? 'Reading…' : 'Upload spreadsheet'}
                </button>
              </div>
              <ul className="text-[12px] text-slate-500 leading-relaxed list-disc pl-5 space-y-0.5">
                <li>Columns: Date, Time, Home Organisation, Home Team, Away Organisation, Away Team, Home Score, Away Score, Venue, Pool.</li>
                <li>Organisation and team names must match MatchPulse exactly — anything that can't be matched is listed and skipped, never guessed.</li>
                <li>Teams found on MatchPulse but not yet in this competition are added automatically.</li>
              </ul>
            </div>
          )}

          {step === 'preview' && plan && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700"><Check className="w-4 h-4" /> {readyCount} ready</span>
                {errorCount > 0 && <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600"><AlertTriangle className="w-4 h-4" /> {errorCount} can't import</span>}
              </div>
              <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
                {plan.rows.map(row => (
                  <div key={row.rowNum} className={`rounded-lg border px-3 py-2 ${row.ok ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
                    <div className="flex items-start gap-2">
                      {row.ok
                        ? <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-slate-900">
                          <span className="font-semibold">{row.raw['Home Organisation']} {row.raw['Home Team']}</span>
                          <span className="text-slate-400"> vs </span>
                          <span className="font-semibold">{row.raw['Away Organisation']} {row.raw['Away Team']}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {row.raw.Date}{row.raw.Time ? ` · ${row.raw.Time}` : ''}
                          {row.resolved?.isResult ? ` · Result ${row.resolved.homeScore}–${row.resolved.awayScore}` : ' · Fixture'}
                          {row.resolved?.poolName ? ` · Pool ${row.resolved.poolName}` : ''}
                        </div>
                        {!row.ok && <div className="text-[11px] text-amber-700 mt-0.5">{row.errors.join('; ')}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Importing {readyCount} fixtures…</p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-sm text-emerald-800 flex items-center gap-2">
                <Check className="w-4 h-4" /> Imported <b>{result.imported.length}</b> {result.imported.length === 1 ? 'match' : 'matches'}.
              </div>
              {result.rejected.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <div className="text-sm text-amber-800 font-semibold flex items-center gap-2 mb-1.5">
                    <AlertTriangle className="w-4 h-4" /> {result.rejected.length} not imported
                  </div>
                  <div className="space-y-1 max-h-[36vh] overflow-y-auto">
                    {result.rejected.map((r, i) => (
                      <div key={i} className="text-[12px] text-amber-900">
                        <span className="font-mono text-amber-500">Row {r.rowNum}:</span>{' '}
                        {r.data['Home Organisation']} {r.data['Home Team']} vs {r.data['Away Organisation']} {r.data['Away Team']} — {r.reason}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => downloadRejected(result.rejected)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:underline">
                    <Download className="w-3.5 h-3.5" /> Download not-imported rows
                  </button>
                </div>
              )}
              <p className="text-[11px] text-slate-400">A report of this import has been saved to the competition.</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
          {step === 'preview' ? (
            <>
              <button type="button" onClick={() => { setStep('intro'); setPlan(null) }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button type="button" onClick={runImport} disabled={readyCount === 0 || busy}
                className="text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 disabled:opacity-40">
                Import {readyCount} {readyCount === 1 ? 'fixture' : 'fixtures'}
              </button>
            </>
          ) : step === 'done' ? (
            <button type="button" onClick={() => { onImported?.(); onClose() }}
              className="ml-auto text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2">
              Done
            </button>
          ) : (
            <button type="button" onClick={onClose} className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-700">Cancel</button>
          )}
        </div>

        <input ref={inputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleFile} />
      </div>
    </div>
  )
}
