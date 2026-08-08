// teamAccent tests — the two guarantees (contrast on white, live-red
// separation) plus the safe fallback. Run: node scripts/test-team-accent.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { teamAccent, TEAM_ACCENT_NEUTRAL, LIVE_RED } from '../src/lib/teamAccent.js'

function hexToRgb(h) {
  const s = h.replace('#', '')
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) }
}
function relLum({ r, g, b }) {
  const c = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}
const contrastWhite = h => (1.05) / (relLum(hexToRgb(h)) + 0.05)
const distLive = h => {
  const a = hexToRgb(h), b = hexToRgb(LIVE_RED)
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

test('invalid or empty input returns the neutral fallback', () => {
  assert.equal(teamAccent(null), TEAM_ACCENT_NEUTRAL)
  assert.equal(teamAccent(''), TEAM_ACCENT_NEUTRAL)
  assert.equal(teamAccent('not a colour'), TEAM_ACCENT_NEUTRAL)
  assert.equal(teamAccent('#12'), TEAM_ACCENT_NEUTRAL)
})

test('valid hex forms parse (3- and 6-digit, with/without #)', () => {
  assert.match(teamAccent('#006B3C'), /^#[0-9a-f]{6}$/)
  assert.match(teamAccent('063'), /^#[0-9a-f]{6}$/)
})

test('every result meets 3:1 contrast on white', () => {
  for (const c of ['#006B3C', '#FFFF00', '#FFEB3B', '#00E5FF', '#FFFFFF', '#7CFC00', '#FFC0CB']) {
    assert.ok(contrastWhite(teamAccent(c)) >= 3.0 - 1e-6, `${c} -> ${teamAccent(c)} contrast ${contrastWhite(teamAccent(c)).toFixed(2)}`)
  }
})

test('a mid-dark legible colour is left effectively as-is', () => {
  // Deep emerald already passes both gates.
  const out = teamAccent('#006B3C')
  assert.ok(contrastWhite(out) >= 3.0)
  assert.ok(distLive(out) >= 70)
})

test('a near-live-red team colour is pushed clear of the live indicator', () => {
  for (const c of ['#E5484D', '#E84A4A', '#EF4444', '#F03E3E']) {
    const out = teamAccent(c)
    assert.ok(distLive(out) >= 70 - 1e-6, `${c} -> ${out} dist ${distLive(out).toFixed(1)}`)
  }
})

test('the live red itself never survives as an accent', () => {
  assert.notEqual(teamAccent(LIVE_RED).toLowerCase(), LIVE_RED.toLowerCase())
})

test('deterministic — same input, same output', () => {
  assert.equal(teamAccent('#123456'), teamAccent('#123456'))
})
