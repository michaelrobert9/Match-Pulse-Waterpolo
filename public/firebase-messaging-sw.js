/* Firebase Cloud Messaging service worker (spec §10, delivery).
 *
 * DEPLOY-GATED: this file must contain your project's PUBLIC Firebase web config
 * (the same non-secret values used by the client SDK — apiKey, projectId,
 * messagingSenderId, appId). A service worker cannot read import.meta.env, so
 * the values are inlined here. Fill them in, set VITE_FIREBASE_VAPID_KEY in the
 * app env, and FCM background notifications will start working. Until then the
 * app's install + permission UX works, but no pushes are delivered.
 *
 * The compat builds are used because service workers need classic importScripts.
 */
/* global importScripts, firebase, self */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            'TODO_PUBLIC_API_KEY',
  authDomain:        'TODO.firebaseapp.com',
  projectId:         'TODO',
  messagingSenderId: 'TODO_SENDER_ID',
  appId:             'TODO_APP_ID',
})

const messaging = firebase.messaging()

// Background message → OS notification. Foreground messages are handled in-app.
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification ?? {}
  self.registration.showNotification(title || 'MatchPulse', {
    body: body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: payload.data ?? {},
  })
})

// Focus or open the app when a notification is tapped.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => 'focus' in c)
      return existing ? existing.focus() : self.clients.openWindow(url)
    })
  )
})
