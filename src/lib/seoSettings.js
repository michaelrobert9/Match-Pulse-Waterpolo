import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, configured } from '../firebase'
import { SPORT } from './sport'

// Sport-specific defaults (tagline / description / keywords) come from the
// sport skin in lib/sport.js, so this file is identical across the Rugby and
// Hockey repos and the two apps can never drift apart here. Admin overrides
// saved to settings/seo still win at runtime.
export const DEFAULT_SEO = {
  siteTitle:                      'MatchPulse',
  siteTagline:                    SPORT.tagline,
  siteDescription:                SPORT.description,
  keywords:                       SPORT.keywords,
  googleAnalyticsId:              '',
  googleSearchConsoleVerification:'',
  statCounterProject:             '',
  statCounterSecurity:            '',
  ogImageUrl:                     '',
}

export async function fetchSeoSettings() {
  if (!configured) return DEFAULT_SEO
  try {
    const snap = await getDoc(doc(db, 'settings', 'seo'))
    return snap.exists() ? { ...DEFAULT_SEO, ...snap.data() } : DEFAULT_SEO
  } catch { return DEFAULT_SEO }
}

export async function saveSeoSettings(data, uid) {
  const { updatedBy: _a, updatedAt: _b, ...clean } = data
  await setDoc(doc(db, 'settings', 'seo'), {
    ...clean,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  })
}
