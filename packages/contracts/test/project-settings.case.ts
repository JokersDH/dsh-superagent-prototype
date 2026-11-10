import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProjectSettingsCommandSchema, ProjectSettingsPageSchema } from '../src/index.ts'

test('project settings permit only fixed checks and explicit offline authorization with CAS', () => {
  const command = { kind: 'update_project_settings', commandId: 'settings-one', projectId: 'project-one', expectedRevision: 1,
    displayName: 'Project', check: 'node_test', environment: { policy: 'existing_only' } }
  assert.equal(ProjectSettingsCommandSchema.safeParse(command).success, true)
  for (const change of [{ actor: 'forged' }, { path: '/another-project' }, { executable: '/bin/sh' }, { expectedRevision: 0 },
    { environment: { policy: 'offline_install', storeDir: './relative' } }, { check: 'arbitrary_command' }])
    assert.equal(ProjectSettingsCommandSchema.safeParse({ ...command, ...change }).success, false)
})
test('settings history belongs to the same project and begins at the current version', () => {
  const version = { projectId: 'project-one', revision: 1, digest: 'a'.repeat(64), displayName: 'Project', check: 'node_test',
    environment: { policy: 'existing_only' }, checkDefinitionRef: 'check-one', createdAt: '2026-11-10T00:00:00.000Z' }
  const page = { protocol: 'project-settings/1', current: { ...version, archived: false, archiveRevision: 0 }, history: [version] }
  assert.equal(ProjectSettingsPageSchema.safeParse(page).success, true)
  assert.equal(ProjectSettingsPageSchema.safeParse({ ...page, history: [{ ...version, projectId: 'another-project' }] }).success, false)
  assert.equal(ProjectSettingsPageSchema.safeParse({ ...page, history: [] }).success, false)
})
