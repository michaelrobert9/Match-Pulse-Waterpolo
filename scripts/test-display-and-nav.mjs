// Static regression tests for two display policies:
//
//   1. Short codes are NEVER used for display — the name is the identity.
//      Stored shortCode fields remain in the database (write paths are
//      allowed), but no JSX may render one or prefer one over a name.
//   2. One global navigation system — Layout renders Nav only (no BottomNav),
//      and AdminLayout has no second fixed bottom nav bar.
//
// Run: node scripts/test-display-and-nav.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { monogram } from '../src/lib/names.js'

const SRC = new URL('../src', import.meta.url).pathname

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(SRC).map(p => ({ path: p, text: readFileSync(p, 'utf8') }))

// ── Short-code display policy ───────────────────────────────────────────────

test('no display ever prefers a shortCode over a name', () => {
  // The anti-pattern: `xShortCode ?? xName` / `shortCode || name` — code wins
  // over name. Write-path normalisation (shortCode ?? null, shortCode ?? '')
  // is allowed; preferring a code over a NAME is not.
  const codeOverName = /[Ss]hortCode\s*(\?\?|\|\|)\s*[\w?.]*[Nn]ame/
  const offenders = files.filter(f => codeOverName.test(f.text))
  assert.deepEqual(offenders.map(f => f.path), [])
})

test('no JSX directly renders a shortCode value', () => {
  // Catches {x.shortCode}, {org?.shortCode}, {match.homeTeamShortCode} etc.
  // rendered as element children. Property assignments (shortCode: …) and
  // form inputs (value={form.shortCode}) are write paths and allowed.
  const renderPattern = />\s*\{[^{}]*[Ss]hortCode[^{}]*\}\s*</
  const offenders = files.filter(f => f.path.endsWith('.jsx') && renderPattern.test(f.text))
  assert.deepEqual(offenders.map(f => f.path), [])
})

test('no JSX monogram derives from a shortCode slice', () => {
  // Display slicing like (t.shortCode || '?').slice(0, 3). Storage
  // normalisation in the data layer (.js) is allowed.
  const offenders = files.filter(f => f.path.endsWith('.jsx') && /[Ss]hortCode[^\n]*\.slice\(/.test(f.text))
  assert.deepEqual(offenders.map(f => f.path), [])
})

test('identity layer emits no shortCode identifier', () => {
  const identity = readFileSync(join(SRC, 'lib/teamIdentity.js'), 'utf8')
  assert.equal(/identifier:\s*null/.test(identity), true)
  assert.equal(/identifier[^\n]*shortCode/i.test(identity), false)
})

test('monogram() derives initials from names', () => {
  assert.equal(monogram('Maritzburg College'), 'MC')
  assert.equal(monogram('Fatima'), 'F')
  assert.equal(monogram('St Annes Diocesan College'), 'SAD')   // capped at 3
  assert.equal(monogram(''), '?')
  assert.equal(monogram(null), '?')
})

// ── Single global navigation ────────────────────────────────────────────────

test('Layout renders Nav only — BottomNav is gone', () => {
  const layout = readFileSync(join(SRC, 'components/Layout.jsx'), 'utf8')
  assert.equal(layout.includes('BottomNav'), false)
  assert.equal(layout.includes('<Nav />'), true)
  assert.equal(existsSync(join(SRC, 'components/BottomNav.jsx')), false)
})

test('AdminLayout has no fixed bottom nav bar', () => {
  const admin = readFileSync(join(SRC, 'components/AdminLayout.jsx'), 'utf8')
  assert.equal(/fixed bottom-0/.test(admin), false)
  // Mobile navigation is a burger menu, mirroring the public Nav.
  assert.equal(/aria-expanded/.test(admin), true)
})

test('no page imports BottomNav', () => {
  const offenders = files.filter(f => f.text.includes('BottomNav'))
  assert.deepEqual(offenders.map(f => f.path), [])
})

// ── Fixture write-path unification ──────────────────────────────────────────

test('every createMatch caller with a competition pairs it with addFixtureToCompetition', () => {
  // Any UI file that calls createMatch(<competition…>, …) must also import
  // addFixtureToCompetition — the membership join record is not optional.
  const uiCallers = files.filter(f =>
    f.path.endsWith('.jsx') && /createMatch\(\s*(form\.competitionId|competitionId|competition\.id)/.test(f.text))
  const missing = uiCallers.filter(f => !f.text.includes('addFixtureToCompetition'))
  assert.deepEqual(missing.map(f => f.path), [])
})
