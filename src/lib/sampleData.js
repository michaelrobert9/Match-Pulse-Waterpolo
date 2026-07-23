// Realistic SA hockey sample data matching the Firestore schema.
// Used as fallback when Firebase is not yet configured.

export const organizations = {
  'org-wp': {
    id: 'org-wp',
    name: 'Western Province',
    shortCode: 'WP',
    logoUrl: null,
    primaryColor: '#006B3C',
    secondaryColor: '#FFFFFF',
    type: 'club',
    region: 'Western Cape',
  },
  'org-kzn': {
    id: 'org-kzn',
    name: 'KZN Raiders',
    shortCode: 'KZN',
    logoUrl: null,
    primaryColor: '#003087',
    secondaryColor: '#FFFFFF',
    type: 'club',
    region: 'KwaZulu-Natal',
  },
  'org-northerns': {
    id: 'org-northerns',
    name: 'Northerns',
    shortCode: 'N',
    logoUrl: null,
    primaryColor: '#CC0000',
    secondaryColor: '#FFFFFF',
    type: 'club',
    region: 'Gauteng North',
  },
  'org-sg': {
    id: 'org-sg',
    name: 'Southern Gauteng',
    shortCode: 'SG',
    logoUrl: null,
    primaryColor: '#C8A400',
    secondaryColor: '#000000',
    type: 'club',
    region: 'Gauteng South',
  },
}

export const competitions = {
  'comp-sahlm-2526': {
    id: 'comp-sahlm-2526',
    name: 'SA Hockey League',
    season: '2025-26',
    gender: 'men',
    ageGroup: 'senior',
    type: 'league',
    status: 'active',
    startDate: new Date('2026-01-15'),
    endDate: new Date('2026-07-30'),
  },
  'comp-ipt-2025': {
    id: 'comp-ipt-2025',
    name: 'Senior IPT',
    season: '2025',
    gender: 'men',
    ageGroup: 'senior',
    type: 'tournament',
    status: 'final',
    startDate: new Date('2025-06-14'),
    endDate: new Date('2025-06-22'),
  },
  'comp-sahlm-2425': {
    id: 'comp-sahlm-2425',
    name: 'SA Hockey League',
    season: '2024-25',
    gender: 'men',
    ageGroup: 'senior',
    type: 'league',
    status: 'final',
    startDate: new Date('2025-01-18'),
    endDate: new Date('2025-07-20'),
  },
  'comp-ipt-2024': {
    id: 'comp-ipt-2024',
    name: 'Senior IPT',
    season: '2024',
    gender: 'men',
    ageGroup: 'senior',
    type: 'tournament',
    status: 'final',
    startDate: new Date('2024-06-08'),
    endDate: new Date('2024-06-16'),
  },
  'comp-sahlm-2324': {
    id: 'comp-sahlm-2324',
    name: 'SA Hockey League',
    season: '2023-24',
    gender: 'men',
    ageGroup: 'senior',
    type: 'league',
    status: 'final',
    startDate: new Date('2024-01-20'),
    endDate: new Date('2024-07-28'),
  },
  'comp-u21-ipt-2023': {
    id: 'comp-u21-ipt-2023',
    name: 'U21 IPT',
    season: '2023',
    gender: 'men',
    ageGroup: 'u21',
    type: 'tournament',
    status: 'final',
    startDate: new Date('2023-06-10'),
    endDate: new Date('2023-06-18'),
  },
}

// ── Teams (standings) ──────────────────────────────────────────────────────

export const teams = {
  'team-wp-sahlm-2526': {
    id: 'team-wp-sahlm-2526',
    competitionId: 'comp-sahlm-2526',
    organizationId: 'org-wp',
    displayName: 'Western Province',
    shortCode: 'WP',
    primaryColor: '#006B3C',
    secondaryColor: '#FFFFFF',
    played: 7, won: 5, drawn: 0, lost: 2,
    goalsFor: 18, goalsAgainst: 10, points: 15,
  },
  'team-kzn-sahlm-2526': {
    id: 'team-kzn-sahlm-2526',
    competitionId: 'comp-sahlm-2526',
    organizationId: 'org-kzn',
    displayName: 'KZN Raiders',
    shortCode: 'KZN',
    primaryColor: '#003087',
    secondaryColor: '#FFFFFF',
    played: 7, won: 4, drawn: 1, lost: 2,
    goalsFor: 15, goalsAgainst: 9, points: 13,
  },
  'team-northerns-sahlm-2526': {
    id: 'team-northerns-sahlm-2526',
    competitionId: 'comp-sahlm-2526',
    organizationId: 'org-northerns',
    displayName: 'Northerns',
    shortCode: 'N',
    primaryColor: '#CC0000',
    secondaryColor: '#FFFFFF',
    played: 7, won: 3, drawn: 0, lost: 4,
    goalsFor: 12, goalsAgainst: 15, points: 9,
  },
  'team-sg-sahlm-2526': {
    id: 'team-sg-sahlm-2526',
    competitionId: 'comp-sahlm-2526',
    organizationId: 'org-sg',
    displayName: 'Southern Gauteng',
    shortCode: 'SG',
    primaryColor: '#C8A400',
    secondaryColor: '#000000',
    played: 7, won: 1, drawn: 1, lost: 5,
    goalsFor: 7, goalsAgainst: 18, points: 4,
  },
}

