import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = resolve(process.argv[2] ?? '')
const helperOnly = process.argv[3] === '--helper-only'
if (!process.argv[2] || process.argv.length > 4 || (process.argv[3] && !helperOnly))
  throw new Error('Usage: node tools/bootstrap/probe-wave10-context.mjs <candidate-root> [--helper-only]')
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const load = path => import(pathToFileURL(join(candidate, path)).href)
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const hash = text => createHash('sha256').update(text).digest('hex')
const { AssistantProposalService, InMemoryAssistantState } = await load('packages/proposals/src/index.ts')
const { ContextComposer } = await load('packages/context/src/composer.ts')
const { ProductStore } = await load('packages/storage/src/index.ts')
const at = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'project-one', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [{ id: 'machine', kind: 'machine', required: true, description: 'Tests pass', checkDefinitionRef: 'check' }]
const cases = []
const check = async (id, action) => {
  let observation
  try { observation = await action(); cases.push({ id, status: 'PASS', observation }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message, ...(error.observation ? { observation: error.observation } : {}) }) }
}
function assertObserved(condition, message, observation) {
  if (!condition) { const error = new Error(message); error.observation = observation; throw error }
}

const state = new InMemoryAssistantState(), service = new AssistantProposalService(state, { now: () => new Date(at) })
const prepared = await service.prepare({ proposalId: 'proposal',
  payload: { kind: 'propose_work', projectId: scope.projectId, goal: 'Implement safely', sourceMessageId: 'source' },
  conversationId: 'conversation', sourceTextDigest: 'a'.repeat(64),
  trusted: { actorRef: 'actor', projectId: scope.projectId, sourceMessageId: 'source', grant: { grantId: 'grant', scope } } })
service.persistPending(prepared)
const confirmation = profileId => ({ actorRef: 'actor', expectedVersion: 1, expectedDigest: prepared.payloadDigest,
  effectCommandId: 'effect', plan: { commandId: 'effect', conversationId: 'conversation', work: { scope, criteria, profileId } } })
let first
if (typeof service.confirmWithCommand !== 'function') {
  cases.push({ id: 'OPTIONAL_HELPER_REMOVED', status: 'PASS', observation: { helperExported: false } })
} else {
  await check('IDENTICAL_HELPER_CONFIRMATION_POSITIVE_CONTROL', () => {
    first = service.confirmWithCommand(prepared, confirmation('profile-one'))
    const replay = service.confirmWithCommand(prepared, confirmation('profile-one'))
    assert.deepEqual(replay.command, first.command); assert.equal(replay.replayed, true)
    return { state: replay.record.state, replayed: replay.replayed, profileId: replay.command.profileId }
  })
  await check('SAME_EFFECT_ID_DIFFERENT_PLAN_BODY_CANNOT_RETURN_A_NEW_COMMAND', () => {
    let replay, errorCode
    try { replay = service.confirmWithCommand(prepared, confirmation('profile-two')) } catch (error) { errorCode = error.code ?? error.name }
    const observation = { firstProfile: first.command.profileId, replayProfile: replay?.command?.profileId,
      replayed: replay?.replayed, errorCode: errorCode ?? null }
    assertObserved(!!errorCode || JSON.stringify(replay?.command) === JSON.stringify(first.command),
      'The same effect identity returned a different executable command while claiming idempotent replay', observation)
    return observation
  })
}

