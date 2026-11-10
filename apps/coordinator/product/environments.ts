import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { ApplicationFault } from '@personal-agent/application'
import { AttemptRefSchema, JsonSchema } from '@personal-agent/contracts'
import type { AttemptRef } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { key } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import type { WorkspaceEnvironmentPort, AssignmentIdentity } from '@personal-agent/workspaces'
import { verifyPreparedEnvironment } from '../../../packages/environment-preparation/src/index.ts'
import { EnvironmentPlanSchema, EnvironmentOutcomeSchema, readEnvironmentOutcome } from '../../runner/src/environment-preparation.ts'
import type { EnvironmentPlan, EnvironmentOutcome } from '../../runner/src/environment-preparation.ts'

export interface ProjectEnvironmentPolicy {
  policy: 'existing_only' | 'offline_install'
  storeDir?: string
  managerCommand?: string
}
const intentId = (attemptId: string) => key('product-environment-plan', attemptId)
const readyId = (attemptId: string) => key('product-environment-ready', attemptId)
const same = (a: unknown, b: unknown) => canonicalDigest(JsonSchema.parse(a)) === canonicalDigest(JsonSchema.parse(b))
const identity = (attempt: AttemptRef) => AttemptRefSchema.parse({ ticketId: attempt.ticketId, assignmentId: attempt.assignmentId,
  attemptId: attempt.attemptId, fenceEpoch: attempt.fenceEpoch, contract: attempt.contract })

/** Uses the existing command ledger; environment state is a preparation projection, not a Work engine. */
export class ProductEnvironments implements WorkspaceEnvironmentPort {
  private readonly store: ProductStore
  private readonly stateRoot: string
  constructor(store: ProductStore, stateRoot: string) { this.store = store; this.stateRoot = realpathSync(stateRoot) }

  plan(attempt: AttemptRef, projectPath: string, workspacePath: string, policy: ProjectEnvironmentPolicy): string {
    const plan = EnvironmentPlanSchema.parse({
      kind: 'runner-environment-plan/1', attempt: identity(attempt), requestId: attempt.attemptId,
      projectPath: realpathSync(projectPath), workspacePath: realpathSync(workspacePath), authorityRoot: join(this.stateRoot, 'environments', attempt.attemptId), ...policy,
    })
    const planRef = this.store.payloads.write(JsonSchema.parse(plan)).ref
    this.store.commands.record(intentId(attempt.attemptId), canonicalDigest(JsonSchema.parse({ planRef, plan })), () => {
      this.store.events.append({ topic: 'application.environment.preparing', entityRef: attempt.contract.workId, payload: { workId: attempt.contract.workId, attemptId: attempt.attemptId, policy: plan.policy } })
      return { planRef, plan }
    })
    return planRef
  }

  private storedPlan(attempt: AttemptRef): { plan: EnvironmentPlan; planRef: string } | undefined {
    const stored = this.store.commands.get(intentId(attempt.attemptId))
    if (!stored) return undefined
    const planRef = (stored.result as { planRef?: unknown })?.planRef
    const plan = EnvironmentPlanSchema.parse((stored.result as { plan?: unknown })?.plan)
    if (typeof planRef !== 'string' || stored.payloadDigest !== canonicalDigest(JsonSchema.parse({ planRef, plan })) ||
        planRef !== `payload:${canonicalDigest(JsonSchema.parse(plan))}`)
      throw new ApplicationFault('verification_failed', '环境准备意图不可用。')
    if (!same(plan.attempt, identity(attempt))) throw new ApplicationFault('stale_binding', '环境准备属于另一项执行。')
    return { plan, planRef }
  }

  capture(attempt: AttemptRef): void {
    const stored = this.storedPlan(attempt)
    if (!stored) return
    const outcome = readEnvironmentOutcome(stored.plan)
    if (outcome.planRef !== stored.planRef || !same(outcome.attempt, stored.plan.attempt) || outcome.status !== 'ready' || !outcome.ref ||
        outcome.ref.requestId !== stored.plan.requestId || outcome.ref.authorityRoot !== stored.plan.authorityRoot ||
        realpathSync(outcome.ref.workspacePath) !== realpathSync(stored.plan.workspacePath) || verifyPreparedEnvironment(outcome.ref).status !== 'valid')
      throw new ApplicationFault('verification_failed', '项目环境未准备完成或已发生变化。')
    this.store.commands.record(readyId(attempt.attemptId), canonicalDigest(JsonSchema.parse(outcome)), () => {
      this.store.events.append({ topic: 'application.environment.ready', entityRef: attempt.contract.workId, payload: { workId: attempt.contract.workId, attemptId: attempt.attemptId, fingerprint: outcome.ref!.fingerprint } })
      return outcome
    })
  }

  private verified(attempt: AttemptRef) {
    const stored = this.storedPlan(attempt)
    if (!stored) return undefined
    const ready = this.store.commands.get(readyId(attempt.attemptId))
    if (!ready) throw new ApplicationFault('verification_failed', '环境凭证尚未确认，不能继续执行或接受交付。')
    const outcome = EnvironmentOutcomeSchema.parse(ready.result)
    if (!same(outcome.attempt, stored.plan.attempt) || outcome.planRef !== stored.planRef || !outcome.ref ||
        outcome.ref.requestId !== stored.plan.requestId || outcome.ref.authorityRoot !== stored.plan.authorityRoot ||
        realpathSync(outcome.ref.workspacePath) !== realpathSync(stored.plan.workspacePath) ||
        ready.payloadDigest !== canonicalDigest(JsonSchema.parse(outcome)))
      throw new ApplicationFault('verification_failed', '环境凭证身份不匹配。')
    const verified = verifyPreparedEnvironment(outcome.ref)
    if (verified.status !== 'valid') throw new ApplicationFault('verification_failed', '环境或依赖已改变，需要重新准备。')
    return { ...verified, workspacePath: stored.plan.workspacePath }
  }

  current(input: { assignment: AssignmentIdentity; workspacePath: string }) {
    const verified = this.verified(identity(input.assignment))
    if (!verified) return undefined
    if (realpathSync(input.workspacePath) !== realpathSync(verified.workspacePath)) throw new Error('Another environment workspace')
    return {
      reference: key('environment', verified.ref.receiptId), fingerprint: verified.fingerprint,
      excludedPaths: verified.ownedPaths.filter(path => existsSync(join(input.workspacePath, path))),
    }
  }

  checkEnvironment(attempt: AttemptRef) {
    const verified = this.verified(attempt)
    return verified ? { reference: key('environment', verified.ref.receiptId), values: verified.environment } : undefined
  }

  status(attempt: AttemptRef): { status: 'not_configured' | 'preparing' | 'ready' | 'blocked'; code?: string; fingerprint?: string } {
    const stored = this.storedPlan(attempt)
    if (!stored) return { status: 'not_configured' }
    try {
      const outcome: EnvironmentOutcome = readEnvironmentOutcome(stored.plan)
      if (outcome.planRef !== stored.planRef || !same(outcome.attempt, stored.plan.attempt)) return { status: 'blocked', code: 'environment_identity_mismatch' }
      if (outcome.status === 'blocked') return { status: 'blocked', code: outcome.code ?? 'environment_blocked' }
      const verified = this.verified(attempt)
      return verified ? { status: 'ready', fingerprint: verified.fingerprint } : { status: 'blocked', code: 'environment_proof_missing' }
    } catch {
      return this.store.commands.get(readyId(attempt.attemptId))
        ? { status: 'blocked', code: 'environment_drift' } : { status: 'preparing' }
    }
  }
}
