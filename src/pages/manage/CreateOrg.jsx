import { ChevronLeft, ExternalLink, Building2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// Organisations are now created and managed centrally on the main MatchPulse
// site; this sport app only reads a synced copy of an org's identity. The
// /manage/new-org route is kept so existing "create an organisation" links
// still resolve — they land here and point the user at the central create flow.
export default function CreateOrg() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-lg mx-auto px-4 py-8">
        <button onClick={() => navigate('/manage')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-6">
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">
            Organisations live on MatchPulse
          </h1>
          <p className="text-slate-500 text-sm mt-3 leading-relaxed">
            Schools, clubs and associations are now created and managed in one place on the
            main MatchPulse site, then appear across every sport automatically. Create yours
            there, then activate it for water polo.
          </p>
          <a href="https://matchpulse.co.za/organisations" target="_blank" rel="noopener noreferrer"
            className="mt-6 inline-flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors">
            Create an organisation
            <ExternalLink className="w-4 h-4" />
          </a>
          <p className="text-[11px] text-slate-400 mt-3">
            You'll be the owner and can manage its profile, teams and staff centrally.
          </p>
        </div>
      </div>
    </div>
  )
}
