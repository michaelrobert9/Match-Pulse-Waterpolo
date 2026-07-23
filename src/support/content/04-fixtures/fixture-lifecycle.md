# The fixture lifecycle explained

Every fixture moves through a set of statuses, from the moment it's created to the moment its result is locked in. Knowing where a fixture sits tells you what you can do with it and what's expected next.

## Why there's a lifecycle

A match isn't just "not played" or "played". It might be scheduled, in progress, finished but not yet confirmed, or resolved without being played at all. Tracking this properly keeps the fixture list honest and makes sure standings and stats only count results that are actually settled.

## The stages

A fixture progresses through a sequence that covers its whole life:

1. **Scheduled.** The fixture exists, has its teams, date and venue, but hasn't started. This is where it sits after you add it.
2. **In progress / live.** The match has kicked off and you're scoring it. Goals and events are being recorded as they happen.
3. **Completed / awaiting finalisation.** The match has ended and the score is captured, but it hasn't been locked in yet. This is the moment to check everything's right.
4. **Finalised.** The result is confirmed and locked. It now counts towards the standings, and player and competition stats are written from it.

Alongside the normal flow, a fixture can reach a settled state without being played in the usual way, through a **non-standard outcome** like a walkover, withdrawal or abandonment.

## What each stage lets you do

- **Scheduled:** edit freely, change date, venue or teams, or delete it.
- **Live:** record goals and events, fix mistakes as you go.
- **Completed:** review the score, make corrections before finalising.
- **Finalised:** the result counts. Changing it now is a correction, which recomputes the affected stats and standings.

## How this connects to stats

Stats and standings are built only from settled results. A finalised fixture feeds the table and the records. Because everything recomputes from the source result, a correctly finalised fixture means correct stats, and a corrected one updates them cleanly.

For the related screens, see [Start a live match](../06-live-scoring/start-a-live-match.md), [Finalise a result](../06-live-scoring/finalise-a-result.md) and [Walkovers, withdrawals and abandonments](non-standard-outcomes.md).
