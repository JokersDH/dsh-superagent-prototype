import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createPersonalEngine, completionCriteriaDigest } from '../../packages/orchestrator-core/dist/index.js'
import { bindCoreRepositories } from '../../apps/coordinator/main.ts'
import { createRunnerCredential, serveRunnerRecovery, connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { confirmOwnedQuiescence } from '../../apps/coordinator/resource-barrier.ts'
import { initialTicket, binding, producer } from '../../tests/integration/runtime-ingress-fixture.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { values } = parseArgs({ options: { runtime: { type: 'string' }, record: { type: 'boolean' } } })
if (!values.runtime) throw new Error('Provide --runtime <clean WP-04 checkout>')
const runtime = resolve(values.runtime), load = path => import(pathToFileURL(join(runtime, path)).href)
const { ProductStore } = await load('packages/storage/dist/index.js')
const { CompletionEvidenceStore } = await load('packages/verification/src/index.ts')
const cases = []
for (const variant of ['active-new-epoch', 'wrong-event-topic']) {
  const directory = mkdtempSync(join(tmpdir(), 'pa-gate-')), store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  const evidence = new CompletionEvidenceStore(store), artifactDigest = 'b'.repeat(64)
  const core = createPersonalEngine({ repo: bindCoreRepositories(store), policy: () => ({ version: 'v1', paused: false, gate: () => ({ admissible: false, reason: 'fixture' }), revalidate: () => true, admitsInferred: () => false, evalTimeoutMs: 1000 }), scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: () => {} }, executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, withdraw: () => {}, status: () => undefined }, completionPolicy: () => { throw new Error('Preseeded fixture') }, isCurrentContract: ref => store.authority.isCurrent(ref), completionVerifier: evidence })
  store.uow.atomic(() => { store.domain.tickets.save(initialTicket()); store.authority.enable(binding.contract); store.bindings.record(binding); store.bindings.setCurrent(binding.ticketId, binding.attemptId) })
  core.reportAssignment(binding.ticketId, binding.assignmentId, { state: 'ready', summary: 'Candidate' })
  const candidate = core.completionCandidate(binding.ticketId)
  const credentialPath = join(directory, 'runner.key'); createRunnerCredential(credentialPath)
  const stopped = { state: 'terminated', admission: 'closed', coverage: 'complete_owned_resources', evidence: ['trusted-host-owned-scan'], resources: binding.resources.map(resource => ({ ...resource, writer: 'quiescent', evidence: ['host-group-quiescent'] })) }
  const service = await serveRunnerRecovery({ credentialPath, socketPath: join(directory, 'runner.sock') }, producer, { inspect: async () => stopped, cancel: async () => stopped })
  try {
    const barrier = confirmOwnedQuiescence(store, await connectRunnerRecovery(service.endpoint, producer).inspect()).result
    evidence.recordVerification({ ...candidate, id: 'verification-1', artifactDigest, criteriaDigest: completionCriteriaDigest(initialTicket().completion.criteria), environmentRef: 'env-1', verifierIdentityRef: 'trusted-verifier', results: [{ criterionId: 'test-1', outcome: 'PASS', evidenceRefs: ['check-evidence'] }] })
    evidence.recordQuiescence({ id: 'quiescence-1', candidate, artifactDigest, attemptId: binding.attemptId, barrier })
    const proposal = { ...candidate, artifactDigest, verificationId: 'verification-1' }
    assert.ok(evidence.resolve(proposal), 'Genuine host barrier must resolve before the adverse change')
    if (variant === 'active-new-epoch') {
      store.bindings.record({ ...binding, attemptId: 'attempt-2', fenceEpoch: 2, runnerIdentityRef: 'runner-2', resources: [{ ref: 'active-writer-2', ownership: 'spawned_process' }] })
      store.bindings.setCurrent(binding.ticketId, 'attempt-2')
    } else {
      // Fault injection: the same fields under an unrelated event topic are not a host barrier.
      store.db.prepare('UPDATE event_log SET topic = ? WHERE seq = ?').run('unrelated.observation', barrier.confirmedEventSeq)
    }
    const stillResolves = !!evidence.resolve(proposal)
    let completionRefused = false
    try { core.confirmCompletion(proposal) } catch { completionRefused = true }
    const ended = store.domain.tickets.get(binding.ticketId).ended?.outcome
    cases.push({ id: variant, passesInvariant: !stillResolves && completionRefused && ended === undefined, observed: { stillResolves, completionRefused, ended, currentAttemptState: store.bindings.current(binding.ticketId).state } })
  } finally { await service.close(); store.close(); rmSync(directory, { recursive: true, force: true }) }
}
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_COMPLETION_RUNTIME_BOUNDARY' : 'BLOCKED_COMPLETION_RUNTIME_BOUNDARY', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases }
if (values.record) writeFileSync(join(root, 'reports/releases/g2-completion-runtime-review.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
assert.ok(cases.every(item => item.passesInvariant), 'A current active attempt or an unrelated event cannot authorize completion')
