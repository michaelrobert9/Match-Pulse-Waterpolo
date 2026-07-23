import { useState } from 'react'
import { Share2, Check } from 'lucide-react'

export default function ShareButton({ shareData, className = '' }) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    if (navigator.share) {
      try { await navigator.share(shareData) } catch { /* user cancelled */ }
      return
    }
    const text = [shareData.title, shareData.text, shareData.url].filter(Boolean).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button onClick={handleShare}
      className={`flex items-center gap-1.5 transition-colors ${className}`}>
      {copied ? (
        <>
          <Check className="w-4 h-4 text-emerald-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Copied!</span>
        </>
      ) : (
        <>
          <Share2 className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Share</span>
        </>
      )}
    </button>
  )
}
