import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct } from '../../apps/coordinator/product/runtime.ts'

if (!process.argv.includes('--execute'))
  throw new Error('Use --execute for an authorized real model task in a private temporary project')
const root = mkdtempSync('/tmp/pa-native-product-'),
  stateRoot = join(root, 'state'),
  project = join(root, 'project')
mkdirSync(stateRoot, { mode: 0o700 })
mkdirSync(project, { mode: 0o700 })
mkdirSync(join(project, 'test'))
const git = (args) => execFileSync('git', args, { cwd: project, stdio: 'pipe', encoding: 'utf8' }).trim()
git(['init', '-q'])
writeFileSync(
  join(project, 'package.json'),
  JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --test' } }),
)
const acceptance =
  "import test from 'node:test';import assert from 'node:assert/strict';import {slugify} from '../src/slugify.mjs';test('normalization',()=>{assert.equal(slugify(' Hello, World! '),'hello-world');assert.equal(slugify('A   B'),'a-b');assert.equal(slugify('---'),'')});\n"
writeFileSync(join(project, 'test/acceptance.test.mjs'), acceptance)
git(['add', 'package.json', 'test/acceptance.test.mjs'])
git([
  '-c',
  'user.name=Native MVP Fixture',
  '-c',
  'user.email=fixture@localhost',
  'commit',
  '-qm',
  'Native MVP acceptance baseline',
])
const base = git(['rev-parse', 'HEAD'])
const executable = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim()
const scope = { projectId: 'native-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
const check = {
  id: 'native-node-tests',
  revision: 1,
  title: 'Node test suite',
  executable: process.execPath,
  argv: ['--test'],
  deadlineMs: 30000,
  outputLimitBytes: 100000,
}
const profile = {
  id: 'profile-codex-native',
  revision: 1,
  driverId: 'codex-native',
  driverApiMajor: 1,
  driverRelease: '0.1.0-native-mvp',
  executable,
  argv: ['app-server', '--disable', 'apps', '-c', 'mcp_servers={}'],
  expectedVersion: execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(),
  nativeConfigRef: 'codex-operator-settings',
  permissionPolicyRevision: 'codex-worktree-1',
  requiredFeatures: [],
}
const options = {
  principal: { userId: 'native-smoke-user', authorityRef: 'native-smoke-authority' },
  projects: [{ id: scope.projectId, displayName: 'Native MVP scratch', scope }],
  actionSecret: Buffer.alloc(32, 1),
  stateRoot,
  scratchProject: project,
  native: { profile, projects: [{ id: scope.projectId, path: project, check }], approvalPolicy: 'on-request' },
}
const actor = { ...options.principal, source: 'local_cli' }
let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }),
  product = createControlledProduct({ ...options, store })
const cases = [],
  started = Date.now()
