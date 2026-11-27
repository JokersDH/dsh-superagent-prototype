import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { snapshotState } from '../../packages/portability/dist/index.js'
import { configureAcpConnection, listAcpConnections } from '../../apps/coordinator/product/acp-connections.ts'
import { inspectAcpConnection } from '../../apps/coordinator/product/acp-inspection.ts'
import { prepareAcpStartup } from '../../apps/coordinator/product/acp-startup.ts'
import { ProductExecutorTrials } from '../../apps/coordinator/product/executor-trial.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../apps/coordinator/product/project-registry.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const dshEntry = join(dirname(dirname(process.execPath)), 'lib/node_modules/@deepseek-ai/dsh/lib/bin.js')
const supported = process.platform === 'darwin' && process.arch === 'arm64' && process.version === 'v24.21.0' && existsSync(dshEntry)
const actualProtocol = process.env.PA_ACP_REAL_INSPECTION === '1'
const principal = { userId: 'acp-config-consumer', authorityRef: 'acp-config-authority' }

test(`private ACP configuration needs original scoped consent and reaches the ordinary project/profile consumer (${actualProtocol ? 'actual zero-model stdio' : 'controlled handshake'})`, { skip: !supported, timeout: 20000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-acp-startup-')), stateRoot = join(root, 'state'), projectPath = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(projectPath, { mode: 0o700 })
  const git = argv => execFileSync('git', argv, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-qm', 'initial'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  let product
  t.after(async () => { await product?.close(); store.close()
    if (actualProtocol) console.log(JSON.stringify({ scope: 'actual initialize-only CLI; original scoped trial/configuration consumer; no Work/model turn', evidenceRoot: root,
      modelTurns: 0, signals: 0, physicalQuiescenceProven: false, materialPreserved: true }))
    else rmSync(root, { recursive: true, force: true })
  })
  const fakeKey = 'controlled-fixture-private-key-never-sent'
  const saved = await configureAcpConnection({ stateRoot, profileId: 'profile-controlled-dsh', displayName: 'Controlled DSH', dshEntry,
    model: { id: 'controlled-model', baseURL: 'http://127.0.0.1:1/v1', apiKey: fakeKey } })
  assert.equal(saved.readiness, 'policy_installed')
  assert.equal(listAcpConnections(stateRoot)[0].connection.modelId, 'controlled-model')
  assert.doesNotMatch(readFileSync(join(stateRoot, 'agent-connections', saved.id, 'connection.json'), 'utf8'), new RegExp(fakeKey))
  const inspect = id => inspectAcpConnection(stateRoot, id, actualProtocol ? {} : { handshake: async () => ({ protocolVersion: 1,
    agentName: 'controlled-standard-declaration', agentVersion: 'controlled-only', capabilities: {}, evidenceRefs: ['controlled-initialize-observed'] }) })
  const observed = await inspect(saved.id)
  assert.equal(observed.verdict.class, 'compatible_unverified')
  assert.equal(observed.verdict.origin, 'protocol_declaration')
  assert.equal(observed.verdict.nativeTestPassed, false)
  const before = await prepareAcpStartup(stateRoot, store, principal, { inspect })
  assert.equal(before.executors.length, 0)
  assert.equal(before.inspectedProfiles[0].dispatchAllowed, false)
  const trials = new ProductExecutorTrials({ store, principal, inspect })
  const trial = await trials.read(saved.id)
  assert.equal(trial.confirmationAvailable, true)
  const command = { commandId: trial.confirmationCommandId, profileId: saved.id, revision: trial.profile.revision,
    identityDigest: trial.identityDigest, policyDigest: trial.policyDigest, confirmUnverifiedVersion: true }
  await trials.confirm(command, { ...principal, source: 'local_ui' })
  const after = await prepareAcpStartup(stateRoot, store, principal, { inspect })
  assert.equal(after.executors.length, 1)
  assert.equal(after.executors[0].admissionCurrent(), true)
  assert.equal(after.executors[0].profileView.readiness, 'inspection_passed')
  assert.equal(after.executors[0].profileView.compatibility.operations.find(item => item.operation === 'steer').enabled, false)
  const registry = new NativeProjectRegistry(stateRoot)
  product = createProductRuntime({ store, stateRoot, principal, actionSecret: Buffer.alloc(32, 62),
    scratchProject: projectPath, projects: [], executors: after.executors, projectRegistry: registry, inspectExecutor: inspect })
  const configuration = await product.read.registerProject({ path: projectPath, displayName: 'ACP consumer project', check: 'node_test' })
  assert.equal(configuration.profiles.length, 1, 'no Codex or scratch fallback is needed to use an admitted ACP profile')
  assert.deepEqual(configuration.projects[0].profileIds, [saved.id])
  assert.match(configuration.profiles[0].displayName, /controlled-model/)
  const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
  const response = await api.request(`http://127.0.0.1/v1/executors/trial?profileId=${saved.id}`, { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })
  assert.equal(response.status, 200)
  const projected = await response.json()
  assert.equal(projected.profile.id, saved.id)
  assert.equal(projected.authorization, 'granted')
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(fakeKey))
  const stagingDir = join(root, 'backup'); mkdirSync(stagingDir, { mode: 0o700 })
  const snapshot = await snapshotState({ stateDir: stateRoot, stagingDir })
  assert.ok(snapshot.excluded.some(entry => entry.path === 'agent-connections'))
  assert.equal(snapshot.config.some(entry => entry.path.includes('agent-connections')), false)
  const overlay = saved.connection.profile.argv.at(-1)
  appendFileSync(overlay, '\n# controlled configuration drift\n')
  assert.equal(after.executors[0].admissionCurrent(), false)
  assert.equal((await product.read.configuration()).profiles[0].dispatchAllowed, false)
  assert.equal(listAcpConnections(stateRoot)[0].readiness, 'invalid')
})
