import assert from 'node:assert/strict'
import { mkdirSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { key } from '../../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { CompletedAssistantReplies } from '../../../apps/coordinator/product/assistant-reply-results.ts'

const [root, mode, feature] = process.argv.slice(2)
if (!root || !['during-provider', 'after-result', 'after-message', 'recover'].includes(mode)) throw new Error('Invalid reply-process fixture arguments')
const projectRoot = join(root, 'project'), stateRoot = join(root, 'state')
mkdirSync(join(projectRoot, 'src'), { recursive: true }); mkdirSync(stateRoot, { recursive: true })
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const principal = { userId: 'process-user', authorityRef: 'process-authority' }
const scope = { projectId: 'process-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const messageId = key('message', 'process-chat'), replyId = key('assistant-reply', messageId), requestId = key('assistant-request', messageId)
let modelCalls = 0
let candidateReview
const completed = new CompletedAssistantReplies(store, store.workflows.assistant.replyResults, principal, () => [scope.projectId])
const readBody = () => { try { return completed.read(requestId) ?? null } catch { return null } }
const snapshot = () => ({ mode, modelCalls, schema: store.database.productSchema,
  requestRecorded: !!store.commands.get(requestId), result: store.workflows.assistant.replyResults.forRequest(requestId) ?? null,
  body: readBody(),
  ...(candidateReview ? { candidateReview } : {}),
  replies: store.product.messages.page('process-conversation').messages.filter(value => value.provenance === 'reasoner_reply'),
  notices: store.product.messages.page('process-conversation').messages.filter(value => value.provenance === 'application_notice') })
const emit = () => writeSync(1, JSON.stringify(snapshot()) + '\n')
const status = () => ({ protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
  model: 'process-mock', models: ['process-mock'], state: 'configured', secureTransport: true, suggestionsEnabled: feature === 'suggestions' })
const provider = { status, selectModel: status, reply: async () => {
  modelCalls++
  if (mode === 'during-provider') { emit(); process.kill(process.pid, 'SIGKILL') }
  return { text: 'Durable response from the original request.', model: 'process-mock',
    ...(feature === 'suggestions' ? { suggestions: [{ kind: 'propose_decision', content: 'Keep the original source contract.', scope, sourceMessageId: messageId }] } : {}) }
} }
const product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
  projects: [{ id: scope.projectId, scope }], actionSecret: Buffer.alloc(32, 43), assistantProvider: provider })
try {
  if (mode === 'after-result') store.db.exec("CREATE TRIGGER fail_process_reply BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'reply-process-window'); END")
  if (mode === 'recover') {
    store.db.exec('DROP TRIGGER IF EXISTS fail_process_reply')
    for (const row of store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100))
      store.queue.reschedule(row.kind, row.key, row.seq, row.generation, 0)
  } else await product.application.dispatch({ kind: 'chat', commandId: 'process-chat', conversationId: 'process-conversation',
    projectId: scope.projectId, text: 'Explain the original request.' }, { ...principal, source: 'local_cli' })
  product.execution.effects.start(); product.execution.effects.kick()
  await product.execution.effects.idle('application.assistant.reply')
  if (mode === 'after-result') {
    assert.ok(snapshot().result); assert.equal(snapshot().replies.length, 0)
  }
  if (mode === 'after-message') assert.equal(snapshot().replies.length, 1)
  if (feature === 'suggestions') candidateReview = await product.read.replyCandidates(messageId)
  emit()
  if (mode !== 'recover') process.kill(process.pid, 'SIGKILL')
} finally { await product.close(); store.close() }
