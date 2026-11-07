/**
 * The verification runner (WP-04). It executes only registered checks against a frozen workspace,
 * with bounded time and output, and returns a contract `Verification` bound to the candidate,
 * artifact digest and `completionCriteriaDigest(criteria)`. It never calls the core completion gate
 * and never finishes a Ticket: a failure, timeout, missing dependency, skip or not-applicable stays
 * an explicit non-PASS result for the gate to judge.
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { VerificationSchema } from '@personal-agent/contracts'
import type { CandidateRef, Criterion, TestStatus, Verification } from '@personal-agent/contracts'
import { completionCriteriaDigest } from '@personal-agent/orchestrator-core'
import { UnknownCheck } from './checks.ts'
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
  /** Trusted exclusions decided by the composition root (for example a platform the check cannot target). */
  exclusions?: readonly { criterionId: string; outcome: 'SKIPPED' | 'NOT_APPLICABLE'; reason: string }[]
  /** Run before the first check and after the last; throw when the frozen artifact changed. */
  verifyArtifact?: () => void
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
const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
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
   * SKIPPED/NOT_APPLICABLE results; everything else runs with its definition's deadline and output
   * budget. A changed artifact or an unregistered check refuses to produce a Verification at all.
   */
  run(plan: VerificationPlan): VerificationRun {
    this.checkFrozen(plan)
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
      const run = this.execute(definition, cwd)
      evidence.push({ ...run.evidence, criterionId: criterion.id, checkDefinitionRef: definition.id, definitionRevision: definition.revision })
      results.push({ criterionId: criterion.id, outcome: run.evidence.outcome, evidenceRefs: [run.evidenceRef] })
    }
    this.checkFrozen(plan)
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

  private checkFrozen(plan: VerificationPlan): void {
    try {
      plan.verifyArtifact?.()
    } catch (error) {
      throw new VerificationUnavailable(`The frozen artifact changed during verification: ${String(error)}`)
    }
  }

  private execute(definition: Readonly<CheckDefinition>, cwd: string): { evidence: Omit<CheckEvidence, 'criterionId' | 'checkDefinitionRef' | 'definitionRevision'>; evidenceRef: string } {
    const env: Record<string, string> = {}
    const path = this.environment.PATH ?? '/usr/bin:/bin'
    env.PATH = path
    for (const name of definition.allowedEnvironment ?? []) {
      const value = this.environment[name]
      if (value !== undefined) env[name] = value
    }
    const started = this.now()
    const result = spawnSync(definition.executable, [...definition.argv], {
      cwd, env, timeout: definition.deadlineMs, maxBuffer: definition.outputLimitBytes, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const durationMs = this.now() - started
    const stdout = result.stdout instanceof Buffer ? result.stdout : Buffer.alloc(0)
    const stderr = result.stderr instanceof Buffer ? result.stderr : Buffer.alloc(0)
    const output = Buffer.concat([stdout, stderr])
    const outputDigest = sha256(output)
    const outputExcerpt = output.toString('utf8').slice(0, EXCERPT_LIMIT)
    const error = result.error as (NodeJS.ErrnoException & { code?: string }) | undefined
    const timedOut = error?.code === 'ETIMEDOUT'
    const missingDependency = error?.code === 'ENOENT'
    const oversized = error?.code === 'ENOBUFS'
    const outcome: CheckOutcome = missingDependency ? 'NOT_TESTED'
      : timedOut || result.signal !== null || oversized || result.status !== 0 ? 'FAIL'
        : 'PASS'
    const reason = missingDependency ? 'missing_dependency'
      : timedOut ? 'deadline_exceeded'
        : oversized ? 'output_limit'
          : result.signal !== null ? `signal:${result.signal}`
            : result.status !== 0 ? `exit:${String(result.status)}`
              : undefined
    const evidence = {
      outcome,
      exitCode: result.status,
      signal: result.signal,
      durationMs,
      timedOut,
      missingDependency,
      outputDigest,
      outputExcerpt,
      ...(reason ? { reason } : {}),
    }
    return { evidence, evidenceRef: `check:${definition.id}:r${definition.revision}:${outputDigest}` }
  }
}

