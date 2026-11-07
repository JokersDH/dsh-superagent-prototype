/**
 * WP-04 verification: registered-check execution with real processes, bounded time/output, explicit
 * non-PASS outcomes, and refusal to verify a changed frozen artifact.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  candidate, criteria, artifactDigest: 'b'.repeat(64), workspacePath, environmentRef: 'env-1', verifierIdentityRef: 'verifier:test', ...overrides,
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

test('a passing check and a failing check produce real exit results', () => {
  const dir = workspace()
  try {
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(0)') }))
    const passed = runner.run(plan(dir))
    assert.equal(passed.verification.results[0]!.outcome, 'PASS')
    assert.equal(passed.evidence[0]!.exitCode, 0)
    assert.match(passed.evidence[0]!.outputDigest, /^[0-9a-f]{64}$/)
    assert.deepEqual(passed.verification.results.map(result => result.criterionId), ['unit'], 'human criteria are not machine results')

    const failing = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(3)') }))
    const failed = failing.run(plan(dir))
    assert.equal(failed.verification.results[0]!.outcome, 'FAIL')
    assert.equal(failed.evidence[0]!.exitCode, 3)
    assert.equal(failed.evidence[0]!.reason, 'exit:3')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a deadline and the output budget bound a check instead of buffering without limit', () => {
  const dir = workspace()
  try {
    const slow = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('setTimeout(() => {}, 5000)'), deadlineMs: 150 }))
    const started = Date.now()
    const timed = slow.run(plan(dir))
    assert.equal(timed.verification.results[0]!.outcome, 'FAIL')
    assert.equal(timed.evidence[0]!.timedOut, true)
    assert.equal(timed.evidence[0]!.reason, 'deadline_exceeded')
    assert.ok(Date.now() - started < 3_000, 'the deadline bounds the run')

    const loud = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script("process.stdout.write('x'.repeat(100000))"), outputLimitBytes: 512 }))
    const bounded = loud.run(plan(dir))
    assert.equal(bounded.verification.results[0]!.outcome, 'FAIL')
    assert.equal(bounded.evidence[0]!.reason, 'output_limit')
    assert.ok(bounded.evidence[0]!.outputExcerpt.length <= 2000, 'the captured excerpt is bounded')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a missing executable is NOT_TESTED and an unregistered check refuses verification', () => {
  const dir = workspace()
  try {
    const missing = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, executable: 'definitely-not-a-real-binary-xyz', argv: [] }))
    const run = missing.run(plan(dir))
    assert.equal(run.verification.results[0]!.outcome, 'NOT_TESTED')
    assert.equal(run.evidence[0]!.missingDependency, true)

    assert.throws(() => new VerificationRunner(new CheckRegistry()).run(plan(dir)), VerificationUnavailable)
    assert.throws(() => new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('') })).run(plan(dir, { criteria: [{ id: 'x', kind: 'machine', description: 'x', required: true }] })), VerificationUnavailable)
    // A symlink inside the workspace that points outside is still refused (real-path containment).
    const outside = mkdtempSync(join(tmpdir(), 'wp04-outside-'))
    try {
      writeFileSync(join(outside, 'marker.txt'), 'outside')
      execFileSync('ln', ['-s', outside, join(dir, 'escape')])
      assert.throws(() => new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script(''), cwd: 'escape' })).run(plan(dir)), VerificationUnavailable)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('trusted exclusions are explicit SKIPPED/NOT_APPLICABLE results', () => {
  const dir = workspace()
  try {
    const registry = new CheckRegistry()
    registry.register({ id: 'unit-check', revision: 1, ...script('process.exit(0)'), deadlineMs: 5_000, outputLimitBytes: 64_000 })
    const runner = new VerificationRunner(registry)
    const run = runner.run(plan(dir, {
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

test('a changed frozen artifact refuses verification before and during the run', () => {
  const dir = workspace()
  try {
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(0)') }))
    assert.throws(() => runner.run(plan(dir, { verifyArtifact: () => { throw new Error('digest changed') } })), (error: unknown) =>
      error instanceof VerificationUnavailable && /artifact changed/.test((error as Error).message))
    let calls = 0
    assert.throws(() => runner.run(plan(dir, { verifyArtifact: () => { if (++calls > 1) throw new Error('changed while running') } })), VerificationUnavailable)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a verification binds the candidate, artifact and core criteria digest', () => {
  const dir = workspace()
  try {
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script("process.stdout.write('ok')") }))
    const run = runner.run(plan(dir))
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

test('the runner refuses a workspace modified after freeze (WorkspaceManager integration)', () => {
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
    const runner = new VerificationRunner(registryWith({ id: 'unit-check', revision: 1, ...script('process.exit(0)') }))
    const run = runner.run(plan(reserved.path, {
      artifactDigest: frozen.artifactDigest,
      verifyArtifact: () => { if (manager.digest({ attemptId: attempt.attemptId }) !== frozen.artifactDigest) throw new Error('workspace changed') },
    }))
    assert.equal(run.verification.results[0]!.outcome, 'PASS')
    writeFileSync(join(reserved.path, 'a.txt'), 'modified after freeze\n')
    assert.throws(() => runner.run(plan(reserved.path, {
      artifactDigest: frozen.artifactDigest,
      verifyArtifact: () => { if (manager.digest({ attemptId: attempt.attemptId }) !== frozen.artifactDigest) throw new Error('workspace changed') },
    })), VerificationUnavailable)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
