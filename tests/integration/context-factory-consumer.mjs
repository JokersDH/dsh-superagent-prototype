import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mock } from 'node:test'
import { parseArgs } from 'node:util'
import * as contextLibrary from '../../packages/context/dist/index.js'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'

const { values } = parseArgs({ options: { output: { type: 'string' } } })
const output = resolve(values.output ?? 'reports/releases/wave15-integration/context-factory')
mkdirSync(output, { recursive: true })
const calls = { conversationFactories: 0, artifactFactories: 0, conversationReads: 0, artifactReads: 0, artifactIds: [] }, coverages = []
mock.module(new URL('../../packages/context/dist/index.js', import.meta.url).href, { namedExports: { ...contextLibrary,
  createScopedConversationProvider(...args) {
    calls.conversationFactories++
    const provider = contextLibrary.createScopedConversationProvider(...args)
    return { ...provider, recent: async input => { calls.conversationReads++; const value = await provider.recent(input); coverages.push(provider.coverage()); return value } }
  },
  createPublishedArtifactProvider(lookup, ...args) {
    calls.artifactFactories++
    const provider = contextLibrary.createPublishedArtifactProvider({ get: id => { calls.artifactIds.push(id); return lookup.get(id) } }, ...args)
    return { ...provider, recent: async input => { calls.artifactReads++; return provider.recent(input) } }
  },
} })
const { createProductRuntime, FIXTURE_CHECK } = await import('../../apps/coordinator/product/runtime.ts')
const { ProductContextPreview } = await import('../../apps/coordinator/product/context-preview.ts')
const { createLocalHttpApp } = await import('../../apps/coordinator/http/app.ts')
const root = mkdtempSync('/tmp/pa-context-factory-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Factory consumer fixture'])
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), principal = { userId: 'factory-user', authorityRef: 'factory-authority' }
const actor = { ...principal, source: 'local_ui' }, projectId = 'factory-project', conversationId = 'factory-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, projects = [{ id: projectId, scope }]
const product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal, projects, actionSecret: Buffer.alloc(32, 59) })
const service = new ProductContextPreview(store, product.application, principal, () => projects,
  { verification: product.read.verification, workEvidence: product.read.workEvidence })
