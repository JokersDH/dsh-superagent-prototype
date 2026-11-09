import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeProjectRegistry, ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'
import { createControlledProduct } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { ProductStore } from '../../packages/storage/dist/index.js'

function fixture(t) {
  const root = mkdtempSync('/tmp/pa-project-registration-'),
    state = join(root, 'state'),
    project = join(root, 'project')
  mkdirSync(state, { mode: 0o700 })
  ensureStarterProject(project)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, state, project, registry: new NativeProjectRegistry(state) }
}
test('project settings persist a clean explicit repository without changing its index or tree', (t) => {
  const h = fixture(t)
  const before = execFileSync('git', ['status', '--porcelain'], { cwd: h.project, encoding: 'utf8' })
  const record = h.registry.prepare({ path: h.project, displayName: '我的项目', check: 'node_test' })
  h.registry.save(record)
  assert.deepEqual(new NativeProjectRegistry(h.state).list(), [record])
  assert.equal(statSync(join(h.state, 'native-projects.json')).mode & 0o777, 0o600)
  assert.deepEqual(h.registry.scope(record).allowedPaths, ['.'])
  assert.deepEqual(h.registry.check(record).argv, ['--test'])
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: h.project, encoding: 'utf8' }), before)
})
test('project import refuses relative paths, subdirectories, uncommitted input and grant replacement', (t) => {
  const h = fixture(t)
  assert.throws(() => h.registry.prepare({ path: './relative', check: 'node_test' }))
  assert.throws(() => h.registry.prepare({ path: join(h.project, 'src'), check: 'node_test' }))
  const record = h.registry.prepare({ path: h.project, check: 'node_test' })
  h.registry.save(record)
  assert.throws(() => h.registry.prepare({ path: h.project, check: 'npm_test' }))
  writeFileSync(join(h.project, 'uncommitted.txt'), 'preserve me')
  assert.throws(() => h.registry.prepare({ path: h.project, check: 'node_test' }))
  assert.equal(readFileSync(join(h.project, 'uncommitted.txt'), 'utf8'), 'preserve me')
})
test('authenticated project registration adds a grant/check and survives runtime reconstruction', async (t) => {
  const h = fixture(t),
    store = new ProductStore({ path: join(h.state, 'state.sqlite') })
  const profile = {
    id: 'native-profile',
    revision: 1,
    driverId: 'codex-native',
    driverApiMajor: 1,
    driverRelease: 'fixture',
    executable: process.execPath,
    argv: [],
    expectedVersion: process.version,
    nativeConfigRef: 'fixture-settings',
    permissionPolicyRevision: 'fixture-policy',
    requiredFeatures: [],
  }
  const principal = { userId: 'local-user', authorityRef: 'local-authority' }
  const options = {
    store,
    principal,
    actionSecret: Buffer.alloc(32, 1),
    stateRoot: h.state,
    scratchProject: h.project,
    projects: [],
    native: { profile, projects: [], approvalPolicy: 'on-request' },
    projectRegistry: h.registry,
  }
  const product = createControlledProduct(options)
  t.after(async () => {
    await product.close()
    store.close()
  })
  const http = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: 'a'.repeat(64),
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5180'],
    mode: 'personal',
    localDevelopmentAccess: true,
    read: product.read,
  })
  const request = (body) =>
    http.request('http://127.0.0.1/v1/projects', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5180', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  assert.equal((await request({ path: h.project, check: 'node_test', actor: 'forged' })).status, 400)
  const response = await request({ path: h.project, displayName: '开发项目', check: 'node_test' })
  assert.equal(response.status, 200)
  const configuration = await response.json(),
    project = configuration.projects[0]
  assert.deepEqual(project.profileIds, [profile.id])
  assert.equal(project.dispatchAllowed, true)
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(h.root))
  const receipt = await product.application.dispatch(
    {
      commandId: 'create-imported-work',
      conversationId: 'imported-conversation',
      kind: 'create_work',
      projectId: project.id,
      scope: project.scope,
      criteria: project.defaultCriteria,
      profileId: profile.id,
      goal: 'A stored real project delegation, not launched in this configuration-only test',
    },
    { ...principal, source: 'local_ui' },
  )
  assert.equal(receipt.status, 'recorded')
  writeFileSync(join(h.project, 'dirty-work.mjs'), '// user work must be preserved\n')
  const blocked = await product.application.dispatch(
    {
      commandId: 'dirty-create-work',
      conversationId: 'imported-conversation',
      kind: 'create_work',
      projectId: project.id,
      scope: project.scope,
      criteria: project.defaultCriteria,
      profileId: profile.id,
      goal: 'Do not launch from a dirty baseline',
    },
    { ...principal, source: 'local_ui' },
  )
  assert.equal(blocked.status, 'rejected')
  assert.equal(blocked.error.code, 'conflict')
  assert.equal(readFileSync(join(h.project, 'dirty-work.mjs'), 'utf8'), '// user work must be preserved\n')
  assert.deepEqual(await product.read.workLocation(receipt.workId), {
    projectPath: realpathSync(h.project),
    workspacePath: null,
    baseCommit: null,
  })
  const restored = new NativeProjectRegistry(h.state)
  const records = restored.list()
  assert.equal(records[0].id, project.id)
  const reconstructed = createControlledProduct({
    ...options,
    projects: records.map((item) => ({ id: item.id, displayName: item.displayName, scope: restored.scope(item) })),
    native: {
      ...options.native,
      projects: records.map((item) => ({ id: item.id, path: item.path, check: restored.check(item) })),
    },
    projectRegistry: restored,
  })
  assert.equal((await reconstructed.application.inspect({ workId: receipt.workId })).works[0].work.id, receipt.workId)
  assert.equal((await reconstructed.read.configuration()).projects[0].id, project.id)
  await reconstructed.close()
})
