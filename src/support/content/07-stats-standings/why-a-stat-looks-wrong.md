# Why a stat looks wrong

If a standings position or a player's tally looks off, the good news is that it's almost always traceable to a specific result, and fixing that result fixes the stat. Here's how to think about it.

## Stats are calculated, not stored

MatchPulse works out standings and stats from the actual match results rather than keeping a separate running count. Standings recompute when they're shown, and stats are rebuilt from their source results. So a stat is only ever as right as the results behind it.

That's the key idea: the table and the records aren't the source of truth. The finalised fixtures are. If something looks wrong in the table, the fix lives in a fixture.

## How to track it down

1. **Find the result behind the number.** A team too high or too low in the table? Look at their fixtures. A player's goal count off? Look at the matches they scored in.
2. **Check the fixture.** Is the score right? Are the goals attributed to the correct players? Was a match finalised that shouldn't have been, or not finalised that should have been?
3. **Correct the source.** Fix the fixture, and the standings and stats recompute to match. See [Correct a finalised result](../06-live-scoring/correct-a-finalised-result.md).

## Common causes

- **A goal credited to the wrong player.** The team score is right, so the table looks fine, but one player's tally is high and another's is low. Fix the goal's scorer on that match.
- **A wrong score.** Affects the standings directly. Correct the result.
- **A match not finalised.** A played match that was never finalised won't count yet. Finalise it. See [Finalise a result](../06-live-scoring/finalise-a-result.md).
- **A non-standard outcome recorded as a normal score.** A walkover or abandonment forced through as an invented scoreline can skew the table. Record it as the proper outcome instead. See [Walkovers, withdrawals and abandonments](../04-fixtures/non-standard-outcomes.md).

## The one habit that prevents most of this

Check the score and scorers before you finalise a match. Most stat problems are just a scoring slip that got locked in. Catching it at full time avoids the whole chase later.
