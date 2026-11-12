import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const candidate = resolve(process.argv[2] ?? '')
if(!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave13-context.mjs <C-root>')
const load = path => import(pathToFileURL(join(candidate,path)).href)
const commit = execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim()
const { ContextComposer, buildSourceManifest, compareSourceManifests, createScopedConversationProvider,
  projectSourceReview, selectRelevantSources, collectContextHistory } = await load('packages/context/src/index.ts')
const { AssistantContextBindingSchema, AssistantReplyResultSchema } = await load('packages/contracts/src/index.ts')

const at = '2026-11-12T00:00:00.000Z'
const projectId = 'project-1', conversationId = 'conversation-1', sourceMessageId = 'msg-1'
const hash = c => c.repeat(64)
const scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const secretScope = { ...scope, allowedPaths: ['private'] }
const observations = []
const observe = (id, observed, passes) => observations.push({ id, status: passes ? 'PASS' : 'FAIL', observed })
const compose = (sourceKinds, groups, sources) => new ContextComposer({
  port: { projectBaseline: async () => ({ capturedAt: at }) }, ...sources,
}, { now: () => new Date(at) }).compose({
  requestId: 'audit', projectId, conversationId, query: '', purpose: 'conversation_discussion',
  grant: { grantId: 'grant-1', projectId, gateway: 'conversation', purpose: 'conversation_discussion', scope,
    sourceKinds, maxFiles: 8, maxBytes: 65536, maxTokens: 32768, maxDurationMs: 1000, confirmedBy: 'user-1', confirmedAt: at },
  budget: { maxFiles: 8, maxSlices: 8, maxBytes: 8192, maxTokens: 4000 }, groups,
})

const selected = selectRelevantSources([{ sourceId: 'private-decision', kind: 'decision', path: 'decisions/private.json',
  content: 'SECRET payment', projectId, scope: secretScope }], { projectId, query: 'payment', allowedKinds: ['decision'] })
observe('RELEVANCE_NO_TRUSTED_SCOPE_MUST_REFUSE', { selected: selected.items.map(x => x.sourceId), complete: selected.complete }, selected.items.length === 0)

const decisions = await compose(['decision'], [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }], {
  decisions: { listEffective: async () => ({ decisions: [{ decisionId: 'private', content: 'SECRET payment', scope: secretScope,
    sourceMessageId, recordedAt: at }] }) },
})
observe('COMPOSER_SCOPE_MUST_FILTER_DECISION_BODY', { grantPaths: scope.allowedPaths,
  included: decisions.slices.map(x => ({ path: x.path, includesSecret: x.content.includes('SECRET') })) }, decisions.slices.length === 0)

const provider = createScopedConversationProvider({ page: () => ({ messages: [{ id: 'm', projectId, conversationId, sequence: 3,
  role: 'user', provenance: 'trusted_user', text: 'payment', createdAt: at }], hasMore: true }) },
  { projectId, conversationId }, { pageSize: 1, maxPages: 1 })
const conversation = await compose(['conversation_message'], [{ name: 'conversation', priority: 1, sourceKinds: ['conversation_message'], share: 1 }],
  { conversation: provider })
const manifest = buildSourceManifest(conversation)
observe('COMPOSER_MUST_PRESERVE_SCOPED_PROVIDER_INCOMPLETE', { providerCoverage: provider.coverage(),
  compositionStatus: conversation.status, groupStatus: conversation.groups[0].status,
  manifestCoverage: manifest.coverage, comparison: compareSourceManifests(manifest, manifest).status }, manifest.coverage.complete === false)

const binding = AssistantContextBindingSchema.parse({ protocol: 'assistant-context-binding/1', commandId: 'cmd-1',
  messageId: sourceMessageId, requestId: 'context-request-1', projectId, conversationId, userTextDigest: hash('a'),
  principal: { userId: 'user-1', authorityRef: 'authority-1' }, purpose: 'conversation_discussion', scope,
  selections: ['decisions'], bundleRef: 'bundle-1', bundleDigest: hash('b'), sources: [
    { sourceId: 'decision-1', kind: 'decision', sourceDigest: hash('a'), previewDigest: hash('b'), truncated: false },
  ], confirmedAt: at,
  expiresAt: '2026-11-12T00:04:00.000Z' })
const reply = AssistantReplyResultSchema.parse({ protocol: 'assistant-reply-result/1', requestId: 'foreign-request',
  requestDigest: hash('c'), sourceMessageId, replyMessageId: 'foreign-reply', projectId, conversationId,
  principal: { userId: 'foreign-user', authorityRef: 'foreign-authority' }, model: 'foreign-model',
  artifactRef: 'arbitrary-artifact', artifactDigest: hash('d'), textDigest: hash('e'), recordedAt: at })
const history = collectContextHistory({ page: () => ({ protocol: 'assistant-context-history/1', observedAt: at,
  records: [binding], hasMore: false }) }, { projectIds: [projectId], conversationId }, {
  now: () => new Date(at), replyFor: () => reply,
})
observe('HISTORY_MUST_REFUSE_FOREIGN_REPLY_PRINCIPAL', { bindingPrincipal: binding.principal, replyPrincipal: reply.principal,
  attached: history.entries[0].completedReply, mismatchedReplies: history.totals.mismatchedReplies }, history.entries[0].completedReply === undefined)

const review = projectSourceReview({ ...decisions, omitted: Array.from({ length: 5000 }, (_, i) => ({
  path: `/Users/owner/private/${i}.ts`, reason: 'missing', detail: `Cannot read /Users/owner/private/${i}.ts`,
})) }, { maxItems: 1, maxBytes: 1, maxExcerptBytes: 1 })
observe('SOURCE_REVIEW_OMISSIONS_MUST_BE_BOUNDED', { maxItems: review.budget.maxItems, omitted: review.omitted.length,
  serializedBytes: Buffer.byteLength(JSON.stringify(review)), suppressed: review.suppressed }, review.omitted.length <= review.budget.maxItems)
observe('SOURCE_REVIEW_OMISSION_DETAIL_MUST_REDACT_HOST_PATH', { first: review.omitted[0] }, !JSON.stringify(review.omitted[0]).includes('/Users/owner'))

const report = { sourceCommit: commit, observations, modelCalls: 0, nativeTurns: 0 }
const output=process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(resolve(dirname(fileURLToPath(import.meta.url)),'../..'),'reports/releases/wave13-admission/context.json')
mkdirSync(dirname(output),{recursive:true}); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = observations.some(item => item.status === 'FAIL') ? 1 : 0
