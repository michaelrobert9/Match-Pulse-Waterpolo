import StatusBadge from './StatusBadge'
import { competitionStatus } from '../lib/competitionRules'

// Competition status badge. Visibility (the `published` flag) takes precedence:
// an unpublished competition is shown as "Unpublished" wherever an admin can see
// it. Once published, the badge reflects the AUTOMATIC lifecycle status
// (upcoming / live / completed) derived from the start and end datetimes.
// competitionStatus() encodes that precedence so the badge and the
// competitions-list status filter stay in lockstep.
export default function CompetitionStatusBadge({ competition, className = '' }) {
  if (!competition) return null
  return <StatusBadge status={competitionStatus(competition)} className={className} />
}
