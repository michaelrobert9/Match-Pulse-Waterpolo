# Deployment Guide

MatchPulse is a Vite SPA on **Firebase Hosting** with **Cloud Firestore** rules and
indexes. This guide covers both automated (CI) and manual deployment, and — importantly —
the **IAM permissions** the CI service account needs to deploy Firestore rules.

- **Firebase project:** `match-pulse-4560e`
- **CI workflow:** `.github/workflows/firebase-deploy.yml` (runs on push to `main`)

---

## What gets deployed

| Artifact | Source | Deploy target |
|---|---|---|
| Static site | `dist/` (from `npm run build`) | Firebase Hosting |
| Firestore security rules | `firestore.rules` | Cloud Firestore |
| Firestore composite indexes | `firestore.indexes.json` | Cloud Firestore |
| Storage rules | `storage.rules` | Cloud Storage |

The hosting deploy and the **Firestore rules/indexes deploy are separate steps.** Hosting
can succeed while the rules deploy fails — always confirm both.

---

## CI service account — required IAM roles

The CI deploy uses the `FIREBASE_SERVICE_ACCOUNT` GitHub secret (a Google service-account
JSON key). Deploying **Firestore rules and indexes** requires more than Hosting alone,
because the Firebase CLI calls `serviceusage.googleapis.com` to verify that
`firestore.googleapis.com` is enabled on the project before releasing rules.

If the service account lacks these roles you will see an error like:

```
Error: Failed to make request to https://serviceusage.googleapis.com/v1/projects/.../services/firestore.googleapis.com
... Permission denied to access serviceusage.googleapis.com for firestore.googleapis.com
```

This is an **IAM / deployment-permission issue, not an application-code issue.**

### Grant the service account these roles

| Role | ID | Why it is needed |
|---|---|---|
| **Firebase Admin** | `roles/firebase.admin` | Deploy Hosting, manage Firebase resources, release Firestore rules. |
| **Cloud Datastore Owner** | `roles/datastore.owner` | Write Firestore security rules and create/update composite indexes. |
| **Service Usage Viewer** | `roles/serviceusage.serviceUsageViewer` | Allow the CLI to check that `firestore.googleapis.com` is enabled (the role missing in the failed deploy). |

### How to grant them

**Console:**
IAM & Admin → IAM → find the service account (e.g.
`github-deployer@match-pulse-4560e.iam.gserviceaccount.com`) → **Edit** → **Add another
role** → add each of the three roles above → **Save**.

**gcloud CLI:**
```bash
PROJECT_ID=match-pulse-4560e
SA_EMAIL=github-deployer@match-pulse-4560e.iam.gserviceaccount.com   # adjust to your SA

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/firebase.admin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/datastore.owner"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/serviceusage.serviceUsageViewer"
```

After granting, re-run the workflow (push to `main` or **Actions → Deploy to Firebase
Hosting → Run workflow**). IAM changes can take a minute or two to propagate.

> Also ensure the **Cloud Firestore API** (`firestore.googleapis.com`) and **Service Usage
> API** (`serviceusage.googleapis.com`) are enabled on the project (APIs & Services →
> Enabled APIs). Service Usage Viewer lets the CLI *check* this; it does not *enable* the API.

---

## Manual deployment (from a local machine)

Use this when CI permissions are not yet in place, or to deploy rules out of band.

### Prerequisites
- Firebase CLI: `npm install -g firebase-tools`
- Signed in as a user with deploy rights on `match-pulse-4560e`: `firebase login`

### Deploy Firestore rules only (the common case)
```bash
git pull origin <your-branch>
firebase deploy --only firestore:rules --project match-pulse-4560e
```

Expected output:
```
✔  firestore: rules file firestore.rules compiled successfully
✔  firestore: released rules firestore.rules to cloud.firestore
✔  Deploy complete!
```

### Other manual targets
```bash
# Rules + indexes together
firebase deploy --only firestore:rules,firestore:indexes --project match-pulse-4560e

# Storage rules
firebase deploy --only storage --project match-pulse-4560e

# Hosting (after npm run build)
npm run build
firebase deploy --only hosting --project match-pulse-4560e

# Everything
firebase deploy --project match-pulse-4560e
```

> A signed-in **human user** with the Owner/Editor role on the project does not hit the
> Service Usage error, because their account already carries the necessary permissions.
> The three roles above are specifically for the **CI service account**.

---

## Post-deploy verification

After deploying Firestore rules, confirm:

1. Public pages load **logged out**: `/`, `/competitions`, `/schools`, `/clubs` — no
   "missing or insufficient permissions" errors in the browser console.
2. A signed-in user can self-create an organisation at `/manage/new-org` and becomes its
   **owner** (check `organizations/{id}/staff/{uid}` has `role: "owner"`).
3. An organisation member can create a competition, team and fixture under
   `/manage/orgs/:id`, and score the fixture from `/score`.

Use the **Firestore → Rules → Rules Playground** in the console to debug any specific
`permission-denied` by simulating the exact operation and user UID.
