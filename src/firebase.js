import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

// Fallbacks are the Match Pulse Water Polo project's PUBLIC web config. Firebase
// web keys are not secrets — they ship in every client bundle and are safe to
// commit; access is controlled by Firestore/Storage rules, not by hiding these.
// VITE_FIREBASE_* env vars (from GitHub Actions secrets) still override at build
// time if set.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'AIzaSyAL6VNmOgAu3n1_Phkr_zMaLEeVKpSRyvo',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'match-pulse-waterpolo.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'match-pulse-waterpolo',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'match-pulse-waterpolo.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '218123532619',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              || '1:218123532619:web:b9323e88f041b2e1f590ce',
}

export const configured = !!firebaseConfig.apiKey

let app, db, auth, storage, functions

export const googleProvider = new GoogleAuthProvider()

if (configured) {
  app = initializeApp(firebaseConfig)
  // Persistent local cache (IndexedDB): queues writes offline and syncs on
  // reconnect — essential for scoring at school venues with poor signal.
  // Single-tab manager: offline persistence is active in one tab at a time.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  })
  auth      = getAuth(app)
  storage   = getStorage(app)
  // Functions are deployed to europe-west1 (africa-south1 is the Firestore
  // region; Functions default to europe-west1 for lower-latency from ZA).
  functions = getFunctions(app, 'europe-west1')
}

export { db, auth, storage, functions }
export default app
