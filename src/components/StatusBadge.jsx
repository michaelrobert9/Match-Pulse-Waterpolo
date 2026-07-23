import { BADGE_BASE, LIVE_DOT, STATUS_STYLES } from '../lib/statusStyles'

const LABEL = {
  live:            'Live',
  active:          'Active',
  scheduled:       'Scheduled',
  upcoming:        'Scheduled', // legacy match status renders under the new name
  paused:          'Paused',
  awaiting_result: 'Awaiting result',
  final:           'Final',
  postponed:       'Postponed',
  cancelled:       'Cancelled',
  completed:       'Completed',
  draft:           'Draft',
  unpublished:     'Unpublished',
}

export default function StatusBadge({ status, className = '' }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.draft
  const isLive = status === 'live' || status === 'active'
  return (
    <span className={`${BADGE_BASE} ${cls} ${className}`}>
      {isLive && <span className={LIVE_DOT} />}
      {LABEL[status] ?? status}
    </span>
  )
}
