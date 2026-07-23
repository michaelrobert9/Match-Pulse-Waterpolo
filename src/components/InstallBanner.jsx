import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Share, X, Bell } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { requestNotificationPermission } from '../lib/notifications'

// ONE banner, same position and framing on every device — the user perceives a
// single system (spec §10). Only the action inside adapts to the platform.
//
//   Android / desktop Chrome : "Install app" → real native install dialog.
//   iOS Safari tab           : Share → Add to Home Screen instructions.
//   Standalone (installed)   : no install banner — instead, once, offer to
//                              enable match alerts (the only point at which a
//                              permission request actually works on iOS).
//
// Dismissals persist (localStorage) so we don't nag on every page.

const DISMISS_INSTALL = 'mp_install_dismissed'
const DISMISS_ALERTS  = 'mp_alerts_dismissed'

export default function InstallBanner() {
  const { user } = useAuth()
  const { standalone, platform, canPromptInstall, promptInstall } = usePWAInstall()
  const [dismissedInstall, setDismissedInstall] = useState(() => localStorage.getItem(DISMISS_INSTALL) === '1')
  const [dismissedAlerts,  setDismissedAlerts]  = useState(() => localStorage.getItem(DISMISS_ALERTS) === '1')
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')

  // When the app is launched standalone and signed in, this is the moment to
  // (gently) offer notification permission — never on first web landing.
  const showAlerts = standalone && user && permission === 'default' && !dismissedAlerts

  // Install banner: only in a plain browser tab (never once standalone).
  const showInstall = !standalone && !dismissedInstall

  function dismissInstall() { localStorage.setItem(DISMISS_INSTALL, '1'); setDismissedInstall(true) }
  function dismissAlerts()  { localStorage.setItem(DISMISS_ALERTS, '1');  setDismissedAlerts(true) }

  async function enableAlerts() {
    const result = await requestNotificationPermission()
    setPermission(result)
    if (result !== 'default') dismissAlerts()
  }

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPermission(Notification.permission)
  }, [standalone])

  if (showAlerts) {
    return (
      <div className="bg-emerald-600 text-white px-4 py-2.5 flex items-center gap-3">
        <Bell className="w-4 h-4 shrink-0" />
        <span className="text-xs font-medium flex-1">Enable match alerts to get score and result notifications.</span>
        <button onClick={enableAlerts}
          className="text-[10px] font-bold uppercase tracking-widest bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 transition-colors shrink-0">
          Enable
        </button>
        <button onClick={dismissAlerts} aria-label="Dismiss" className="text-white/80 hover:text-white shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  if (!showInstall) return null

  return (
    <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center gap-3">
      <Download className="w-4 h-4 shrink-0 text-emerald-400" />
      <span className="text-xs font-medium flex-1">
        Add MatchPulse to your home screen for match alerts.
      </span>

      {platform === 'other' && canPromptInstall ? (
        <button onClick={promptInstall}
          className="text-[10px] font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-1.5 transition-colors shrink-0">
          Install app
        </button>
      ) : platform === 'ios' ? (
        <Link to="/install" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 transition-colors shrink-0">
          <Share className="w-3 h-3" /> How to
        </Link>
      ) : (
        <Link to="/install" className="text-[10px] font-bold uppercase tracking-widest bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 transition-colors shrink-0">
          How to
        </Link>
      )}

      <button onClick={dismissInstall} aria-label="Dismiss" className="text-white/70 hover:text-white shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
