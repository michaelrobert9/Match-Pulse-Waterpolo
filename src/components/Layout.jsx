import { Outlet, Link } from 'react-router-dom'
import Nav from './Nav'
import InstallBanner from './InstallBanner'

export default function Layout() {
  const year = new Date().getFullYear()
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <Nav />
      <InstallBanner />
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-sm text-slate-400">© {year} MatchPulse</span>
            <nav className="flex items-center gap-4 text-sm">
              <Link to="/plans" className="text-slate-500 hover:text-slate-900 transition-colors">Plans</Link>
              <Link to="/why-matchpulse" className="text-slate-500 hover:text-slate-900 transition-colors">Why MatchPulse</Link>
              <Link to="/support" className="text-slate-500 hover:text-slate-900 transition-colors">Support</Link>
              <Link to="/contact" className="text-slate-500 hover:text-slate-900 transition-colors">Contact</Link>
            </nav>
          </div>
          {/* Legal + pricing */}
          <nav className="flex flex-wrap items-center justify-center sm:justify-end gap-x-4 gap-y-1.5 text-xs border-t border-slate-100 pt-3">
            <Link to="/legal/terms" className="text-slate-400 hover:text-slate-700 transition-colors">Terms &amp; Conditions</Link>
            <Link to="/legal/privacy" className="text-slate-400 hover:text-slate-700 transition-colors">Privacy Policy</Link>
            <Link to="/legal/cookies" className="text-slate-400 hover:text-slate-700 transition-colors">Cookie Policy</Link>
            <Link to="/legal/acceptable-use" className="text-slate-400 hover:text-slate-700 transition-colors">Acceptable Use</Link>
            <Link to="/plans" className="text-slate-400 hover:text-slate-700 transition-colors">Pricing</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
