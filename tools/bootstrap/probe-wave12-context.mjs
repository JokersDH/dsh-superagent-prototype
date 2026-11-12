import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = process.argv[2] ?? '/Users/hh/Desktop/joker/superagent-agent-c'
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const load = path => import(pathToFileURL(`${root}/${path}`).href)
const {
  ContextComposer, buildSourceManifest, compareSourceManifests, projectSourceReview,
  selectRelevantSources, createConversationRelevanceCandidates, collectContextHistory,
} = await load('packages/context/src/index.ts')
const { reviewReplyCandidates } = await load('packages/proposals/src/index.ts')
const { AssistantContextBindingSchema } = await load('packages/contracts/src/index.ts')
const at = '2026-11-12T00:00:00.000Z'
const projectId = 'project-1', conversationId = 'conversation-1', sourceMessageId = 'msg-1'
const hash = char => char.repeat(64)
const scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-1', revision: 1, digest: hash('a') }
const composition = await new ContextComposer({
  port: { projectBaseline: async () => ({ capturedAt: at }) },
  decisions: { listEffective: async () => ({ decisions: [1, 2, 3].map(index => ({
    decisionId: `decision-${index}`, content: 'Keep response codes stable.', scope, sourceMessageId, recordedAt: at,
  })) }) },
}, { now: () => new Date(at) }).compose({
  requestId: 'audit', projectId, conversationId, query: '', purpose: 'conversation_discussion',
  grant: { grantId: 'grant-1', projectId, gateway: 'conversation', purpose: 'conversation_discussion', scope,
    sourceKinds: ['decision'], maxFiles: 8, maxBytes: 65536, maxTokens: 32768, maxDurationMs: 1000,
    confirmedBy: 'user-1', confirmedAt: at },
  budget: { maxFiles: 8, maxSlices: 8, maxBytes: 8192, maxTokens: 4000 },
  groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }],
})
const observations = []
const check = (id, read, verify) => {
  const observed = read()
  try { verify(observed); observations.push({ id, status: 'PASS', observed }) }
  catch (error) { observations.push({ id, status: 'FAIL', message: error.message, observed }) }
}

check('MANIFEST_DIGEST_SCOPE_MUST_CHANGE', () => {
  const before = buildSourceManifest(composition), after = structuredClone(before)
  after.sources[0].digestScope = 'prefix'
  return compareSourceManifests(before, after)
}, result => assert.notEqual(result.status, 'unchanged'))

check('SOURCE_REVIEW_MAX_ITEMS', () => {
  const result = projectSourceReview(composition, { maxItems: 1 })
  return { maxItems: result.budget.maxItems, actualItems: result.items.length }
}, result => assert.ok(result.actualItems <= result.maxItems))

check('SOURCE_REVIEW_REDACTS_OMISSION_PATH', () => {
  const result = projectSourceReview({ ...composition, omitted: [{ path: '/Users/owner/private/secret.ts', reason: 'missing' }] })
  return result.omitted[0]
}, result => assert.ok(!JSON.stringify(result).includes('/Users/owner')))

check('RELEVANCE_REQUIRES_ROLE_AND_PROVENANCE', () => {
  const result = selectRelevantSources([{ sourceId: 'unknown-origin', kind: 'conversation_message',
    path: 'conversation/1', content: 'payment', projectId }],
  { projectId, query: 'payment', allowedKinds: ['conversation_message'] })
  return { selected: result.items.map(item => item.sourceId), complete: result.complete }
}, result => assert.equal(result.selected.length, 0))

const provider = { recent: async () => [{ messageId: 'm', conversationId, sequence: 1, role: 'user',
  provenance: 'trusted_user', text: 'payment', createdAt: at }], coverage: () => ({ complete: false }) }
const candidates = await createConversationRelevanceCandidates(provider, { projectId, conversationId })
check('RELEVANCE_PRESERVES_INCOMPLETE_COVERAGE', () => {
  const result = selectRelevantSources(candidates, { projectId, query: 'payment', allowedKinds: ['conversation_message'] })
  return { upstreamComplete: provider.coverage().complete, selectedComplete: result.complete }
}, result => assert.equal(result.selectedComplete, false))

const bindings = { projectId, conversationId, sourceMessageId, grantId: 'grant-1', grantScope: scope, currentContract: contract }
const body = { protocol: 'assistant-reply-body/1', projectId, conversationId: 'foreign-conversation', sourceMessageId,
  replyMessageId: 'reply-1', model: 'mock', text: 'Old foreign reply',
  suggestions: [{ kind: 'propose_decision', scope, content: 'Foreign candidate', sourceMessageId }] }
check('REPLY_BODY_BINDS_CONVERSATION', () => {
  const result = reviewReplyCandidates(body, bindings)
  return { status: result.status, candidates: result.candidates.map(item => item.plan) }
}, result => assert.equal(result.status, 'invalid_body'))

check('REPLY_REVISION_BODY_BINDS_PROJECT', () => {
  const result = reviewReplyCandidates({ ...body, projectId: 'foreign-project', conversationId,
    suggestions: [{ kind: 'propose_revision', expected: contract, rationale: 'Foreign envelope', sourceMessageId }] }, bindings)
  return { status: result.status, candidates: result.candidates.map(item => item.plan) }
}, result => assert.equal(result.status, 'invalid_body'))

const binding = AssistantContextBindingSchema.parse({ protocol: 'assistant-context-binding/1', commandId: 'cmd-1',
  messageId: sourceMessageId, requestId: 'req-1', projectId, conversationId, userTextDigest: hash('a'),
  principal: { userId: 'user-1', authorityRef: 'authority-1' }, purpose: 'conversation_discussion', scope,
  contract: { ...contract, workId: 'other-work' }, selections: ['work'], bundleRef: 'bundle-1', bundleDigest: hash('b'),
  sources: [{ sourceId: 'source-1', kind: 'contract', sourceDigest: hash('c'), previewDigest: hash('d'), truncated: false }],
  confirmedAt: at, expiresAt: '2026-11-12T00:04:00.000Z' })
check('HISTORY_RECHECKS_WORK_QUERY', () => {
  const result = collectContextHistory({ page: () => ({ protocol: 'assistant-context-history/1', observedAt: at,
    records: [binding], hasMore: false }) }, { projectIds: [projectId], conversationId, workId: 'work-1' },
  { now: () => new Date(at) })
  return { queryWorkId: result.query.workId, entries: result.entries.map(item => ({ workId: item.contract?.workId, state: item.state })) }
}, result => assert.equal(result.entries.length, 0))

const report = { sourceRoot: root, sourceCommit: head, modelCalls: 0, nativeTurns: 0,
  passed: observations.filter(item => item.status === 'PASS').length,
  failed: observations.filter(item => item.status === 'FAIL').length, observations }
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave12-admission/context.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = observations.some(item => item.status === 'FAIL') ? 1 : 0
