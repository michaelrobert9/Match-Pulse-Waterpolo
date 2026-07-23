# Walkovers, withdrawals and abandonments

Not every fixture plays out the normal way. A team doesn't show, a side pulls out of the competition, or a match gets called off partway through. MatchPulse has a proper way to record each of these so the standings and stats stay correct. Don't try to fake these with a manual score.

## Walkover

A walkover is when one team doesn't field a side and the match is awarded to the other. Use this when a team fails to turn up or can't play, and the result goes to their opponent without a real game.

Record it as a walkover on the fixture rather than entering an invented scoreline. MatchPulse handles how it counts towards the standings.

## Withdrawal

A withdrawal is when a team pulls out of the competition partway through. This is bigger than a single match, since it affects every fixture that team still had to play, and sometimes the ones they already played.

Handle this as a withdrawal at the competition level so MatchPulse can resolve the team's remaining fixtures correctly. Don't just delete the team, which can leave gaps in the standings. See also [Add teams to a competition](../03-competitions/add-teams-to-a-competition.md) for the team list, and [Archive or remove a team](../02-organisations-teams/archive-or-remove-a-team.md) for the team itself.

## Abandonment

An abandonment is when a match starts but can't be finished, often because of weather or another interruption. The fixture was played in part but has no normal full-time result.

Record it as an abandonment on the fixture. How it's treated, replayed, voided, or settled on the score at the time, depends on your competition's rules, so resolve it the way your competition handles it.

## Why use these instead of a manual score

Each of these outcomes affects the standings differently from a normal win or loss. Recording them properly means:

- The standings stay accurate.
- The stats engine treats them correctly when it recomputes.
- Anyone looking at the competition sees what actually happened, not a misleading scoreline.

Forcing a fake result through the normal flow can quietly throw off the table and the records. Use the right outcome type and let MatchPulse do the rest.

For where these sit in a fixture's life, see [The fixture lifecycle](fixture-lifecycle.md).