// ── Matches ─────────────────────────────────────────────────────────────────

export const matches = {
  'match-001': {
    id: 'match-001',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-wp-sahlm-2526',   homeTeamName: 'Western Province', homeTeamShortCode: 'WP',  homeTeamColor: '#006B3C',
    awayTeamId: 'team-kzn-sahlm-2526',  awayTeamName: 'KZN Raiders',      awayTeamShortCode: 'KZN', awayTeamColor: '#003087',
    homeScore: 3, awayScore: 1,
    scheduledAt: new Date('2026-01-15T10:00:00'),
    pitch: 'Field 1', status: 'final',
    homeScorers: [
      { name: 'T. van der Merwe', minute: 12 },
      { name: 'T. van der Merwe', minute: 34 },
      { name: 'L. Abrahams',      minute: 56 },
    ],
    awayScorers: [
      { name: 'P. Govender', minute: 41 },
    ],
  },
  'match-002': {
    id: 'match-002',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-northerns-sahlm-2526', homeTeamName: 'Northerns',        homeTeamShortCode: 'N',   homeTeamColor: '#CC0000',
    awayTeamId: 'team-sg-sahlm-2526',        awayTeamName: 'Southern Gauteng', awayTeamShortCode: 'SG',  awayTeamColor: '#C8A400',
    homeScore: 1, awayScore: 2,
    scheduledAt: new Date('2026-01-15T12:30:00'),
    pitch: 'Field 2', status: 'final',
    homeScorers: [{ name: 'D. Groenewald', minute: 28 }],
    awayScorers: [{ name: 'J. van Wyk', minute: 17 }, { name: 'J. van Wyk', minute: 63 }],
  },
  'match-003': {
    id: 'match-003',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-wp-sahlm-2526',           homeTeamName: 'Western Province', homeTeamShortCode: 'WP',  homeTeamColor: '#006B3C',
    awayTeamId: 'team-northerns-sahlm-2526',    awayTeamName: 'Northerns',        awayTeamShortCode: 'N',   awayTeamColor: '#CC0000',
    homeScore: 2, awayScore: 0,
    scheduledAt: new Date('2026-02-12T10:00:00'),
    pitch: 'Field 1', status: 'final',
    homeScorers: [{ name: 'T. van der Merwe', minute: 23 }, { name: 'L. Abrahams', minute: 67 }],
    awayScorers: [],
  },
  'match-004': {
    id: 'match-004',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-kzn-sahlm-2526',  homeTeamName: 'KZN Raiders',      homeTeamShortCode: 'KZN', homeTeamColor: '#003087',
    awayTeamId: 'team-sg-sahlm-2526',   awayTeamName: 'Southern Gauteng', awayTeamShortCode: 'SG',  awayTeamColor: '#C8A400',
    homeScore: 2, awayScore: 2,
    scheduledAt: new Date('2026-02-12T12:30:00'),
    pitch: 'Field 2', status: 'final',
    homeScorers: [{ name: 'P. Govender', minute: 19 }, { name: 'P. Govender', minute: 55 }],
    awayScorers: [{ name: 'J. van Wyk', minute: 33 }, { name: 'R. Maharaj', minute: 78 }],
  },
  'match-005': {
    id: 'match-005',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-wp-sahlm-2526',   homeTeamName: 'Western Province', homeTeamShortCode: 'WP',  homeTeamColor: '#006B3C',
    awayTeamId: 'team-kzn-sahlm-2526',  awayTeamName: 'KZN Raiders',      awayTeamShortCode: 'KZN', awayTeamColor: '#003087',
    homeScore: 2, awayScore: 1,
    scheduledAt: new Date('2026-05-28T10:00:00'),
    pitch: 'Field 1', status: 'live',
    homeScorers: [{ name: 'T. van der Merwe', minute: 8 }, { name: 'M. de Beer', minute: 31 }],
    awayScorers: [{ name: 'P. Govender', minute: 44 }],
  },
  'match-006': {
    id: 'match-006',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-sg-sahlm-2526',           homeTeamName: 'Southern Gauteng', homeTeamShortCode: 'SG',  homeTeamColor: '#C8A400',
    awayTeamId: 'team-northerns-sahlm-2526',    awayTeamName: 'Northerns',        awayTeamShortCode: 'N',   awayTeamColor: '#CC0000',
    homeScore: 0, awayScore: 0,
    scheduledAt: new Date('2026-05-28T12:30:00'),
    pitch: 'Field 2', status: 'scheduled', tracked: false,
    homeScorers: [], awayScorers: [],
  },
  'match-007': {
    id: 'match-007',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-northerns-sahlm-2526', homeTeamName: 'Northerns',        homeTeamShortCode: 'N',   homeTeamColor: '#CC0000',
    awayTeamId: 'team-kzn-sahlm-2526',      awayTeamName: 'KZN Raiders',      awayTeamShortCode: 'KZN', awayTeamColor: '#003087',
    homeScore: 0, awayScore: 0,
    scheduledAt: new Date('2026-06-15T10:00:00'),
    pitch: 'Field 1', status: 'scheduled', tracked: false,
    homeScorers: [], awayScorers: [],
  },
  'match-008': {
    id: 'match-008',
    competitionId: 'comp-sahlm-2526',
    homeTeamId: 'team-wp-sahlm-2526',  homeTeamName: 'Western Province', homeTeamShortCode: 'WP',  homeTeamColor: '#006B3C',
    awayTeamId: 'team-sg-sahlm-2526',  awayTeamName: 'Southern Gauteng', awayTeamShortCode: 'SG',  awayTeamColor: '#C8A400',
    homeScore: 0, awayScore: 0,
    scheduledAt: new Date('2026-07-20T10:00:00'),
    pitch: 'Field 1', status: 'scheduled', tracked: false,
    homeScorers: [], awayScorers: [],
  },
}

