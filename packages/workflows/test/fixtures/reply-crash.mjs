/**
 * Wave-11 A8 crash fixture. It commits real rows and SIGKILLs itself at the named window; the parent
 * reopens the same SQLite file and proves what survived without a second send.
 */
import { createHash } from 'node:crypto'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { key } from '../../../../packages/orchestrator-core/dist/index.js'

const [path, mode] = process.argv.slice(2)
if (!path || !mode) throw new Error('Usage: reply-crash.mjs <db> <before-result|after-result|after-message|source-before|source-after>')
const at = '2026-11-12T00:00:00.000Z', principal = { userId: 'user-1', authorityRef: 'authority-1' }
const sha = text => createHash('sha256').update(text).digest('hex')
const store = new ProductStore({ path })
if (mode === 'source-before' || mode === 'source-after') {
  store.product.works.insert({ id: 'crash-work', projectId: 'project-1', conversationId: 'conversation-1', title: 'Crash source', createdAt: at })
  if (mode === 'source-before') process.kill(process.pid, 'SIGKILL')
  const { RecoveryIntentCommitter } = await import('../../../../apps/coordinator/product/recovery-intents.ts')
  const intent = { protocol: 'recovery-activation-intent/1', activationId: 'crash-activation', commandId: 'crash-command',
    planId: 'crash-plan', planDigest: 'b'.repeat(64),
    source: { stateId: 'source', stateRoot: '/tmp/source', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
    target: { generationId: 'generation', stateRoot: '/tmp/target', configurationDigest: 'e'.repeat(64) },
    principal, machineDigest: 'f'.repeat(64), resourcePolicyDigest: 'a'.repeat(64),
    createdAt: at, expiresAt: '2026-11-12T00:05:00.000Z' }
  new RecoveryIntentCommitter(store, store.workflows.recoveryActivations, principal, () => {}, () => at)
    .commit(intent, { ...principal, source: 'local_ui' })
  process.kill(process.pid, 'SIGKILL')
}
const messageId = 'crash-source', replyId = key('assistant-reply', messageId), requestId = key('assistant-request', messageId)
store.product.messages.append({ id: messageId, conversationId: 'conversation-1', projectId: 'project-1', role: 'user',
  provenance: 'trusted_user', text: 'Explain the crash window.', sourceRefs: [], createdAt: at })
const inference = { kind: 'assistant-inference/1', input: { messageId, projectId: 'project-1', conversationId: 'conversation-1' }, model: 'mock-model' }
const receipt = store.commands.record(requestId, sha('request'), () => inference)
const body = { protocol: 'assistant-reply-body/1', projectId: 'project-1', conversationId: 'conversation-1',
  sourceMessageId: messageId, replyMessageId: replyId, model: 'mock-model', text: 'Completed before the crash.', suggestions: [] }
const artifact = store.artifacts.write(Buffer.from(JSON.stringify(body)))
store.uow.atomic(() => {
  store.artifacts.insert(artifact)
  store.workflows.assistant.replyResults.put({ protocol: 'assistant-reply-result/1', requestId,
    requestDigest: receipt.result === undefined ? '' : store.commands.get(requestId).payloadDigest,
    sourceMessageId: messageId, replyMessageId: replyId, projectId: 'project-1', conversationId: 'conversation-1',
    principal, model: 'mock-model', artifactRef: artifact.id, artifactDigest: artifact.digest,
    textDigest: sha(body.text), recordedAt: at })
  if (mode === 'before-result') process.kill(process.pid, 'SIGKILL')
})
if (mode === 'after-message') {
  // Simulate the reply message commit before the crash; the result already exists.
  store.product.messages.append({ id: replyId, conversationId: 'conversation-1', projectId: 'project-1', role: 'assistant',
    provenance: 'reasoner_reply', text: body.text, sourceRefs: [messageId], createdAt: at })
}
process.kill(process.pid, 'SIGKILL')
