/**
 * The upgrade must preserve the identity the instance actually ran with. These are the pure pieces:
 * no silent fallback from personal to fixture, no guessed access mode, no switch without identity.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UpgradeError, launcherStartArgs, preserveIdentity } from '../lib/upgrade.mjs'

test('start flags follow the recorded mode/access instead of a fixed fixture default', () => {
  assert.deepEqual(launcherStartArgs({ mode: 'personal', access: 'local-development' }), [])
  assert.deepEqual(launcherStartArgs({ mode: 'fixture', access: 'local-development' }), ['--fixture'])
  assert.deepEqual(launcherStartArgs({ mode: 'personal', access: 'token' }), ['--require-login'])
  assert.deepEqual(launcherStartArgs({ mode: 'fixture', access: 'token' }), ['--fixture', '--require-login'])
  assert.throws(() => launcherStartArgs({ mode: 'auto', access: 'local-development' }), (error) => error.code === 'upgrade_mode_unavailable')
  assert.throws(() => launcherStartArgs({ mode: 'fixture', access: 'open' }), (error) => error.code === 'upgrade_access_unavailable')
})

test('the running record is authoritative; a journal can only recover the same identity', () => {
  assert.deepEqual(preserveIdentity({ record: { mode: 'personal', access: 'token' }, journal: { mode: 'fixture', access: 'local-development' } }), {
    mode: 'personal',
    access: 'token',
  })
  assert.deepEqual(preserveIdentity({ record: null, journal: { mode: 'fixture', access: 'local-development' } }), {
    mode: 'fixture',
    access: 'local-development',
  })
  assert.deepEqual(preserveIdentity({ record: null, journal: null, explicitMode: 'personal', explicitAccess: 'local-development' }), {
    mode: 'personal',
    access: 'local-development',
  })
})

test('without any establishable identity the upgrade refuses instead of silently choosing one', () => {
  assert.throws(
    () => preserveIdentity({ record: null, journal: null }),
    (error) => error instanceof UpgradeError && error.code === 'upgrade_mode_unavailable' && /refusing to switch/.test(error.message),
  )
  assert.throws(
    () => preserveIdentity({ record: { mode: 'fixture' } }),
    (error) => error.code === 'upgrade_mode_unavailable',
  )
})
