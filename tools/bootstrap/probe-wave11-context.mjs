import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = resolve(process.argv[2] ?? '')
if (!process.argv[2] || process.argv.length !== 3)
  throw new Error('Usage: node tools/bootstrap/probe-wave11-context.mjs <candidate-root>')
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const load = path => import(pathToFileURL(join(candidate, path)).href)
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const hash = value => createHash('sha256').update(value).digest('hex')
const sourceFiles = ['packages/context/src/scoped-adapters.ts', 'packages/context/src/composer.ts',
  'packages/context/src/prompt-data.ts', 'packages/proposals/src/assistant-proposal-service.ts']
const {
  createScopedConversationProvider, createPublishedArtifactProvider,
} = await load('packages/context/src/scoped-adapters.ts')
const { ContextComposer, buildSourceManifest, compareSourceManifests } = await load('packages/context/src/composer.ts')
const { projectPromptData } = await load('packages/context/src/prompt-data.ts')
const { estimateTokens } = await load('packages/context/src/tokens.ts')
const { AssistantProposalService } = await load('packages/proposals/src/index.ts')
const at = '2026-11-11T12:00:00.000Z'
const projectId = 'project-one', conversationId = 'conversation-one'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const cases = []
const check = async (id, scope, action) => {
  try { cases.push({ id, scope, status: 'PASS', observation: await action() }) }
  catch (error) { cases.push({ id, scope, status: 'FAIL', message: error.message, ...(error.observation ? { observation: error.observation } : {}) }) }
}
const observed = (condition, message, observation) => {
  if (!condition) throw Object.assign(new Error(message), { observation })
}
const message = (id, sequence, extra = {}) => ({ id, sequence, conversationId, projectId,
  role: 'user', provenance: 'trusted_user', text: id, createdAt: at, ...extra })
const reader = messages => ({ page(id, { before = Number.MAX_SAFE_INTEGER, limit = 50 } = {}) {
  const eligible = messages.filter(value => value.conversationId === id && value.sequence < before)
    .sort((a, b) => b.sequence - a.sequence)
  return { messages: eligible.slice(0, limit), hasMore: eligible.length > limit }
} })
const recent = (provider, limit = 100) => provider.recent({ projectId, conversationId, limit })
const grant = (extra = {}) => ({ grantId: 'grant', projectId, gateway: 'conversation', purpose: 'conversation_discussion', scope,
  sourceKinds: ['decision'], maxFiles: 8, maxBytes: 65536, maxTokens: 32768, maxDurationMs: 1000,
  confirmedAt: at, confirmedBy: 'local-user', ...extra })
const decision = (id = 'decision-one', content = 'Keep existing response codes.') => ({
  decisionId: id, content, scope, sourceMessageId: 'source-message', recordedAt: at,
})
const compose = (decisions = [decision()], budget = {}, providerExtra = {}) => new ContextComposer({
  port: { projectBaseline: async () => ({ capturedAt: at }), listSources: async () => [], readSource: async () => { throw new Error('No files selected') } },
  decisions: { listEffective: async () => ({ decisions }), ...providerExtra },
}, { now: () => new Date(at) }).compose({ requestId: 'comparison', projectId, conversationId,
  purpose: 'conversation_discussion', query: '', grant: grant(), budget: { maxFiles: 8, maxSlices: 8, maxBytes: 8192, maxTokens: 4000, ...budget },
  groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }] })

