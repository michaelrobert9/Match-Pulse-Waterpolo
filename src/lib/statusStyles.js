// Status colour tokens — the single source of truth for the semantic status
// palette (DESIGN_SYSTEM.md §3.5). Both the match `StatusBadge` and the
// home-page competition `ActivityPill` draw their hue classes from here, so the
// palette is defined once and cannot drift into a "fourth way" to render status.

// Shared badge shell: the mono micro-caps pill used by every status chip.
export const BADGE_BASE =
  'inline-flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full'

// The live pulse dot — also used by live section headers.
export const LIVE_DOT = 'w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0'

// Match status → hue classes (background + border + text). Live/active is red,
// scheduled is sky, paused/awaiting is amber, postponed is violet, everything
// terminal is slate.
export const STATUS_STYLES = {
  live:            'bg-red-50 border border-red-200 text-red-600',
  active:          'bg-red-50 border border-red-200 text-red-600',
  scheduled:       'bg-sky-50 border border-sky-200 text-sky-600',
  upcoming:        'bg-sky-50 border border-sky-200 text-sky-600', // legacy match status
  paused:          'bg-amber-50 border border-amber-200 text-amber-600',
  awaiting_result: 'bg-amber-50 border border-amber-200 text-amber-600',
  postponed:       'bg-violet-50 border border-violet-200 text-violet-600',
  final:           'bg-slate-100 border border-slate-200 text-slate-500',
  completed:       'bg-slate-100 border border-slate-200 text-slate-500',
  draft:           'bg-slate-100 border border-slate-200 text-slate-500',
  unpublished:     'bg-slate-100 border border-slate-200 text-slate-500',
  cancelled:       'bg-slate-100 border border-slate-200 text-slate-400 line-through',
}

// Competition activity → hue classes. Deliberately distinct from match status:
// "today" is positive brand context (emerald), not a live signal.
export const ACTIVITY_STYLES = {
  live:     'bg-red-50 border border-red-200 text-red-600',
  today:    'bg-emerald-50 border border-emerald-200 text-emerald-600',
  upcoming: 'bg-sky-50 border border-sky-200 text-sky-600',
}
