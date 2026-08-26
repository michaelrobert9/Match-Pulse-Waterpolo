# Guardianship sync — sport apps ⇄ main website

## The problem this solves

A parent creates an account and claims their child's player profile inside a
sport app (hockey / netball / rugby / water polo). Player profiles (`people`)
live in each **sport's own Firestore database**, but the main website manages
parent↔child links in the **central (default) identity database**. There was no
bridge between the two, so a claim in a sport app never reached the main site.

Two independent things were wrong and both are addressed here:

1. **The claim button did nothing in the installed PWA.** The confirmation used
   `window.confirm()`, which the installed PWA suppresses, so the claim silently
   never ran. Fixed in the sport apps: the confirm is now an in-UI two-step
   ("I'm a parent" → "Confirm claim"). No main-site work needed for this.

2. **No central record of the claim.** Now fixed on the sport side by writing a
   `guardianships` document to the central identity DB on every **parent** claim.
   **The main website must add the security rule below for that write to be
   accepted, and then consume the collection.** That is the work described here.

---

## What the sport apps now write

Firebase project: `match-pulse-4560e`. Database: **(default)** — the same one
that holds `users`, `userProfiles`, `venues`, `venueIndex`.

- **Collection:** `guardianships`
- **Document ID (deterministic, idempotent):** `` `${sport}_${personId}_${parentUid}` ``
  e.g. `netball_9fK2…_ABC123uid`
- **Written on:** a successful **parent/guardian** claim only (a player claiming
  their *own* profile stays sport-local — there is no parent↔child link to sync).
- **Write mode:** `setDoc(..., { merge: true })` — the sport app only ever writes
  the fields below, so any fields the main site adds (see "Approval" below) are
  never overwritten.

Document shape written by the sport app:

```jsonc
{
  "parentUid":   "ABC123uid",          // Firebase Auth uid of the claiming parent
  "parentEmail": "parent@example.com", // lowercased, may be null
  "parentName":  "Jane Doe",           // may be null
  "sport":       "netball",            // hockey | netball | rugby | waterpolo
  "personId":    "9fK2…",              // the sport-DB people doc id (per sport)
  "personName":  "Sam Doe",            // child's name snapshot, may be null
  "personSlug":  "sam-doe",            // may be null
  "relationship":"parent",
  "status":      "active",             // sport-side claim is immediate
  "source":      "sport-claim",
  "createdAt":   <serverTimestamp>
}
```

Auth is shared across every subdomain and the main site (one Firebase Auth), so
`parentUid` is the same id the main website already knows the parent by.

---

## 1) Security rules to ADD on the central (default) database

Until this rule exists the sport-side write fails with `permission-denied`. That
failure is swallowed (the claim still succeeds locally), so **nothing syncs until
you deploy this.** The email-verified check mirrors the sport-side gate.

```
match /guardianships/{id} {
  // The parent who owns the record can read it; platform admins can read all.
  allow read: if request.auth != null
    && (request.auth.uid == resource.data.parentUid || isPlatformAdmin());

  // A signed-in, email-verified user may create/update ONLY their own record,
  // and only the sport-claim shape. They can never set the main-site approval
  // fields (those are added server-side / by an admin — see below).
  allow create, update: if request.auth != null
    && request.auth.token.email_verified == true
    && request.resource.data.parentUid == request.auth.uid
    && request.resource.data.relationship == 'parent'
    && request.resource.data.source == 'sport-claim'
    && !('mainSiteStatus' in request.resource.data.diff(resource.data).affectedKeys());

  allow delete: if isPlatformAdmin();
}
```

(`isPlatformAdmin()` — reuse whatever admin predicate the central rules already
have for `venues` etc.)

---

## 2) What the main website should DO with these records

- **List for a parent:** query `guardianships where parentUid == <currentUser.uid>`
  to show "children/players you've claimed", grouped by child.
- **Admin queue:** list all (or `where status == 'active'`) for the parent-linking
  screen you built, so an admin can see every claim across all four sports.
- **Resolve the child:** the child is a **per-sport** `people` doc, identified by
  `(sport, personId)`. If the main site keeps a central child registry, map
  `(sport, personId)` → your central child entity; a child who plays two sports
  will produce two `guardianships` rows (one per sport, same `parentUid`).
- **Approval (optional, main-site owned):** if you want an approval step, add your
  own fields — e.g. `mainSiteStatus: "pending" | "approved" | "rejected"`,
  `approvedBy`, `approvedAt`. The sport app never writes these (merge-safe), and
  the rule above forbids the client from setting `mainSiteStatus`, so only your
  server/admin can. Note the sport-side claim already grants the parent control
  **inside the sport app** immediately; `mainSiteStatus` is only about what the
  main website chooses to surface/allow centrally.

---

## 3) Optional reverse sync (main site → sport apps)

You mentioned you can already link a parent to a child on the main site. If you
want that link to **grant guardian control inside a sport app** (i.e. write
`guardianUids` onto the sport-DB `people/{personId}` doc), that is a
cross-database write the browser client cannot do against another project's
database under these rules. Do it with a **Cloud Function (Admin SDK)**:

- Trigger: `onCreate`/`onWrite` of your central parent↔child link (or an explicit
  "push to sport" action).
- Action: using the Admin SDK, open the target sport database
  (`getFirestore(app, '<sport>')`) and `arrayUnion` the parent's uid into
  `people/{personId}.guardianUids`, setting `claimStatus: 'claimed'`.
- Idempotent: keyed by the same `(sport, personId, parentUid)`.

This is only needed if the *main site* is the place a parent gets linked; when the
parent claims *in the sport app*, control is already granted there.

---

## Summary of who does what

| Piece | Where | Status |
|---|---|---|
| PWA claim button (in-UI confirm) | sport apps | ✅ done |
| Write `guardianships` on parent claim | sport apps | ✅ done (no-ops until the rule below exists) |
| `guardianships` security rule on (default) DB | **main website** | ⬜ to build |
| Consume/approve/link `guardianships` | **main website** | ⬜ to build |
| Reverse sync (main→sport) via Cloud Function | **main website** | ⬜ optional |
