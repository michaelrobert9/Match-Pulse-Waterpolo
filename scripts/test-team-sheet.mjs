// Deterministic unit tests for src/lib/teamSheet.js and src/lib/lineupResolve.js
// (bulk team sheets brief §5 parsing, §4 derived line-ups, §11 acceptance).
// Run: node scripts/test-team-sheet.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLine, parseTeamSheet, guessNumbersAreCaps, applyNumbersMode,
  normaliseName, splitName, duplicateCapNumbers, duplicateNames, nextUnusedCap,
} from '../src/lib/teamSheet.js'
import { resolveSideLineup, isInheritedLineup, sortByCap } from '../src/lib/lineupResolve.js'

// ── §5 line formats ─────────────────────────────────────────────────────────

test('line formats all parse to number + name', () => {
  const cases = [
    ['1. John Smith',      1,    'John Smith'],
    ['1  John Smith',      1,    'John Smith'],
    ['John Smith 4',       4,    'John Smith'],
    ['Cap 4 John Smith',   4,    'John Smith'],
    ['#4 John Smith',      4,    'John Smith'],
    ['John Smith, 7',      7,    'John Smith'],
    ['John Smith\t4',      4,    'John Smith'],
    ['4\tJohn Smith',      4,    'John Smith'],
    ['JOHN SMITH',         null, 'John Smith'],
    ['Smith, John',        null, 'John Smith'],
  ]
  for (const [line, num, name] of cases) {
    const r = parseLine(line)
    assert.equal(r.parsedNumber, num, `number of ${JSON.stringify(line)}`)
    assert.equal(r.name, name, `name of ${JSON.stringify(line)}`)
    assert.equal(r.unreadable, false, `readability of ${JSON.stringify(line)}`)
  }
})

test('trailing (C) sets the captain flag and is stripped', () => {
  const r = parseLine('7 Sarah Botha (C)')
  assert.equal(r.isCaptain, true)
  assert.equal(r.name, 'Sarah Botha')
  assert.equal(r.parsedNumber, 7)
  assert.equal(parseLine('Sipho Dlamini').isCaptain, false)
})

test('unreadable line keeps raw text in the name field, flagged — never refused', () => {
  const r = parseLine('???!!')
  assert.equal(r.unreadable, true)
  assert.equal(r.name, '???!!')
})

test('ALL CAPS normalises preserving McDonald, van der Merwe, O\'Brien, du Plessis', () => {
  assert.equal(normaliseName('ANGUS MCDONALD'), 'Angus McDonald')
  assert.equal(normaliseName('PIETER VAN DER MERWE'), 'Pieter van der Merwe')
  assert.equal(normaliseName("LIAM O'BRIEN"), "Liam O'Brien")
  assert.equal(normaliseName('JEAN DU PLESSIS'), 'Jean du Plessis')
  // Mixed case passes through untouched
  assert.equal(normaliseName('Pieter van der Merwe'), 'Pieter van der Merwe')
})

test('particle-aware surname split (addendum B5): particles belong to the surname', () => {
  assert.deepEqual(splitName('John Smith'), { firstName: 'John', surname: 'Smith' })
  assert.deepEqual(splitName('Pieter van der Merwe'), { firstName: 'Pieter', surname: 'van der Merwe' })
  assert.deepEqual(splitName('Jean du Plessis'), { firstName: 'Jean', surname: 'du Plessis' })
  assert.deepEqual(splitName('van der Merwe'), { firstName: '', surname: 'van der Merwe' })
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', surname: '' })
})

// ── §5 water polo cap-vs-list heuristic ─────────────────────────────────────

const sheetOf = n => Array.from({ length: n }, (_, i) => `${i + 1}. Player Number${i + 1}`).join('\n')

test('acceptance 1: 13 names numbered 1 to 13 read as cap numbers', () => {
  const { rows, numbersAreCaps } = parseTeamSheet(sheetOf(13))
  assert.equal(numbersAreCaps, true)
  assert.equal(rows.length, 13)
  assert.equal(rows[0].capNumber, 1)
  assert.equal(rows[12].capNumber, 13)
})

test('acceptance 2: 20 names numbered 1 to 20 read as a list, not caps', () => {
  const { rows, numbersAreCaps } = parseTeamSheet(sheetOf(20))
  assert.equal(numbersAreCaps, false)
  assert.ok(rows.every(r => r.capNumber === null))
})

test('gapped or out-of-order numbers read as cap numbers', () => {
  const gapped = '1 A One\n2 B Two\n4 C Four\n7 D Seven'
  assert.equal(parseTeamSheet(gapped).numbersAreCaps, true)
  const shuffled = '2 A One\n1 B Two\n3 C Three'
  assert.equal(parseTeamSheet(shuffled).numbersAreCaps, true)
})

test('sequential 1..N for N of 11–15 with matching row count reads as caps', () => {
  for (const n of [11, 14, 15]) {
    assert.equal(parseTeamSheet(sheetOf(n)).numbersAreCaps, true, `N=${n}`)
  }
})

test('short sequential sheets default to caps (water polo default)', () => {
  assert.equal(parseTeamSheet(sheetOf(7)).numbersAreCaps, true)
})

