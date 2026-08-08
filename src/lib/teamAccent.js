// Team colour safety (line-up display brief §3): every surface that renders a
// team-coloured © or a POM accent passes the colour through teamAccent first.
// It returns the team colour, or neutral slate when the colour is unsafe:
//
//   • Contrast — a pale colour at 14px bold on the white row background
//     defeats the point of enlarging the glyph. Large-text threshold (3:1).
//   • Live-red proximity — a colour close to #E5484D reads as the live-match
//     indicator, and the design rule is that red means live and nothing else.
//
// NOTE: the brief says netball authors this helper and the other three repos
// copy it verbatim (byte-identical, same terms as pom.js). Netball has not
// published it yet — this implementation follows the brief's spec and MUST be
// replaced byte-for-byte with netball's canonical version when it circulates.

const FALLBACK = '#64748b' // slate-500

function parseHex(color) {
  if (typeof color !== 'string') return null
  const m = color.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// WCAG relative luminance.
function luminance({ r, g, b }) {
  const lin = c => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// Contrast ratio against the white row background.
function contrastOnWhite(rgb) {
  const l = luminance(rgb)
  return (1.0 + 0.05) / (l + 0.05)
}

function hue({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  let h
  if (max === r)      h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else                h = (r - g) / d + 4
  return ((h * 60) + 360) % 360
}

function saturation({ r, g, b }) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255
  if (max === 0) return 0
  return (max - min) / max
}

function lightness({ r, g, b }) {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510
}

const LIVE = parseHex('#E5484D')
const LIVE_HUE = hue(LIVE)

// Returns the team colour, or '#64748b' when it is unsafe (brief §3).
export function teamAccent(color) {
  const rgb = parseHex(color)
  if (!rgb) return FALLBACK
  // Contrast: 14px bold is WCAG large text — require 3:1 on white.
  if (contrastOnWhite(rgb) < 3) return FALLBACK
  // Live-red proximity: a colour reads as the live indicator only when it is
  // genuinely similar — near the live token's hue, saturated, AND in its
  // mid-lightness band. A dark maroon shares the hue but not the read.
  const dh = Math.abs(hue(rgb) - LIVE_HUE)
  const hueDist = Math.min(dh, 360 - dh)
  const l = lightness(rgb)
  if (hueDist <= 18 && saturation(rgb) >= 0.4 && l >= 0.3 && l <= 0.85) return FALLBACK
  return color
}
