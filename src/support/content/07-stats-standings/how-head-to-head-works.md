# How head-to-head tie-breakers work

When teams finish level on points, most competitions separate them using head-to-head results. MatchPulse does this with a "mini-table", and part-way through a tournament the outcome can look surprising. This explains exactly how it works, and why a table that looks odd mid-way almost always settles correctly by the end.

> Different sports measure the scoring margin differently — goal difference, points difference or net run rate — but the tie-breaker logic below is identical. This guide uses "goal difference" in its examples; read it as whatever margin your sport uses.

## Points come first

The table is always sorted by points first. Tie-breakers only ever come into play when two or more teams are level on points. If teams have different points totals, none of what follows applies, the points decide it. See [How standings are calculated](how-standings-work.md).

## Head-to-head is a mini-table, not a single match

This is the part that trips people up. When teams are level on points, head-to-head does **not** just look at the one match between two of them. It builds a **mini-table** (a little league of its own) using only the matches played **between the teams that are tied**, and then ranks those teams by:

1. **Points** in the mini-table
2. then **goal difference** in the mini-table
3. then **goals for** in the mini-table

Only once the mini-table still can't separate them does it fall through to the competition's next tie-breaker (usually overall goal difference, then goals for, and so on).

So with three or more teams level on points, "head-to-head" means "how did these teams do **against each other**", taken as a group, not just one result between one pair.

## A worked example

Say a pool has three teams level on **4 points** each: **St Mary's**, **Umhlali** and **Virginia**. The matches played among those three are:

- St Mary's **1–1** Umhlali
- St Mary's **1–0** Virginia
- Umhlali v Virginia — **not played yet**

The head-to-head mini-table (using only those matches) works out as:

- **St Mary's** — beat Virginia, drew Umhlali → **4 points**
- **Umhlali** — drew St Mary's → **1 point**
- **Virginia** — lost to St Mary's → **0 points**

So the order comes out **St Mary's, then Umhlali, then Virginia**, and that is exactly what the table shows.

Notice that Virginia might have a better **overall** goal difference than St Mary's across the whole pool. It doesn't matter here: head-to-head is applied **before** overall goal difference, and the mini-table has already separated the teams, so overall goal difference is never reached.

## Why it can look wrong mid-way

In that example, St Mary's sits **above** Umhlali even though the two of them **drew** and St Mary's may have a worse overall goal difference. That looks wrong if you only look at the one match between them.

It isn't wrong. St Mary's is ahead because of the **whole** mini-table: St Mary's has already **beaten Virginia**, while **Umhlali hasn't played Virginia yet**. St Mary's has simply banked a head-to-head result that Umhlali hasn't had the chance to.

This is the key thing about head-to-head **mid-tournament**: while some of the matches among the tied teams are still outstanding, the mini-table is **incomplete**, so it's comparing teams that have played a different set of each other. That can produce an order that looks off at a glance.

## It settles once the matches are played

The moment the outstanding matches among the tied teams are played, the mini-table fills out and the order reflects the full picture. In the example above, once **Umhlali play Virginia**, the mini-table is complete and the standings settle into their true, final order.

In other words: a head-to-head table almost always looks **more correct at the end** than it does in the middle. A surprising-looking order with matches still outstanding is normal, not a mistake, and it corrects itself as the results come in. Nothing needs to be fixed.

## When only two teams are level

When exactly **two** teams are level on points and they've already played each other, the mini-table is just that one result:

- If one beat the other, that team is placed above. Done.
- If they **drew**, the mini-table can't separate them, so it falls through to the next tie-breaker, usually **overall goal difference**, then goals for, and so on.

So a straight two-team tie that ends in a draw is decided by overall goal difference, exactly as you'd expect.

## The order your competition uses

Every competition stores its own ranking configuration, chosen by its organiser. You can see it at the top of the pool or standings page: the points system, and the tie-breakers in the exact order they're applied. That summary is the definitive answer for how **that** competition's table is decided.

If a table still looks wrong once every match among the tied teams has been played, it almost always traces back to a wrong or missing result rather than the tie-breaker itself. See [Why a stat looks wrong](why-a-stat-looks-wrong.md).
