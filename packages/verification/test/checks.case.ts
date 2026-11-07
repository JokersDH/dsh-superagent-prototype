/**
 * WP-04 verification: registered-check execution with real processes, bounded time/output, explicit
 * non-PASS outcomes, a mandatory fail-closed frozen-artifact guard, and isolated process groups that
 * are cleaned up even when a check ignores SIGTERM.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { completionCriteriaDigest } from '@personal-agent/orchestrator-core'
import type { CandidateRef, Criterion } from '@personal-agent/contracts'
import { CheckConflict, CheckRegistry, InvalidCheck, UnknownCheck, VerificationRunner, VerificationUnavailable } from '../src/index.ts'
import { WorkspaceManager, type AssignmentIdentity } from '@personal-agent/workspaces'

const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const candidate: CandidateRef = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 }
const criteria: Criterion[] = [
  { id: 'unit', kind: 'machine', description: 'Unit checks pass.', required: true, checkDefinitionRef: 'unit-check' },
  { id: 'review', kind: 'human', description: 'The user accepts the result.', required: true },
]
const script = (code: string): { executable: string; argv: string[] } => ({ executable: process.execPath, argv: ['-e', code] })

const workspace = (): string => mkdtempSync(join(tmpdir(), 'wp04-verify-'))
const registryWith = (definition: { id: string; revision: number; executable: string; argv: readonly string[]; deadlineMs?: number; outputLimitBytes?: number; allowedEnvironment?: readonly string[]; cwd?: string }): CheckRegistry => {
  const registry = new CheckRegistry()
  registry.register({ deadlineMs: 5_000, outputLimitBytes: 64_000, ...definition })
  return registry
}
const plan = (workspacePath: string, overrides: Record<string, unknown> = {}) => ({
  candidate, criteria, artifactDigest: 'b'.repeat(64), workspacePath, environmentRef: 'env-1', verifierIdentityRef: 'verifier:test',
  verifyArtifact: () => true, ...overrides,
})

test('the registry is immutable per revision and refuses unregistered or invalid checks', () => {
  const registry = new CheckRegistry()
  registry.register({ id: 'unit-check', revision: 1, ...script('process.exit(0)'), deadlineMs: 1000, outputLimitBytes: 1024 })
  assert.equal(registry.require('unit-check').revision, 1)
  assert.throws(() => registry.register({ id: 'unit-check', revision: 1, ...script('process.exit(1)'), deadlineMs: 1000, outputLimitBytes: 1024 }), CheckConflict)
  registry.register({ id: 'unit-check', revision: 2, ...script('process.exit(0)'), deadlineMs: 1000, outputLimitBytes: 1024 })
  assert.equal(registry.require('unit-check').revision, 2, 'a new revision is additive')
  assert.throws(() => registry.require('unknown-check'), UnknownCheck)
  assert.throws(() => registry.register({ id: 'bad', revision: 1, ...script(''), deadlineMs: 0, outputLimitBytes: 1024 }), InvalidCheck)
  assert.throws(() => registry.register({ id: 'bad', revision: 1, ...script(''), deadlineMs: 1000, outputLimitBytes: 1024, cwd: '../escape' }), InvalidCheck)
  assert.throws(() => registry.register({ id: 'bad', revision: 1, ...script(''), deadlineMs: 1000, outputLimitBytes: 1024, allowedEnvironment: ['BAD-NAME'] }), InvalidCheck)
})

test('a passing check and a failing check produce real exit results', async () => {
  const dir = workspace()
  try {
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(0)') }))
    const passed = await runner.run(plan(dir))
    assert.equal(passed.verification.results[0]!.outcome, 'PASS')
    assert.equal(passed.evidence[0]!.exitCode, 0)
    assert.match(passed.evidence[0]!.outputDigest, /^[0-9a-f]{64}$/)
    assert.deepEqual(passed.verification.results.map(result => result.criterionId), ['unit'], 'human criteria are not machine results')

    const failing = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(3)') }))
    const failed = await failing.run(plan(dir))
    assert.equal(failed.verification.results[0]!.outcome, 'FAIL')
    assert.equal(failed.evidence[0]!.exitCode, 3)
    assert.equal(failed.evidence[0]!.reason, 'exit:3')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a deadline and the output budget bound a check instead of buffering without limit', async () => {
  const dir = workspace()
  try {
    const slow = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('setTimeout(() => {}, 5000)'), deadlineMs: 150 }))
    const started = Date.now()
    const timed = await slow.run(plan(dir))
    assert.equal(timed.verification.results[0]!.outcome, 'FAIL')
    assert.equal(timed.evidence[0]!.timedOut, true)
    assert.equal(timed.evidence[0]!.reason, 'deadline_exceeded')
    assert.ok(Date.now() - started < 3_000, 'the deadline bounds the run')

    const loud = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script("process.stdout.write('x'.repeat(100000))"), outputLimitBytes: 512 }))
    const bounded = await loud.run(plan(dir))
    assert.equal(bounded.verification.results[0]!.outcome, 'FAIL')
    assert.equal(bounded.evidence[0]!.reason, 'output_limit')
    assert.ok(bounded.evidence[0]!.outputExcerpt.length <= 2000, 'the captured excerpt is bounded')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a check that ignores SIGTERM is killed as a group and does not hang the runner', async () => {
  const dir = workspace()
  try {
    const stubborn = new VerificationRunner(registryWith({
      id: 'unit-check', revision: 1, deadlineMs: 150,
      ...script("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"),
    }))
    const started = Date.now()
    const run = await stubborn.run(plan(dir))
    assert.equal(run.verification.results[0]!.outcome, 'FAIL')
    assert.equal(run.evidence[0]!.timedOut, true)
    assert.equal(run.evidence[0]!.cleanupUnproven, undefined, 'the group was proven gone')
    assert.ok(Date.now() - started < 2_500, 'SIGKILL and the cleanup bound finish the check')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a missing executable is NOT_TESTED and an unregistered check refuses verification', async () => {
  const dir = workspace()
  try {
    const missing = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, executable: 'definitely-not-a-real-binary-xyz', argv: [] }))
    const run = await missing.run(plan(dir))
    assert.equal(run.verification.results[0]!.outcome, 'NOT_TESTED')
    assert.equal(run.evidence[0]!.missingDependency, true)

    await assert.rejects(new VerificationRunner(new CheckRegistry()).run(plan(dir)), VerificationUnavailable)
    await assert.rejects(new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('') })).run(plan(dir, { criteria: [{ id: 'x', kind: 'machine', description: 'x', required: true }] })), VerificationUnavailable)
    // A symlink inside the workspace that points outside is still refused (real-path containment).
    const outside = mkdtempSync(join(tmpdir(), 'wp04-outside-'))
    try {
      writeFileSync(join(outside, 'marker.txt'), 'outside')
      execFileSync('ln', ['-s', outside, join(dir, 'escape')])
      await assert.rejects(new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script(''), cwd: 'escape' })).run(plan(dir)), VerificationUnavailable)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('trusted exclusions are explicit SKIPPED/NOT_APPLICABLE results', async () => {
  const dir = workspace()
  try {
    const registry = new CheckRegistry()
    registry.register({ id: 'unit-check', revision: 1, ...script('process.exit(0)'), deadlineMs: 5_000, outputLimitBytes: 64_000 })
    const runner = new VerificationRunner(registry)
    const run = await runner.run(plan(dir, {
      criteria: [
        { id: 'unit', kind: 'machine', description: 'Unit checks pass.', required: true, checkDefinitionRef: 'unit-check' },
        { id: 'skip', kind: 'machine', description: 'Needs a service.', required: true, checkDefinitionRef: 'service-check' },
        { id: 'na', kind: 'machine', description: 'Other platform.', required: true, checkDefinitionRef: 'platform-check' },
      ],
      exclusions: [
        { criterionId: 'skip', outcome: 'SKIPPED', reason: 'service unavailable in this environment' },
        { criterionId: 'na', outcome: 'NOT_APPLICABLE', reason: 'not a darwin target' },
      ],
    }))
    const outcomes = run.verification.results.map(result => [result.criterionId, result.outcome])
    assert.deepEqual(outcomes, [['unit', 'PASS'], ['skip', 'SKIPPED'], ['na', 'NOT_APPLICABLE']])
    for (const result of run.verification.results) assert.ok(result.evidenceRefs.length)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the frozen-artifact guard is mandatory and only an explicit true passes', async () => {
  const dir = workspace()
  try {
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(0)') }))
    await assert.rejects(runner.run(plan(dir, { verifyArtifact: () => false })), (error: unknown) =>
      error instanceof VerificationUnavailable && /did not confirm/.test((error as Error).message))
    await assert.rejects(runner.run(plan(dir, { verifyArtifact: () => undefined })), VerificationUnavailable)
    await assert.rejects(runner.run(plan(dir, { verifyArtifact: () => { throw new Error('digest changed') } })), (error: unknown) =>
      error instanceof VerificationUnavailable && /guard failed/.test((error as Error).message))
    // A missing guard (JS caller) fails closed too.
    const missing = { ...plan(dir) } as Record<string, unknown>
    delete missing.verifyArtifact
    await assert.rejects(runner.run(missing as never), VerificationUnavailable)
    let calls = 0
    await assert.rejects(runner.run(plan(dir, { verifyArtifact: () => { if (++calls > 1) throw new Error('changed while running'); return true } })), VerificationUnavailable)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a verification binds the candidate, artifact and core criteria digest', async () => {
  const dir = workspace()
  try {
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script("process.stdout.write('ok')") }))
    const run = await runner.run(plan(dir))
    assert.equal(run.verification.ticketId, candidate.ticketId)
    assert.equal(run.verification.assignmentId, candidate.assignmentId)
    assert.equal(run.verification.candidateGeneration, candidate.candidateGeneration)
    assert.deepEqual(run.verification.contract, contract)
    assert.equal(run.verification.artifactDigest, 'b'.repeat(64))
    assert.equal(run.verification.criteriaDigest, completionCriteriaDigest(criteria))
    assert.equal(run.verification.environmentRef, 'env-1')
    assert.equal(run.verification.verifierIdentityRef, 'verifier:test')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the runner refuses a workspace modified after freeze (WorkspaceManager integration)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp04-freeze-'))
  const projectRoot = join(dir, 'project')
  mkdirSync(projectRoot)
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q'); git('config', 'user.email', 'f@e.test'); git('config', 'user.name', 'F')
  writeFileSync(join(projectRoot, 'a.txt'), 'base\n')
  git('add', '.'); git('commit', '-qm', 'base')
  const manager = new WorkspaceManager(join(dir, 'state'))
  const attempt: AssignmentIdentity = { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract }
  try {
    const reserved = manager.reserve({ projectPath: projectRoot, assignment: attempt })
    const frozen = manager.freeze({ attemptId: attempt.attemptId })
    const guard = (): boolean => manager.digest({ attemptId: attempt.attemptId }) === frozen.artifactDigest
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(0)') }))
    const run = await runner.run(plan(reserved.path, { artifactDigest: frozen.artifactDigest, verifyArtifact: guard }))
    assert.equal(run.verification.results[0]!.outcome, 'PASS')
    writeFileSync(join(reserved.path, 'a.txt'), 'modified after freeze\n')
    await assert.rejects(runner.run(plan(reserved.path, { artifactDigest: frozen.artifactDigest, verifyArtifact: guard })), VerificationUnavailable)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