// ── People ──────────────────────────────────────────────────────────────────

export const people = {
  'person-tvdm-001': {
    id: 'person-tvdm-001',
    fullName: 'Tyrone van der Merwe',
    photoUrl: null,
    dateOfBirth: new Date('1998-03-15'),
    careerCaps: 94,
    careerGoals: 47,
    careerCards: { green: 4, yellow: 2, red: 0 },
  },
  'person-pgovender-002': {
    id: 'person-pgovender-002',
    fullName: 'Prashant Govender',
    photoUrl: null,
    dateOfBirth: new Date('2000-07-22'),
    careerCaps: 48,
    careerGoals: 31,
    careerCards: { green: 1, yellow: 0, red: 0 },
  },
}

// ── Players ──────────────────────────────────────────────────────────────────

export const players = {
  // ── SA Hockey League 2025-26 — WP ────────────────────────────────────────
  'player-wp-1': {
    id: 'player-wp-1', personId: 'p-smith', teamId: 'team-wp-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'J. Smith', shirtNumber: 1, position: 'GK', isCaptain: false,
    caps: 7, goals: 0, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-wp-5': {
    id: 'player-wp-5', personId: 'p-davids', teamId: 'team-wp-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'R. Davids', shirtNumber: 5, position: 'Def', isCaptain: false,
    caps: 7, goals: 0, cards: { green: 1, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-wp-7': {
    id: 'player-tvdm-sahlm-2526', personId: 'person-tvdm-001', teamId: 'team-wp-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'T. van der Merwe', shirtNumber: 7, position: 'Fwd', isCaptain: true,
    caps: 7, goals: 5, cards: { green: 0, yellow: 1, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-wp-8': {
    id: 'player-wp-8', personId: 'p-abrahams', teamId: 'team-wp-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'L. Abrahams', shirtNumber: 8, position: 'Mid', isCaptain: false,
    caps: 7, goals: 3, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-wp-11': {
    id: 'player-wp-11', personId: 'p-debeer', teamId: 'team-wp-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'M. de Beer', shirtNumber: 11, position: 'Fwd', isCaptain: false,
    caps: 6, goals: 2, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },

  // ── SA Hockey League 2025-26 — KZN ───────────────────────────────────────
  'player-kzn-1': {
    id: 'player-kzn-1', personId: 'p-singh', teamId: 'team-kzn-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'A. Singh', shirtNumber: 1, position: 'GK', isCaptain: false,
    caps: 7, goals: 0, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'KZN Raiders', teamShortCode: 'KZN', teamPrimaryColor: '#003087',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-kzn-4': {
    id: 'player-kzn-4', personId: 'p-pillay', teamId: 'team-kzn-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'K. Pillay', shirtNumber: 4, position: 'Def', isCaptain: false,
    caps: 7, goals: 1, cards: { green: 0, yellow: 1, red: 0 },
    teamDisplayName: 'KZN Raiders', teamShortCode: 'KZN', teamPrimaryColor: '#003087',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-kzn-6': {
    id: 'player-kzn-6', personId: 'p-madlala', teamId: 'team-kzn-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'N. Madlala', shirtNumber: 6, position: 'Mid', isCaptain: false,
    caps: 7, goals: 2, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'KZN Raiders', teamShortCode: 'KZN', teamPrimaryColor: '#003087',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-kzn-9': {
    id: 'player-kzn-9', personId: 'person-pgovender-002', teamId: 'team-kzn-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'P. Govender', shirtNumber: 9, position: 'Fwd', isCaptain: true,
    caps: 7, goals: 4, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'KZN Raiders', teamShortCode: 'KZN', teamPrimaryColor: '#003087',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },
  'player-kzn-10': {
    id: 'player-kzn-10', personId: 'p-ntuli', teamId: 'team-kzn-sahlm-2526', competitionId: 'comp-sahlm-2526',
    personName: 'T. Ntuli', shirtNumber: 10, position: 'Mid', isCaptain: false,
    caps: 6, goals: 1, cards: { green: 1, yellow: 0, red: 0 },
    teamDisplayName: 'KZN Raiders', teamShortCode: 'KZN', teamPrimaryColor: '#003087',
    competitionName: 'SA Hockey League', competitionSeason: '2025-26', competitionStatus: 'active',
  },

  // ── Tyrone's other competition records ────────────────────────────────────
  'player-tvdm-ipt-2025': {
    id: 'player-tvdm-ipt-2025', personId: 'person-tvdm-001', teamId: 'team-wp-ipt-2025', competitionId: 'comp-ipt-2025',
    personName: 'Tyrone van der Merwe', shirtNumber: 7, position: 'Fwd', isCaptain: false,
    caps: 9, goals: 8, cards: { green: 1, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'Senior IPT', competitionSeason: '2025', competitionStatus: 'final',
  },
  'player-tvdm-sahlm-2425': {
    id: 'player-tvdm-sahlm-2425', personId: 'person-tvdm-001', teamId: 'team-wp-sahlm-2425', competitionId: 'comp-sahlm-2425',
    personName: 'Tyrone van der Merwe', shirtNumber: 7, position: 'Fwd', isCaptain: false,
    caps: 14, goals: 11, cards: { green: 1, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2024-25', competitionStatus: 'final',
  },
  'player-tvdm-ipt-2024': {
    id: 'player-tvdm-ipt-2024', personId: 'person-tvdm-001', teamId: 'team-wp-ipt-2024', competitionId: 'comp-ipt-2024',
    personName: 'Tyrone van der Merwe', shirtNumber: 7, position: 'Fwd', isCaptain: false,
    caps: 9, goals: 9, cards: { green: 1, yellow: 1, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'Senior IPT', competitionSeason: '2024', competitionStatus: 'final',
  },
  'player-tvdm-sahlm-2324': {
    id: 'player-tvdm-sahlm-2324', personId: 'person-tvdm-001', teamId: 'team-wp-sahlm-2324', competitionId: 'comp-sahlm-2324',
    personName: 'Tyrone van der Merwe', shirtNumber: 11, position: 'Fwd', isCaptain: false,
    caps: 13, goals: 8, cards: { green: 1, yellow: 0, red: 0 },
    teamDisplayName: 'Western Province', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'SA Hockey League', competitionSeason: '2023-24', competitionStatus: 'final',
  },
  'player-tvdm-u21-2023': {
    id: 'player-tvdm-u21-2023', personId: 'person-tvdm-001', teamId: 'team-wp-u21-2023', competitionId: 'comp-u21-ipt-2023',
    personName: 'Tyrone van der Merwe', shirtNumber: 11, position: 'Fwd', isCaptain: false,
    caps: 7, goals: 6, cards: { green: 0, yellow: 0, red: 0 },
    teamDisplayName: 'WP U21', teamShortCode: 'WP', teamPrimaryColor: '#006B3C',
    competitionName: 'U21 IPT', competitionSeason: '2023', competitionStatus: 'final',
  },
}

// ── Helper functions ────────────────────────────────────────────────────────

export function getCareerForPerson(personId) {
  return Object.values(players)
    .filter(p => p.personId === personId)
    .sort((a, b) => {
      const sa = String(b.competitionSeason), sb = String(a.competitionSeason)
      return sa.localeCompare(sb) || b.caps - a.caps
    })
}

export function getTeamsForCompetition(competitionId) {
  return Object.values(teams)
    .filter(t => t.competitionId === competitionId)
    .sort((a, b) => b.points - a.points
      || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
      || b.goalsFor - a.goalsFor)
}

export function getMatchesForCompetition(competitionId) {
  return Object.values(matches)
    .filter(m => m.competitionId === competitionId)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
}

export function getPlayersForTeam(teamId) {
  return Object.values(players)
    .filter(p => p.teamId === teamId)
    .sort((a, b) => (a.shirtNumber || 99) - (b.shirtNumber || 99))
}

export function getTopScorersForCompetition(competitionId, limit = 5) {
  return Object.values(players)
    .filter(p => p.competitionId === competitionId && p.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit)
}
