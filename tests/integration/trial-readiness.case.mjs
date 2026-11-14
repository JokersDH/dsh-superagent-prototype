import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { TrialReadinessSchema } from '../../packages/contracts/dist/index.js'
import { projectTrialReadiness } from '../../apps/coordinator/product/readiness.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'

const at = '2026-11-14T04:00:00.000Z', token = 'a'.repeat(64)
const profile = { id: 'native', revision: 1, displayName: 'Private native account', driverId: 'native-driver', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }
const criterion = { id: 'unit', kind: 'machine', description: 'Unit checks', required: true, checkDefinitionRef: 'unit' }
const project = { id: 'project', displayName: 'Private project', scope: { projectId: 'project', allowedPaths: ['private/source/'], excludedPaths: [], externalActions: [] },
  profileIds: ['native'], defaultProfileId: 'native', defaultCriteria: [criterion], dispatchAllowed: true }
const config = { protocol: 'application-configuration/1', revision: 'b'.repeat(64), executionAvailability: { state: 'available', kind: 'native' },
  profiles: [profile], projects: [project], checks: [{ id: 'unit', revision: 1, displayName: 'Unit' }],
  contextHistoryAvailable: true, contextSourcesAvailable: true, decisionsAvailable: true, proposalsAvailable: true }
const provider = { protocol: 'assistant-provider/1', configured: true, baseURL: 'https://private-provider.invalid/v1', model: 'private-model', models: ['private-model'], state: 'configured', secureTransport: true }
const observation = { mode: 'personal', startupMode: 'normal', observedAt: at }
const app = (overrides = {}) => createLocalHttpApp({ application: { dispatch() { throw new Error('Readiness cannot dispatch') } },
  principal: { userId: 'private-user', authorityRef: 'private-authority' }, apiToken: token, bootstrapToken: 'c'.repeat(64),
  mode: 'personal', allowedOrigins: ['http://127.0.0.1:4400'], now: () => Date.parse(at), read: { configuration: async () => config, assistant: async () => provider }, ...overrides })
const get = (server, path = '/v1/readiness', headers = { authorization: `Bearer ${token}` }) => server.request(`http://127.0.0.1${path}`, { headers })

