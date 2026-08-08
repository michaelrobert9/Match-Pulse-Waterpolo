// teamAccent — resolve a team's chosen colour into a UI accent that is safe to
// paint on a white surface (captain armband, Player of the Match tint, and any
// other team-coloured chrome).
//
// Authored by netball; copied VERBATIM into hockey, rugby and water polo. Like
// pom.js this must stay byte-identical across the four repos — a captain badge
// rendered in one sport must resolve to the same colour in another. Do not
// tune the thresholds per sport.
//
// Two guarantees:
//   1. Contrast — the returned colour has at least a 3:1 contrast ratio against
//      white (WCAG AA for large text and graphical objects), so a pale team
//      colour is darkened until it is legible rather than washing out.
//   2. Live-red separation — #E5484D means "live match" and nothing else. A
//      team whose colour sits near it is pushed away (deepened, slightly
//      desaturated) so a team accent can never be mistaken for the live state.
//
// Deterministic and dependency-free. Invalid or empty input returns a neutral
// slate, so callers never have to guard.

export const TEAM_ACCENT_NEUTRAL = '#64748b'   // slate-500
export const LIVE_RED            = '#e5484d'    // must match --live
const MIN_CONTRAST      = 3.0                    // vs white
const LIVE_MIN_DISTANCE = 70                     // RGB euclidean distance from LIVE_RED

function parseHex(input) {
  if (typeof input !== 'string') return null
  let h = input.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function relLuminance({ r, g, b }) {
  const chan = v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

function contrastOnWhite(rgb) {
  return (1.0 + 0.05) / (relLuminance(rgb) + 0.05)
}

function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === R)      h = ((G - B) / d + (G < B ? 6 : 0))
    else if (max === G) h = (B - R) / d + 2
    else                h = (R - G) / d + 4
    h /= 6
  }
  return { h, s, l }
}

function hslToRgb({ h, s, l }) {
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v } }
  const hue = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hue(p, q, h + 1 / 3) * 255,
    g: hue(p, q, h) * 255,
    b: hue(p, q, h - 1 / 3) * 255,
  }
}

function distanceToLiveRed(rgb) {
  const live = parseHex(LIVE_RED)
  return Math.sqrt((rgb.r - live.r) ** 2 + (rgb.g - live.g) ** 2 + (rgb.b - live.b) ** 2)
}

export function teamAccent(color) {
  const rgb = parseHex(color)
  if (!rgb) return TEAM_ACCENT_NEUTRAL

  let hsl = rgbToHsl(rgb)

  // 1. Contrast: darken a too-light colour until it is legible on white.
  let guard = 0
  while (contrastOnWhite(hslToRgb(hsl)) < MIN_CONTRAST && hsl.l > 0.12 && guard++ < 40) {
    hsl = { ...hsl, l: hsl.l - 0.03 }
  }

  // 2. Live-red separation: if the result sits near the live indicator, deepen
  //    and slightly desaturate it away — enough to be unmistakably a team
  //    colour, while keeping the team's hue.
  guard = 0
  while (distanceToLiveRed(hslToRgb(hsl)) < LIVE_MIN_DISTANCE && hsl.l > 0.12 && guard++ < 40) {
    hsl = { ...hsl, l: hsl.l - 0.04, s: Math.max(0.35, hsl.s - 0.05) }
  }

  return toHex(hslToRgb(hsl))
}
