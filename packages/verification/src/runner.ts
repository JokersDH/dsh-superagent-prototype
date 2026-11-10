/**
 * The verification runner (WP-04). It executes only registered checks against a frozen workspace,
 * with bounded time and output, and returns a contract `Verification` bound to the candidate,
 * artifact digest and `completionCriteriaDigest(criteria)`. It never calls the core completion gate
 * and never finishes a Ticket: a failure, timeout, missing dependency, skip or not-applicable stays
 * an explicit non-PASS result for the gate to judge.
 *
 * Isolation and boundedness: every check runs in its own process group (`detached`) off the
 * coordinator's event loop. A deadline sends SIGTERM to the group, a short grace then SIGKILL, and a
 * hard cleanup bound resolves the check as NOT_TESTED (`cleanup_unproven`) if the child cannot be
 * proven gone. Stragglers left in the group are reaped after the leader exits, and captured pipes
 * are destroyed so descendants cannot hold the coordinator. Process groups are not a sandbox.
 *
 * The frozen-artifact guard is mandatory and fail-closed: `verifyArtifact` must return exactly
 * `true` before and after the checks; a missing guard, a false result or a throw refuses to produce
 * a Verification.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { VerificationSchema } from '@personal-agent/contracts'
import type { CandidateRef, Criterion, TestStatus, Verification } from '@personal-agent/contracts'
import { completionCriteriaDigest } from '@personal-agent/orchestrator-core'
import type { CheckDefinition, CheckRegistry } from './checks.ts'

/** The frozen candidate could not be verified as frozen (changed artifact, unregistered check, bad cwd). */
export class VerificationUnavailable extends Error {}

export interface VerificationPlan {
  candidate: CandidateRef
  criteria: readonly Criterion[]
  /** The artifact digest captured at freeze time; verification binds to it. */
  artifactDigest: string
  /** The frozen attempt worktree. */
  workspacePath: string
  environmentRef: string
  verifierIdentityRef?: string
  /**
   * Mandatory fail-closed guard: called before the first check and after the last. It must return
   * exactly `true`; a false/undefined result or a throw refuses verification.
   */
  verifyArtifact: () => boolean
  /** Trusted exclusions decided by the composition root (for example a platform the check cannot target). */
  exclusions?: readonly { criterionId: string; outcome: 'SKIPPED' | 'NOT_APPLICABLE'; reason: string }[]
  /** Host environment values; only names declared by a check definition are passed through. */
  environment?: Readonly<Record<string, string | undefined>>
}

export type CheckOutcome = TestStatus | 'NOT_APPLICABLE'

export interface CheckEvidence {
  criterionId: string
  checkDefinitionRef?: string
  definitionRevision?: number
  outcome: CheckOutcome
  exitCode?: number | null
  signal?: string | null
  durationMs: number
  timedOut: boolean
  missingDependency: boolean
  cleanupUnproven?: boolean
  outputDigest: string
  outputExcerpt: string
  reason?: string
}