const append = (id, text, rest = {}) => store.product.messages.append({ id, projectId, conversationId, role: 'user', provenance: 'trusted_user', text, sourceRefs: [], createdAt: new Date().toISOString(), ...rest })
const input = { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 32, maxBytes: 131072, maxTokens: 32768 } }
const checks = [], check = async (id, run) => { try { await run(); checks.push({ id, status: 'PASS' }) } catch (error) { checks.push({ id, status: 'FAIL', message: error.message }); throw error } }
let complete = false
try {
  append('factory-source', 'SELECTED_FACTORY_DISCUSSION')
  const created = await product.application.dispatch({ kind: 'create_work', commandId: 'factory-work', projectId, conversationId, goal: 'Create the fixed fixture output', scope,
    profileId: 'profile-fixture-pass', criteria: [{ id: 'fixed', kind: 'machine', required: true, description: 'Fixed output', checkDefinitionRef: FIXTURE_CHECK }] }, actor)
  product.start()
  let work
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    work = (await product.application.inspect({ workId: created.workId })).works[0]
    if (work.actions.currentVerificationId && work.artifactIds.length) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.ok(work?.artifactIds.length, 'The real product must publish verified artifacts')
  await product.close()
  const artifactInput = { ...input, workId: work.work.id, selections: ['artifacts'] }, artifactId = work.artifactIds[0]
  const http = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: product.read, operations: product.operations })
  await check('ACTUAL_RUNTIME_HTTP_CALLS_REVIEWED_C_FACTORIES_WITHOUT_WRITES_OR_ARTIFACT_BYTES', async () => {
    const changes = store.db.prepare('SELECT total_changes() AS n').get().n, cursor = store.events.cursor(), read = store.artifacts.read
    store.artifacts.read = () => { throw new Error('Metadata context must not read artifact bytes') }
    try {
      const response = await http.request('http://127.0.0.1/v1/context/preview', { method: 'POST',
        headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...artifactInput, selections: ['conversation', 'artifacts'] }) })
      assert.equal(response.status, 200, await response.clone().text())
      const value = await response.json()
      assert.ok(calls.conversationFactories && calls.artifactFactories && calls.conversationReads && calls.artifactReads)
      assert.ok(value.sources.some(source => source.kind === 'conversation_message'))
      assert.ok(value.sources.some(source => source.kind === 'artifact'))
      assert.equal(JSON.stringify(value).includes(root), false)
      assert.equal(store.events.cursor(), cursor); assert.equal(store.db.prepare('SELECT total_changes() AS n').get().n, changes)
    } finally { store.artifacts.read = read }
  })
  await check('ACTUAL_FACTORY_CUTOFF_EXCLUDES_OWN_NEW_MESSAGE_AND_LATER_HISTORY', async () => {
    const cutoff = store.workflows.conversations.get(conversationId).lastSequence
    append('later-factory-source', 'LATER_FACTORY_DISCUSSION')
    const beforeValues = [], page = store.product.messages.page.bind(store.product.messages)
    store.product.messages.page = (id, options) => { beforeValues.push(options.before); return page(id, options) }
    try {
      const value = await service.prepareGuarded(input, actor, { conversationThrough: cutoff })
      assert.ok(value.preview.sources.some(source => source.content.includes('SELECTED_FACTORY_DISCUSSION')))
      assert.equal(JSON.stringify(value.preview).includes('LATER_FACTORY_DISCUSSION'), false)
      assert.ok(beforeValues.length && beforeValues.every(before => before <= cutoff + 1))
      value.assertCurrent()
    } finally { store.product.messages.page = page }
  })
  await check('PUBLICATION_RECEIPT_CHANGE_WITHOUT_EVENT_INVALIDATES_THE_SYNCHRONOUS_GUARD', async () => {
    const guarded = await service.prepareGuarded(artifactInput, actor), id = key('product-artifact', artifactId, work.work.id)
    const publication = store.commands.get(id), cursor = store.events.cursor()
    store.db.prepare('UPDATE command_receipts SET payload_digest = ? WHERE command_id = ?').run('f'.repeat(64), id)
    assert.throws(guarded.assertCurrent, error => error?.error?.code === 'conflict')
    assert.equal(store.events.cursor(), cursor)
    store.db.prepare('UPDATE command_receipts SET payload_digest = ? WHERE command_id = ?').run(publication.payloadDigest, id)
  })
  await check('MISSING_PUBLICATION_IS_PARTIAL_AND_UNPUBLISHED_REGISTRY_IDS_ARE_NEVER_LOOKED_UP', async () => {
    const hidden = store.artifacts.write(Buffer.from('UNPUBLISHED_FACTORY_BYTES')); store.artifacts.insert(hidden)
    const id = key('product-artifact', artifactId, work.work.id), publication = store.commands.get(id)
    store.db.prepare("UPDATE command_receipts SET status = 'rejected' WHERE command_id = ?").run(id)
    const value = await service.prepare(artifactInput, actor)
    assert.equal(value.status, 'partial'); assert.ok(value.issues.includes('artifact_source_missing'))
    assert.equal(value.sources.some(source => JSON.parse(source.content).artifactRef === artifactId), false)
    assert.equal(calls.artifactIds.includes(hidden.id), false)
    store.db.prepare('UPDATE command_receipts SET status = ? WHERE command_id = ?').run(publication.status, id)
  })
  await check('THE_C_FACTORY_FILTERS_A_CORRUPT_CROSS_CONVERSATION_PAGE', async () => {
    const foreign = append('foreign-session-factory', 'FOREIGN_SESSION_PRIVATE', { conversationId: 'foreign-session' })
    const page = store.product.messages.page.bind(store.product.messages)
    store.product.messages.page = (id, options) => { const value = page(id, options); return { ...value, messages: [...value.messages, foreign] } }
    try {
      const value = await service.prepare(input, actor)
      assert.equal(JSON.stringify(value).includes('FOREIGN_SESSION_PRIVATE'), false)
      assert.ok(coverages.at(-1).excluded.otherConversation > 0)
    } finally { store.product.messages.page = page }
  })
  await check('THE_DEFAULT_CONSUMER_STOPS_AT_600_SCANNED_MESSAGES_AND_EXPOSES_INCOMPLETE_COVERAGE', async () => {
    store.uow.atomic(() => {
      for (let index = 0; index < 601; index++) append(`permission-${index}`, 'Not reusable discussion', { anchor: { questionId: `question-${index}` } })
    })
    const value = await service.prepare(input, actor), coverage = coverages.at(-1)
    assert.equal(coverage.scanned, 600); assert.equal(coverage.complete, false)
    assert.ok(value.issues.includes('conversation_scan_incomplete'))
    assert.ok(value.omitted.some(item => item.reason === 'source_unavailable'))
    assert.notEqual(value.status, 'sufficient')
  })
  complete = true
} finally {
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true }); mock.restoreAll()
  writeFileSync(join(output, 'report.json'), JSON.stringify({ protocol: 'context-factory-consumer/1',
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDirty: !!execFileSync('git', ['diff', 'HEAD', '--', 'packages/context', 'apps/coordinator/product/context-preview.ts'], { encoding: 'utf8' }).trim(),
    status: complete && checks.length === 6 && checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', checks,
    calls, realModelTurns: 0, nativeTurnStarts: 0,
    scope: 'Actual runtime/HTTP/SQLite/composer; spies wrap the reviewed C factories, controlled local product execution only' }, null, 2) + '\n')
}
