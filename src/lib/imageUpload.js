import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'

// ── Image specs ──────────────────────────────────────────────────────────────
// Single source of truth for every user-uploaded image: the recommended upload
// dimensions (surfaced as helper text next to each picker), the aspect + fit the
// image is displayed at, and the max file size (mirrored in storage.rules). Pick
// the source size to comfortably cover the largest place each image renders — a
// little oversize is fine (it scales down cleanly); undersize looks soft.
//
// The `prefix` of each spec MUST match a path block in storage.rules — that is
// what authorises the write. Water polo's bucket allows: avatars,
// player-avatars, player-banners, org-logos, org-banners, competition-logos and
// competition-banners. There is no team-logos block, so no teamLogo spec here.
//
//   shape:  'circle' | 'square' | 'wide'  — preview + crop shape
//   fit:    'cover'  | 'contain'          — cover for photos/banners (fill + crop),
//                                           contain for logos/crests (show whole mark)
//   box:    preview size in px for circle/square shapes
//   aspect: CSS aspect-ratio for wide shapes
export const IMAGE_SPECS = {
  userAvatar: {
    label: 'Profile picture', shape: 'circle', fit: 'cover', box: 88,
    recommend: '512×512px, square. Shown as a circle, so keep the face centred.',
    maxMB: 2, prefix: 'avatars',
  },
  playerPhoto: {
    label: 'Profile picture', shape: 'square', fit: 'cover', box: 88,
    recommend: '512×512px, square (head-and-shoulders works best).',
    maxMB: 2, prefix: 'player-avatars',
  },
  playerBanner: {
    label: 'Banner image', shape: 'wide', fit: 'cover', aspect: '3 / 1',
    recommend: '1500×500px (3:1). Wide and short — avoid important detail at the edges.',
    maxMB: 5, prefix: 'player-banners',
  },
  orgLogo: {
    label: 'Logo', shape: 'square', fit: 'contain', box: 88,
    recommend: '512×512px, square. PNG with a transparent background looks best.',
    maxMB: 2, prefix: 'org-logos',
  },
  orgBanner: {
    label: 'Banner image', shape: 'wide', fit: 'cover', aspect: '16 / 9',
    recommend: '1600×900px (16:9). Shown as a wide cover image on the profile card.',
    maxMB: 5, prefix: 'org-banners',
  },
  competitionLogo: {
    label: 'Logo', shape: 'square', fit: 'contain', box: 88,
    recommend: '512×512px, square. PNG with a transparent background looks best.',
    maxMB: 2, prefix: 'competition-logos',
  },
  competitionBanner: {
    label: 'Banner image', shape: 'wide', fit: 'cover', aspect: '3 / 1',
    recommend: '1500×500px (3:1). Shown as a wide banner strip on the competition page and cards.',
    maxMB: 5, prefix: 'competition-banners',
  },
}

// The storage path for a given image kind + owning entity id. Kept here so the
// client paths and storage.rules stay in lockstep (rules match on the prefix).
export function imagePath(specKey, id) {
  const spec = IMAGE_SPECS[specKey]
  if (!spec) throw new Error(`Unknown image spec: ${specKey}`)
  return `${spec.prefix}/${id}`
}

// Client-side guard. The bucket enforces the same size/type; this is just for a
// fast, friendly error before we spend an upload round-trip.
export function validateImageFile(file, maxMB = 5) {
  if (!file) return 'No file selected.'
  if (!file.type || !file.type.startsWith('image/')) return 'Please choose an image file.'
  if (file.size > maxMB * 1024 * 1024) return `Image must be under ${maxMB} MB.`
  return null
}

// Upload an image to `path` and return its public download URL. Throws a
// human-readable Error on a validation or upload failure.
export async function uploadImageFile(path, file, { maxMB = 5 } = {}) {
  if (!storage) throw new Error('Image storage is not configured.')
  const err = validateImageFile(file, maxMB)
  if (err) throw new Error(err)
  const r = storageRef(storage, path)
  await uploadBytes(r, file)
  return getDownloadURL(r)
}

// Upload keyed by an image spec + entity id (the common case).
export function uploadImageForEntity(specKey, id, file) {
  const spec = IMAGE_SPECS[specKey]
  return uploadImageFile(imagePath(specKey, id), file, { maxMB: spec.maxMB })
}
