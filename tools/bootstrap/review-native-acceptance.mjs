import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ApplicationConfigurationSchema, UserCommandSchema } from '../../packages/contracts/dist/index.js'

const { values } = parseArgs({ options: { acceptance: { type: 'string' }, candidate: { type: 'string' }, report: { type: 'string' } } })
if (!values.acceptance) throw new Error('Provide --acceptance <candidate checkout>')
const checkout = resolve(values.acceptance)
if (values.candidate && !/^[a-f0-9]{7,40}$/.test(values.candidate)) throw new Error('--candidate must be a commit hash')
const candidateCommit = execFileSync('git', ['rev-parse', '--verify', values.candidate ? values.candidate + '^{commit}' : 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim()
const archive = execFileSync('git', ['archive', candidateCommit, 'tests/native-acceptance'], { cwd: checkout, maxBuffer: 4 * 1024 * 1024 })
const snapshot = mkdtempSync('/tmp/pa-acceptance-review-')
try {
  execFileSync('tar', ['-x', '-C', snapshot], { input: archive })
  symlinkSync(fileURLToPath(new URL('../../packages', import.meta.url)), join(snapshot, 'packages'))
  const { runNativeCases, selectNativeProfile } = await import(pathToFileURL(join(snapshot, 'tests/native-acceptance/cases.mjs')))
  const { CaseLog } = await import(pathToFileURL(join(snapshot, 'tests/native-acceptance/harness.mjs')))
  const configuration = ApplicationConfigurationSchema.parse({
    protocol: 'application-configuration/1', revision: 'a'.repeat(64),
    profiles: [{ id: 'profile-codex-native', revision: 1, displayName: 'Native', driverId: 'codex-native', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }],
    checks: [{ id: 'registered-check', revision: 1, displayName: 'Check' }],
    projects: [{ id: 'private-project', displayName: 'Private project', scope: { projectId: 'private-project', allowedPaths: ['.'], excludedPaths: [], externalActions: [] }, profileIds: ['profile-codex-native'], defaultProfileId: 'profile-codex-native', dispatchAllowed: true, defaultCriteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Check', checkDefinitionRef: 'registered-check' }, { id: 'human', kind: 'human', required: true, description: 'Review' }] }],
  })
  const calls = [], log = new CaseLog()
  const client = {
    async request(method, path, { body } = {}) {
      calls.push({ method, path, ...(body ? { body } : {}) })
      if (method === 'POST') return path === '/v1/commands' && body.kind === 'create_work'
        ? { status: 200, json: { status: 'recorded', commandId: body.commandId, workId: 'work-no-candidate', seq: 1 } }
        : { status: 400, json: { error: { code: 'invalid_request' } } }
      return { status: 200, json: { phase: 'needs_user', openQuestionIds: [], artifactIds: [] } }
    },
  }
  const result = await runNativeCases({ client, log, options: { runNative: true, conversationId: 'review-conversation', nativeTimeoutMs: 1 }, configuration, selection: selectNativeProfile(configuration) })
  const continued = calls.find(call => call.body?.kind === 'continue_work')
  const cases = [
    { id: 'NATIVE-NO-CANDIDATE-MUST-NOT-PASS', passesInvariant: log.cases.find(item => item.id === 'NATIVE-LINK')?.status !== 'PASS', observed: { nativeLinkStatus: log.cases.find(item => item.id === 'NATIVE-LINK')?.status, realCandidatePresent: false, returnedModelTasks: result.modelTasks } },
    { id: 'CONTINUE-COMMAND-MUST-SATISFY-SHARED-SCHEMA', passesInvariant: continued ? UserCommandSchema.safeParse(continued.body).success : true, observed: { sent: !!continued, schemaValid: continued ? UserCommandSchema.safeParse(continued.body).success : null } },
  ]
  const report = {
    status: cases.every(item => item.passesInvariant) ? 'PASS_ACCEPTANCE_GUARDS_ONLY' : 'BLOCKED_NATIVE_ACCEPTANCE_ADMISSION',
    checkedAt: new Date().toISOString(), candidateCommit,
    reviewerCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceArchiveSha256: createHash('sha256').update(archive).digest('hex'), cases, modelCalls: 0,
    scope: 'Immutable candidate archive, valid shared configuration and an in-memory fake client only; no HTTP/native/model/project operation',
  }
  if (values.report) {
    mkdirSync(dirname(values.report), { recursive: true })
    writeFileSync(values.report, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report, null, 2))
  if (!cases.every(item => item.passesInvariant)) process.exitCode = 1
} finally { rmSync(snapshot, { recursive: true, force: true }) }
