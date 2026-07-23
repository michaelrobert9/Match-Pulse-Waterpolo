# Fixture Lifecycle — Deployment & Activation

The fixture-lifecycle redesign (six-status model, daily sweep, submit-result
queue, audit log, nudges, install/notifications) is merged in code. Several
pieces require Firebase actions that must be run against the project. Do them in
this order.

## 1. Deploy Firestore rules

Adds the immutable per-fixture audit log (`matches/{id}/auditLog`).

```
firebase deploy --only firestore:rules
```

## 2. Run the status migration (after the app deploy)

Rewrites legacy `status:'upcoming'` → `'scheduled'` and seeds `tracked` on
existing matches. The app already tolerates legacy `upcoming` on read, so this
is cleanup, not load-bearing — but run it so the legacy alias can later be
removed. Dry-run first.

```
FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" \
  node scripts/migrate-fixture-status.mjs            # dry run, reports only
APPLY=1 FIREBASE_SERVICE_ACCOUNT=... \
  node scripts/migrate-fixture-status.mjs            # writes
```

## 3. Seed the sweep config (optional — has a safe default)

The daily sweep reads `_meta/sweepConfig`; absent, it defaults to
`{ cutoffTime: "03:00", timezone: "Africa/Johannesburg" }`. To override, create:

```
_meta/sweepConfig = { cutoffTime: "03:00", timezone: "Africa/Johannesburg" }
```

This is the seam for per-region cutoffs later (move to per-competition/org
config — a config change, not a rewrite).

## 4. Deploy Cloud Functions

Replaces the deleted `autoFinalizeStaleMatches` (which silently finalised) with:
- `autoFlipScheduledMatches` (every 15 min) — scheduled → live at start time.
- `dailyFixtureSweep` (hourly, acts at the local cutoff hour) — live →
  awaiting_result, never final.

```
firebase deploy --only functions
```

> ORDER NOTE: the sweep moves matches into `awaiting_result`, which are resolved
> from the admin **Awaiting result** queue (`/admin/result-queue`). That UI ships
> in the same app deploy, so deploy the app before/with the functions.

## 5. Push notifications (FCM) — deploy-gated, optional

The install banner, permission sequencing, and instructions page work today.
Actual push DELIVERY needs:

1. **Service worker config** — inline the project's PUBLIC web config into
   `public/firebase-messaging-sw.js` (the TODO placeholders).
2. **VAPID key** — set `VITE_FIREBASE_VAPID_KEY` (Firebase console → Project
   settings → Cloud Messaging → Web push certificates) in the app env.
   `lib/notifications.js` then registers per-user tokens to
   `users/{uid}.fcmTokens`.
3. **Senders (not yet built)** — Cloud Functions that send to those tokens for:
   - scorer "still playing?" reminders (possibly-unfinished tracked matches),
   - admin "result awaiting confirmation" notifications when the sweep or a
     submit moves a fixture to `awaiting_result`.
   These are the remaining backend work; the client scaffolding and token
   storage are in place.

## Model reference (six statuses, one flag)

- `scheduled` · `live` · `awaiting_result` · `final` · `postponed` · `cancelled`
- `tracked` (bool): true once "Start match" is tapped. Drives the live
  disclaimer, exempts the match from per-fixture auto-retire, and pre-fills the
  provisional score on hand-off to `awaiting_result`.
- `paused` remains a transitional 7th stored status for the scorer clock; all
  behavioural checks go through `isLive()` in `src/lib/fixtureStatus.js`, so the
  eventual `paused → isPaused` collapse is a one-function change.
- Only `final` counts toward standings; standings are recomputed from scratch on
  read (`computeStandings`) — never incrementally — so editing a result can
  never double-count.
