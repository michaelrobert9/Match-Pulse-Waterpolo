import { Component, Suspense } from 'react'

// A lazily-imported route ships as its own JS chunk. After a deploy, a browser
// (or edge) holding a stale index/bundle can request a chunk hash that no longer
// exists — the dynamic import rejects, and with no boundary the whole app shows
// a blank white screen. This wraps a lazy route so that:
//   • while the chunk loads, a spinner shows (not a blank `null` fallback);
//   • if the chunk FAILS to load, the page reloads ONCE to fetch the fresh
//     index + chunks (guarded so it can't loop); a persistent failure then
//     shows a simple Reload button instead of a blank page.
function isChunkError(error) {
  const msg = String(error?.message || error || '')
  return /loading chunk|loading dynamically imported module|importing a module script failed|chunkloaderror|failed to fetch dynamically/i.test(msg)
}

class ChunkErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) {
    if (isChunkError(error)) {
      const last = Number(sessionStorage.getItem('mp-chunk-reload') || 0)
      // Reload at most once per 10s window, so a genuine fix reloads but a
      // persistent failure (just reloaded, still broken) doesn't loop.
      if (Date.now() - last > 10000) {
        sessionStorage.setItem('mp-chunk-reload', String(Date.now()))
        window.location.reload()
      }
    }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="max-w-md mx-auto px-6 py-20 text-center">
          <p className="text-slate-600 text-sm mb-4">This page couldn’t load.</p>
          <button
            onClick={() => { sessionStorage.removeItem('mp-chunk-reload'); window.location.reload() }}
            className="text-sm text-emerald-600 border border-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors">
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function LazyBoundary({ children }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </ChunkErrorBoundary>
  )
}
