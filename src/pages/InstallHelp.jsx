import { Share, Plus, Bell, Smartphone, MonitorSmartphone } from 'lucide-react'

// Install + notifications instructions (spec §10), with the conventional
// "On iPhone… / On Android…" split. Linked from the install banner.

function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
      <span className="text-sm text-slate-600 leading-relaxed">{children}</span>
    </li>
  )
}

function Card({ icon: Icon, title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-emerald-600" />
        <h2 className="font-display font-bold text-slate-900 text-base">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default function InstallHelp() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <div>
        <h1 className="font-display font-black text-slate-900 text-2xl">Install MatchPulse</h1>
        <p className="text-slate-500 text-sm mt-1">
          Add MatchPulse to your home screen to get live match alerts and result notifications, and
          to keep the screen awake while you score.
        </p>
      </div>

      <Card icon={Smartphone} title="On iPhone or iPad">
        <ol className="space-y-3">
          <Step n={1}>Open MatchPulse in <strong>Safari</strong> (notifications don’t work in other iOS browsers).</Step>
          <Step n={2}>Tap the <Share className="inline w-3.5 h-3.5 -mt-0.5" /> <strong>Share</strong> button in the toolbar.</Step>
          <Step n={3}>Scroll down and tap <strong>Add to Home Screen</strong> <Plus className="inline w-3.5 h-3.5 -mt-0.5" />.</Step>
          <Step n={4}>Tap <strong>Add</strong>, then open MatchPulse from the new home-screen icon.</Step>
        </ol>
      </Card>

      <Card icon={MonitorSmartphone} title="On Android or desktop">
        <ol className="space-y-3">
          <Step n={1}>Open MatchPulse in <strong>Chrome</strong>.</Step>
          <Step n={2}>Tap the <strong>Install app</strong> button in the banner, or choose <strong>Install app</strong> / <strong>Add to Home screen</strong> from the browser menu (⋮).</Step>
          <Step n={3}>Confirm the install, then open MatchPulse from your home screen or app launcher.</Step>
        </ol>
      </Card>

      <Card icon={Bell} title="Turn on match alerts">
        <ol className="space-y-3">
          <Step n={1}>Open MatchPulse from the home-screen icon (not a browser tab — alerts only work once installed).</Step>
          <Step n={2}>Tap <strong>Enable</strong> on the match-alerts banner, or allow notifications when prompted.</Step>
          <Step n={3}>You’ll get scorer reminders and admins will be notified when a result needs confirming.</Step>
        </ol>
        <p className="text-[11px] text-slate-400 mt-4">
          You can change this any time in your device’s notification settings for MatchPulse.
        </p>
      </Card>
    </div>
  )
}