test('acceptance 3 (parser side): flipping interpretation keeps name edits', () => {
  const { rows } = parseTeamSheet(sheetOf(13))
  rows[0] = { ...rows[0], firstName: 'Edited', surname: 'Name' }
  const asList = applyNumbersMode(rows, false)
  assert.equal(asList[0].capNumber, null)
  assert.equal(asList[0].firstName, 'Edited')
  const backToCaps = applyNumbersMode(asList, true)
  assert.equal(backToCaps[0].capNumber, 1)
  assert.equal(backToCaps[0].firstName, 'Edited')
})

test('manually edited cap numbers survive an interpretation flip', () => {
  const { rows } = parseTeamSheet(sheetOf(13))
  rows[2] = { ...rows[2], capNumber: 99, capEdited: true }
  const flipped = applyNumbersMode(applyNumbersMode(rows, false), true)
  assert.equal(flipped[2].capNumber, 99)
})

// ── §7 grid helpers ─────────────────────────────────────────────────────────

test('duplicate caps and names warn, blanks are valid (acceptance 7)', () => {
  const rows = [
    { capNumber: 4,    firstName: 'A', surname: 'X' },
    { capNumber: 4,    firstName: 'B', surname: 'Y' },
    { capNumber: null, firstName: 'C', surname: 'Z' },
    { capNumber: 9,    firstName: 'C', surname: 'Z' },
  ]
  assert.deepEqual([...duplicateCapNumbers(rows)], [4])
  assert.deepEqual([...duplicateNames(rows)], ['c z'])
  assert.equal(nextUnusedCap(rows), 1)
  assert.equal(nextUnusedCap([{ capNumber: 1 }, { capNumber: 2 }]), 3)
})

// ── §4 derived line-ups ─────────────────────────────────────────────────────

const SQUAD = [
  { playerId: 'p1', name: 'Anna GK',     capNumber: 1,  isCaptain: false },
  { playerId: 'p7', name: 'Cara Seven',  capNumber: 7,  isCaptain: true  },
  { playerId: 'p3', name: 'Bea Three',   capNumber: 3,  isCaptain: false },
  { playerId: 'pX', name: 'Nocap Player', capNumber: null, isCaptain: false },
]

test('acceptance 4: every fixture inherits the full squad with no input', () => {
  const lineup = resolveSideLineup({ squad: SQUAD, exceptions: [], side: 'home' })
  assert.equal(lineup.length, 4)
  // sorted by cap, blanks last
  assert.deepEqual(lineup.map(e => e.shirtNumber), [1, 3, 7, null])
  assert.equal(lineup.find(e => e.personId === 'p7').isCaptain, true)
})

test('acceptance 5: an absence is scoped to its own fixture', () => {
  const f3 = resolveSideLineup({
    squad: SQUAD,
    exceptions: [{ playerId: 'p3', side: 'home', type: 'absent' }],
    side: 'home',
  })
  assert.equal(f3.length, 3)
  assert.ok(!f3.some(e => e.personId === 'p3'))
  // A different fixture (its own empty exceptions) is unaffected by construction
  const f4 = resolveSideLineup({ squad: SQUAD, exceptions: [], side: 'home' })
  assert.equal(f4.length, 4)
})

test('exceptions are side-scoped', () => {
  const lineup = resolveSideLineup({
    squad: SQUAD,
    exceptions: [{ playerId: 'p3', side: 'away', type: 'absent' }],
    side: 'home',
  })
  assert.equal(lineup.length, 4)
})

test('acceptance 12: a per-fixture cap change is type "override", not "added"', () => {
  const lineup = resolveSideLineup({
    squad: SQUAD,
    exceptions: [
      { playerId: 'pNew', side: 'home', type: 'added',    capNumber: 14, name: 'Late Addition' },
      { playerId: 'p7',   side: 'home', type: 'override', capNumber: 2 },
    ],
    side: 'home',
  })
  assert.equal(lineup.length, 5)
  assert.equal(lineup.find(e => e.personId === 'pNew').shirtNumber, 14)
  assert.equal(lineup.find(e => e.personId === 'p7').shirtNumber, 2)
  assert.equal(lineup.find(e => e.personId === 'p7').isCaptain, true) // override keeps captaincy
  // An 'added' entry for a player already in the squad is ignored — it is NOT
  // an override channel (rugby's workaround, corrected by the addendum).
  const ignored = resolveSideLineup({
    squad: SQUAD,
    exceptions: [{ playerId: 'p7', side: 'home', type: 'added', capNumber: 2 }],
    side: 'home',
  })
  assert.equal(ignored.find(e => e.personId === 'p7').shirtNumber, 7)
})

test('acceptance 6/9: frozen fixtures and leagues never resolve from the squad', () => {
  assert.equal(isInheritedLineup({ lineupMode: 'frozen' }, 'tournament'), false)
  assert.equal(isInheritedLineup({}, 'league'), false)
  assert.equal(isInheritedLineup({}, undefined), false)
  assert.equal(isInheritedLineup({}, 'tournament'), true)
  assert.equal(isInheritedLineup({}, 'festival'), true)
})

test('sortByCap: numbered first ascending, blanks after, alphabetical', () => {
  const sorted = sortByCap([
    { shirtNumber: null, personName: 'Zoe' },
    { shirtNumber: 2, personName: 'B' },
    { shirtNumber: null, personName: 'Amy' },
    { shirtNumber: 1, personName: 'A' },
  ])
  assert.deepEqual(sorted.map(e => e.shirtNumber ?? e.personName), [1, 2, 'Amy', 'Zoe'])
})
