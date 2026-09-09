const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const logger = require('firebase-functions/logger')
const { Resend } = require('resend')
const admin = require('firebase-admin')
const { getFirestore } = require('firebase-admin/firestore')
const crypto = require('crypto')
const { recomputeCompetitionStats, recomputeAllCareerStats, recomputeFriendlyStatsForTeams } = require('./statsEngine')
const { buildSitemap } = require('./sitemap')
const { rendererHandler } = require('./renderer')

admin.initializeApp()

// This app's Firestore data lives in the `waterpolo` NAMED database, not
// (default). Bind every function's Firestore access — and the `database` option
// on the document triggers below — to it; otherwise reads/writes silently hit
// the wrong database and the triggers never fire for this sport. Mirrors
// firebase.json's `"database": "waterpolo"` and the client's VITE_FIRESTORE_DATABASE.
// VERIFY ON LIVE: the build workspace has no Firebase credentials to exercise
// this against the real database.
const DB_ID = 'waterpolo'
const db = getFirestore(DB_ID)
// Shared identity (users/userProfiles) lives in the project's (default)
// database, not this sport's named DB — read it through the default handle.
const dbDefault = admin.firestore()

// Human-readable role labels, mirroring src/lib/capabilities.js ROLE_DISPLAY.
// Falls back to the raw role string for anything not listed.
const ROLE_DISPLAY = {
  master_admin: 'Master Admin',
  owner: 'Owner',
  staff: 'Scorer',
  player: 'Player',
  parent: 'Parent',
  manager: 'Manager',
}

