import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  AttemptRefSchema,
  AttemptSpecSchema,
  CandidateRefSchema,
  ContractRefSchema,
  ExecutionInputSchema,
  IdSchema,
  JsonSchema,
  NativeAnswerPayloadSchema,
  NativeQuestionBindingSchema,
  PreparedExecutionPolicySchema,
  RunnerCommandSchema,
  WorkVerificationStatusSchema,
} from '@personal-agent/contracts'
import type {
  AttemptRef,
  CandidateRef,
  CriticalFact,
  NativeDispatch,
  NativeQuestionBinding,
  RunnerCommand,
  RuntimeFactPayload,
  WorkVerificationStatus,
  WorkView,
  ContractRevision,
} from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import type { ProductApplication } from '@personal-agent/application'
import { Effects, Later, UnknownSend } from '@personal-agent/effects'
import { key, latestAssignment } from '@personal-agent/orchestrator-core'
import type { Ticket, Trigger } from '@personal-agent/orchestrator-core'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { WorkspaceConflict } from '@personal-agent/workspaces'
import type { WorkspaceManager } from '@personal-agent/workspaces'
import { EvidenceConflict, InvalidEvidence, QuiescenceUnavailable, VerificationUnavailable } from '@personal-agent/verification'
import { AttemptSupervisor } from '../../../packages/execution/src/supervisor.ts'
import type { CommandKey } from '../../../packages/execution/src/supervisor.ts'
import { handleQuestionAnswers } from '../http/question-effects.ts'
import { handleRunnerRecovery } from '../recovery-effects.ts'
import { createStoredRuntimeIngress } from '../stored-ingress.ts'
import { producerForBinding } from '../runner-registry.ts'
import type { IngressBinding } from '../runtime-ingress.ts'
import { ownedResourceManifestDigest } from '../resource-barrier.ts'
import { ControlledProductAttempt } from './controlled-attempt.ts'
import { NativeProductAttempt } from './native-attempt.ts'
import type { NativeProductConfiguration } from './native-config.ts'
import { NativeCodexSettingsSchema } from '../../../packages/drivers/codex-native/src/native.ts'
import type { ProductCompletion } from './completion.ts'
import type { ProductEnvironments } from './environments.ts'

const IntentSchema = z.strictObject({
  kind: z.enum(['start', 'deliver']),
  ticketId: IdSchema,
  assignmentId: IdSchema,
  contract: ContractRefSchema,
})
type Intent = z.infer<typeof IntentSchema>
const same = (a: unknown, b: unknown): boolean =>
  a !== undefined && b !== undefined && canonicalDigest(JsonSchema.parse(a)) === canonicalDigest(JsonSchema.parse(b))
const commandIndex = (id: string) => key('product-command', id)
const attemptOf = (value: AttemptRef): AttemptRef =>
  AttemptRefSchema.parse({
    ticketId: value.ticketId,
    assignmentId: value.assignmentId,
    attemptId: value.attemptId,
    fenceEpoch: value.fenceEpoch,
    contract: value.contract,
  })
const StartSchema = z.strictObject({
  spec: AttemptSpecSchema,
  initialInputRef: IdSchema,
  preparedPolicyRef: IdSchema,
  mode: z.enum(['question', 'pass', 'fail', 'slow', 'native']),
})
const CommandIndexSchema = z.strictObject({
  command: RunnerCommandSchema,
  inputIds: z.array(IdSchema),
  nativeBinding: NativeQuestionBindingSchema.optional(),
})
const VerifyIntentSchema = z.strictObject({
  candidate: CandidateRefSchema,
  barrier: z.strictObject({
    scope: z.literal('registered_owned_resources_only'),
    attemptId: IdSchema,
    proofRef: IdSchema,
    resourceManifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    confirmedEventSeq: z.number().int().positive().safe(),
    writerFactId: IdSchema.optional(),
  }),
})
const VerificationBlockSchema = z.strictObject({
  protocol: z.literal('blocked-verification/1'),
  id: IdSchema,
  code: z.enum(['verification_failed', 'storage_unavailable']),
  failureCount: z.number().int().positive().safe(),
})
export const FIXTURE_PROFILES = [
  'profile-fixture-question',
  'profile-fixture-pass',
  'profile-fixture-fail',
  'profile-fixture-slow',
] as const

