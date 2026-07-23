// The exact wording a user confirms before creating a player profile. It is
// stored against the profile (consentTextVersion) so we can prove WHICH wording
// was agreed to. If this text ever changes, bump PLAYER_CONSENT_VERSION.
export const PLAYER_CONSENT_VERSION = '2026-07-14'

export const PLAYER_CONSENT_TEXT =
  "I confirm that I am the player, or the player's parent or legal guardian, or a team manager acting with the parent or guardian's consent. " +
  "I have the right to create this profile and to publish this player's name and statistics on MatchPulse. " +
  "Where the player is a minor, I confirm I have the consent of their parent or legal guardian. " +
  "I accept that I am responsible for this profile and its information, and that MatchPulse relies on this confirmation."
