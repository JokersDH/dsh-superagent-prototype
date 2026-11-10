import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore, canonicalDigest } from '../../packages/storage/dist/index.js'
import { createWorkflowPorts } from '../../packages/workflows/dist/index.js'
import { AssistantProposalService } from '../../packages/proposals/dist/index.js'
import { AssistantDecisionStore, DecisionGovernance } from '../../packages/knowledge/dist/index.js'

const { values } = parseArgs({ options: { output: { type: 'string', default: 'reports/releases/assistant-storage/admission.json' } } })
const root = mkdtempSync(join(tmpdir(), 'pa-assistant-consumer-')), file = join(root, 'state.sqlite')
let store = new ProductStore({ path: file }), ports = createWorkflowPorts(store)
const scope = { projectId: 'consumer-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const actor = { actorRef: 'consumer-user', projectId: scope.projectId, grantScope: scope }, cases = []
store.product.messages.append({ id: 'consumer-message', conversationId: 'consumer-conversation', projectId: scope.projectId,
  role: 'user', provenance: 'trusted_user', text: 'Explicitly retain this decision', sourceRefs: [], createdAt: new Date().toISOString() })
const sources = { async getMessage(id) {
  const value = ports.index.sourceMessage(id, [scope.projectId])
  return value && { messageId: value.id, conversationId: value.conversationId, projectId: value.projectId,
    role: value.role, provenance: value.provenance, createdAt: value.createdAt, textDigest: value.textDigest }
} }
const governance = () => new DecisionGovernance(new AssistantDecisionStore(ports.assistant), sources)
const decision = { decisionId: 'consumer-decision', content: 'Explicit reusable decision', scope, sourceMessageId: 'consumer-message' }
let prepared
const check = async (id, run, owner = 'integration') => {
  try { await run(); cases.push({ id, owner, status: 'PASS' }) }
  catch (error) { cases.push({ id, owner, status: 'FAIL', error: error.message, code: error.code ?? error.constructor.name }) }
}
try {
  await check('PENDING-PROPOSAL-REAL-SQLITE', async () => {
    const service = new AssistantProposalService(ports.assistant), source = await sources.getMessage('consumer-message')
    prepared = await service.prepare({ proposalId: 'consumer-proposal', payload: { kind: 'propose_work', projectId: scope.projectId,
      goal: 'No actual execution', sourceMessageId: 'consumer-message' }, trusted: { actorRef: actor.actorRef, projectId: scope.projectId,
      grant: { grantId: 'consumer-grant', scope }, sourceMessageId: 'consumer-message' }, conversationId: 'consumer-conversation', sourceTextDigest: source.textDigest })
    assert.equal(ports.assistant.proposals.get(prepared.proposalId), undefined)
    store.uow.atomic(() => service.persistPending(prepared))
    assert.equal(ports.assistant.proposals.get(prepared.proposalId).state, 'pending')
  })
  const commitInput = () => ({ expectedVersion: 1, expectedDigest: prepared.payloadDigest, actorRef: actor.actorRef,
    effectCommandId: 'consumer-effect', revalidate: () => ({ ok: ports.index.sourceMessage(prepared.sourceMessageId, [scope.projectId])?.textDigest === prepared.sourceTextDigest }), barrier: () => ({ ok: true }) })
  await check('CONFIRM-RECEIPT-FAILURE-ROLLS-BACK-REAL-SQLITE', async () => {
    const service = new AssistantProposalService(ports.assistant)
    store.db.exec("CREATE TRIGGER reject_consumer_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id = 'consumer-effect' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
    assert.throws(() => store.uow.atomic(() => {
      service.commit(prepared, commitInput())
      store.commands.record('consumer-effect', canonicalDigest({ proposalId: prepared.proposalId }), () => ({ status: 'recorded' }))
    }))
    assert.equal(ports.assistant.proposals.get(prepared.proposalId).state, 'pending')
    assert.equal(store.commands.get('consumer-effect'), undefined)
    store.db.exec('DROP TRIGGER reject_consumer_receipt')
  })
  await check('CONFIRM-REOPEN-AND-REPLAY-REAL-SQLITE', async () => {
    const service = new AssistantProposalService(ports.assistant)
    store.uow.atomic(() => {
      service.commit(prepared, commitInput())
      store.commands.record('consumer-effect', canonicalDigest({ proposalId: prepared.proposalId }), () => ({ status: 'recorded' }))
    })
    store.close(); store = new ProductStore({ path: file }); ports = createWorkflowPorts(store)
    const reopened = new AssistantProposalService(ports.assistant)
    const result = store.uow.atomic(() => reopened.commit(prepared, commitInput()))
    assert.equal(result.replayed, true)
    assert.equal(ports.assistant.proposals.history(prepared.proposalId).length, 2)
    assert.equal(ports.assistant.proposals.get(prepared.proposalId).effectCommandId, 'consumer-effect')
  })
  await check('DECISION-PROVENANCE-REAL-SQLITE', async () => {
    const result = await governance().record(decision, actor)
    assert.equal(result.record.status, 'active')
    assert.equal(await governance().isEffective(decision.decisionId), true)
    assert.equal(ports.assistant.decisions.get(decision.decisionId).sourceMessageId, 'consumer-message')
  })
  await check('DECISION-DOMAIN-REPLAY-OVER-STORAGE', async () => {
    const result = await governance().record(decision, actor)
    assert.equal(result.idempotent, true)
    assert.equal(ports.assistant.decisions.history(decision.decisionId).length, 1)
  }, 'C')
  await check('DECISION-REVOKE-AND-REOPEN-REAL-SQLITE', async () => {
    await governance().revoke(decision.decisionId, 1, actor)
    store.close(); store = new ProductStore({ path: file }); ports = createWorkflowPorts(store)
    assert.equal(await governance().isEffective(decision.decisionId), false)
    assert.equal(ports.assistant.decisions.history(decision.decisionId).length, 2)
  })
  await check('SOURCE-INVALIDATION-EXCLUDES-PERSISTED-DECISION', async () => {
    const input = { ...decision, decisionId: 'missing-source-decision' }
    await governance().record(input, actor)
    const missing = new DecisionGovernance(new AssistantDecisionStore(ports.assistant), { async getMessage() { return undefined } })
    assert.equal(await missing.isEffective(input.decisionId), false)
    assert.equal((await missing.listEffective(scope.projectId)).length, 0)
    assert.ok(ports.assistant.decisions.get(input.decisionId), 'Audit record is preserved')
  })
} finally { store.close(); rmSync(root, { recursive: true, force: true }) }
const report = { status: cases.every(value => value.status === 'PASS') ? 'PASS_SQLITE_ASSISTANT_CONSUMER' : 'FAIL_SQLITE_ASSISTANT_CONSUMER',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checkedAt: new Date().toISOString(),
  modelCalls: 0, actualBusinessEffects: 0, cases,
  limitations: ['Real temporary SQLite and production A/C ports; no HTTP/model/UI production enablement',
    'Atomic proposal consumer records a fixture command receipt, without executing a coding or model task'] }
const output = resolve(values.output); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2)); if (report.status !== 'PASS_SQLITE_ASSISTANT_CONSUMER') process.exitCode = 1
