import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  CriticalFactSchema,
  JsonSchema,
  PreparedExecutionPolicySchema,
  RunnerCommandSchema,
  parseRuntimeFactPayload,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { AttemptSpec, RunnerCommand, ServeExit } from '@personal-agent/contracts'
import type { ProductStore } from '@personal-agent/storage'
import type { FactSink, RunningAttempt } from '../../../packages/execution/src/contracts.ts'
import { RunnerLink } from '../../runner/src/runner-link-client.ts'
import type { RunnerLinkOptions, SpawnedRunner } from '../../runner/src/runner-link-client.ts'
import { attachRunningAttempt } from '../../../packages/execution/src/attached-attempt.ts'
import type { AttachedAttempt } from '../../../packages/execution/src/attached-attempt.ts'
import { RunnerPayloadStore } from '../../runner/src/payload-store.ts'
import { endpointDirectory } from '../../runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery, runnerResourceManifestDigest, verifiedRunnerInspection } from '../runner-link.ts'
import type { RunnerEndpoint } from '../runner-link.ts'
import { registerRecoveryRunner } from '../runner-registry.ts'
import { confirmOwnedQuiescence, ownedResourceManifestDigest } from '../resource-barrier.ts'
import type { IngressBinding, RuntimeProducer } from '../runtime-ingress.ts'
import { storedAttemptPayloads } from '../stored-ingress.ts'
import { key } from '@personal-agent/orchestrator-core'

/** Trusted Node composition only; no profile, environment flag or public request can select it. */
export type NativeRunnerLinkFactory = (options: RunnerLinkOptions) => Pick<RunnerLink, 'spawnAttempt'>