const read = (workId) => product.application.inspect({ workId, conversationId: 'native-smoke' })
const until = async (workId, predicate) => {
  let snapshot
  while (Date.now() - started < 180000) {
    snapshot = await read(workId)
    if (predicate(snapshot)) return snapshot
    const attempt = snapshot.works[0]?.links[0] && store.bindings.current(snapshot.works[0].links[0].ticketId)
    const diagnostics =
      attempt && store.observations.forAttempt(attempt.attemptId).filter((item) => item.kind === 'runtime.error')
    if (diagnostics?.length) {
      const payload = await store.payloads.read(diagnostics[0].payloadRef)
      throw new Error(JSON.stringify(payload.value).replace(/sk-[A-Za-z0-9_-]+/g, '<REDACTED>'))
    }
    const parked = store.queue.parked('application.execute')
    if (parked.length)
      throw new Error(`Native dispatch held: ${JSON.stringify(parked).replace(/sk-[A-Za-z0-9_-]+/g, '<REDACTED>')}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Native product timeout: ${JSON.stringify(snapshot)}`)
}
try {
  product.start()
  const configuration = await product.read.configuration()
  assert.equal(configuration.profiles.find((item) => item.id === profile.id).dispatchAllowed, true)
  const created = await product.application.dispatch(
    {
      commandId: 'native-create',
      conversationId: 'native-smoke',
      kind: 'create_work',
      projectId: scope.projectId,
      goal: 'Implement src/slugify.mjs exporting slugify(text). Lowercase ASCII letters and digits; replace each run of other characters with one hyphen and trim leading/trailing hyphens. Create the missing src directory. Run node --test. Do not modify test/acceptance.test.mjs, package.json, or Git metadata. You may add additional tests. No network or external actions.',
      scope,
      criteria: [
        {
          id: 'project-tests',
          kind: 'machine',
          required: true,
          description: 'Existing acceptance tests pass unchanged',
          checkDefinitionRef: check.id,
        },
        { id: 'human-review', kind: 'human', required: true, description: 'Review current patch' },
      ],
      profileId: profile.id,
    },
    actor,
  )
  assert.equal(created.status, 'recorded')
  cases.push({ id: 'NATIVE-DELEGATION', status: 'PASS' })
  console.log(JSON.stringify({ stage: 'delegated', root, workId: created.workId }))
  const verified = await until(created.workId, (snapshot) => !!snapshot.works[0]?.actions.currentVerificationId)
  const work = verified.works[0],
    verification = await product.read.verification(work.actions.currentVerificationId)
  assert.equal(verification.results.find((item) => item.criterionId === 'project-tests').outcome, 'PASS')
  cases.push({ id: 'REAL-CODE-AND-REGISTERED-CHECK', status: 'PASS' })
  const attempt = store.bindings.current(work.links[0].ticketId)
  assert.equal(
    readFileSync(join(product.workspaces.attemptPath(attempt.attemptId), 'test/acceptance.test.mjs'), 'utf8'),
    acceptance,
  )
  assert.equal(git(['rev-parse', 'HEAD']), base)
  assert.equal(git(['status', '--porcelain']), '')
  cases.push({ id: 'USER-WORKTREE-AND-ACCEPTANCE-PRESERVED', status: 'PASS' })
  const accepted = await product.application.dispatch(
    {
      commandId: 'native-accept',
      conversationId: 'native-smoke',
      kind: 'accept_candidate',
      candidate: work.actions.currentCandidate,
    },
    actor,
  )
  assert.equal(accepted.status, 'recorded')
  assert.equal((await read(created.workId)).works[0].phase, 'delivered')
  cases.push({ id: 'VERIFIED-CANDIDATE-HUMAN-ACCEPTANCE', status: 'PASS' })
  const factCount = store.facts.count?.()
  await product.close()
  store.close()
  store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  product = createControlledProduct({ ...options, store })
  product.start()
  const reopened = await read(created.workId)
  assert.equal(reopened.works[0].phase, 'delivered')
  assert.deepEqual(
    await product.application.dispatch(
      {
        commandId: 'native-accept',
        conversationId: 'native-smoke',
        kind: 'accept_candidate',
        candidate: work.actions.currentCandidate,
      },
      actor,
    ),
    accepted,
  )
  assert.equal(reopened.works[0].artifactIds.length, 3)
  cases.push({ id: 'REOPEN-DELIVERY-AND-RECEIPT', status: 'PASS' })
  console.log(
    JSON.stringify({
      status: 'PASS_REAL_NATIVE_PRODUCT',
      root,
      profileVersion: profile.expectedVersion,
      elapsedMs: Date.now() - started,
      cases,
      factCount,
    }),
  )
  mkdirSync(resolve('reports/releases/native-mvp'), { recursive: true })
  writeFileSync(
    resolve('reports/releases/native-mvp/native-product.json'),
    JSON.stringify(
      {
        status: 'PASS_REAL_NATIVE_PRODUCT',
        checkedAt: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        profileVersion: profile.expectedVersion,
        root,
        elapsedMs: Date.now() - started,
        cases,
        limitations: [
          'Real Codex and SQLite/core verification; UI and approval cases are separate',
          'Private scratch project retained for inspection; no user repository modified',
        ],
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  await product.close()
  store.close()
}
