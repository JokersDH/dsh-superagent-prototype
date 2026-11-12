#!/usr/bin/env node
/**
 * E-owned independent-process fixture for the A18 durable reply result.
 * It uses the current product runtime, real SQLite/store/effect queue and a loopback mock provider.
 * No in-process Map result port is accepted; each mode is a separate OS process.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { key } from '../../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'

const [root, mode] = process.argv.slice(2)
if (!root || !['during-provider', 'after-result', 'after-message', 'recover'].includes(mode))
  throw new Error('Invalid reply process arguments')
const projectRoot = join(root, 'project'), stateRoot = join(root, 'state')
mkdirSync(join(projectRoot, 'src'), { recursive: true }); mkdirSync(stateRoot, { recursive: true })
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const principal = { userId: 'w12-process-user', authorityRef: 'w12-process-authority' }
const scope = { projectId: 'w12-process-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const messageId = key('message', 'w12-process-chat')
const requestId = key('assistant-request', messageId)
let modelCalls = 0
const messages = () => store.product.messages.page('w12-process-conversation').messages
const snapshot = () => ({ mode, modelCalls, schema: store.database.productSchema,
  requestRecorded: !!store.commands.get(requestId),
  result: store.workflows.assistant.replyResults.forRequest(requestId) ?? null,
  replies: messages().filter(value => value.provenance === 'reasoner_reply'),
  notices: messages().filter(value => value.provenance === 'application_notice') })
const emit = () => writeSync(1, JSON.stringify(snapshot()) + '\n')
const status = () => ({ protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
  model: 'w12-mock', models: ['w12-mock'], state: 'configured', secureTransport: true })
const provider = { status, selectModel: status, reply: async () => {
  modelCalls++
  if (mode === 'during-provider') { emit(); process.kill(process.pid, 'SIGKILL') }
  return { text: 'W12 durable response from the original request.', model: 'w12-mock' }
} }
const product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
  projects: [{ id: scope.projectId, scope }], actionSecret: Buffer.alloc(32, 44), assistantProvider: provider })
try {
  if (mode === 'after-result')
    store.db.exec("CREATE TRIGGER fail_w12_reply BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'w12-reply-window'); END")
  if (mode === 'recover') {
    store.db.exec('DROP TRIGGER IF EXISTS fail_w12_reply')
    for (const row of store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100))
      store.queue.reschedule(row.kind, row.key, row.seq, row.generation, 0)
  } else {
    await product.application.dispatch({ kind: 'chat', commandId: 'w12-process-chat', conversationId: 'w12-process-conversation',
      projectId: scope.projectId, text: 'W12 original request.' }, { ...principal, source: 'local_cli' })
  }
  product.execution.effects.start(); product.execution.effects.kick()
  await product.execution.effects.idle('application.assistant.reply')
  if (mode === 'after-result') {
    assert.ok(snapshot().result)
    assert.equal(snapshot().replies.length, 0)
  }
  if (mode === 'after-message') assert.equal(snapshot().replies.length, 1)
  emit()
  if (mode !== 'recover') process.kill(process.pid, 'SIGKILL')
} finally {
  await product.close(); store.close()
}