test('actual readiness HTTP reports bounded configuration observations without exposing names, paths or endpoints', async () => {
  let configurationReads = 0, providerReads = 0
  const server = app({ read: { configuration: async () => { configurationReads++; return config }, assistant: async () => { providerReads++; return provider } } })
  const response = await get(server), view = TrialReadinessSchema.parse(await response.json())
  assert.equal(response.status, 200); assert.equal(view.development, 'configuration_present'); assert.equal(view.discussion, 'configuration_present')
  assert.equal(view.authorization, 'none'); assert.equal(view.configurationRevision, config.revision)
  assert.deepEqual(view.projects, { development: 1, discussion: 0, dispatchable: 1 })
  assert.deepEqual(view.profiles, { native: 1, controlled: 0, admittedNative: 1, admittedControlled: 0 })
  assert.doesNotMatch(JSON.stringify(view), /Private|private-|private\/|baseURL|apiToken|authorityRef|nativeConfigRef/)
  assert.equal(configurationReads, 1); assert.equal(providerReads, 1)
})
test('readonly projection agrees with the existing configuration route and cannot present execution admission', async () => {
  const server = app({ startupMode: 'recovery_readonly' }), response = await get(server), view = await response.json()
  assert.equal(response.status, 200); assert.equal(view.development, 'readonly')
  assert.deepEqual(view.execution, { state: 'unavailable', reason: 'recovery_readonly' })
  assert.equal(view.projects.dispatchable, 0); assert.equal(view.profiles.admittedNative, 0)
  assert.equal(view.capabilities.decisions, false); assert.equal(view.capabilities.proposals, false)
  const configuration = await (await get(server, '/v1/configuration')).json()
  assert.deepEqual(configuration.executionAvailability, view.execution)
  assert.ok(configuration.projects.every(project => !project.dispatchAllowed)); assert.equal(view.authorization, 'none')
})
test('missing executor still allows independently configured discussion and unknown evidence stays unknown', () => {
  const unavailable = { ...config, executionAvailability: { state: 'unavailable', reason: 'not_installed' },
    profiles: [], projects: [{ ...project, profileIds: [], defaultProfileId: undefined, dispatchAllowed: false, blockedReason: 'unsupported_capability' }] }
  const view = projectTrialReadiness(unavailable, provider, observation)
  assert.equal(view.discussion, 'configuration_present'); assert.equal(view.development, 'blocked')
  const { executionAvailability: _, ...legacy } = config
  const unknown = projectTrialReadiness(legacy, undefined, observation)
  assert.equal(unknown.discussion, 'unknown'); assert.equal(unknown.development, 'unknown'); assert.equal(unknown.execution.state, 'unknown')
  const errored = projectTrialReadiness(config, { ...provider, state: 'error' }, observation)
  assert.equal(errored.discussion, 'provider_error')
  assert.equal(projectTrialReadiness(config, { ...provider, model: null }, observation).discussion, 'not_configured')
})
test('fixture evidence and absent development projects never claim native configuration readiness', () => {
  assert.equal(projectTrialReadiness(config, provider, { ...observation, mode: 'fixture' }).development, 'fixture_only')
  const noProject = projectTrialReadiness({ ...config, projects: [] }, provider, observation)
  assert.equal(noProject.development, 'needs_project'); assert.equal(noProject.projects.development, 0)
  const controlled = { ...config, executionAvailability: { state: 'available', kind: 'controlled_fixture' },
    profiles: [{ ...profile, kind: 'controlled_fixture', readiness: 'fixture_ready' }] }
  assert.equal(projectTrialReadiness(controlled, provider, observation).development, 'fixture_only')
})
test('readiness authenticates, refuses all query claims, and propagates provider/configuration integrity failures', async () => {
  const server = app()
  assert.equal((await get(server, '/v1/readiness', {})).status, 401)
  assert.equal((await get(server, '/v1/readiness', { authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await get(server, '/v1/readiness', { authorization: `Bearer ${token}`, origin: 'https://foreign.invalid' })).status, 403)
  for (const query of ['?projectId=foreign', '?grant=true', '?native=1&native=1']) assert.equal((await get(server, `/v1/readiness${query}`)).status, 400)
  assert.equal((await get(app({ read: {} }))).status, 422)
  assert.equal((await get(app({ read: { configuration: async () => ({ ...config, revision: 'bad' }) } }))).status, 400)
  assert.equal((await get(app({ read: { configuration: async () => config, assistant: async () => ({ ...provider, configured: 'true' }) } }))).status, 400)
  const absent = await (await get(app({ read: { configuration: async () => config } }))).json()
  assert.equal(absent.discussion, 'unknown')
})
test('actual Store and Node HTTP compose readiness without event, queue, model or native work', async t => {
  const root = mkdtempSync('/tmp/pa-trial-readiness-'), stateRoot = join(root, 'state'), scratch = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(scratch, 'src'), { recursive: true })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  let modelCalls = 0, runtime, server
  t.after(async () => { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await runtime?.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  runtime = createProductRuntime({ store, stateRoot, scratchProject: scratch, projects: [{ id: 'trial-project', displayName: 'Trial project', scope: { ...project.scope, projectId: 'trial-project', allowedPaths: ['src/'] } }],
    principal: { userId: 'trial-user', authorityRef: 'trial-authority' }, actionSecret: Buffer.alloc(32, 74),
    assistantProvider: { status: () => provider, selectModel: () => provider,
      reply: async () => { modelCalls++; throw new Error('Readiness cannot ask a model') } } })
  const before = store.events.cursor(), initial = await runtime.read.configuration()
  server = listenLocalHttp(createLocalHttpApp({ application: runtime.application,
    principal: { userId: 'trial-user', authorityRef: 'trial-authority' }, mode: 'fixture', apiToken: token,
    bootstrapToken: 'c'.repeat(64), allowedOrigins: ['http://127.0.0.1:4400'], operations: runtime.operations, read: runtime.read }), 0)
  await once(server, 'listening')
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/readiness`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
  const view = TrialReadinessSchema.parse(await response.json())
  assert.equal(response.status, 200); assert.equal(view.configurationRevision, initial.revision)
  assert.equal(view.mode, 'fixture'); assert.equal(view.development, 'fixture_only'); assert.equal(view.discussion, 'configuration_present')
  assert.equal(view.authorization, 'none'); assert.equal(modelCalls, 0); assert.equal(store.events.cursor(), before)
})
