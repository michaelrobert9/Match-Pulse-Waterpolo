// Structured naming + seniority tests. Run: node scripts/test-team-governance.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generatedTeamName, teamStructuralKey, levelLabel, seniorityDescriptor,
  ageGroupsFor, TEAM_LEVELS, TEAM_LETTERS, schoolGenderProfile,
} from '../src/lib/teamNaming.js'
import { compareSeniority, sortBySeniority } from '../src/lib/seniority.js'

test('level vocabulary', () => {
  assert.equal(TEAM_LEVELS.length, 10)
  assert.equal(TEAM_LEVELS[0], '1st Team')
  assert.equal(TEAM_LEVELS[9], '10th Team')
  assert.deepEqual(TEAM_LETTERS, ['A','B','C','D','E','F','G','H','I','J'])
  assert.ok(ageGroupsFor('school').includes('U8') && ageGroupsFor('school').includes('U19'))
  assert.ok(!ageGroupsFor('school').includes('U21'))
  assert.ok(ageGroupsFor('club').includes('U21'))
})

test('schoolGenderProfile has no default', () => {
  assert.equal(schoolGenderProfile({ genderProfile: 'coed' }), 'coed')
  assert.equal(schoolGenderProfile({}), null)
  assert.equal(schoolGenderProfile(null), null)
})

test('levelLabel: age vs senior', () => {
  assert.equal(levelLabel({ ageGroup: 'U14', teamLevel: 'A' }), 'U14A')
  assert.equal(levelLabel({ ageGroup: null, teamLevel: '1st Team' }), '1st Team')
})

test('generatedTeamName: school co-ed shows gender', () => {
  assert.equal(generatedTeamName({ gender: 'girls', ageGroup: 'U16', teamLevel: 'A', orgGenderProfile: 'coed' }), 'Girls U16A')
  assert.equal(generatedTeamName({ gender: 'boys',  ageGroup: 'U14', teamLevel: 'A', orgGenderProfile: 'coed' }), 'Boys U14A')
})

test('generatedTeamName: single-gender school omits gender word', () => {
  assert.equal(generatedTeamName({ gender: 'boys', ageGroup: 'U16', teamLevel: 'A', orgGenderProfile: 'boys' }), 'U16A')
})

test('generatedTeamName: club division + senior', () => {
  assert.equal(generatedTeamName({ division: 'men', teamLevel: '1st Team' }), "Men's 1st Team")
  assert.equal(generatedTeamName({ division: 'masters', ageGroup: 'U21', teamLevel: 'B' }), 'Masters U21B')
})

test('teamStructuralKey is stable and gender/level scoped', () => {
  assert.equal(teamStructuralKey({ gender: 'girls', ageGroup: 'U16', teamLevel: 'A' }), 'girls-u16-a')
  assert.equal(teamStructuralKey({ division: 'men', teamLevel: '1st Team' }), 'men-1st-team')
  // Boys U14A and Girls U14A never collapse.
  assert.notEqual(
    teamStructuralKey({ gender: 'boys',  ageGroup: 'U14', teamLevel: 'A' }),
    teamStructuralKey({ gender: 'girls', ageGroup: 'U14', teamLevel: 'A' }),
  )
})

test('seniority: seniors before ages, ordinal ascending, ages descending, letters ascending', () => {
  const teams = [
    { ageGroup: 'U14', teamLevel: 'B' },
    { ageGroup: null,  teamLevel: '2nd Team' },
    { ageGroup: 'U16', teamLevel: 'A' },
    { ageGroup: null,  teamLevel: '1st Team' },
    { ageGroup: 'U14', teamLevel: 'A' },
  ]
  const ordered = sortBySeniority(teams, seniorityDescriptor).map(levelLabel)
  assert.deepEqual(ordered, ['1st Team', '2nd Team', 'U16A', 'U14A', 'U14B'])
})

test('compareSeniority: gender is a tiebreak only, never reorders seniority', () => {
  const boysU14 = seniorityDescriptor({ gender: 'boys',  ageGroup: 'U14', teamLevel: 'A' })
  const girlsU16 = seniorityDescriptor({ gender: 'girls', ageGroup: 'U16', teamLevel: 'A' })
  assert.ok(compareSeniority(girlsU16, boysU14) < 0)  // U16 outranks U14 regardless of gender
})
