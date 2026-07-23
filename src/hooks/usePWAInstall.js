import { useEffect, useState } from 'react'

// PWA install + standalone detection for the unified install banner (spec §10).
//
// The banner is ONE component with the same position and copy on every device;
// only the ACTION adapts:
//   - 'other' (Android / desktop Chrome): a captured beforeinstallprompt drives
//     a real one-tap native install.
//   - 'ios' (iOS Safari tab): no programmatic install exists — the banner shows
//     Share → Add to Home Screen instructions instead.
//   - standalone (installed, launched from the home-screen icon): no banner;
//     this is the only moment notification permission should be requested.

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

function detectPlatform() {
  const ua = navigator.userAgent || ''
  // iPadOS 13+ reports as MacIntel with touch — treat as iOS (no install prompt).
  const iOS = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return iOS ? 'ios' : 'other'
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [standalone, setStandalone] = useState(isStandalone())
  const platform = detectPlatform()

  useEffect(() => {
    const onBIP = e => { e.preventDefault(); setDeferredPrompt(e) }
    const onInstalled = () => { setDeferredPrompt(null); setStandalone(isStandalone()) }
    window.addEventListener('beforeinstallprompt', onBIP)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function promptInstall() {
    if (!deferredPrompt) return false
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return outcome === 'accepted'
  }

  return {
    standalone,
    platform,                            // 'ios' | 'other'
    canPromptInstall: !!deferredPrompt,  // Android/desktop with a captured prompt
    promptInstall,
  }
}
