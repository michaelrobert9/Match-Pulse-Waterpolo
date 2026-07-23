# How standings are calculated

The standings table ranks the teams in a competition by their results. It updates itself as fixtures are finalised, so it's always current.

## Built from results, recomputed on read

MatchPulse doesn't keep a running tally that it nudges up and down. Instead, the standings are worked out from the actual finalised results whenever they're shown. Every time you look at the table, it reflects exactly what the results say.

This is why the table is reliable. There's no separate score being maintained that could drift out of step with the matches. The results are the single source of truth, and the table is calculated from them.

## What feeds the table

- **Finalised fixtures.** Only settled results count. A match that's scheduled or still live doesn't affect the table yet.
- **Non-standard outcomes.** Walkovers, withdrawals and abandonments are factored in according to how they're recorded. See [Walkovers, withdrawals and abandonments](../04-fixtures/non-standard-outcomes.md).

## How teams are ranked

Teams earn points from their results, and the table orders them accordingly, typically points first, then the usual tie-breakers your competition uses. As more fixtures finalise, the table fills out and settles towards the final standings.

## When the season ends

Once every fixture is finalised, the table is settled and reflects the final standings. Finalising the competition locks this in. See [Finalise a competition](../03-competitions/finalise-a-competition.md).

## If the table looks off

Because the table is computed from results, a wrong-looking table almost always traces back to a wrong or missing result. Fix the fixture, and the table corrects itself. See [Why a stat looks wrong](why-a-stat-looks-wrong.md).