if (!helperOnly) {
const root = mkdtempSync(join(tmpdir(), 'pa-wave10-context-admission-'))
const store = new ProductStore({ path: join(root, 'state.sqlite') })
try {
  const conversationId = 'shared-conversation'
  for (const [id, projectId, provenance, text] of [
    ['selected-source', scope.projectId, 'trusted_user', 'SELECTED_PROJECT_DISCUSSION'],
    ['foreign-source', 'project-two', 'trusted_user', 'FOREIGN_PROJECT_DISCUSSION'],
    ['permission-source', scope.projectId, 'question_answer_display', 'PERMISSION_ANSWER_DISPLAY'],
  ]) store.product.messages.append({ id, conversationId, projectId, role: 'user', provenance, text, sourceRefs: [], createdAt: at })
  const artifact = store.artifacts.write(Buffer.from('UNPUBLISHED_ARTIFACT'))
  store.artifacts.insert(artifact, at)
  const grant = sourceKinds => ({ grantId: 'context-grant', projectId: scope.projectId, gateway: 'conversation',
    purpose: 'conversation_discussion', scope, sourceKinds, maxFiles: 8, maxBytes: 65536, maxTokens: 8192,
    maxDurationMs: 1000, confirmedAt: at, confirmedBy: 'actor' })
  const port = { projectBaseline: async () => ({ capturedAt: at }), listSources: async () => [],
    readSource: async () => { throw new Error('No file source is selected') } }
  // These two adapters reproduce C's explicitly recommended recipe at the bound source hash below.
  const composer = new ContextComposer({ port,
    conversation: { recent: async ({ conversationId: id, limit }) => [...store.product.messages.page(id, { limit }).messages]
      .sort((left, right) => right.sequence - left.sequence).map(message => ({ messageId: message.id,
        conversationId: message.conversationId, sequence: message.sequence, role: message.role,
        provenance: message.provenance, text: message.text, createdAt: message.createdAt })) },
    artifacts: { recent: async ({ limit }) => store.workflows.index.listArtifacts({ limit }).artifacts.map(value => ({
      artifactId: value.id, digest: value.digest, bytes: value.bytes, createdAt: value.createdAt })) },
  }, { now: () => new Date(at) })
  await check('RECOMMENDED_CONVERSATION_ADAPTER_EXCLUDES_FOREIGN_PROJECT_AND_PERMISSION_DISPLAY', async () => {
    const result = await composer.compose({ requestId: 'conversation-check', projectId: scope.projectId,
      purpose: 'conversation_discussion', query: '', conversationId, grant: grant(['conversation_message']), budget: {},
      groups: [{ name: 'conversation', priority: 1, sourceKinds: ['conversation_message'], share: 1 }] })
    const text = result.slices.map(slice => slice.content).join('\n')
    const observation = { includedSelected: text.includes('SELECTED_PROJECT_DISCUSSION'),
      includedForeignProject: text.includes('FOREIGN_PROJECT_DISCUSSION'), includedPermissionDisplay: text.includes('PERMISSION_ANSWER_DISPLAY') }
    assertObserved(observation.includedSelected && !observation.includedForeignProject && !observation.includedPermissionDisplay,
      'The recommended trusted adapter does not enforce its project/provenance boundary', observation)
    return observation
  })
  await check('RECOMMENDED_ARTIFACT_ADAPTER_EXCLUDES_UNPUBLISHED_GLOBAL_REGISTRY_METADATA', async () => {
    const result = await composer.compose({ requestId: 'artifact-check', projectId: scope.projectId,
      purpose: 'conversation_discussion', query: '', conversationId, workId: 'selected-work',
      grant: grant(['artifact']), budget: {}, groups: [{ name: 'artifacts', priority: 1, sourceKinds: ['artifact'], share: 1 }] })
    const observation = { selectedWorkPublishedArtifactIds: [], globalArtifactId: artifact.id,
      includedUnpublishedArtifact: result.slices.some(slice => slice.content.includes(artifact.id)) }
    assertObserved(!observation.includedUnpublishedArtifact,
      'The recommended adapter exposes global registry metadata with no selected-work publication proof', observation)
    return observation
  })
} finally { store.close(); rmSync(root, { recursive: true, force: true }) }
}

const report = { status: cases.every(value => value.status === 'PASS')
  ? helperOnly ? 'PASS_OPTIONAL_HELPER_IDENTITY_ONLY' : 'PASS_HELPER_AND_HISTORICAL_REPRODUCTION'
  : helperOnly ? 'FAIL_OPTIONAL_HELPER_IDENTITY_ONLY' : 'FAIL_CANDIDATE_HELPER_AND_RECIPE_ADMISSION',
  mode: helperOnly ? 'helper_identity_only' : 'helper_and_fixed_historical_recipe_reproduction',
  recipeOriginalSourceHash: 'fe66ebd3b0f957e4d05cc4b804ecf5c5a0ebb6f8316d66cc1d19c616aea159a2',
  newScopedAdaptersTested: false,
  sourceRoot: candidate, sourceCommit: git(['rev-parse', 'HEAD']), sourceWorktreeClean: git(['status', '--porcelain']) === '',
  checkedAt: new Date().toISOString(), command: ['node', 'tools/bootstrap/probe-wave10-context.mjs', candidate, ...(helperOnly ? ['--helper-only'] : [])],
  exitCode: cases.every(value => value.status === 'PASS') ? 0 : 1,
  sourceHashes: Object.fromEntries(['packages/proposals/src/assistant-proposal-service.ts', 'packages/knowledge/test/main-context-consumer.case.ts']
    .map(path => [path, existsSync(join(candidate, path)) ? hash(readFileSync(join(candidate, path), 'utf8')) : null])),
  cases, modelCalls: 0, nativeTurns: 0,
  references: { helperReplay: 'packages/proposals/src/assistant-proposal-service.ts:158', helperCommand: 'packages/proposals/src/assistant-proposal-service.ts:258',
    conversationRecipe: 'packages/knowledge/test/main-context-consumer.case.ts:33', artifactRecipe: 'packages/knowledge/test/main-context-consumer.case.ts:52' },
  limitations: [
    'The optional helper is deliberately absent from main; its failure does not affect the admitted ProductProposals receipt path.',
    'The adapter negatives reproduce the recommended C test/document recipe, not a public production adapter; main already implements its own scoped adapters.',
    'The two recipe implementations are fixed historical reproductions. They cannot certify a newly repaired adapter; use --helper-only for the dynamic helper check and add an actual-export consumer for new adapters.',
    'Context providers are documented as pre-authorized; this does not claim the composer should infer artifact ownership from an unscoped registry.',
    'Temporary actual SQLite and metadata only; no user services, model/native sends, external network or current-source UI are exercised.',
  ] }
const output = join(repository, `reports/releases/wave10-admission/${helperOnly ? 'context-helper' : 'context'}.json`)
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.exitCode
