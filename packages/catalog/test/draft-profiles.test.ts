/** Draft profiles must be well-formed AgentProfiles and must never claim native readiness. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentProfileSchema } from '../../contracts/src/schemas.ts'
import { buildCatalogEntry } from '../src/index.ts'
import { CODEX_PROFILE, DRAFT_PROFILES, DSH_PROFILE, NATIVE_TESTED, ZCODE_PROFILE } from '../fixtures/draft-profiles.ts'

test('every draft profile satisfies the frozen AgentProfile schema', () => {
  assert.equal(DRAFT_PROFILES.length, 3)
  for (const profile of DRAFT_PROFILES) {
    assert.equal(AgentProfileSchema.safeParse(profile).success, true, profile.id)
  }
})

test('draft profiles pin absolute executables and explicit argv', () => {
  for (const profile of [CODEX_PROFILE, DSH_PROFILE, ZCODE_PROFILE]) {
    assert.ok(profile.executable.startsWith('/'), profile.id)
    assert.ok(Array.isArray(profile.argv), profile.id)
  }
})

test('an unreachable draft profile is missing, never inspection_passed', () => {
  const entry = buildCatalogEntry({
    profile: CODEX_PROFILE,
    checkedAt: '2026-11-08T00:00:00.000Z',
    facts: { executable: CODEX_PROFILE.executable, exists: false },
  })
  assert.equal(entry.readiness, 'missing')
})

test('no draft agent claims a native test', () => {
  assert.deepEqual({ ...NATIVE_TESTED }, { codex: false, dsh: false, zcode: false })
})