// Sends an invite email through Resend whenever a document is created in the
// top-level `invites` collection. The Resend API key is supplied at runtime by
// the RESEND_API_KEY secret (Google Cloud Secret Manager) and read from
// process.env — never committed or hard-coded.
exports.waterpoloSendInviteEmail = onDocumentCreated(
  { document: 'invites/{inviteId}', database: DB_ID, secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const snap = event.data
    if (!snap) return

    const invite = snap.data() || {}
    const { inviteId } = event.params

    // createInvite() writes an already-`accepted` document when the invitee
    // already has an account (they are added directly, with no email needed).
    // Only the `pending` path is a genuine invitation that should be emailed.
    if (invite.status && invite.status !== 'pending') {
      logger.info('Skipping invite email — status is not pending', {
        inviteId,
        status: invite.status,
      })
      return
    }

    const email = invite.email
    if (!email) {
      logger.warn('Skipping invite email — invite has no email address', { inviteId })
      return
    }

    const roleLabel = ROLE_DISPLAY[invite.role] || invite.role || 'member'
    const signupLink = `https://waterpolo.matchpulse.co.za/signup?invite=${inviteId}`

    const resend = new Resend(process.env.RESEND_API_KEY)

    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
        <h1 style="font-size: 20px; margin: 0 0 16px;">You've been invited to MatchPulse</h1>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">
          You have been invited to join MatchPulse as a <strong>${roleLabel}</strong>.
        </p>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Click the button below to create your account and accept the invitation.
        </p>
        <p style="margin: 0 0 24px;">
          <a href="${signupLink}"
             style="display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 12px 24px; border-radius: 8px;">
            Accept invitation
          </a>
        </p>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0;">
          Or paste this link into your browser:<br />
          <a href="${signupLink}" style="color: #059669;">${signupLink}</a>
        </p>
      </div>
    `

    const text = [
      "You've been invited to MatchPulse",
      '',
      `You have been invited to join MatchPulse as a ${roleLabel}.`,
      '',
      'Create your account and accept the invitation here:',
      signupLink,
    ].join('\n')

    try {
      const { data, error } = await resend.emails.send({
        from: 'MatchPulse <noreply@matchpulse.co.za>',
        to: email,
        subject: 'You have been invited to MatchPulse',
        html,
        text,
      })

      if (error) {
        logger.error('Resend returned an error sending the invite email', { inviteId, error })
        // Throw so the function is retried per the platform's retry policy.
        throw new Error(error.message || 'Resend error')
      }

      logger.info('Invite email sent', { inviteId, email, role: invite.role, messageId: data?.id })
    } catch (err) {
      logger.error('Failed to send invite email', { inviteId, message: err.message })
      throw err
    }
  }
)

// ── PayFast / billing: REMOVED ────────────────────────────────────────────────
// Purchase is a PayFast hosted checkout on the MAIN SITE, whose webhook grants
// the plan and mirrors it onto the Auth token via syncUserClaims (brief §7a).
// This app only READS the entitlement claim. The initPayFastPayment and
// payfastITN functions were removed from here: their names are global to the
// shared project, so declaring them here would collide with the main site's.

// ── Fixture lifecycle: scheduled functions ─────────────────────────────────────
//
// CORE PRINCIPLE: the system NEVER invents a result and NEVER silently
// finalises one. These jobs only MOVE fixtures between non-counting states —
// scheduled → live (auto-flip) and live → awaiting_result (daily sweep). A human
// always confirms the final result from the admin queue. (The previous
// `autoFinalizeStaleMatches` job, which wrote status:'final' on a timer, has
// been deleted — it violated this principle.)
//
// Legacy match docs may still store status:'upcoming' instead of 'scheduled'
// until scripts/migrate-fixture-status.mjs has run; both are queried.
const SCHEDULED_STATUSES = ['scheduled', 'upcoming']
const LIVE_STATUSES = ['live', 'paused']

// Sweep cutoff lives in config (NOT hard-coded) so going multi-region later is a
// config change — move this from a single global doc to per-competition/per-org
// lookups inside the same function body. v1: one global value (South Africa).
const SWEEP_CONFIG_DEFAULT = { cutoffTime: '03:00', timezone: 'Africa/Johannesburg' }

async function readSweepConfig(db) {
  try {
    const snap = await db.doc('_meta/sweepConfig').get()
    const cfg = snap.exists ? snap.data() : {}
    return {
      cutoffTime: cfg.cutoffTime || SWEEP_CONFIG_DEFAULT.cutoffTime,
      timezone:   cfg.timezone   || SWEEP_CONFIG_DEFAULT.timezone,
    }
  } catch {
    return { ...SWEEP_CONFIG_DEFAULT }
  }
}

// The wall-clock hour in a given IANA timezone. The functions run in UTC; this
// converts so the cutoff is evaluated against local time.
function localHour(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', hour12: false,
  }).formatToParts(date)
  return Number(parts.find(p => p.type === 'hour')?.value ?? -1)
}

function toMillis(val) {
  if (val == null) return null
  if (val.toMillis) return val.toMillis()
  if (typeof val === 'number') return val
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

// ── Auto-flip: scheduled → live at start time (spec §4 Paths A & C) ─────────────
// A fixture goes Live (unconfirmed, tracked:false, disclaimer shown) once its
// scheduled start passes, so the public sees the match is in its window even if
// no scorer has opened it. A scorer's "Start match" tap later sets tracked:true.
//
// AGE GUARD: only fixtures scheduled within the last AUTOFLIP_WINDOW_HOURS are
// flipped. Without this, the first run would resurrect every past, never-played
// fixture in the database into Live → Awaiting result and flood the queue.
const AUTOFLIP_WINDOW_HOURS = 6

exports.waterpoloAutoFlipScheduledMatches = onSchedule(
  { schedule: 'every 15 minutes', region: 'europe-west1' },
  async () => {
    const serverTs = admin.firestore.FieldValue.serverTimestamp
    const now = Date.now()
    const windowStart = now - AUTOFLIP_WINDOW_HOURS * 60 * 60 * 1000

    const snap = await db.collection('matches').where('status', 'in', SCHEDULED_STATUSES).get()
    const due = snap.docs.filter(d => {
      const startMs = toMillis(d.data().scheduledAt)
      return startMs != null && startMs <= now && startMs >= windowStart
    })

    if (due.length === 0) {
      logger.info('autoFlipScheduledMatches — nothing due', { scheduled: snap.size })
      return
    }

    for (const d of due) {
      try {
        // tracked stays false — no human has started scoring. The disclaimer on
        // the public live view keys off this. status flips to 'live' only.
        await db.doc(`matches/${d.id}`).update({
          status: 'live', tracked: false,
          updatedBy: 'system:auto-flip', updatedAt: serverTs(),
        })
        logger.info('Auto-flipped fixture to live (untracked)', { matchId: d.id })
      } catch (err) {
        logger.error('Failed to auto-flip fixture', { matchId: d.id, message: err.message })
      }
    }
  }
)

// ── Daily sweep: live → awaiting_result at the cutoff (spec §5) ─────────────────
// Runs hourly; acts only when the configured local cutoff hour is reached, so
// the effective behaviour is "once daily at cutoffTime in timezone". Reading the
// cutoff from config (rather than the cron) is the seam for per-region cutoffs
// later. Any fixture still Live at the cutoff is moved to Awaiting result — NEVER
// finalised, NEVER given an invented score. tracked matches keep their
// provisional live score (already on homeScore/awayScore) for the admin to
// confirm; untracked matches present a blank form (driven by tracked downstream).
exports.waterpoloDailyFixtureSweep = onSchedule(
  { schedule: '0 * * * *', region: 'europe-west1' },
  async () => {
    const serverTs = admin.firestore.FieldValue.serverTimestamp
    const cfg = await readSweepConfig(db)
    const cutoffHour = Number(String(cfg.cutoffTime).split(':')[0])
    const hourNow = localHour(cfg.timezone)

    if (hourNow !== cutoffHour) {
      logger.info('dailyFixtureSweep — outside cutoff hour, skipping', { hourNow, cutoffHour, tz: cfg.timezone })
      return
    }

    const snap = await db.collection('matches').where('status', 'in', LIVE_STATUSES).get()
    if (snap.size === 0) {
      logger.info('dailyFixtureSweep — nothing live at cutoff')
      return
    }

    logger.info('dailyFixtureSweep — retiring live fixtures to awaiting_result', { count: snap.size })
    for (const d of snap.docs) {
      const m = d.data()
      const tracked = m.tracked === true
      const sweepEntry = {
        type: 'swept_to_awaiting', period: null, matchTimestamp: 0,
        clockTime: new Date().toISOString(), createdBy: 'system:daily-sweep',
        createdAt: Date.now(), tracked,
      }
      try {
        await db.doc(`matches/${d.id}`).update({
          // Non-counting state; awaits human confirmation. No result written.
          status: 'awaiting_result',
          // Provisional score is whatever the live scoring left on the doc for a
          // tracked match; an untracked match has only the 0–0 placeholder, which
          // the submit form treats as blank (it keys off `tracked`).
          sweptAt: serverTs(),
          controlLog: admin.firestore.FieldValue.arrayUnion(sweepEntry),
          updatedBy: 'system:daily-sweep', updatedAt: serverTs(),
        })
        logger.info('Swept fixture to awaiting_result', { matchId: d.id, tracked })
      } catch (err) {
        logger.error('Failed to sweep fixture', { matchId: d.id, message: err.message })
      }
    }
  }
)

// ── Stats: recompute-from-history ──────────────────────────────────────────────
//
// Stats are ALWAYS derived from match history (lineups, goals, cards), never
// trusted as stored state. One rebuild engine (functions/statsEngine.js), two
// triggers with different scope:
//   • Competition slices — rebuilt the moment a fixture is finalised or its
//     result is edited (scoped to that competition; cheap; immediate).
//   • Career totals — rebuilt wholesale once daily at 03:00 (the safety net that
//     silently corrects any drift, edit, or late fixture from the previous day).
// The split is deliberate: a full career sweep on every finalisation would
// rebuild all-time history repeatedly across a busy weekend and bog the site
// down, so it lives on the schedule; the scoped slice rebuild is cheap.

// Stat-affecting fields. An edit to an already-final fixture only needs a
// recompute if one of these changed; a metadata-only edit is ignored.
function statsRelevantChanged(before, after) {
  const j = v => JSON.stringify(v ?? null)
  return before.homeScore !== after.homeScore
    || before.awayScore !== after.awayScore
    || j(before.goals)      !== j(after.goals)
    || j(before.cards)      !== j(after.cards)
    || j(before.homeLineup) !== j(after.homeLineup)
    || j(before.awayLineup) !== j(after.awayLineup)
}

// Scoped competition recompute on finalisation. Fires on the transition INTO
// final, and on any stat-affecting edit to an already-final fixture. Writes only
// `players` slices (never the match doc) so it cannot re-trigger itself.
exports.waterpoloRecomputeCompetitionStatsOnFinal = onDocumentUpdated(
  { document: 'matches/{matchId}', database: DB_ID, region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before?.data()
    const after  = event.data?.after?.data()
    if (!before || !after) return

    const wasFinal = before.status === 'final'
    const isFinal  = after.status === 'final'
    if (!isFinal) return
    if (wasFinal && !statsRelevantChanged(before, after)) return

    const competitionId = after.competitionId
    if (!competitionId) {
      // Standalone fixture (friendly) — rebuild the two teams' roster-entry
      // stats so friendlies count toward player records too.
      try {
        const res = await recomputeFriendlyStatsForTeams(
          [after.homeTeamId, after.awayTeamId], db)
        logger.info('Friendly stats recomputed', { matchId: event.params.matchId, ...res })
      } catch (err) {
        logger.error('Failed to recompute friendly stats', {
          matchId: event.params.matchId, message: err.message,
        })
      }
      return
    }

    try {
      const res = await recomputeCompetitionStats(competitionId, db)
      logger.info('Competition stats recomputed', {
        matchId: event.params.matchId, competitionId, transition: !wasFinal, ...res,
      })
    } catch (err) {
      logger.error('Failed to recompute competition stats', {
        matchId: event.params.matchId, competitionId, message: err.message,
      })
    }
  }
)

// Wholesale career recompute — daily at 03:00 Africa/Johannesburg. Rebuilds every
// competition's slices from origin, then re-derives every person's career totals
// and competitionIds as the sum/union of their fresh slices. Idempotent.
exports.waterpoloDailyCareerStatsRecompute = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Africa/Johannesburg', region: 'europe-west1' },
  async () => {
    try {
      const res = await recomputeAllCareerStats(db)
      logger.info('Daily career stats recompute complete', res)
    } catch (err) {
      logger.error('Daily career stats recompute failed', { message: err.message })
    }
  }
)

// Recycle-bin auto-purge — daily at 03:30. Permanently removes matches that have
// been soft-deleted (deleted === true) for more than RECYCLE_BIN_TTL_DAYS, and
// clears their competition fixture-membership doc. Restoring clears the flag, so
// only abandoned deletions are ever purged. A deleted match with no deletedAt is
// left for manual purge.
const RECYCLE_BIN_TTL_DAYS = 90
exports.waterpoloDailyRecycleBinPurge = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'Africa/Johannesburg', region: 'europe-west1' },
  async () => {
    try {
      const cutoffMs = Date.now() - RECYCLE_BIN_TTL_DAYS * 24 * 60 * 60 * 1000
      const snap = await db.collection('matches').where('deleted', '==', true).get()
      let purged = 0, batch = db.batch(), ops = 0
      for (const docSnap of snap.docs) {
        const m = docSnap.data()
        const del = m.deletedAt
        if (!del || typeof del.toMillis !== 'function' || del.toMillis() > cutoffMs) continue
        batch.delete(docSnap.ref); ops++
        if (m.competitionId) { batch.delete(db.doc(`competitions/${m.competitionId}/fixtures/${docSnap.id}`)); ops++ }
        purged++
        if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0 }
      }
      if (ops > 0) await batch.commit()
      logger.info('Recycle-bin purge complete', { purged, ttlDays: RECYCLE_BIN_TTL_DAYS })
    } catch (err) {
      logger.error('Recycle-bin purge failed', { message: err.message })
    }
  }
)

// Backend authorisation mirror of src/lib/competitionAuth.js#canAdministerCompetition:
// platform admin; an org-WIDE (teamId == null) grant on the owning org; the
// competition's creator; or a direct competition staff grant.
async function assertCanAdministerCompetition(db, competitionId, auth) {
  const [compSnap, userSnap] = await Promise.all([
    db.doc(`competitions/${competitionId}`).get(),
    dbDefault.doc(`users/${auth.uid}`).get(),
  ])
  if (!compSnap.exists) throw new HttpsError('not-found', 'Competition not found.')
  const comp = compSnap.data()
  const u = userSnap.exists ? userSnap.data() : {}

  if (u.platformAdmin === true) return
  const owningOrgId = comp.ownerOrgId ?? comp.orgId ?? null
  const orgGrant = owningOrgId ? (u.orgRoles ?? {})[owningOrgId] : null
  if (orgGrant && (orgGrant.teamId == null)) return
  if (comp.createdBy && comp.createdBy === auth.uid) return
  if ((u.competitionRoles ?? {})[competitionId]) return

  throw new HttpsError('permission-denied', 'You are not authorised to administer this competition.')
}

// Manual "Recalculate stats" button (CompetitionManage). Authorises the caller
// as a competition admin, then runs the same scoped engine the finalisation
// trigger uses. Career totals are not touched here — they refresh on the nightly
// run. Writes an immutable audit entry.
exports.waterpoloRecalculateCompetitionStats = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.')
    const { competitionId } = request.data ?? {}
    if (!competitionId) throw new HttpsError('invalid-argument', 'competitionId is required.')

    await assertCanAdministerCompetition(db, competitionId, request.auth)

    const res = await recomputeCompetitionStats(competitionId, db)

    await db.collection('competitions').doc(competitionId).collection('auditLog').add({
      eventType:  'stats_recalculated',
      actorId:    request.auth.uid,
      actorEmail: request.auth.token?.email ?? null,
      occurredAt: admin.firestore.FieldValue.serverTimestamp(),
      payload:    { before: null, after: { ...res }, reason: 'manual_recalculate' },
    })

    logger.info('Manual competition stats recompute', { competitionId, uid: request.auth.uid, ...res })
    return res
  }
)

// Manual wholesale career rebuild — platform-admin only. Runs the same engine as
// the nightly job, on demand. Intended for deploy day (populate every player's
// career totals + competitionIds immediately rather than waiting for 03:00) and
// as an operator escape hatch. Wholesale cost is fine for a deliberate one-off;
// it is the per-finalisation case that the nightly schedule exists to avoid.
exports.waterpoloRebuildAllCareerStats = onCall(
  { region: 'europe-west1', timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.')
    const userSnap = await dbDefault.doc(`users/${request.auth.uid}`).get()
    if (!(userSnap.exists && userSnap.data().platformAdmin === true)) {
      throw new HttpsError('permission-denied', 'Platform admin only.')
    }
    const res = await recomputeAllCareerStats(db)
    logger.info('Manual wholesale career rebuild', { uid: request.auth.uid, ...res })
    return res
  }
)

// Bot renderer — head injection for search & AI crawlers. Serves as the **
// catch-all rewrite in firebase.json. Non-bots get the SPA shell; bots get
// the same shell with per-route title/description/OG/JSON-LD injected.
// Does NOT require Puppeteer — just Firestore reads + string injection.
// minInstances: 1 keeps one warm instance so the very first request to a URL
// (before the 5-min edge cache is populated) doesn't pay a multi-second cold
// start. Small always-on cost; set back to 0 to trade latency for zero idle cost.
exports.waterpoloRenderer = onRequest(
  { region: 'europe-west1', timeoutSeconds: 30, memory: '256MiB', minInstances: 1 },
  rendererHandler
)

// Dynamic sitemap.xml — generated live from Firestore. Served at /sitemap.xml
// via a Hosting rewrite (firebase.json). Public, cached at the edge for an hour.
exports.waterpoloSitemap = onRequest(
  { region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    try {
      const xml = await buildSitemap(db, logger)
      res.set('Content-Type', 'application/xml; charset=utf-8')
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600')
      res.status(200).send(xml)
    } catch (err) {
      logger.error('sitemap generation failed', err)
      res.status(500).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>')
    }
  }
)
