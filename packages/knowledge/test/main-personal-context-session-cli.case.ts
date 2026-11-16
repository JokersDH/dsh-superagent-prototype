import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { key } from '@personal-agent/orchestrator-core'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../apps/coordinator/http/server.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const cli = join(repoRoot, 'packages/context/tools/assistant-context-cli.mjs')
const principal = { userId: 'wave32-cli-user', authorityRef: 'wave32-cli-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const projectA = 'wave32-project-a', projectB = 'wave32-project-b'
const conversationA = 'wave32-conversation-a', conversationB = 'wave32-conversation-b'
const scopeFor = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] })
const scope = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })

const execFileAsync = promisify(execFile)
async function run(args: string[]): Promise<{ exit: number | null; result: Record<string, any> }> {
  try {
    const outcome = await execFileAsync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 60000 })
    const line = String(outcome.stdout ?? '').trim().split('\n').at(-1) ?? '{}'
    return { exit: 0, result: JSON.parse(line) as Record<string, any> }
  } catch (error) {
    const candidate = error as { code?: number; stdout?: string; stderr?: string }
    const line = String(candidate.stdout ?? '').trim().split('\n').at(-1) || JSON.stringify({ status: 'crashed', stderr: String(candidate.stderr ?? '').slice(-800) })
    return { exit: typeof candidate.code === 'number' ? candidate.code : 1, result: JSON.parse(line) as Record<string, any> }
  }
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`context CLI flow timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('a normal instance selects sources, confirms a proposal and records/revokes a decision that survives reopen', { timeout: 240000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave32-cli-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const database = join(stateRoot, 'state.sqlite')
  // @ts-expect-error - main-owned fixture has no type declarations.
  const modelModule = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(): Promise<{ file: string; requests: unknown[]; provider: unknown; close(): Promise<void> }>
  }
  const model = await modelModule.candidateModel()
  t.after(async () => { await model.close(); rmSync(root, { recursive: true, force: true }) })

  const startInstance = async () => {
    const store = new ProductStore({ path: database })
    const product = createProductRuntime({ store, stateRoot, scratchProject: join(root, 'scratch'), assistantProvider: model.provider as never,
      projects: [{ id: projectA, displayName: 'A', scope: scope(projectA) }, { id: projectB, displayName: 'B', scope: scope(projectB) }],
      principal, actionSecret: Buffer.alloc(32, 21) })
    const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
      allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
    const server = listenLocalHttp(app, 0)
    await new Promise<void>((done) => server.once('listening', () => done()))
    product.start()
    return { store, product, app, server, api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await product.close().catch(() => undefined); store.close() } }
  }

  let contextMessage = ''
  let draftFile = ''
  let draftRequestId = ''
  const instance = await startInstance()
  try {
    for (const [projectId, conversationId, text] of [[projectA, conversationA, 'A 项目讨论：保留错误码。'], [projectB, conversationB, 'B 项目讨论。']] as const) {
      const commandId = `${conversationId}-chat`
      await instance.product.application.dispatch({ commandId, conversationId, kind: 'chat', projectId, text }, actor)
      await instance.product.execution.effects.idle('application.assistant.reply')
    }
    const messageA = key('message', `${conversationA}-chat`)
    const messageB = key('message', `${conversationB}-chat`)

    const candidates = await run(['candidates', '--api', instance.api, '--api-token', apiToken, '--message', messageA])
    assert.equal(candidates.exit, 0, JSON.stringify(candidates.result))
    assert.equal(candidates.result.result.candidates.length >= 1, true)
    const index = candidates.result.result.candidates[0].index as number

    const proposed = await run(['propose', '--api', instance.api, '--api-token', apiToken, '--message', messageA, '--index', String(index),
      '--project', projectA, '--conversation', conversationA, '--command-id', 'w32-cli-confirm'])
    assert.equal(proposed.exit, 0, JSON.stringify(proposed.result))
    assert.equal(proposed.result.result.receiptStatus, 'recorded')
    const replay = await run(['propose', '--api', instance.api, '--api-token', apiToken, '--message', messageA, '--index', String(index),
      '--project', projectA, '--conversation', conversationA, '--command-id', 'w32-cli-confirm'])
    // Recommitting the same proposal is refused by the original product; the CLI reports the refusal.
    assert.equal(replay.exit, 3, JSON.stringify(replay.result))
    assert.equal(typeof replay.result.failure?.code, 'string')

    const preview = await run(['preview', '--api', instance.api, '--api-token', apiToken, '--project', projectA, '--conversation', conversationA,
      '--select', 'conversation', '--limit', '16'])
    assert.equal(preview.exit, 0, JSON.stringify(preview.result))
    assert.equal(preview.result.result.authorization, 'none')
    assert.equal(preview.result.result.sources.length >= 1, true)
    assert.equal(preview.result.result.sources.some((source: { sourceId: string }) => source.sourceId.includes(messageB)), false)

    const sent = await run(['send', '--api', instance.api, '--api-token', apiToken, '--project', projectA, '--conversation', conversationA,
      '--content', '按选定来源再核对一次。', '--select', 'conversation'])
    assert.equal(sent.exit, 0, JSON.stringify(sent.result))
    assert.equal(sent.result.result.receiptStatus, 'recorded')
    contextMessage = sent.result.result.messageId as string
    const sentReplay = await run(['send', '--api', instance.api, '--api-token', apiToken, '--project', projectA, '--conversation', conversationA,
      '--content', '按选定来源再核对一次。', '--select', 'conversation', '--command-id', sent.result.result.commandId])
    assert.equal([0, 3].includes(sentReplay.exit ?? -1), true, JSON.stringify(sentReplay.result))

    const foreign = await run(['preview', '--api', instance.api, '--api-token', apiToken, '--project', projectB, '--conversation', conversationA,
      '--select', 'conversation'])
    assert.equal(foreign.exit, 3, JSON.stringify(foreign.result))

    const decided = await run(['decide', '--api', instance.api, '--api-token', apiToken, '--project', projectA, '--conversation', conversationA,
      '--message', messageA, '--content', '保留错误码 E1，不暴露内部路径。'])
    assert.equal(decided.exit, 0, JSON.stringify(decided.result))
    assert.equal(decided.result.result.receiptStatus, 'recorded')
    const decisionId = decided.result.result.decisionId as string

    const sourcesBefore = await run(['sources', '--api', instance.api, '--api-token', apiToken, '--message', contextMessage])
        assert.equal(sourcesBefore.exit, 0, JSON.stringify(sourcesBefore))
    const digestBefore = sourcesBefore.result.result.bundleDigest as string
    assert.match(digestBefore, /^[a-f0-9]{64}$/)

    const revoked = await run(['decide', '--api', instance.api, '--api-token', apiToken, '--project', projectA, '--conversation', conversationA,
      '--revoke', decisionId, '--expected-version', '1'])
    assert.equal(revoked.exit, 0, JSON.stringify(revoked.result))
    const sourcesAfterRevoke = await run(['sources', '--api', instance.api, '--api-token', apiToken, '--message', contextMessage])
    assert.equal(sourcesAfterRevoke.exit, 0, JSON.stringify(sourcesAfterRevoke.result))
    assert.equal(sourcesAfterRevoke.result.result.bundleDigest, digestBefore)

    draftFile = join(root, 'context-draft.json')
    const saved = await run(['draft', 'save', '--api', instance.api, '--api-token', apiToken, '--project', projectA,
      '--conversation', conversationA, '--select', 'conversation', '--file', draftFile])
    assert.equal(saved.exit, 0, JSON.stringify(saved.result))
    assert.equal(saved.result.result.authorization, 'none')
    assert.equal(statSync(draftFile).mode & 0o777, 0o600)
    draftRequestId = (JSON.parse(readFileSync(draftFile, 'utf8')) as { requestId: string }).requestId

    // A conversation change produces a new preview; the saved draft stays historical data.
    await instance.product.application.dispatch({ commandId: `${conversationA}-later`, conversationId: conversationA,
      kind: 'chat', projectId: projectA, text: '之后新增的一条消息。' }, actor)
    await instance.product.execution.effects.idle('application.assistant.reply')
    const changed = await run(['preview', '--api', instance.api, '--api-token', apiToken, '--project', projectA,
      '--conversation', conversationA, '--select', 'conversation'])
    assert.equal(changed.exit, 0)
    assert.notEqual(changed.result.result.requestId, draftRequestId)

    const history = await run(['history', '--api', instance.api, '--api-token', apiToken, '--work', 'missing-work'])
    assert.equal(history.exit, 3)
    const observe = await run(['observe', '--api', instance.api, '--api-token', apiToken, '--project', projectA, '--days', '7', '--export'])
    assert.equal(observe.exit, 0, JSON.stringify(observe.result))
    assert.equal(observe.result.result.observation.authorization, 'none')
  } finally { await instance.close() }

  // Reopen the same store: the original frozen sources remain readable.
  const reopened = await startInstance()
  try {
    const sources = await run(['sources', '--api', reopened.api, '--api-token', apiToken, '--message', contextMessage])
    assert.equal(sources.exit, 0, JSON.stringify(sources.result))
    const draft = await run(['draft', 'load', '--api', reopened.api, '--api-token', apiToken, '--file', draftFile])
    assert.equal(draft.exit, 0, JSON.stringify(draft.result))
    assert.equal(draft.result.result.requestId, draftRequestId)
    assert.equal(draft.result.result.authorization, 'none')
    assert.equal(typeof draft.result.result.usable, 'boolean')
    const tampered = join(root, 'context-draft-tampered.json')
    copyFileSync(draftFile, tampered)
    chmodSync(tampered, 0o644)
    const refusedDraft = await run(['draft', 'load', '--api', reopened.api, '--api-token', apiToken, '--file', tampered])
    assert.equal(refusedDraft.exit, 3, JSON.stringify(refusedDraft.result))
    const forged = join(root, 'context-draft-forged.json')
    writeFileSync(forged, JSON.stringify({ protocol: 'assistant-context-draft/1', projectId: projectA }), { mode: 0o600 })
    const forgedDraft = await run(['draft', 'load', '--api', reopened.api, '--api-token', apiToken, '--file', forged])
    assert.equal(forgedDraft.exit, 3, JSON.stringify(forgedDraft.result))
    const again = await run(['sources', '--api', reopened.api, '--api-token', apiToken, '--message', contextMessage])
    assert.equal(sources.result.result.bundleDigest, again.result.result.bundleDigest)
    assert.equal(sources.result.result.sources.length >= 1, true)
    // A readonly instance still shows the original sources but refuses new context/preview work.
    const readonly = await (async () => {
      const store = new ProductStore({ path: database })
      const productRuntime = createProductRuntime({ store, stateRoot, scratchProject: join(root, 'scratch'),
        startupMode: 'recovery_readonly', executionUnavailable: 'recovery_readonly',
        projects: [{ id: projectA, displayName: 'A', scope: scope(projectA) }, { id: projectB, displayName: 'B', scope: scope(projectB) }],
        principal, actionSecret: Buffer.alloc(32, 21) })
      const readonlyApp = createLocalHttpApp({ application: productRuntime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
        allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', startupMode: 'recovery_readonly',
        read: productRuntime.read, operations: productRuntime.operations })
      const readonlyServer = listenLocalHttp(readonlyApp, 0)
      await new Promise<void>((done) => readonlyServer.once('listening', () => done()))
      return { api: `http://127.0.0.1:${(readonlyServer.address() as AddressInfo).port}`,
        close: async () => { readonlyServer.closeAllConnections(); await new Promise<void>((done) => readonlyServer.close(() => done())); await productRuntime.close().catch(() => undefined); store.close() } }
    })()
    try {
      const readable = await run(['sources', '--api', readonly.api, '--api-token', apiToken, '--message', contextMessage])
      assert.equal(readable.exit, 0, JSON.stringify(readable.result))
      const refusedPreview = await run(['preview', '--api', readonly.api, '--api-token', apiToken, '--project', projectA,
        '--conversation', conversationA, '--select', 'conversation'])
      assert.equal(refusedPreview.exit, 3, JSON.stringify(refusedPreview.result))
      const refusedSend = await run(['send', '--api', readonly.api, '--api-token', apiToken, '--project', projectA,
        '--conversation', conversationA, '--content', 'readonly 不应发送'])
      assert.equal(refusedSend.exit, 3, JSON.stringify(refusedSend.result))
    } finally { await readonly.close() }
  } finally { await reopened.close() }
  assert.equal(model.requests.length >= 2, true)
})
