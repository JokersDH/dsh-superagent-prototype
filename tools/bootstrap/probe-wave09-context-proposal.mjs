import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const candidate = process.argv[2]
if (!candidate) throw new Error('Usage: node tools/bootstrap/probe-wave09-context-proposal.mjs <candidate-root>')
const load = path => import(pathToFileURL(resolve(candidate, path)).href)
const { ContextComposer } = await load('packages/context/src/composer.ts')
const { InMemoryAssistantState, AssistantProposalService } = await load('packages/proposals/src/index.ts')
const at = '2026-11-11T08:00:00.000Z'
const scope = { projectId: 'probe-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const results = []
for (const alias of [false, true]) {
  let reads = 0, errorCode = null, kinds = []
  const grant = { grantId: 'probe-grant', projectId: scope.projectId, gateway: 'conversation', purpose: 'conversation_discussion', scope,
    sourceKinds: [alias ? 'artifact' : 'decision'], maxFiles: 5, maxBytes: 4096, maxTokens: 4096, maxDurationMs: 1000,
    confirmedAt: at, confirmedBy: 'local-user' }
  const composer = new ContextComposer({ port: {}, decisions: { listEffective: async () => {
    reads++
    return { decisions: [{ decisionId: 'decision-probe', content: 'Keep required checks', scope, sourceMessageId: 'message-probe', recordedAt: at }] }
  } } }, { now: () => new Date(at) })
  try {
    const value = await composer.compose({ requestId: 'probe', projectId: scope.projectId, purpose: 'conversation_discussion', query: '', grant, budget: {},
      groups: [{ name: 'decisions', priority: 1, sourceKinds: grant.sourceKinds, share: 1 }] })
    kinds = value.slices.map(slice => slice.kind)
  } catch (error) { errorCode = error.code ?? error.name }
  const pass = alias ? reads === 0 && kinds.length === 0 : reads === 1 && kinds.includes('decision') && !errorCode
  results.push({ case: alias ? 'group_kind_alias' : 'group_kind_control', status: pass ? 'PASS' : 'FAIL', reads, kinds, errorCode })
}
if (typeof AssistantProposalService.prototype.confirmWithCommand !== 'function') results.push({ case: 'effect_command_binding', status: 'NOT_TESTED_HELPER_NOT_IN_THIS_INTEGRATION' })
else for (const mismatch of [false, true]) {
  const port = new InMemoryAssistantState(), service = new AssistantProposalService(port, { now: () => new Date(at) })
  const prepared = await service.prepare({ proposalId: 'proposal-probe', payload: { kind: 'propose_work', projectId: scope.projectId, goal: 'Implement', sourceMessageId: 'message-probe' },
    trusted: { actorRef: 'authority', projectId: scope.projectId, sourceMessageId: 'message-probe', grant: { grantId: 'grant', scope } },
    conversationId: 'conversation-probe', sourceTextDigest: 'a'.repeat(64) })
  service.persistPending(prepared)
  let commandId = null, errorCode = null
  try {
    const result = service.confirmWithCommand(prepared, { actorRef: 'authority', expectedVersion: 1, expectedDigest: prepared.payloadDigest,
      effectCommandId: 'effect-one', plan: { commandId: mismatch ? 'other-command' : 'effect-one', conversationId: 'conversation-probe',
        work: { scope, profileId: 'profile', criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Check', checkDefinitionRef: 'check' }] } } })
    commandId = result.command?.commandId ?? null
  } catch (error) { errorCode = error.code ?? error.name }
  const record = port.proposals.get(prepared.proposalId)
  const pass = mismatch ? !!errorCode && record.state === 'pending' && !record.effectCommandId : record.state === 'confirmed' && record.effectCommandId === commandId && !errorCode
  results.push({ case: mismatch ? 'effect_command_mismatch' : 'effect_command_control', status: pass ? 'PASS' : 'FAIL',
    state: record.state, recordedEffect: record.effectCommandId ?? null, commandId, errorCode })
}
const pass = results.every(value => value.status === 'PASS')
console.log(JSON.stringify({ status: pass ? 'PASS_CONTEXT_AND_PROPOSAL_BINDING' : 'FAIL_OR_INCOMPLETE_CONTEXT_AND_PROPOSAL_BINDING', results, modelCalls: 0, diskWrites: 0 }, null, 2))
if (!pass) process.exitCode = 1
