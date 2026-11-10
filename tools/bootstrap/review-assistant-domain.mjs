import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DecisionGovernance, InMemoryDecisionStore, StaticDecisionSourcePort } from '../../packages/knowledge/dist/index.js'

const sources = new StaticDecisionSourcePort([{ messageId: 'admission-message', conversationId: 'admission-conversation',
  projectId: 'admission-project', role: 'user', provenance: 'trusted_user', createdAt: '2026-11-10T00:00:00.000Z', textDigest: 'a'.repeat(64) }])
const governance = new DecisionGovernance(new InMemoryDecisionStore(), sources)
await governance.record({ decisionId: 'admission-decision', content: 'Explicit fixture decision',
  scope: { projectId: 'admission-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, sourceMessageId: 'admission-message' },
  { actorRef: 'admission-user', projectId: 'admission-project' })
assert.equal(await governance.isEffective('admission-decision'), true)
sources.markMissing('admission-message')
const actual = { isEffective: await governance.isEffective('admission-decision'), listCount: (await governance.listEffective('admission-project')).length }
const expected = { isEffective: false, listCount: 0 }
const passed = actual.isEffective === expected.isEffective && actual.listCount === expected.listCount
const report = { status: passed ? 'PASS_SOURCE_VALIDITY_ADMISSION' : 'FAIL_SOURCE_VALIDITY_ADMISSION', owner: 'C',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checkedAt: new Date().toISOString(),
  case: 'Missing provenance remains auditable but must not enter effective decision context', actual, expected,
  modelCalls: 0, scope: 'Independent domain probe only; production context/decision capability remains unconnected' }
const directory = resolve('reports/releases/conversation-catalog')
mkdirSync(directory, { recursive: true })
writeFileSync(resolve(directory, 'assistant-domain-admission.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!passed) process.exitCode = 1
