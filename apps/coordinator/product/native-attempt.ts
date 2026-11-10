import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CriticalFactSchema,
  JsonSchema,
  PreparedExecutionPolicySchema,
  RunnerCommandSchema,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { AttemptSpec, RunnerCommand } from '@personal-agent/contracts'
import type { ProductStore } from '@personal-agent/storage'
import type { FactSink, RunningAttempt } from '../../../packages/execution/src/contracts.ts'
import { RunnerLink } from '../../runner/src/runner-link-client.ts'
import type { SpawnedRunner } from '../../runner/src/runner-link-client.ts'
import { RunnerPayloadStore } from '../../runner/src/payload-store.ts'
import { endpointDirectory } from '../../runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../runner-link.ts'
import type { RunnerEndpoint } from '../runner-link.ts'
import { registerRecoveryRunner } from '../runner-registry.ts'
import { confirmOwnedQuiescence } from '../resource-barrier.ts'
import type { IngressBinding, RuntimeProducer } from '../runtime-ingress.ts'
import { storedAttemptPayloads } from '../stored-ingress.ts'
import { key } from '@personal-agent/orchestrator-core'

/** Owns one independent Runner; recovery can inspect/cancel it but cannot replay native business. */
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
  ) {
    this.spec = spec
    this.store = store
    this.workspacePath = workspacePath
    this.stateRoot = stateRoot
    this.producer = producer
    this.sink = sink
    this.current = current
    this.environment = environment
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
  async launch(): Promise<RunningAttempt> {
    mkdirSync(this.stateRoot, { recursive: true, mode: 0o700 })
    const local = new RunnerPayloadStore(join(this.stateRoot, 'payloads'))
    let prepared!: () => void, failed!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      prepared = resolve
      failed = reject
    })
    void ready.catch(() => undefined)
    const link = new RunnerLink({
      executable: process.execPath,
      entry: fileURLToPath(new URL('../../runner/src/runner-service-entry.ts', import.meta.url)),
      args: ['codex-native'],
      stateRoot: this.stateRoot,
      env: { PA_RUNNER_CWD: this.workspacePath, PA_RUNNER_RECOVERY_ROOT: this.recoveryRoot,
        ...(this.environment ? { PA_RUNNER_ENVIRONMENT_PLAN: this.environment.planRef } : {}) },
      producer: { source: this.producer.source, runnerIdentityRef: this.producer.runnerIdentityRef },
      payloads: { read: async reference => {
        if (this.environment?.planRef === reference) {
          await this.register()
          if (!this.current() || this.store.bindings.binding(this.spec.attemptId)?.state !== 'active') throw new Error('Preparation authorization is no longer current')
        }
        return storedAttemptPayloads(this.store).read(reference)
      } },
      beforeNativeWrite: async (command) => {
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
      },
    })
    this.child = await link.spawnAttempt(this.spec, async (incoming) => {
      const fact = CriticalFactSchema.parse(incoming)
      if (fact.attemptId !== this.spec.attemptId || fact.source !== this.producer.source)
        throw new Error('Native fact has another producer')
      const payload = local.read(fact.payloadRef)
      const restored = this.store.payloads.write(payload)
      if (restored.ref !== fact.payloadRef) throw new Error('Native immutable payload identity changed')
      await this.register()
      if (fact.kind === 'policy.prepared') this.environment?.capture()
      const receipt = await this.sink.record(fact)
      if (fact.kind === 'policy.prepared') {
        const policy = PreparedExecutionPolicySchema.parse((payload as { value: unknown }).value)
        this.preparedPolicyRef = this.store.payloads.write(JsonSchema.parse(policy)).ref
        prepared()
      }
      return receipt
    })
    void this.child.waitExit().then(() => failed(new Error('Native Runner ended before policy preparation')))
    const timeout = setTimeout(() => failed(new Error('Native policy preparation timed out')), 45000)
    try {
      await this.register()
      await ready
    } finally {
      clearTimeout(timeout)
    }
    if (!this.current()) throw new Error('Work changed during native preparation')
    return {
      attemptId: this.spec.attemptId,
      feed: (command) => this.feed(command),
      waitExit: async () => (await this.child!.waitExit()).exit,
      stop: async () => {
        await this.quiesce()
        return { quiescence: 'confirmed', evidenceRefs: ['native-owned-resource-barrier'] }
      },
    }
  }
  allowAnswer(id: string, beforeWrite: () => void) {
    this.answerWrites.set(id, beforeWrite)
  }
  async feed(command: RunnerCommand) {
    if (!this.current() || !this.child) throw new Error('Native command has no current Runner')
    if (command.kind === 'begin') this.environment?.capture()
    await this.child.command(command)
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
    const proof = await this.connection().cancel(command)
    return confirmOwnedQuiescence(this.store, proof).result
  }
  async dispose() {
    if (this.disposed) return
    if (this.store.bindings.binding(this.spec.attemptId)?.state !== 'ended') await this.quiesce()
    this.disposed = true
    await this.child?.close()
    rmSync(this.recoveryRoot, { recursive: true, force: true })
  }
}
