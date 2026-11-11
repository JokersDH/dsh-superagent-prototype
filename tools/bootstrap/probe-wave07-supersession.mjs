import { InMemoryAssistantState } from '../../packages/proposals/src/index.ts'
import { AssistantDecisionStore } from '../../packages/knowledge/src/index.ts'

const store = new AssistantDecisionStore(new InMemoryAssistantState())
const scope = { projectId: 'probe-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
for (const [id, supersedes, recordedAt] of [
  ['old-decision', undefined, '2026-11-11T00:00:00.000Z'],
  ['replacement', 'old-decision', '2026-11-11T00:01:00.000Z'],
]) store.appendSync({ decision: { id, version: 1, content: id, scope, authorityRef: 'user', ...(supersedes ? { supersedes } : {}) },
  sourceMessageId: 'probe-message', sourceConversationId: 'probe-conversation', sourceTextDigest: 'a'.repeat(64), actorRef: 'user', recordedAt })
store.revokeSync({ decisionId: 'replacement', expectedVersion: 1, revokedAt: '2026-11-11T00:02:00.000Z', actorRef: 'user' })
const singleStatus = store.getSync('old-decision')?.status
const activeIds = store.listSync({ projectId: scope.projectId, status: 'active' }).decisions.map(record => record.decision.id)
const passed = singleStatus === 'superseded' && !activeIds.includes('old-decision')
console.log(JSON.stringify({ status: passed ? 'PASS_SUPERSESSION_NO_RESURRECTION' : 'FAIL_EFFECTIVE_LIST_RESURRECTS_PREDECESSOR',
  owner: 'C', layer: 'deterministic_domain', singleStatus, activeIds, nativeTurnStarts: 0 }, null, 2))
if (!passed) process.exitCode = 1