await check('UNCONSUMED_CONFIRM_HELPER_REMOVED', 'dynamic_candidate_helper', async () => {
  assert.equal(typeof AssistantProposalService.prototype.confirmWithCommand, 'undefined')
  return { helperExported: false }
})
await check('PROJECT_CONVERSATION_AND_PERMISSION_DISPLAY_FILTER_POSITIVE_CONTROL', 'actual_conversation_adapter', async () => {
  const provider = createScopedConversationProvider({ page: () => ({ hasMore: false, messages: [
    message('selected', 4), message('foreign-project', 3, { projectId: 'other-project' }),
    message('foreign-conversation', 2, { conversationId: 'other-conversation' }),
    message('permission-display', 1, { provenance: 'question_answer_display', anchor: { questionId: 'question' } }),
  ] }) }, { projectId, conversationId })
  const result = await recent(provider)
  assert.deepEqual(result.map(value => value.messageId), ['selected'])
  return { included: result.map(value => value.messageId), coverage: provider.coverage() }
})
await check('TRUSTED_DISCUSSION_QUESTION_ANCHOR_IS_NOT_REUSABLE_CONTEXT', 'main_compatibility_conversation_boundary', async () => {
  const result = await recent(createScopedConversationProvider(reader([
    message('selected', 2), message('auth-answer', 1, { anchor: { questionId: 'authentication-question' } }),
  ]), { projectId, conversationId }))
  observed(!result.some(value => value.messageId === 'auth-answer'),
    'The existing main boundary excludes question anchors regardless of provenance', { included: result.map(value => value.messageId) })
})
await check('NO_SELECTED_WORK_EXCLUDES_ALL_WORK_SUPPLEMENTS', 'main_compatibility_conversation_boundary', async () => {
  const result = await recent(createScopedConversationProvider(reader([
    message('discussion', 2), message('private-work-input', 1, { anchor: { workId: 'other-work' } }),
  ]), { projectId, conversationId }))
  observed(!result.some(value => value.messageId === 'private-work-input'),
    'A general discussion cannot inherit an arbitrary work supplement', { included: result.map(value => value.messageId) })
})
await check('SELECTED_WORK_EXCLUDES_OTHER_WORK_POSITIVE_CONTROL', 'actual_conversation_adapter', async () => {
  const result = await recent(createScopedConversationProvider(reader([
    message('selected', 3, { anchor: { workId: 'selected-work' } }),
    message('other', 2, { anchor: { workId: 'other-work' } }), message('general', 1),
  ]), { projectId, conversationId, workId: 'selected-work' }))
  assert.deepEqual(result.map(value => value.messageId), ['selected', 'general'])
  return { included: result.map(value => value.messageId) }
})
await check('VALID_REASONER_REPLY_IS_RETAINED_WITH_MATCHING_ROLE', 'main_compatibility_conversation_boundary', async () => {
  const result = await recent(createScopedConversationProvider(reader([
    message('user', 2), message('reasoner', 1, { role: 'assistant', provenance: 'reasoner_reply' }),
  ]), { projectId, conversationId }))
  observed(result.some(value => value.messageId === 'reasoner'),
    'The current main provider includes legitimate assistant/reasoner replies', { included: result.map(value => value.messageId) })
})
await check('BOUNDED_SCAN_EXPOSES_INCOMPLETE_COVERAGE', 'actual_conversation_adapter', async () => {
  const provider = createScopedConversationProvider(reader(Array.from({ length: 10 }, (_, i) => message(`source-${i}`, i + 1))),
    { projectId, conversationId }, { pageSize: 2, maxPages: 1 })
  const result = await recent(provider)
  assert.equal(result.length, 2); assert.equal(provider.coverage().complete, false)
  return provider.coverage()
})
await check('MAIN_CUTOFF_WRAPPER_CAN_EXCLUDE_LATER_OWN_MESSAGES', 'integration_requires_trusted_reader_wrapper', async () => {
  const underlying = reader([message('original-source', 1), message('subsequent-own-message', 2)])
  const conversationThrough = 1
  const provider = createScopedConversationProvider({ page: (id, input) => underlying.page(id,
    { ...input, before: Math.min(input.before ?? Number.MAX_SAFE_INTEGER, conversationThrough + 1) }) }, { projectId, conversationId })
  const result = await recent(provider)
  assert.deepEqual(result.map(value => value.messageId), ['original-source'])
  return { included: result.map(value => value.messageId), nativeCutoffFieldAvailable: false,
    requirement: 'Main must keep the trusted reader cutoff wrapper; this factory has no cutoff selection field' }
})
await check('ARTIFACTS_LOOK_UP_ONLY_PUBLISHED_IDS_POSITIVE_CONTROL', 'actual_artifact_adapter', async () => {
  const looked = []
  const provider = createPublishedArtifactProvider({ get: id => { looked.push(id); return { id, digest: 'a'.repeat(64), bytes: 10, createdAt: at } } },
    { publishedArtifactIds: ['published', 'published'] })
  const result = await provider.recent({ projectId, limit: 10 })
  assert.deepEqual(looked, ['published']); assert.deepEqual(result.map(value => value.artifactId), ['published'])
  return { looked, coverage: provider.coverage() }
})
await check('MAX_IDS_CAPS_LOOKUPS_EVEN_WHEN_METADATA_IS_MISSING', 'actual_artifact_adapter_budget', async () => {
  let lookups = 0
  const provider = createPublishedArtifactProvider({ get: () => { lookups++; return undefined } },
    { publishedArtifactIds: Array.from({ length: 100 }, (_, i) => `missing-${i}`) }, { maxIds: 2 })
  await provider.recent({ projectId, limit: 10 })
  observed(lookups <= 2, 'maxIds currently limits successful results but does not bound unsuccessful metadata lookups',
    { lookups, maxIds: 2, coverage: provider.coverage() })
})
await check('EXPIRED_GRANT_REFUSES_BEFORE_PROVIDER_READ', 'existing_composer_authorization', async () => {
  let reads = 0
  const composer = new ContextComposer({ port: {}, decisions: { listEffective: async () => { reads++; return { decisions: [decision()] } } } },
    { now: () => new Date('2026-11-11T12:01:00.000Z') })
  await assert.rejects(composer.compose({ requestId: 'expired', projectId, purpose: 'conversation_discussion', query: '',
    grant: grant({ expiresAt: '2026-11-11T12:00:01.000Z' }), budget: {},
    groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }] }), error => error.code === 'grant_expired')
  assert.equal(reads, 0); return { reads }
})
await check('MANIFEST_CONTENT_SELECTION_AND_INCOMPLETE_CHANGES_POSITIVE_CONTROL', 'actual_manifest_comparison', async () => {
  const base = buildSourceManifest(await compose()), bodyChanged = buildSourceManifest(await compose([decision('decision-one', 'Changed constraint')]))
  assert.equal(compareSourceManifests(base, bodyChanged).status, 'changed')
  const incomplete = structuredClone(base); incomplete.coverage.complete = false
  assert.equal(compareSourceManifests(base, incomplete).status, 'incomplete')
  const foreign = structuredClone(base); foreign.selection.conversationId = 'other-conversation'
  assert.notEqual(compareSourceManifests(base, foreign).status, 'unchanged')
  return { content: 'changed', partial: 'incomplete', selection: 'non_unchanged' }
})
await check('SOURCE_ID_REPLACEMENT_CANNOT_BE_UNCHANGED_AT_SAME_PATH', 'actual_manifest_identity', async () => {
  const base = buildSourceManifest(await compose()), replacement = structuredClone(base)
  replacement.sources[0].sourceId = 'replacement-source-id'
  const result = compareSourceManifests(base, replacement)
  observed(result.status !== 'unchanged', 'A different source identity at the same path/content is reported unchanged',
    { oldId: base.sources[0].sourceId, newId: replacement.sources[0].sourceId, comparison: result })
})
await check('ACTUAL_BUDGET_CHANGE_CANNOT_BE_UNCHANGED_WITHOUT_CLAMP', 'actual_manifest_budget', async () => {
  const first = await compose([decision()], { maxBytes: 8192 }), second = await compose([decision()], { maxBytes: 4096 })
  const result = compareSourceManifests(buildSourceManifest(first), buildSourceManifest(second))
  observed(result.status !== 'unchanged', 'The manifest carries clamp labels but loses the actual resolved budget',
    { firstBudget: first.budget, secondBudget: second.budget, comparison: result })
})
await check('PROMPT_UTF8_BYTES_INCLUDE_THE_FINAL_SEPARATOR', 'actual_prompt_hard_budget', async () => {
  const composed = await compose([decision('decision-one', 'x'.repeat(1000))])
  const complete = projectPromptData(composed, { maxBytes: 65536, maxTokens: 10000 })
  const headBytes = Buffer.byteLength(complete.text.slice(0, complete.text.indexOf('\n') + 1)), maxBytes = headBytes + 8
  const result = projectPromptData(composed, { maxBytes, maxTokens: 10000 })
  observed(Buffer.byteLength(result.text) <= maxBytes, 'The final newline is appended after the byte cap was allocated',
    { maxBytes, actualBytes: Buffer.byteLength(result.text), reportedBytes: result.totals.bytes })
})
await check('PROMPT_TOKEN_ESTIMATE_COVERS_THE_COMPLETE_SERIALIZED_TEXT', 'actual_prompt_hard_budget', async () => {
  for (const id of ['d', 'dd', 'ddd', 'dddd']) {
    const composed = await compose([decision(id, 'x'.repeat(1000))])
    const complete = projectPromptData(composed, { maxBytes: 65536, maxTokens: 10000 })
    const head = complete.text.slice(0, complete.text.indexOf('\n') + 1), maxTokens = estimateTokens(head) + 1
    const result = projectPromptData(composed, { maxBytes: 65536, maxTokens })
    observed(estimateTokens(result.text) <= maxTokens && result.totals.tokens >= estimateTokens(result.text),
      'The full text including final separators exceeds or is undercounted by the declared token estimate',
      { decisionId: id, maxTokens, actualEstimatedTokens: estimateTokens(result.text), reportedTokens: result.totals.tokens })
  }
})
await check('PROMPT_REFERENCES_PRESERVE_UPSTREAM_TRUNCATION', 'actual_prompt_provenance', async () => {
  const composed = await compose([decision('long', 'x'.repeat(1000))], { maxTokens: 100 })
  assert.equal(composed.slices[0].truncated, true)
  const projected = projectPromptData(composed, { maxBytes: 65536, maxTokens: 10000 })
  observed(projected.references[0].truncated && projected.truncated,
    'An already truncated source becomes non-truncated in projection references',
    { sourceTruncated: composed.slices[0].truncated, projectedReference: projected.references[0], projectionTruncated: projected.truncated })
})

