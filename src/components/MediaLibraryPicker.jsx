import { useEffect, useRef, useState } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { X, Search, ImagePlus, Trash2 } from 'lucide-react'
import { storage, auth } from '../firebase'
import { fetchOrgMedia, registerOrgMedia, removeOrgMedia } from '../lib/mediaLibrary'

// A modal that lists an organisation's media library so a previously-uploaded
// image can be re-selected instead of uploaded again. Also supports uploading a
// new image straight into the library, searching by name, and removing an entry.
// Selecting an image calls onSelect(url) and closes.
const MAX_MB = 5

export default function MediaLibraryPicker({ orgId, onSelect, onClose }) {
  const [items, setItems] = useState(null)   // null = loading
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function load() { setItems(await fetchOrgMedia(orgId)) }
  useEffect(() => { load() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    if (!storage) { setError('Uploads are unavailable right now.'); return }
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`Image must be under ${MAX_MB} MB.`); return }
    setBusy(true); setError('')
    try {
      const uid = auth?.currentUser?.uid || 'anon'
      const dest = `org-media/${orgId}/${uid}-${Date.now().toString(36)}`
      const r = storageRef(storage, dest)
      await uploadBytes(r, file)
      const url = await getDownloadURL(r)
      await registerOrgMedia(orgId, { url, name: file.name, path: dest, contentType: file.type, size: file.size })
      await load()
    } catch (err) {
      setError(err?.code === 'storage/unauthorized'
        ? 'You do not have permission to upload here.'
        : (err?.message || 'Upload failed. Please try again.'))
    } finally { setBusy(false) }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Remove "${item.name}" from the library? This only removes it from the library — it does not affect anywhere the image is already used.`)) return
    try { await removeOrgMedia(orgId, item.id); await load() }
    catch (err) { setError(err?.message || 'Could not remove this image.') }
  }

  const term = q.trim().toLowerCase()
  const filtered = (items ?? []).filter(it => !term || (it.name || '').toLowerCase().includes(term))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-display font-bold text-slate-900 text-base">Media library</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search images…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400" />
          </div>
          <button type="button" onClick={() => !busy && inputRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-2 shrink-0 disabled:opacity-50">
            <ImagePlus className="w-4 h-4" /> {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {error && <p className="px-4 pt-2 text-[11px] text-red-600">{error}</p>}

        <div className="p-4 overflow-y-auto">
          {items === null ? (
            <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-12">
              {items.length === 0 ? 'No images yet. Upload one to start your library.' : 'No images match your search.'}
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {filtered.map(item => (
                <div key={item.id} className="group relative">
                  <button type="button" onClick={() => { onSelect(item.url); onClose() }}
                    className="block w-full aspect-square rounded-xl border border-slate-200 overflow-hidden bg-slate-50 hover:border-emerald-400 hover:ring-2 hover:ring-emerald-200 transition">
                    <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                  </button>
                  <button type="button" onClick={() => handleDelete(item)}
                    className="absolute top-1 right-1 bg-white/90 rounded-full p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shadow-sm">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <p className="text-[10px] text-slate-500 mt-1 truncate" title={item.name}>{item.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={busy} />
      </div>
    </div>
  )
}