/** Consumes core intents after commit. Durable receipts fence every possible physical begin. */
export class ProductExecution {
  readonly effects: Effects
  private readonly attempts = new Map<string, ControlledProductAttempt | NativeProductAttempt>()
  private readonly pendingBegins = new Map<string, RunnerCommand>()
  private readonly runs = new Set<Promise<void>>()
  private readonly waiters = new Map<string, (dispatch: NativeDispatch) => void>()
  private readonly verifying = new Set<string>()
  private readonly ingress: ReturnType<typeof createStoredRuntimeIngress>
  private timer: ReturnType<typeof setInterval> | undefined
  private closing = false
  private started = false
  private readonly store: ProductStore
  private readonly application: ProductApplication
  private readonly workspaces: WorkspaceManager
  private readonly scratchProject: string
  private readonly stateRoot: string
  private readonly principal: { userId: string }
  private readonly native: NativeProductConfiguration | undefined
  private readonly environments: ProductEnvironments | undefined
  private readonly projectForContract: ((contract: ContractRevision) => NativeProductConfiguration['projects'][number] | undefined) | undefined
  constructor(
    store: ProductStore,
    application: ProductApplication,
    workspaces: WorkspaceManager,
    completion: ProductCompletion,
    scratchProject: string,
    stateRoot: string,
    principal: { userId: string },
    native?: NativeProductConfiguration,
    environments?: ProductEnvironments,
    projectForContract?: (contract: ContractRevision) => NativeProductConfiguration['projects'][number] | undefined,
  ) {
    this.store = store
    this.application = application
    this.workspaces = workspaces
    this.scratchProject = scratchProject
    this.stateRoot = stateRoot
    this.principal = principal
    this.native = native
    this.environments = environments
    this.projectForContract = projectForContract
    this.effects = new Effects(store.queue)
    this.ingress = createStoredRuntimeIngress(
      store,
      application.core,
      () => ({ revalidate: (mandate) => this.authorized(mandate) }),
      {
        business: (fact, payload) => this.reduce(fact, payload),
      },
    )
    this.effects.handle('application.execute', async (value) => this.execute(IntentSchema.parse(value)), {
      limit: () => 1,
      retry: [100, 5000],
    })
    this.effects.handle(
      'application.verify',
      async (value, attemptId) => {
        const plan = VerifyIntentSchema.parse(value)
        const binding = store.bindings.binding<IngressBinding>(attemptId)
        if (!binding || binding.state !== 'ended') throw new Later('Await complete physical barrier')
        const ticket = store.domain.tickets.get<Ticket>(binding.ticketId)
        if (!ticket || ticket.ended || !this.authorized(ticket.mandate)) return
        const candidate = application.core.completionCandidate(binding.ticketId)
        if (!candidate || !same(candidate, plan.candidate) || plan.barrier.attemptId !== attemptId) return
        const contract = store.product.contracts.getByRef(candidate.contract)!
        const { writerFactId, ...barrier } = plan.barrier
        const row = this.verificationRows().find(row => row.key === attemptId)
        if (!row) return
        this.verifying.add(attemptId)
        try {
          if (!this.verificationBarrierCurrent(plan, binding))
            throw new ApplicationFault('writer_indeterminate', 'The verification resource barrier changed', 'reconcile')
          store.events.append({ topic: 'application.verification.started', entityRef: candidate.contract.workId,
            payload: { workId: candidate.contract.workId } })
          await completion.verify(candidate, contract, attemptId, {
            ...barrier,
            ...(writerFactId ? { writerFactId } : {}),
          })
        } catch (error) {
          const invalid = error instanceof VerificationUnavailable || error instanceof WorkspaceConflict ||
            error instanceof QuiescenceUnavailable || error instanceof InvalidEvidence || error instanceof EvidenceConflict ||
            (error instanceof ApplicationFault && ['verification_failed', 'writer_indeterminate', 'stale_candidate', 'stale_contract'].includes(error.error.code))
          // Infrastructure gets two automatic retries; invalid content/environment waits for the user immediately.
          if (!invalid && row.attempts < 2) throw new Error('Verification temporarily unavailable')
          const blocked = VerificationBlockSchema.parse({ protocol: 'blocked-verification/1',
            id: `verification-block:${randomUUID()}`, code: invalid ? 'verification_failed' : 'storage_unavailable',
            failureCount: row.attempts + 1 })
          store.uow.atomic(() => {
            store.queue.park('application.verify', row.key, row.seq, row.generation, JSON.stringify(blocked), new Date().toISOString())
            store.events.append({ topic: 'application.verification.blocked', entityRef: candidate.contract.workId,
              payload: { workId: candidate.contract.workId, ...blocked } })
          })
        } finally {
          this.verifying.delete(attemptId)
        }
      },
      { retry: [500, 5000] },
    )
    handleRunnerRecovery(this.effects, store)
    handleQuestionAnswers(this.effects, application.questions, {
      send: async (commandId, payload, beforeWrite) => {
        const target = payload.nativeBinding
        const runtime = this.attempts.get(target.attemptId)
        if (!runtime || this.nativeFence(target) !== 'current')
          return {
            commandId,
            delivery: 'not_sent',
            retry: 'same_key_safe',
            evidenceRefs: ['controlled-attempt-unavailable'],
          }
        const nativeBindingRef = store.payloads.write(JsonSchema.parse(target)).ref
        const answerRef = store.payloads.write(JsonSchema.parse(NativeAnswerPayloadSchema.parse(payload))).ref
        const command = RunnerCommandSchema.parse({
          ...attemptOf(target),
          id: commandId,
          kind: 'answer',
          nativeBindingRef,
          answerRef,
        })
        this.index(command, [], target)
        runtime.allowAnswer(commandId, beforeWrite)
        return this.send(runtime, command)
      },
    })
  }
  nativeFence(target: NativeQuestionBinding): 'current' | 'stale' | 'unknown' {
    const binding = this.store.bindings.current<IngressBinding>(target.ticketId)
    if (!binding || !same(attemptOf(binding), attemptOf(target)) || binding.state !== 'active') return 'stale'
    return this.attempts.has(target.attemptId) && target.connectionEpoch === 1 ? 'current' : 'unknown'
  }
  private verificationRows() {
    return this.store.queue.dueRows('application.verify', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  }
  private verificationBarrierCurrent(plan: z.infer<typeof VerifyIntentSchema>, binding: IngressBinding): boolean {
    const digest = ownedResourceManifestDigest(binding.resources)
    const receipt = this.store.commands.get(key('confirm-owned-quiescence/v2', binding.attemptId, digest))
    return binding.state === 'ended' && plan.barrier.attemptId === binding.attemptId &&
      digest === plan.barrier.resourceManifestDigest && !!receipt && same(receipt.result, plan.barrier)
  }
  verificationBlocked(candidate: CandidateRef): boolean {
    return this.store.queue.parked('application.verify').some(row =>
      same(VerifyIntentSchema.parse(JSON.parse(row.payload)).candidate, candidate))
  }
  verificationStatus(work: WorkView): WorkVerificationStatus {
    const base = { protocol: 'work-verification/1' as const, workId: work.work.id, retryAvailable: false }
    if (work.actions.currentVerificationId)
      return WorkVerificationStatusSchema.parse({ ...base, state: 'finished', verificationId: work.actions.currentVerificationId })
    const candidate = work.actions.currentCandidate
    if (!candidate) return { ...base, state: 'not_ready' }
    const binding = this.store.bindings.current(candidate.ticketId)
    const matches = (row: { key: string; payload: string }) => {
      const plan = VerifyIntentSchema.safeParse(JSON.parse(row.payload))
      return plan.success && binding?.attemptId === row.key && same(plan.data.candidate, candidate)
    }
    const parked = this.store.queue.parked('application.verify').find(matches)
    if (parked) {
      const { protocol: _, ...failure } = VerificationBlockSchema.parse(JSON.parse(parked.parkedReason))
      return WorkVerificationStatusSchema.parse({ ...base, state: 'blocked', candidate, failure,
        retryAvailable: !!binding && this.verificationBarrierCurrent(VerifyIntentSchema.parse(JSON.parse(parked.payload)), binding) &&
          work.resourceStatus === 'quiescent' && !this.verifying.has(parked.key) })
    }
    const row = this.verificationRows().find(matches)
    return WorkVerificationStatusSchema.parse({ ...base, candidate,
      state: binding && this.verifying.has(binding.attemptId) ? 'running' : row?.attempts ? 'retry_wait' : 'queued' })
  }
  retryVerification(candidate: CandidateRef, blockedId: string): void {
    const binding = this.store.bindings.current(candidate.ticketId)
    const parked = binding && this.store.queue.parked('application.verify').find(row => row.key === binding.attemptId)
    if (!parked) throw new ApplicationFault('conflict', 'Verification is no longer blocked')
    const plan = VerifyIntentSchema.parse(JSON.parse(parked.payload))
    const blocked = VerificationBlockSchema.parse(JSON.parse(parked.parkedReason))
    if (!same(plan.candidate, candidate) || blocked.id !== blockedId)
      throw new ApplicationFault('stale_candidate', 'Verification recovery context changed')
    if (!this.verificationBarrierCurrent(plan, binding) || this.verifying.has(binding.attemptId))
      throw new ApplicationFault('writer_indeterminate', 'Verification resources are not quiescent', 'reconcile')
    this.store.queue.cancel('application.verify', parked.key)
    this.enqueue('application.verify', parked.key, plan)
    this.store.events.append({ topic: 'application.verification.retry', entityRef: candidate.contract.workId,
      payload: { workId: candidate.contract.workId, blockedId } })
  }
  start(): void {
    if (this.closing) throw new Error('A closed execution consumer cannot start')
    if (this.started) return
    this.started = true
    // A same-process host cannot survive a coordinator crash. Preserve uncertainty on reopen.
    this.store.uow.atomic(() => {
      for (const ticket of this.store.domain.tickets.list<Ticket>()) {
        const binding = this.store.bindings.current<IngressBinding>(ticket.id)
        if (
          binding &&
          ['controlled-product-fixture', 'codex-native'].includes(binding.source) &&
          binding.state !== 'ended'
        ) {
          this.store.bindings.record({ ...binding, state: 'stopping' })
          this.enqueue('runtime.reconcile', binding.attemptId, ticket.id)
        }
      }
    })
    this.effects.start()
    this.timer = setInterval(() => this.effects.kick(), 50)
    this.timer.unref()
  }
  private enqueue(kind: string, id: string, payload: unknown) {
    this.store.queue.enqueue(
      kind,
      id,
      JSON.stringify(payload),
      this.store.queue.maxSeq() + 1,
      0,
      new Date().toISOString(),
    )
    this.store.uow.afterCommit(() => this.effects.kick())
  }
  private authorized(mandate: Ticket['mandate']): boolean {
    const parsed = ContractRefSchema.safeParse(mandate.basis.scope?.contract)
    const contract = parsed.success && this.store.product.contracts.getByRef(parsed.data)
    return (
      mandate.actor.id === this.principal.userId &&
      !!contract &&
      parsed.success &&
      this.store.authority.isCurrent(parsed.data) &&
      (!contract.scope.expiresAt || Date.parse(contract.scope.expiresAt) > Date.now())
    )
  }
  private current(intent: Intent | AttemptRef): Ticket | undefined {
    const ticket = this.store.domain.tickets.get<Ticket>(intent.ticketId)
    const contract = this.store.product.contracts.getByRef(intent.contract)
    if (
      !ticket ||
      ticket.ended ||
      !this.authorized(ticket.mandate) ||
      ticket.completion?.retired ||
      !same(ticket.completion?.contract, intent.contract) ||
      !this.store.authority.isCurrent(intent.contract) ||
      latestAssignment(ticket)?.id !== intent.assignmentId ||
      latestAssignment(ticket)?.state === 'ended' ||
      !contract ||
      (contract.scope.expiresAt && Date.parse(contract.scope.expiresAt) <= Date.now())
    )
      return undefined
    if ('attemptId' in intent) {
      const binding = this.store.bindings.current<IngressBinding>(intent.ticketId)
      if (!binding || binding.state !== 'active' || !same(attemptOf(binding), attemptOf(intent))) return undefined
    }
    return ticket
  }
  private readyToDispatch(intent: Intent): Ticket | undefined {
    if (this.closing) throw new Later('Execution is shutting down')
    const ticket = this.current(intent)
    if (!ticket) return undefined
    if (this.store.product.dispatchControls.get(intent.contract.workId)?.paused) throw new Later('Dispatch is paused')
    return ticket
  }
  private index(command: RunnerCommand, inputIds: string[], nativeBinding?: NativeQuestionBinding) {
    const value = CommandIndexSchema.parse({ command, inputIds, ...(nativeBinding ? { nativeBinding } : {}) })
    this.store.uow.atomic(() => {
      if (!this.current(command)) throw new UnknownSend('Attempt changed before command registration', 'stale_attempt')
      this.store.commands.record(commandIndex(command.id), canonicalDigest(JsonSchema.parse(value)), () => value)
    })
  }
  private async send(
    runtime: ControlledProductAttempt | NativeProductAttempt,
    command: RunnerCommand,
  ): Promise<NativeDispatch> {
    if (this.waiters.has(command.id)) throw new UnknownSend('An earlier native write is unresolved', 'write_pending')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const observation = new Promise<NativeDispatch>((resolve, reject) => {
        this.waiters.set(command.id, resolve)
        timer = setTimeout(
          () => reject(new UnknownSend('No committed native write fact', 'write_unknown')),
          runtime instanceof NativeProductAttempt ? 15000 : 2500,
        )
      })
      await runtime.feed(command)
      return await observation
    } finally {
      if (timer) clearTimeout(timer)
      this.waiters.delete(command.id)
    }
  }
  private input(ticket: Ticket, ids: string[], initial: boolean) {
    const triggers = ids.flatMap((id) => {
      const input = ticket.inputs.find((item) => item.id === id)
      return input?.kind === 'trigger' ? [this.store.domain.triggers.get<Trigger>(input.triggerId)!] : []
    })
    const supplements = ids
      .map((id) => {
        const input = ticket.inputs.find((item) => item.id === id)!
        return input.kind === 'trigger'
          ? this.store.domain.triggers.get<Trigger>(input.triggerId)!.text
          : 'text' in input
            ? input.text
            : JSON.stringify(input)
      })
      .join('\n\n')
    const text = [initial ? this.store.product.contracts.getByRef(ticket.completion!.contract)!.goal : '', supplements]
      .filter(Boolean)
      .join('\n\n')
    return this.store.payloads.write(
      JsonSchema.parse(
        ExecutionInputSchema.parse({
          inputId: key('execution-input', ticket.id, canonicalDigest(ids)),
          contract: ticket.completion!.contract,
          text,
          contextRefs: [],
          sourceMessageRefs: [
            ...new Set([...(initial ? ticket.origin.triggerIds : []), ...triggers.map((trigger) => trigger.id)]),
          ],
          provenance: initial ? 'authorized_work_input' : 'user_supplement',
        }),
      ),
    ).ref
  }
  private command(spec: AttemptRef, operation: CommandKey): RunnerCommand {
    return RunnerCommandSchema.parse({
      ...attemptOf(spec),
      ...operation,
      id: AttemptSupervisor.commandId(spec, operation),
    })
  }
  private async execute(intent: Intent): Promise<void> {
    const ticket = this.readyToDispatch(intent)
    if (!ticket) return
    if (intent.kind === 'deliver') {
      if (!ticket.undelivered.length) return
      const binding = this.store.bindings.current<IngressBinding>(ticket.id)
      const runtime = binding && this.attempts.get(binding.attemptId)
      if (!binding || binding.state !== 'active' || !runtime)
        throw new UnknownSend('No current physical delivery target', 'delivery_target_unknown')
      const ids = [...ticket.undelivered],
        inputRef = this.input(ticket, ids, false)
      const command = this.command(binding, { kind: 'deliver', inputRef })
      if (this.store.commands.get(commandIndex(command.id))) {
        if (this.store.dispatch.get(command.id, binding.attemptId)?.delivery === 'native_accepted') return
        throw new UnknownSend('A previous input delivery requires reconciliation', 'input_unknown')
      }
      if (!this.readyToDispatch(intent)) return
      this.index(command, ids)
      await this.send(runtime, command)
      return
    }
    const startId = key('product-start', intent.assignmentId)
    if (this.store.commands.get(startId)) {
      // Even if the queue receipt was lost after begin, this checkpoint forbids a second writer.
      const prepared = StartSchema.parse(this.store.commands.get(startId)!.result)
      const pending = this.pendingBegins.get(prepared.spec.attemptId)
      const runtime = this.attempts.get(prepared.spec.attemptId)
      if (runtime && pending) {
        await this.begin(runtime, pending, intent)
        return
      }
      if (
        this.attempts.has(prepared.spec.attemptId) ||
        this.store.bindings.binding<IngressBinding>(prepared.spec.attemptId)?.state === 'ended'
      )
        return
      throw new UnknownSend('Earlier begin needs physical reconciliation', 'start_unknown')
    }
    if (this.attempts.size >= 4) throw new Later('The four controlled execution slots are in use')
    for (const link of this.store.product.links.listByWork(intent.contract.workId)) {
      const binding = this.store.bindings.current<IngressBinding>(link.ticketId)
      if (binding && binding.state !== 'ended') throw new Later('Previous writer barrier is not confirmed')
      const prior = this.store.domain.tickets.get<Ticket>(link.ticketId)
      if (!binding && prior?.assignments.some((item) => item.startedAt || item.state === 'running'))
        throw new UnknownSend('An earlier writer has no registered physical proof', 'unregistered_writer')
    }
    const trigger = this.store.domain.triggers.get<Trigger>(ticket.origin.triggerId)!
    const profileId = String(trigger.meta.profileId)
    const nativeProfile = this.native?.profile.id === profileId ? this.native.profile : undefined
    if (!nativeProfile && !FIXTURE_PROFILES.includes(profileId as (typeof FIXTURE_PROFILES)[number]))
      throw new UnknownSend('Only explicit fixture profiles are enabled', 'unsupported_profile')
    const mode = nativeProfile
      ? 'native'
      : z.enum(['question', 'pass', 'fail', 'slow']).parse(profileId.slice('profile-fixture-'.length))
    const contract = this.store.product.contracts.getByRef(intent.contract)!
    const scope = contract.scope
    if (
      !nativeProfile &&
      (scope.allowedPaths.length !== 1 ||
        scope.allowedPaths[0] !== 'src/' ||
        scope.excludedPaths.length ||
        scope.externalActions.length)
    )
      throw new UnknownSend('This fixture only supports its fixed src/ scratch grant', 'unsupported_scope')
    const previous = this.store.bindings.current<IngressBinding>(ticket.id)
    const attempt = AttemptRefSchema.parse({
      ticketId: intent.ticketId,
      assignmentId: intent.assignmentId,
      contract: intent.contract,
      attemptId: `attempt-${randomUUID()}`,
      fenceEpoch: (previous?.fenceEpoch ?? 0) + 1,
    })
    const nativeProject =
      nativeProfile && (this.projectForContract ? this.projectForContract(contract) : this.native?.projects.find((project) => project.id === contract.scope.projectId))
    if (nativeProfile && !nativeProject)
      throw new UnknownSend('Native project is not registered', 'unsupported_project')
    const workspace = this.workspaces.reserve({
      projectPath: nativeProject ? nativeProject.path : this.scratchProject,
      assignment: attempt,
    })
    const initialInputRef = this.input(ticket, [...ticket.undelivered], true)
    const policySnapshotRef = this.store.payloads.write(
      JsonSchema.parse(
        nativeProfile
          ? NativeCodexSettingsSchema.parse({
              kind: 'codex-native-settings/1',
              workspacePath: workspace.path,
              scope,
              approvalPolicy: this.native!.approvalPolicy,
              ...(this.native!.model ? { model: this.native!.model } : {}),
              timeoutMs: 600000,
            })
          : {
              kind: 'fixed-scratch-fixture-policy/1',
              scope,
              executable: process.execPath,
              userTextIsExecutable: false,
            },
      ),
    ).ref
    const preparedPolicyRef = nativeProfile
      ? policySnapshotRef
      : this.store.payloads.write(
          JsonSchema.parse(
            PreparedExecutionPolicySchema.parse({
              ...attempt,
              requestedPolicyRevision: 'fixed-scratch-policy-1',
              nativeAppliedSettingsRef: policySnapshotRef,
              effectiveConfigFingerprint: canonicalDigest(JsonSchema.parse(scope)),
              enforcement: 'advisory',
              verification: 'passed',
              evidenceRef: policySnapshotRef,
            }),
          ),
        ).ref
    const spec = AttemptSpecSchema.parse({
      ...attempt,
      profile: nativeProfile ?? {
        id: profileId,
        revision: 1,
        driverId: 'controlled-product-fixture',
        driverApiMajor: 1,
        driverRelease: '0.1.0-fixture',
        executable: process.execPath,
        argv: [],
        expectedVersion: process.version,
        nativeConfigRef: policySnapshotRef,
        permissionPolicyRevision: 'fixed-scratch-policy-1',
        requiredFeatures: [],
      },
      workspaceRef: key('workspace', attempt.attemptId),
      resourceLeaseRef: key('lease', attempt.attemptId),
      policySnapshotRef,
      budgetRef: nativeProfile ? 'native-bounded-work' : 'fixture-fixed-operation',
    })
    const binding: IngressBinding = {
      ...attempt,
      runnerIdentityRef: key(nativeProfile ? 'native-host' : 'controlled-host', attempt.attemptId),
      source: nativeProfile ? 'codex-native' : 'controlled-product-fixture',
      state: 'active',
      resources: [],
    }
    let command = this.command(spec, { kind: 'begin', inputRef: initialInputRef, preparedPolicyRef })
    // File preparation precedes the transaction; launch always follows its durable checkpoint.
    this.store.uow.atomic(() => {
      if (!this.readyToDispatch(intent)) throw new Later('Work changed during preparation')
      this.store.commands.record(
        startId,
        canonicalDigest(JsonSchema.parse({ spec, initialInputRef, preparedPolicyRef, mode })),
        () => ({ spec, initialInputRef, preparedPolicyRef, mode }),
      )
      this.store.bindings.record(binding)
      this.store.bindings.setCurrent(ticket.id, attempt.attemptId)
      if (!nativeProfile) this.index(command, [...ticket.undelivered])
      this.store.events.append({
        topic: 'application.execution.prepared',
        entityRef: intent.contract.workId,
        payload: { workId: intent.contract.workId, attempt },
      })
    })
    const producer = producerForBinding(binding)
    const environmentPlan = nativeProject && nativeProject.environment
      ? this.environments!.plan(attempt, nativeProject.path, workspace.path, nativeProject.environment)
      : undefined
    mkdirSync(join(this.stateRoot, 'receipts'), { recursive: true, mode: 0o700 })
    const runtime = nativeProfile
      ? new NativeProductAttempt(
          spec,
          this.store,
          workspace.path,
          join(this.stateRoot, 'runners', attempt.attemptId),
          producer,
          this.ingress.bind(producer),
          () => !!this.current(attempt),
          environmentPlan ? { planRef: environmentPlan, capture: () => this.environments!.capture(attempt) } : undefined,
        )
      : new ControlledProductAttempt(
          spec,
          this.store,
          contract,
          mode,
          preparedPolicyRef,
          workspace.path,
          join(this.stateRoot, 'receipts', `${attempt.attemptId}.jsonl`),
          producer,
          this.ingress.bind(producer),
          () => !!this.current(attempt),
        )
    this.attempts.set(attempt.attemptId, runtime)
    try {
      const running = await runtime.launch()
      if (runtime instanceof NativeProductAttempt) {
        if (!runtime.preparedPolicyRef) throw new Error('Native policy preparation has no committed proof')
        command = this.command(spec, {
          kind: 'begin',
          inputRef: initialInputRef,
          preparedPolicyRef: runtime.preparedPolicyRef,
        })
        this.index(command, [...ticket.undelivered])
      }
      const run = (async () => {
        try {
          const exit = await running.waitExit()
          const barrier = await runtime.quiesce()
          this.store.uow.atomic(() => {
            const current = this.current(intent)
            if (!current || this.store.bindings.current(ticket.id)?.attemptId !== attempt.attemptId) return
            if (exit.reason !== 'terminal' || current.undelivered.length) {
              this.application.core.reportAssignment(ticket.id, intent.assignmentId, {
                state: 'failed',
                summary: '执行结束，未形成输入已完整消费的当前候选',
              })
              return
            }
            this.application.core.reportAssignment(ticket.id, intent.assignmentId, {
              state: 'ready',
              summary: '当前变更已停止写入，等待注册检查与人工审阅',
            })
            const candidate = this.application.core.completionCandidate(ticket.id)
            if (candidate) this.enqueue('application.verify', attempt.attemptId, { candidate, barrier })
          })
        } finally {
          if (this.store.bindings.binding<IngressBinding>(attempt.attemptId)?.state === 'ended') {
            await runtime.dispose()
            this.attempts.delete(attempt.attemptId)
            this.pendingBegins.delete(attempt.attemptId)
          }
        }
      })()
      this.runs.add(run)
      void run.catch((error) => this.recordFailure(attempt, error)).finally(() => this.runs.delete(run))
      this.pendingBegins.set(attempt.attemptId, command)
      await this.begin(runtime, command, intent)
    } catch (error) {
      if (error instanceof Later && this.pendingBegins.has(attempt.attemptId)) throw error
      this.store.uow.atomic(() => {
        const known = this.store.bindings.binding<IngressBinding>(attempt.attemptId)!
        if (known.state !== 'ended') {
          this.store.bindings.record({ ...known, state: 'stopping' })
          this.enqueue('runtime.reconcile', attempt.attemptId, ticket.id)
        }
      })
      throw new UnknownSend(`Controlled begin requires reconciliation: ${String(error)}`, 'begin_unknown')
    }
  }
  private async begin(
    runtime: ControlledProductAttempt | NativeProductAttempt,
    command: RunnerCommand,
    intent: Intent,
  ): Promise<void> {
    if (!this.readyToDispatch(intent)) return
    // Only a live in-memory command proven not yet fed may wait through a dispatch hold.
    this.pendingBegins.delete(command.attemptId)
    try {
      await this.send(runtime, command)
    } catch (error) {
      this.store.uow.atomic(() => {
        const binding = this.store.bindings.binding<IngressBinding>(command.attemptId)!
        if (binding.state !== 'ended') {
          this.store.bindings.record({ ...binding, state: 'stopping' })
          this.enqueue('runtime.reconcile', command.attemptId, command.ticketId)
        }
      })
      throw new UnknownSend(`Controlled begin requires reconciliation: ${String(error)}`, 'begin_unknown')
    }
  }
  private recordFailure(attempt: AttemptRef, error: unknown) {
    this.store.uow.atomic(() => {
      const diagnostic = { attemptId: attempt.attemptId, error: String(error).slice(0, 2000) }
      this.store.commands.record(
        key('product-runtime-failure', attempt.attemptId),
        canonicalDigest(diagnostic),
        () => diagnostic,
      )
      this.store.events.append({
        topic: 'application.execution.held',
        entityRef: attempt.contract.workId,
        payload: { workId: attempt.contract.workId, attemptId: attempt.attemptId, reason: 'controlled_runtime_failed' },
      })
      const binding = this.store.bindings.binding<IngressBinding>(attempt.attemptId)
      if (binding && binding.state !== 'ended') {
        this.store.bindings.record({ ...binding, state: 'stopping' })
        this.enqueue('runtime.reconcile', attempt.attemptId, attempt.ticketId)
      }
    })
  }
  private reduce(fact: CriticalFact, payload: RuntimeFactPayload) {
    if (payload.kind === 'question.opened') this.application.questions.open(payload.value)
    if (payload.kind === 'answer.observed') {
      const index = this.store.commands.get(
        commandIndex(key('native-answer', payload.value.answerId, payload.value.targetBindingId)),
      )
      const command = index && CommandIndexSchema.parse(index.result)
      if (!command || command.command.kind !== 'answer') throw new Error('Native answer has no committed command index')
      const target = command.nativeBinding
      if (!target) throw new Error('Native answer has no original target binding')
      this.application.questions.observe(payload.value, target)
    }
    if (payload.kind === 'dispatch.observed') {
      const dispatch = payload.value
      const index = this.store.commands.get(commandIndex(dispatch.commandId))
      if (!index) throw new Error('Native dispatch has no committed command index')
      const { command, inputIds } = CommandIndexSchema.parse(index.result)
      if (!same(attemptOf(command), attemptOf(fact))) throw new Error('Native dispatch has another attempt identity')
      if (command.kind !== 'answer') {
        if (
          dispatch.delivery === 'written' &&
          this.store.dispatch.get(command.id, fact.attemptId)?.delivery !== 'native_accepted'
        )
          this.store.dispatch.markWritten(command.id, fact.attemptId)
        if (dispatch.delivery === 'native_accepted') {
          this.store.dispatch.markAccepted(command.id, fact.attemptId)
          if (command.kind === 'begin') this.application.core.assignmentStarted(fact.ticketId, fact.assignmentId)
          this.application.core.inputsDelivered(fact.ticketId, fact.assignmentId, inputIds)
          this.application.core.inputsReadAssignment(fact.ticketId, fact.assignmentId, inputIds)
        }
      }
      this.store.uow.afterCommit(() => this.waiters.get(dispatch.commandId)?.(dispatch))
    }
  }
  async close(): Promise<void> {
    this.closing = true
    if (this.timer) clearInterval(this.timer)
    await this.effects.drain()
    await Promise.allSettled([...this.attempts.values()].map((runtime) => runtime.dispose()))
    await Promise.allSettled([...this.runs])
  }
}
