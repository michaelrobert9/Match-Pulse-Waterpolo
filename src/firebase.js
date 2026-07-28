import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

// The Match Pulse apps share one Firebase project (match-pulse-4560e), but each
// sport is isolated within it: its own named Firestore database, its own Storage
// bucket and its own Hosting site. Water Polo uses the `waterpolo` database (see
// FIRESTORE_DB below and initializeFirestore) and the match-pulse-waterpolo-f9b4c
// bucket, so the app never touches another sport's data or uploaded files.
// Fallbacks are the project's PUBLIC
// web config: Firebase web keys are not secrets — they ship in every client
// bundle and are safe to commit; access is controlled by the Firestore/Storage
// rules, not by hiding these. VITE_FIREBASE_* env vars still override if set.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'AIzaSyBUlpGJmlCM4PK0dmyOL0MPMSVay_7HhBE',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'match-pulse-4560e.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'match-pulse-4560e',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'match-pulse-waterpolo-f9b4c',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '161675532534',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              || '1:161675532534:web:4ba5fdb624f779049eb4d7',
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID     || 'G-5V5RTXDP9C',
}

// Named Firestore database for this sport within the shared project.
const FIRESTORE_DB = import.meta.env.VITE_FIRESTORE_DATABASE || 'waterpolo'

// Region where the MAIN SITE's Cloud Functions are deployed. The auth handoff
// calls redeemHandoffTicket there, and a wrong region fails only at CALL time
// with an opaque error — never at build or deploy. Kept in ONE constant so a
// correction is a one-line change. NOTE: this is the Functions region, which is
// independent of the Firestore region (africa-south1).
export const FUNCTIONS_REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1'

export const configured = !!firebaseConfig.apiKey

let app, db, identityDb, auth, storage, functions

if (configured) {
  app = initializeApp(firebaseConfig)
  // Persistent local cache (IndexedDB): queues writes offline and syncs on
  // reconnect — essential for scoring at school venues with poor signal.
  // Single-tab manager: offline persistence is active in one tab at a time.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  }, FIRESTORE_DB)
  // Central identity/plan/organisation data lives in the (default) database,
  // owned by the main site. READ-ONLY from here: never write plan or billing
  // fields — the central rules reject it.
  identityDb = getFirestore(app)
  auth       = getAuth(app)
  storage    = getStorage(app)
  functions  = getFunctions(app, FUNCTIONS_REGION)
}

export { db, identityDb, auth, storage, functions }
export default app
