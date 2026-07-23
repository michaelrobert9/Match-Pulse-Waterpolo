// Notification permission + FCM token registration (spec §10).
//
// SEQUENCING: never request permission on first landing — on iOS the prompt is
// a no-op in a browser tab and only works once the app is launched from the
// home-screen icon. Callers request permission ONLY when running standalone.
//
// DELIVERY (deploy-gated): actually receiving pushes requires a configured web
// push VAPID key (VITE_FIREBASE_VAPID_KEY) and the firebase-messaging service
// worker (public/firebase-messaging-sw.js), plus Cloud Function senders that
// target the tokens stored here. Until the VAPID key is set, registerFcmToken()
// is a safe no-op and the permission UX still works end-to-end.

import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { doc, setDoc, arrayUnion } from 'firebase/firestore'
import app, { db, auth, configured } from '../firebase'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || ''

// Ask for notification permission. The caller is responsible for only invoking
// this when standalone (see usePWAInstall / InstallBanner).
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') {
    await registerFcmToken().catch(() => {})
    return 'granted'
  }
  if (Notification.permission === 'denied') return 'denied'
  const perm = await Notification.requestPermission()
  if (perm === 'granted') await registerFcmToken().catch(() => {})
  return perm
}

// Register an FCM token for the signed-in user so the backend can target this
// device. No-op (returns null) until the VAPID key + service worker are in
// place — the rest of the install/notification UX does not depend on it.
export async function registerFcmToken() {
  if (!configured || !VAPID_KEY) return null
  if (!(await isSupported().catch(() => false))) return null
  const reg = await navigator.serviceWorker?.register('/firebase-messaging-sw.js').catch(() => null)
  if (!reg) return null
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg })
  const uid = auth.currentUser?.uid
  if (token && uid) {
    // Multiple devices per user — accumulate tokens; the sender prunes stale ones.
    await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true })
  }
  return token
}