/** Owns one original Runner connection. Recovery may reattach; it never replays native business. */
export class NativeProductAttempt {
  readonly spec: AttemptSpec
  preparedPolicyRef: string | undefined
  private readonly store: ProductStore
  private readonly producer: RuntimeProducer
  private readonly stateRoot: string
  private readonly workspacePath: string
  private readonly sink: FactSink
  private readonly current: () => boolean
  private readonly recoveryRoot = mkdtempSync('/tmp/pa-native-r-')
  private readonly answerWrites = new Map<string, () => void>()
  private child: SpawnedRunner | undefined
  private endpoint: RunnerEndpoint | undefined
  private disposed = false
  private readonly createLink: NativeRunnerLinkFactory
  private callbackOwner: AttachedAttempt | undefined
  private callbackTask: Promise<void> | undefined
  private callbacksStopped = false
  private recovered = false
  private terminal: ServeExit | undefined
  get connected(): boolean { return !!this.callbackOwner && !this.callbacksStopped }
  private readonly environment: { planRef: string; capture(): void } | undefined
  constructor(
    spec: AttemptSpec,
    store: ProductStore,
    workspacePath: string,
    stateRoot: string,
    producer: RuntimeProducer,
    sink: FactSink,
    current: () => boolean,
    environment?: { planRef: string; capture(): void },
    createLink: NativeRunnerLinkFactory = options => new RunnerLink(options),
  ) {
    this.spec = spec
    this.store = store
    this.workspacePath = workspacePath
    this.stateRoot = stateRoot
    this.producer = producer
    this.sink = sink
    this.current = current
    this.environment = environment
    this.createLink = createLink
  }
  private connection() {
    if (!this.endpoint) {
      const directory = endpointDirectory(this.recoveryRoot, this.spec.attemptId)
      const socketPath = join(directory, 'runner.sock'),
        stat = lstatSync(socketPath)
      this.endpoint = {
        socketPath,
        credentialPath: join(directory, 'runner.credential'),
        socketIdentity: { dev: stat.dev, ino: stat.ino },
      }
    }
    return connectRunnerRecovery(this.endpoint, this.producer)
  }
  private async register() {
    const proof = await this.connection().inspect()
    const inspection = verifiedRunnerInspection(proof).value
    this.store.uow.atomic(() => {
      const binding = this.store.bindings.binding<IngressBinding>(this.spec.attemptId)
      if (!binding || binding.state === 'ended')
        throw new Error('Native resource registration lost its current binding')
      const known = new Map(binding.resources.map((resource) => [resource.ref, resource]))
      for (const resource of inspection.resources)
        known.set(resource.ref, { ref: resource.ref, ownership: resource.ownership })
      this.store.bindings.record({ ...binding, resources: [...known.values()] })
    })
    registerRecoveryRunner(this.store, proof)
  }
  /** Shared Node-internal payload callback for stdio and an explicitly attached consumer. */
  async readPayload(reference: string) {
    if (this.environment?.planRef === reference) {
      await this.register()
      if (!this.current() || this.store.bindings.binding(this.spec.attemptId)?.state !== 'active')
        throw new Error('Preparation authorization is no longer current')
    }
    return storedAttemptPayloads(this.store).read(reference)
  }
  /** Shared original answer admission; success is void, never a reusable approval token. */
  async beforeNativeWrite(command: RunnerCommand): Promise<void> {
    RunnerCommandSchema.parse(command)
    const indexed = this.store.commands.get(key('product-command', command.id))?.result as
      | { command?: unknown }
      | undefined
    if (
      !this.current() ||
      !indexed?.command ||
      canonicalDigest(JsonSchema.parse(indexed.command)) !== canonicalDigest(JsonSchema.parse(command))
    )
      throw new Error('Native answer write is not currently authorized')
    const before = this.answerWrites.get(command.id)
    if (!before) throw new Error('Native answer has no live write admission')
    before()
    this.answerWrites.delete(command.id)
  }
  async nativeWriteDecision(command: RunnerCommand): Promise<{ allowed: boolean }> {
    try {
      await this.beforeNativeWrite(command)
      return { allowed: true }
    } catch {
      return { allowed: false }
    }
  }
  /** Keep immutable copying, original registration and policy readiness in the original fact path. */
  async recordFact(incoming: unknown, local: RunnerPayloadStore, prepared: () => void) {
    const fact = CriticalFactSchema.parse(incoming)
    if (fact.attemptId !== this.spec.attemptId || fact.source !== this.producer.source)
      throw new Error('Native fact has another producer')
    const payload = local.read(fact.payloadRef)
    const restored = this.store.payloads.write(payload)
    if (restored.ref !== fact.payloadRef) throw new Error('Native immutable payload identity changed')
    await this.register()
    if (fact.kind === 'policy.prepared') this.environment?.capture()
    const receipt = await this.sink.record(fact)
    if (fact.kind === 'turn.ended') {
      const parsed = parseRuntimeFactPayload(fact, payload)
      if (parsed.kind === 'turn.ended') this.terminal = {
        reason: parsed.value.outcome === 'completed' ? 'terminal' : parsed.value.outcome === 'cancelled' ? 'cancelled' : 'error',
        evidenceRefs: [fact.factId],
      }
    }
    if (fact.kind === 'policy.prepared') {
      const policy = PreparedExecutionPolicySchema.parse((payload as { value: unknown }).value)
      this.preparedPolicyRef = this.store.payloads.write(JsonSchema.parse(policy)).ref
      prepared()
    }
    return receipt
  }
  async launch(): Promise<RunningAttempt> {
    mkdirSync(this.stateRoot, { recursive: true, mode: 0o700 })
    const local = new RunnerPayloadStore(join(this.stateRoot, 'payloads'))
    let prepared!: () => void, failed!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      prepared = resolve
      failed = reject
    })
    void ready.catch(() => undefined)
    const recordFact = (incoming: unknown) => this.recordFact(incoming, local, prepared)
    const link = this.createLink({
      executable: process.execPath,
      entry: fileURLToPath(new URL('../../runner/src/runner-service-entry.ts', import.meta.url)),
      args: ['codex-native'],
      stateRoot: this.stateRoot,
      env: { PA_RUNNER_CWD: this.workspacePath, PA_RUNNER_RECOVERY_ROOT: this.recoveryRoot,
        ...(this.environment ? { PA_RUNNER_ENVIRONMENT_PLAN: this.environment.planRef } : {}) },
      producer: { source: this.producer.source, runnerIdentityRef: this.producer.runnerIdentityRef },
      payloads: { read: reference => this.readPayload(reference) },
      beforeNativeWrite: command => this.beforeNativeWrite(command),
    })
    this.child = await link.spawnAttempt(this.spec, recordFact)
    void this.child.waitExit().then(() => failed(new Error('Native Runner ended before policy preparation')))
    const timeout = setTimeout(() => failed(new Error('Native policy preparation timed out')), 45000)
    try {
      await this.register()
      await ready
    } finally {
      clearTimeout(timeout)
    }
    if (!this.current()) throw new Error('Work changed during native preparation')
    const endpoint = this.endpoint
    if (!endpoint) throw new Error('Native Runner registration is unavailable')
    return this.attachCallbacks(local, prepared)
  }
  /** Reconnect only to the original durable registration; never spawn or resend begin. */
  async resume(endpoint: RunnerEndpoint): Promise<RunningAttempt> {
    if (this.child || this.callbackOwner || !this.current()) throw new Error('Native resume has no current original attempt')
    this.endpoint = structuredClone(endpoint)
    this.recovered = true
    const proof = await this.connection().inspect(), inspection = verifiedRunnerInspection(proof).value
    const binding = this.store.bindings.current<IngressBinding>(this.spec.ticketId)
    const terminal = inspection.state === 'terminated'
    if (!binding || binding.state !== 'active' || !this.current() ||
        (!terminal && (inspection.state !== 'serving' || inspection.admission !== 'open')) ||
        inspection.coverage !== 'complete_owned_resources' ||
        inspection.resources.some(resource => resource.writer === 'indeterminate') ||
        (terminal && inspection.resources.some(resource => resource.writer !== 'quiescent')) ||
        ownedResourceManifestDigest(binding.resources) !== ownedResourceManifestDigest(inspection.resources))
      throw new Error('Native resume requires the same active complete original resource set')
    registerRecoveryRunner(this.store, proof)
    if (terminal) await this.restoreTerminal()
    try { return await this.attachCallbacks(new RunnerPayloadStore(join(this.stateRoot, 'payloads')), () => {}, !terminal) }
    catch (error) { await this.stopCallbacks(); throw error }
  }
  /** An already-ACKed terminal must come from its original committed fact/payload, never inspection. */
  private async restoreTerminal() {
    const rows = this.store.observations.forAttempt(this.spec.attemptId, 10001)
    if (rows.length > 10000) throw new Error('Original terminal history exceeds the recovery bound')
    const row = rows.findLast(value => value.kind === 'turn.ended' && value.disposition === 'business')
    if (!row || row.ticketId !== this.spec.ticketId || row.assignmentId !== this.spec.assignmentId ||
        row.fenceEpoch !== this.spec.fenceEpoch || canonicalDigest(JsonSchema.parse(row.contract)) !== canonicalDigest(JsonSchema.parse(this.spec.contract)))
      throw new Error('Original committed terminal fact is missing')
    const fact = CriticalFactSchema.parse({ ...this.producer.attempt, factId: row.factId,
      source: this.producer.source, kind: 'turn.ended', payloadRef: row.payloadRef })
    const payload = await storedAttemptPayloads(this.store).read(row.payloadRef)
    const digest = canonicalDigest(JsonSchema.parse(payload)), receipt = this.store.facts.get(row.factId)
    if (digest !== row.payloadSha256 || row.payloadRef !== `payload:${digest}` ||
        receipt?.payloadDigest !== canonicalDigest(JsonSchema.parse({ fact, payloadDigest: digest })))
      throw new Error('Original terminal fact has no matching durable receipt')
    const parsed = parseRuntimeFactPayload(fact, payload)
    if (parsed.kind !== 'turn.ended') throw new Error('Original terminal payload has another kind')
    this.terminal = { reason: parsed.value.outcome === 'completed' ? 'terminal' : parsed.value.outcome === 'cancelled' ? 'cancelled' : 'error',
      evidenceRefs: [row.factId] }
  }
  /** A failed takeover owns only its local connection/temp root, never the original Runner's state. */
  async releaseRecoveryConnection(): Promise<void> {
    if (this.child) throw new Error('A launched Runner must use its original lifecycle')
    await this.stopCallbacks()
    rmSync(this.recoveryRoot, { recursive: true, force: true })
  }
  private async attachCallbacks(local: RunnerPayloadStore, prepared: () => void, connect = true): Promise<RunningAttempt> {
    const endpoint = this.endpoint!
    const running: RunningAttempt = {
      attemptId: this.spec.attemptId,
      attachPort: structuredClone({ registration: endpoint, producer: this.producer }),
      attachCallbacks: {
        fact: incoming => this.recordFact(incoming, local, prepared),
        payload: request => this.readPayload(request.reference),
        nativeWrite: intent => this.nativeWriteDecision(intent.command),
      },
      feed: (command) => this.feed(command),
      waitExit: async () => {
        if (this.recovered) {
          for (;;) {
            const inspection = verifiedRunnerInspection(await this.connection().inspect()).value
            if (inspection.state === 'terminated') {
              if (!this.terminal) throw new Error('Original terminal fact has not been durably observed')
              await this.stopCallbacks()
              return this.terminal
            }
            if (this.callbacksStopped) throw new Error('Original callback lease is no longer current')
            await new Promise(resolve => setTimeout(resolve, 20))
          }
        }
        const value = await this.child!.waitExit()
        await this.stopCallbacks()
        return value.exit
      },
      stop: async () => {
        await this.quiesce()
        return { quiescence: 'confirmed', evidenceRefs: ['native-owned-resource-barrier'] }
      },
    }
    if (!connect) return running
    // Each coordinator connection owns a distinct lease. An old poller cannot share a successor lease.
    const owner = attachRunningAttempt(running, key('native-callback-owner', running.attemptId, randomUUID()))
    // Bind before begin. Immutable pending preparation facts may replay with their original IDs.
    this.callbackOwner = owner
    try { await owner.pollOnce() }
    catch (error) { await this.stopCallbacks(); throw error }
    if (!this.current()) { await this.stopCallbacks(); throw new Error('Work changed during callback attachment') }
    this.callbackTask = (async () => {
      while (!this.callbacksStopped) {
        try {
          if (!await owner.pollOnce()) await new Promise(resolve => setTimeout(resolve, 10))
        } catch {
          // A lost lease is not permission to bind again or replay a business command.
          this.callbacksStopped = true
          owner.stop()
        }
      }
    })()
    return running
  }
  private async stopCallbacks() {
    this.callbacksStopped = true
    this.callbackOwner?.stop()
    await this.callbackTask
  }
  allowAnswer(id: string, beforeWrite: () => void) {
    this.answerWrites.set(id, beforeWrite)
  }
  async feed(command: RunnerCommand) {
    if (!this.current() || this.callbacksStopped || (!this.child && !this.recovered)) throw new Error('Native command has no current Runner')
    if (command.kind === 'begin') this.environment?.capture()
    if (this.recovered) {
      if (command.kind === 'begin') throw new Error('A recovered Runner cannot receive another begin')
      if (!this.callbackOwner) throw new Error('Original callback attachment is unavailable')
      await this.callbackOwner.feed(command)
    } else await this.child!.command(command)
  }
  async quiesce() {
    const command = RunnerCommandSchema.parse({
      ticketId: this.spec.ticketId,
      assignmentId: this.spec.assignmentId,
      attemptId: this.spec.attemptId,
      fenceEpoch: this.spec.fenceEpoch,
      contract: this.spec.contract,
      id: key('native-close', this.spec.attemptId),
      kind: 'cancel',
    })
    if (command.kind !== 'cancel') throw new Error('Native close requires cancellation')
    const connection = this.connection()
    const proof = await connection.cancel(command)
    const inspection = verifiedRunnerInspection(proof).value
    const receipt = confirmOwnedQuiescence(this.store, proof).result
    // The Store barrier is committed before this call. B's endpoint only accepts the full
    // runner inventory digest (writer/evidence included) and an idempotent confirmation ID;
    // it never creates the Store receipt or ends the binding itself.
    const confirmationId = key('terminal-finalize', this.spec.attemptId, receipt.proofRef)
    if (!connection.finalize) throw new Error('Runner does not expose postcommit terminal finalize')
    await this.finalizeWithRetry(connection, {
      attempt: this.spec,
      confirmationId,
      resourceManifestDigest: runnerResourceManifestDigest(inspection.resources),
      proofRef: receipt.proofRef,
    })
    await this.stopCallbacks()
    return receipt
  }
  /** Retry only the same postcommit confirmation after a transport-level unknown response. */
  private async finalizeWithRetry(connection: ReturnType<typeof connectRunnerRecovery>, confirmation: Parameters<NonNullable<ReturnType<typeof connectRunnerRecovery>['finalize']>>[0]) {
    if (!connection.finalize) throw new Error('Runner does not expose postcommit terminal finalize')
    try {
      return await connection.finalize(confirmation)
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code !== 'unavailable' && code !== 'timeout' && code !== 'unknown_outcome') throw error
      // The confirmation ID is stable and B finalization is idempotent. A second request can
      // reconcile a lost HTTP response without repeating a business/native effect.
      return connection.finalize(confirmation)
    }
  }
  async dispose() {
    if (this.disposed) return
    if (this.store.bindings.binding(this.spec.attemptId)?.state !== 'ended') await this.quiesce()
    this.disposed = true
    await this.stopCallbacks()
    await this.child?.close()
    rmSync(this.recoveryRoot, { recursive: true, force: true })
  }
}
