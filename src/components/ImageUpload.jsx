import { useRef, useState } from 'react'
import { IMAGE_SPECS, validateImageFile, uploadImageForEntity } from '../lib/imageUpload'

// Reusable image picker that uploads to the storage bucket and reports back the
// resulting download URL. Two modes:
//
//  • Immediate (default): pass `entityId`. On pick it validates, uploads to
//    `<prefix>/<entityId>`, and calls `onChange(url)`.
//  • Deferred: pass `deferred` (for create flows where the entity has no id yet).
//    On pick it validates and calls `onPick(file, previewUrl)`; the parent
//    uploads once the entity exists. A local object-URL is shown meanwhile.
//
// Layout follows the spec's shape: `wide` renders a full-width banner with an
// overlaid button; `circle`/`square` render a fixed preview with a button beside
// it. Recommended dimensions are always shown as helper text.
export default function ImageUpload({
  specKey,
  value,
  onChange,
  entityId,
  deferred = false,
  onPick,
  label,
  monogram = '',
  accentColor,
  disabled = false,
  className = '',
}) {
  const spec = IMAGE_SPECS[specKey]
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')

  const shown = preview || value || ''
  const heading = label ?? spec.label

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateImageFile(file, spec.maxMB)
    if (err) { setError(err); return }
    setError('')

    if (deferred) {
      const url = URL.createObjectURL(file)
      setPreview(url)
      onPick?.(file, url)
      return
    }
    setBusy(true)
    try {
      const url = await uploadImageForEntity(specKey, entityId, file)
      onChange?.(url)
      setPreview('')
    } catch (err2) {
      setError(err2.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    setPreview('')
    setError('')
    if (deferred) onPick?.(null, '')
    else onChange?.('')
  }

  const openPicker = () => inputRef.current?.click()

  const hiddenInput = (
    <input ref={inputRef} type="file" accept="image/*" className="hidden"
      disabled={disabled || busy} onChange={handleFile} />
  )

  // ── Wide / banner layout ──────────────────────────────────────────────────
  if (spec.shape === 'wide') {
    return (
      <div className={className}>
        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
          {heading}
        </label>
        <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
          style={{ aspectRatio: spec.aspect }}>
          {shown ? (
            <img src={shown} alt="" className="w-full h-full object-cover" />
          ) : (
            <button type="button" onClick={openPicker} disabled={disabled || busy}
              className="w-full h-full flex items-center justify-center text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-600 hover:bg-emerald-50/50 transition-colors">
              {busy ? 'Uploading…' : '+ Add banner image'}
            </button>
          )}
          {shown && !disabled && (
            <div className="absolute bottom-2 right-2 flex gap-2">
              <button type="button" onClick={openPicker} disabled={busy}
                className="bg-white/90 hover:bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 shadow-sm">
                {busy ? 'Uploading…' : 'Change'}
              </button>
              <button type="button" onClick={clear} disabled={busy}
                className="bg-white/90 hover:bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-red-500 shadow-sm">
                Remove
              </button>
            </div>
          )}
          {hiddenInput}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">{spec.recommend}</p>
        {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
      </div>
    )
  }

  // ── Avatar / logo layout (circle or square) ───────────────────────────────
  const boxRadius = spec.shape === 'circle' ? 'rounded-full' : 'rounded-xl'
  const box = spec.box ?? 80

  return (
    <div className={className}>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
        {heading}
      </label>
      <div className="flex items-center gap-3">
        <div className={`${boxRadius} overflow-hidden shrink-0 flex items-center justify-center border border-slate-200 bg-slate-50`}
          style={{ width: box, height: box, ...(accentColor ? { borderColor: accentColor } : {}) }}>
          {shown
            ? <img src={shown} alt="" className={`w-full h-full ${spec.fit === 'contain' ? 'object-contain p-1' : 'object-cover'}`} />
            : <span className="text-sm font-bold font-mono text-slate-400">{monogram || '—'}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <button type="button" onClick={openPicker} disabled={disabled || busy}
              className="bg-white border border-slate-200 hover:border-emerald-400 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 disabled:opacity-40 transition-colors">
              {busy ? 'Uploading…' : shown ? 'Change' : 'Upload'}
            </button>
            {shown && !disabled && !busy && (
              <button type="button" onClick={clear}
                className="rounded-lg px-2 py-2 text-[11px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors">
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 max-w-[16rem]">{spec.recommend}</p>
        </div>
        {hiddenInput}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}
