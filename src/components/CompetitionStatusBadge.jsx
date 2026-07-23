import StatusBadge from './StatusBadge'
import { competitionLifecycle } from '../lib/competitionRules'

// Competition status badge. Visibility (the `published` flag) takes precedence:
// an unpublished competition is shown as "Unpublished" wherever an admin can see
// it. Once published, the badge reflects the AUTOMATIC lifecycle status
// (upcoming / live / completed) derived from the start and end datetimes.
export default function CompetitionStatusBadge({ competition, className = '' }) {
  if (!competition) return null
  if (competition.published === false) {
    return <StatusBadge status="unpublished" className={className} />
  }
  return <StatusBadge status={competitionLifecycle(competition)} className={className} />
}
