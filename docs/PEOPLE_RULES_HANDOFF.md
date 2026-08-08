# People rules handoff — water polo

**Per the ownerless-profiles addendum §A5:** `people` rules ship centrally, not from a
sport repo. This document is water polo's proposed rule text for the central ruleset,
to be reconciled with hockey's `docs/PEOPLE_RULES_HANDOFF.md` and netball's proposed
text and deployed from the main site.

**Release gate:** until the central rules deploy, every gate in the ownerless-profiles
feature is UX rather than security — and in this repo, team-sheet *creates* are
outright denied by the live rules (the existing create rule requires a consent record
and self-attachment). Do not put team sheets in front of a real organiser and do not
announce the feature.

## Water polo platform notes the reconciliation must resolve

1. **Where `people` lives.** In water polo today, `people` is in the sport's own
   `waterpolo` named database, governed by this repo's `firestore.rules` — not the
   central `(default)` database the addendum assumes. The create-authority clause
   (squad-write authority on the competition team) is therefore expressible *here*
   without any cross-database read; it is the central deploy that cannot see our
   `competitions/{id}/teams` docs. Either `people` moves central (a migration this
   addendum says not to do), or the central ruleset must be deployed per-sport-database
   by the platform owner. Decide once, for all four sports.
2. **Legacy self-claim branch.** This repo's live rules allow any signed-in user to
   claim an unclaimed profile (no owner, no guardians) by writing `ownerUid` or
   `guardianUids` — with **no email verification**. Team-sheet profiles satisfy that
   branch's preconditions, so until the central rules land, an unverified legacy-shaped
   claim on a team-sheet profile is possible. The central ruleset must scope the legacy
   branch away from `claimStatus`-carrying docs (see §3 below).
3. **Audit fields.** `createdByUid` and `createdInCompetitionId` are audit-only. No rule
   may read them to grant access. `createdInCompetitionTeamId` is an extra audit field
   water polo writes so the create-authority clause can scope coach/manager creates to
   their own team.

## Proposed rule text

Helpers assumed available: `isSignedIn()`, `isPlatformAdmin()`,
`canAdministerCompetition(cid)`, `isTeamOrgMember(teamId)`.

### 1. Create a person via team sheet

```
// OWNERLESS team-sheet creates (ownerless-profiles addendum A5): no owner,
// no guardian, no manager, no consent record — nobody claims rights over
// anyone, so there is nothing to consent to at creation. The writer must
// hold squad-write authority on the competition team the sheet belongs to.
// createdByUid is AUDIT ONLY — it must never appear in a permission
// expression (that would quietly turn the ownerless model back into an
// ownership model).
allow create: if isSignedIn()
  && request.resource.data.get('createdVia', '') == 'teamSheet'
  && request.resource.data.get('claimStatus', '') == 'unclaimed'
  && request.resource.data.get('ownerUid', 'set') == null
  && request.resource.data.get('guardianUids', ['set']).size() == 0
  && request.resource.data.get('managerUids', ['set']).size() == 0
  && (canAdministerCompetition(request.resource.data.get('createdInCompetitionId', ''))
      || isTeamOrgMember(request.resource.data.get('createdInCompetitionTeamId', '')));
```

### 2. Claim transition (email-verified)

```
// Email-verified CLAIM of a team-sheet profile: the doc must be unclaimed,
// the caller's email verified, the caller not on the block list. A player
// claim sets ownerUid to EXACTLY the caller; a parent claim sets
// guardianUids to EXACTLY [caller]. managerUids is never touched by a claim.
// Only the claim fields may change; a claimed profile is not claimable again.
allow update: if isSignedIn()
  && request.auth.token.get('email_verified', false) == true
  && resource.data.get('claimStatus', '') == 'unclaimed'
  && !(request.auth.uid in resource.data.get('claimBlockedUids', []))
  && request.resource.data.get('claimStatus', '') == 'claimed'
  && request.resource.data.get('managerUids', []) == resource.data.get('managerUids', [])
  && (
       (request.resource.data.get('ownerUid', null) == request.auth.uid
         && request.resource.data.get('guardianUids', []).size() == 0)
       || (request.resource.data.get('ownerUid', null) == null
         && request.resource.data.get('guardianUids', []) == [request.auth.uid])
     )
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['ownerUid', 'guardianUids', 'claimStatus', 'preClaimSnapshot',
                 'claimedBy', 'claimedAt', 'updatedAt', 'updatedBy']);
```

### 3. Scope the legacy self-claim branch

The pre-existing self-claim branch (write `ownerUid`/`guardianUids` on a doc with
neither) must exclude team-sheet profiles, or it bypasses the email-verified gate:

```
  && resource.data.get('claimStatus', '') == ''   // add to the legacy branch
```

### 4. Revocation

Master admins only, any profile, any state. The platform-admin clause of the
existing update rule already covers the write; revocation restores the pre-claim
snapshot, empties `ownerUid`/`guardianUids` (never `managerUids`), block-lists the
revoked uid (`claimBlockedUids`) and stamps `claimRevokedAt`/`claimRevokedBy`.

## Client behaviour already shipped (waiting on these rules)

- `createTeamSheetPerson` writes exactly the create shape in §1.
- `claimTeamSheetProfile(personId, relationship)` writes exactly the claim shape in
  §2 (player → `ownerUid`, parent → `guardianUids`), stores the pre-claim snapshot
  and audit fields, and refuses unverified emails client-side.
- `revokeProfileClaim` (platform admin) writes the revocation shape in §4.
- The claim search runs on the first authenticated session with no claimed profile
  (`ClaimSearchPrompt`), covering provider sign-ins that never pass through sign-up.
