// Reference-image slots per article. Each slot illustrates a screen/step the
// article describes. `src` is a real (WebP) screenshot when available; when it
// is null the UI renders a clearly-marked placeholder at the right aspect ratio
// with the descriptive alt text, so a real screenshot can be dropped in later.
//
// Every slot here is currently a PLACEHOLDER awaiting a real screenshot — the
// full list is reproduced in the PR description. To fill one, capture the screen
// described in `alt`, save it (WebP) under src/support/assets/, and set `src`.

export const IMAGE_SLOTS = {
  'getting-started/the-dashboard': [
    { src: null, alt: 'The MatchPulse dashboard after signing in, showing the user’s organisations, competitions and quick actions.', caption: 'The dashboard' },
  ],
  'getting-started/choosing-a-plan': [
    { src: null, alt: 'The Plans page comparing the Free, Plus and Pro tiers with their prices and features.', caption: 'The Plans page' },
  ],
  'organisations-teams/create-an-organisation': [
    { src: null, alt: 'The “Create organisation” form with fields for name, type (school, club, association, franchise) and logo.', caption: 'Creating an organisation' },
  ],
  'organisations-teams/add-a-team': [
    { src: null, alt: 'The “Add a team” screen within an organisation, showing the gender, age group and team-level fields.', caption: 'Adding a team' },
  ],
  'organisations-teams/manage-your-squad': [
    { src: null, alt: 'The squad management screen listing players with shirt numbers and positions.', caption: 'Managing a squad' },
  ],
  'competitions/create-a-competition': [
    { src: null, alt: 'The “Create competition” form showing series name, gender, age, season and the live name/URL preview.', caption: 'Creating a competition' },
  ],
  'competitions/competition-formats': [
    { src: null, alt: 'The competition type chooser comparing league, tournament and festival formats.', caption: 'Choosing a format' },
  ],
  'fixtures/add-a-fixture': [
    { src: null, alt: 'The “Add fixture” form with home team, away team, date, time and venue fields.', caption: 'Adding a fixture' },
  ],
  'fixtures/generate-fixtures': [
    { src: null, alt: 'The generate-fixtures panel for a round-robin, showing the match-format options.', caption: 'Generating a fixture list' },
  ],
  'fixtures/fixture-lifecycle': [
    { src: null, alt: 'A fixture list showing the lifecycle status badges: scheduled, live, awaiting result and final.', caption: 'Fixture lifecycle states' },
  ],
  'live-scoring/start-a-live-match': [
    { src: null, alt: 'The live scoring screen before kickoff with the “Start match” control.', caption: 'Starting a live match' },
  ],
  'live-scoring/record-events': [
    { src: null, alt: 'The live scoring screen mid-match, recording a goal for the home team.', caption: 'Recording a goal' },
  ],
  'live-scoring/finalise-a-result': [
    { src: null, alt: 'The live scoring screen with the “Finalise result” control at full time.', caption: 'Finalising a result' },
  ],
  'playoffs/build-a-knockout-stage': [
    { src: null, alt: 'The Playoffs builder showing the type chooser (Playoff, Knockout round, Custom) and bracket size.', caption: 'The playoffs builder' },
  ],
  'playoffs/seed-the-bracket': [
    { src: null, alt: 'A knockout bracket with pool qualifiers seeded into the first round.', caption: 'A seeded bracket' },
  ],
  'stats-standings/how-standings-work': [
    { src: null, alt: 'A competition standings table with played, won, drawn, lost, goal difference and points columns.', caption: 'A standings table' },
  ],
  'permissions/invite-people': [
    { src: null, alt: 'The invite screen where an organiser enters an email and assigns a role.', caption: 'Inviting people' },
  ],
}
