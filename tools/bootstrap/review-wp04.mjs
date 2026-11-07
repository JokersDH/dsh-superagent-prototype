import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { values } = parseArgs({ options: { runtime: { type: 'string' }, commit: { type: 'string' }, record: { type: 'boolean' } } })
if (!values.runtime || !values.commit) throw new Error('Provide --runtime <clean WP-04 snapshot> --commit <reviewed source SHA>')
const runtime = resolve(values.runtime), load = path => import(pathToFileURL(join(runtime, path)).href)
const { WorkspaceManager } = await load('packages/workspaces/src/index.ts')
const { CheckRegistry, VerificationRunner, CompletionEvidenceStore } = await load('packages/verification/src/index.ts')
const { ProductStore, canonicalDigest } = await load('packages/storage/dist/index.js')
const directory = mkdtempSync(join(tmpdir(), 'wp04-review-')), cases = []
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const candidate = { ticketId: 'ticket-1', assignmentId: 'assignment-1', candidateGeneration: 1, contract }
const assignment = { ...candidate, attemptId: 'attempt-1', fenceEpoch: 1 }
const project = join(directory, 'project'), manager = new WorkspaceManager(join(directory, 'owned'))
try {
  // init creates only a disposable project for workspace API checks.
  execFileSync('git', ['init', '-q', project])
  writeFileSync(join(project, 'tracked.txt'), 'tracked\n')
  writeFileSync(join(project, 'target-a'), 'same')
  writeFileSync(join(project, 'target-b'), 'same')
  writeFileSync(join(project, 'target-c'), 'same')
  symlinkSync('target-a', join(project, 'link'))
  const git = args => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
  git(['add', '--', 'tracked.txt', 'target-a', 'target-b', 'target-c', 'link']); git(['commit', '-qm', 'fixture'])
  const workspace = manager.reserve({ projectPath: project, assignment })
  unlinkSync(join(workspace.path, 'link')); symlinkSync('target-b', join(workspace.path, 'link'))
  const first = manager.freeze({ attemptId: assignment.attemptId })
  unlinkSync(join(workspace.path, 'tracked.txt'))
  let deletedFrozen = false, deletionError
  try { manager.freeze({ attemptId: assignment.attemptId }); deletedFrozen = true } catch (error) { deletionError = error.code ?? error.message }
  cases.push({ id: 'FREEZE-DELETED-TRACKED-FILE', passesInvariant: deletedFrozen, observed: { deletedFrozen, deletionError } })
  writeFileSync(join(workspace.path, 'tracked.txt'), 'tracked\n')
  unlinkSync(join(workspace.path, 'link')); symlinkSync('target-c', join(workspace.path, 'link'))
  const second = manager.freeze({ attemptId: assignment.attemptId })
  cases.push({ id: 'FREEZE-SYMLINK-TARGET', passesInvariant: first.artifactDigest !== second.artifactDigest, observed: { digestChanged: first.artifactDigest !== second.artifactDigest } })

  const registry = new CheckRegistry()
  registry.register({ id: 'check-1', revision: 1, executable: process.execPath, argv: ['-e', 'process.exit(0)'], deadlineMs: 100, outputLimitBytes: 1024 })
  const plan = { candidate, criteria: [{ id: 'criterion-1', kind: 'machine', description: 'fixture', required: true, checkDefinitionRef: 'check-1' }], artifactDigest: first.artifactDigest, workspacePath: workspace.path, environmentRef: 'env-1' }
  let falseGuardRefused = false
  try { new VerificationRunner(registry).run({ ...plan, verifyArtifact: () => false }) } catch { falseGuardRefused = true }
  cases.push({ id: 'VERIFY-FALSE-FROZEN-GUARD', passesInvariant: falseGuardRefused, observed: { falseGuardRefused } })

  const probeCode = `
    import { CheckRegistry, VerificationRunner } from ${JSON.stringify(pathToFileURL(join(runtime, 'packages/verification/src/index.ts')).href)};
    const registry = new CheckRegistry();
    registry.register({ id: 'check-1', revision: 1, executable: process.execPath, argv: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], deadlineMs: 150, outputLimitBytes: 1024 });
    new VerificationRunner(registry).run(${JSON.stringify(plan)});
  `
  const probe = spawn(process.execPath, ['--input-type=module', '-e', probeCode], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let watchdogKilled = false, probeStderr = ''
  probe.stderr.on('data', chunk => { probeStderr += chunk.toString() })
  const watchdog = setTimeout(() => { watchdogKilled = true; try { process.kill(-probe.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }, 1500)
  const probeExit = await new Promise((resolve, reject) => { probe.once('exit', code => resolve(code)); probe.once('error', reject) }).finally(() => clearTimeout(watchdog))
  cases.push({ id: 'CHECK-DEADLINE-IGNORING-SIGTERM', passesInvariant: !watchdogKilled && probeExit === 0, observed: { deadlineMs: 150, watchdogMs: 1500, watchdogKilled, probeExit, probeStderr } })

  const store = new ProductStore({ path: join(directory, 'state.sqlite') })
  try {
    const binding = { ...assignment, runnerIdentityRef: 'runner-1', source: 'driver-1', state: 'active', resources: ['res-quiet', 'res-active'].map(ref => ({ ref, ownership: 'spawned_process' })) }
    const payload = { kind: 'writer.observed', value: { resources: [{ resourceRef: 'res-quiet', ownership: 'spawned_process', status: 'quiescent', evidenceRefs: ['driver-report'] }] } }
    store.uow.atomic(() => {
      store.bindings.record(binding)
      store.observations.record({ fact: { ...assignment, source: binding.source, factId: 'driver-observation', kind: payload.kind, payloadRef: 'payload-1' }, payload, payloadSha256: canonicalDigest(payload), disposition: 'physical_only' })
    })
    const evidence = new CompletionEvidenceStore(store)
    let subsetRefused = false
    try { evidence.recordQuiescence({ id: 'quiet-1', candidate, artifactDigest: first.artifactDigest, attemptId: assignment.attemptId, resourceRefs: ['res-quiet'] }) } catch { subsetRefused = true }
    cases.push({ id: 'QUIESCENCE-REQUIRES-ALL-REGISTERED-RESOURCES', passesInvariant: subsetRefused, observed: { subsetRefused, bindingState: store.bindings.binding(assignment.attemptId).state, registeredResources: binding.resources.length, observedResources: 1 } })
    evidence.recordAcceptance({ id: 'accept-1', candidate, artifactDigest: first.artifactDigest, criterionIds: ['human-1'], actorRef: 'actor-1' })
    let changedBodyRefused = false
    try { evidence.recordAcceptance({ id: 'accept-1', candidate: { ...candidate, candidateGeneration: 2 }, artifactDigest: 'b'.repeat(64), criterionIds: ['human-1'], actorRef: 'actor-2' }) } catch { changedBodyRefused = true }
    cases.push({ id: 'ACCEPTANCE-ID-IMMUTABILITY', passesInvariant: changedBodyRefused, observed: { changedBodyRefused } })
  } finally { store.close() }
} finally {
  try { manager.release({ attemptId: assignment.attemptId }) } finally { rmSync(directory, { recursive: true, force: true }) }
}
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_WP04_ADMISSION' : 'BLOCKED_WP04_ADMISSION', sourceCommit: values.commit, node: process.version, platform: process.platform, cases }
if (values.record) writeFileSync(join(root, 'reports/releases/g2-wp04-review.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
assert.ok(cases.every(item => item.passesInvariant), 'WP-04 must preserve frozen artifact and trusted completion invariants')