export interface VerificationRun {
  verification: Verification
  evidence: readonly CheckEvidence[]
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const EXCERPT_LIMIT = 2000
/** How long a SIGKILLed group may take to prove it exited before the check is indeterminate. */
const CLEANUP_BOUND_MS = 2000
const TERM_GRACE_MS = 200
const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

interface Executed {
  evidence: Omit<CheckEvidence, 'criterionId' | 'checkDefinitionRef' | 'definitionRevision'>
  evidenceRef: string
}

export class VerificationRunner {
  private readonly registry: CheckRegistry
  private readonly identity: string
  private readonly environment: Readonly<Record<string, string | undefined>>
  private readonly now: () => number
  constructor(registry: CheckRegistry, options: { identity?: string; environment?: Readonly<Record<string, string | undefined>>; now?: () => number } = {}) {
    this.registry = registry
    this.identity = options.identity ?? 'verifier:local'
    this.environment = options.environment ?? process.env
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Runs the registered checks for a frozen candidate. Exclusions are recorded as explicit
   * SKIPPED/NOT_APPLICABLE results; everything else runs in an owned process group with its
   * definition's deadline and output budget. A changed artifact or an unregistered check refuses to
   * produce a Verification at all.
   */
  async run(plan: VerificationPlan): Promise<VerificationRun> {
    this.assertFrozen(plan, 'before')
    const root = resolve(plan.workspacePath)
    const exclusions = new Map((plan.exclusions ?? []).map(item => [item.criterionId, item]))
    const evidence: CheckEvidence[] = []
    const results: { criterionId: string; outcome: CheckOutcome; evidenceRefs: string[] }[] = []
    for (const criterion of plan.criteria) {
      if (criterion.kind !== 'machine') continue
      const exclusion = exclusions.get(criterion.id)
      if (exclusion) {
        const outputDigest = sha256(`${exclusion.outcome}:${exclusion.reason}`)
        evidence.push({ criterionId: criterion.id, outcome: exclusion.outcome, durationMs: 0, timedOut: false, missingDependency: false, outputDigest, outputExcerpt: '', reason: exclusion.reason })
        results.push({ criterionId: criterion.id, outcome: exclusion.outcome, evidenceRefs: [`exclusion:${criterion.id}:${outputDigest}`] })
        continue
      }
      if (!criterion.checkDefinitionRef) throw new VerificationUnavailable(`Machine criterion ${criterion.id} has no registered check definition`)
      let definition: Readonly<CheckDefinition>
      try { definition = this.registry.require(criterion.checkDefinitionRef) } catch (error) {
        throw new VerificationUnavailable(`Unregistered check definition for criterion ${criterion.id}: ${String(error)}`)
      }
      const cwd = resolve(root, definition.cwd ?? '.')
      const realRoot = realpathSync(root)
      const realCwd = realpathSync(cwd)
      if (!inside(root, cwd) || !inside(realRoot, realCwd)) throw new VerificationUnavailable(`Check ${definition.id} working directory escapes the workspace: ${definition.cwd}`)
      const run = await this.execute(definition, cwd, plan.environment ?? this.environment)
      evidence.push({ ...run.evidence, criterionId: criterion.id, checkDefinitionRef: definition.id, definitionRevision: definition.revision })
      results.push({ criterionId: criterion.id, outcome: run.evidence.outcome, evidenceRefs: [run.evidenceRef] })
    }
    this.assertFrozen(plan, 'after')
    const verification = VerificationSchema.parse({
      ...plan.candidate,
      id: `verification:${randomUUID()}`,
      artifactDigest: plan.artifactDigest,
      criteriaDigest: completionCriteriaDigest(plan.criteria),
      environmentRef: plan.environmentRef,
      results,
      verifierIdentityRef: plan.verifierIdentityRef ?? this.identity,
    })
    return { verification, evidence }
  }

  private assertFrozen(plan: VerificationPlan, phase: 'before' | 'after'): void {
    let confirmed: unknown
    try {
      confirmed = plan.verifyArtifact()
    } catch (error) {
      throw new VerificationUnavailable(`The frozen artifact guard failed ${phase} verification: ${String(error)}`)
    }
    if (confirmed !== true) throw new VerificationUnavailable(`The frozen artifact guard did not confirm the artifact ${phase} verification`)
  }

  /** Runs one check in its own process group with bounded time, output and cleanup. */
  private execute(definition: Readonly<CheckDefinition>, cwd: string, environment: Readonly<Record<string, string | undefined>>): Promise<Executed> {
    return new Promise<Executed>(resolvePromise => {
      const env: Record<string, string> = { PATH: environment.PATH ?? '/usr/bin:/bin' }
      for (const name of definition.allowedEnvironment ?? []) {
        const value = environment[name]
        if (value !== undefined) env[name] = value
      }
      const started = this.now()
      const child = spawn(definition.executable, [...definition.argv], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout: Buffer = Buffer.alloc(0)
      let stderr: Buffer = Buffer.alloc(0)
      let oversized = false
      let timedOut = false
      let cleanupUnproven = false
      let settled = false
      let exitCode: number | null = null
      let exitSignal: string | null = null
      const timers: ReturnType<typeof setTimeout>[] = []

      const killGroup = (signal: NodeJS.Signals): void => {
        try { if (child.pid) process.kill(-child.pid, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      const settle = (): void => {
        if (settled) return
        settled = true
        for (const timer of timers) clearTimeout(timer)
        child.stdout?.destroy()
        child.stderr?.destroy()
        const output = Buffer.concat([stdout, stderr])
        const durationMs = this.now() - started
        // A leader exit does not prove the group is gone: reap stragglers in our own group.
        killGroup('SIGKILL')
        const outcome: CheckOutcome = cleanupUnproven ? 'NOT_TESTED'
          : timedOut || exitSignal !== null || oversized || exitCode !== 0 ? 'FAIL'
            : 'PASS'
        const reason = cleanupUnproven ? 'cleanup_unproven'
          : oversized ? 'output_limit'
            : timedOut ? 'deadline_exceeded'
              : exitSignal !== null ? `signal:${exitSignal}`
                : exitCode !== 0 ? `exit:${String(exitCode)}`
                  : undefined
        const evidence: Omit<CheckEvidence, 'criterionId' | 'checkDefinitionRef' | 'definitionRevision'> = {
          outcome,
          exitCode,
          signal: exitSignal,
          durationMs,
          timedOut,
          missingDependency: false,
          ...(cleanupUnproven ? { cleanupUnproven: true } : {}),
          outputDigest: sha256(output),
          outputExcerpt: output.toString('utf8').slice(0, EXCERPT_LIMIT),
          ...(reason ? { reason } : {}),
        }
        resolvePromise({ evidence, evidenceRef: `check:${definition.id}:r${definition.revision}:${sha256(output)}` })
      }
      const capture = (current: Buffer, chunk: Buffer): Buffer => {
        if (oversized) return current
        const next = Buffer.concat([current, chunk])
        if (next.byteLength > definition.outputLimitBytes) {
          oversized = true
          killGroup('SIGKILL')
          return next.subarray(0, definition.outputLimitBytes)
        }
        return next
      }
      child.stdout?.on('data', (chunk: Buffer) => { stdout = capture(stdout, chunk) })
      child.stderr?.on('data', (chunk: Buffer) => { stderr = capture(stderr, chunk) })
      child.once('error', (error: NodeJS.ErrnoException) => {
        // Spawn failure (typically ENOENT): nothing ran.
        if (error.code === 'ENOENT') {
          if (settled) return
          settled = true
          for (const timer of timers) clearTimeout(timer)
          child.stdout?.destroy()
          child.stderr?.destroy()
          resolvePromise({
            evidence: { outcome: 'NOT_TESTED', exitCode: null, signal: null, durationMs: this.now() - started, timedOut: false, missingDependency: true,
              outputDigest: sha256(''), outputExcerpt: '', reason: 'missing_dependency' },
            evidenceRef: `check:${definition.id}:r${definition.revision}:${sha256('')}`,
          })
          return
        }
        settle()
      })
      child.once('exit', (code, signal) => {
        exitCode = code
        exitSignal = signal
        settle()
      })
      timers.push(setTimeout(() => {
        timedOut = true
        killGroup('SIGTERM')
        timers.push(setTimeout(() => killGroup('SIGKILL'), TERM_GRACE_MS))
      }, definition.deadlineMs))
      // Hard bound: if the group still cannot be proven exited, resolve as indeterminate rather
      // than holding the coordinator forever.
      timers.push(setTimeout(() => {
        if (settled) return
        cleanupUnproven = true
        killGroup('SIGKILL')
        settle()
      }, definition.deadlineMs + TERM_GRACE_MS + CLEANUP_BOUND_MS))
    })
  }
}
