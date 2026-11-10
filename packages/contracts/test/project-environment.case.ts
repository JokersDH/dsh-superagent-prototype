import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProjectRegistrationInputSchema, WorkEnvironmentSchema } from '../src/index.ts'

test('environment policy is explicit and cannot carry executables, network settings or guessed authority', () => {
  const base = { path: '/project', check: 'pnpm_test' }
  assert.equal(ProjectRegistrationInputSchema.safeParse(base).success, true)
  assert.equal(ProjectRegistrationInputSchema.safeParse({ ...base, environment: { policy: 'offline_install', storeDir: '/offline-cache' } }).success, true)
  for (const environment of [
    { policy: 'online_install', storeDir: '/cache' },
    { policy: 'offline_install' },
    { policy: 'offline_install', storeDir: './cache' },
    { policy: 'offline_install', storeDir: '/cache', managerCommand: '/bin/sh' },
    { policy: 'existing_only', authorityRoot: '/private' },
    { policy: 'existing_only', network: true },
  ]) assert.equal(ProjectRegistrationInputSchema.safeParse({ ...base, environment }).success, false)
})
test('public environment status cannot expose receipt paths or process configuration', () => {
  const base = { protocol: 'work-environment/1', workId: 'work-1', status: 'blocked', code: 'dependencies_missing' }
  assert.equal(WorkEnvironmentSchema.safeParse(base).success, true)
  for (const extra of [{ authorityRoot: '/private' }, { environmentRef: 'private-ref' }, { env: { HOME: '/account' } }, { stderr: 'sensitive data' }])
    assert.equal(WorkEnvironmentSchema.safeParse({ ...base, ...extra }).success, false)
})
