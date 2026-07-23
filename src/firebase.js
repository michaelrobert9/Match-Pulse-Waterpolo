import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

// The Match Pulse apps share one Firebase project (match-pulse-4560e); each
// sport lives in its OWN named Firestore database. Water Polo uses the
// `waterpolo` database (see FIRESTORE_DB below and initializeFirestore), so the
// app never touches another sport's data. Fallbacks are the project's PUBLIC
// web config: Firebase web keys are not secrets — they ship in every client
// bundle and are safe to commit; access is controlled by the Firestore/Storage
// rules, not by hiding these. VITE_FIREBASE_* env vars still override if set.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'AIzaSyBUlpGJmlCM4PK0dmyOL0MPMSVay_7HhBE',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'match-pulse-4560e.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'match-pulse-4560e',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'match-pulse-4560e.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '161675532534',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              || '1:161675532534:web:4ba5fdb624f779049eb4d7',
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID     || 'G-5V5RTXDP9C',
}

// Named Firestore database for this sport within the shared project.
const FIRESTORE_DB = import.meta.env.VITE_FIRESTORE_DATABASE || 'waterpolo'

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
  }, FIRESTORE_DB)
  auth      = getAuth(app)
  storage   = getStorage(app)
  // Functions are deployed to europe-west1 (africa-south1 is the Firestore
  // region; Functions default to europe-west1 for lower-latency from ZA).
  functions = getFunctions(app, 'europe-west1')
}

export { db, auth, storage, functions }
export default app