const failed = cases.filter(value => value.status === 'FAIL').length
const report = { status: failed ? 'FAIL_CANDIDATE_SCOPED_EXPORT_ADMISSION' : 'PASS_CANDIDATE_SCOPED_EXPORT_ADMISSION',
  command: ['node', 'tools/bootstrap/probe-wave11-context.mjs', candidate],
  sourceRoot: candidate, sourceCommit: git(['rev-parse', 'HEAD']), publishedSource: git(['rev-parse', 'origin/codex/g3-assistant-context']),
  baseCommit: git(['merge-base', 'HEAD', 'origin/main']),
  sourceWorktreeClean: git(['status', '--porcelain', '--', ...sourceFiles]) === '',
  unrelatedLockDiffPreserved: git(['status', '--porcelain', '--', 'pnpm-lock.yaml']) !== '',
  sourceHashes: Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(join(candidate, path)))])),
  checkedAt: new Date().toISOString(), exitCode: failed ? 1 : 0, passed: cases.length - failed, failed, cases,
  historicalIndependentOwnedTests: { context: { passed: 78, exitCode: 0 }, proposals: { passed: 26, exitCode: 0 },
    knowledge: { passed: 75, exitCode: 0 }, contextTypecheck: { exitCode: 0 }, proposalsTypecheck: { exitCode: 0 }, contextBuild: { exitCode: 0 },
    historicalGrant: { passed: 4, exitCode: 0 }, historicalGroupBinding: { passed: 2, notTestedHelperRemoved: 1, exitCode: 1 } },
  historicalSourceReferences: {
    conversationQuestionAndWorkAnchors: 'packages/context/src/scoped-adapters.ts:118',
    conversationRoleProvenance: 'packages/context/src/scoped-adapters.ts:122',
    artifactLookupBudget: 'packages/context/src/scoped-adapters.ts:208',
    manifestSourceIdentity: 'packages/context/src/composer.ts:1081',
    manifestResolvedBudget: 'packages/context/src/composer.ts:1115',
    promptSeparatorBudget: 'packages/context/src/prompt-data.ts:139',
    promptUpstreamTruncation: 'packages/context/src/prompt-data.ts:149',
  },
  modelCalls: 0, nativeTurns: 0,
  limitations: [
    'Actual candidate exported adapters, manifest comparison, prompt projection and composer are called directly; historical fixed recipe implementations are not used.',
    'These candidate modules are not integrated into the current main per-message flow; its private scoped adapters and full preview fingerprint remain authoritative.',
    'No model/native, user service, production database, installer or new authorization is exercised.',
    'The cutoff positive control uses a trusted main-side reader wrapper because the candidate selection type has no native cutoff field.',
    'Artifact identity sets are trusted caller inputs; tests do not ask this adapter to infer ownership from a global registry.',
    'Only this new probe and its own report are written; unrelated candidate lockfile changes are preserved.',
  ] }
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave11-admission/context.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.exitCode
