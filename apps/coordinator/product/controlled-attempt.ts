import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AttemptSpec, ContractRevision, RunnerCommand } from '@personal-agent/contracts'
import type { ProductStore } from '@personal-agent/storage'
import { ControlledRunnerHost, ProcessHost } from '../../runner/src/index.ts'
import type { FactSink, RunningAttempt } from '../../../packages/execution/src/contracts.ts'
import type { IngressBinding, RuntimeProducer } from '../runtime-ingress.ts'
import { storedAttemptPayloads } from '../stored-ingress.ts'
import { createRunnerCredential, connectRunnerRecovery, serveRunnerRecovery } from '../runner-link.ts'
import type { RunnerEndpoint, RunnerState } from '../runner-link.ts'
import { registerRecoveryRunner } from '../runner-registry.ts'
import { confirmOwnedQuiescence } from '../resource-barrier.ts'
import { ProductFixtureDriver } from './fixture-driver.ts'

/** Same-process controlled lane. Its recovery endpoint does not survive coordinator SIGKILL. */
export class ControlledProductAttempt {
  private closed = false
  private terminated = false
  private stopping: Promise<RunnerState> | undefined
  private disposing: Promise<void> | undefined
  private spawning: Promise<unknown> | undefined
  private handle: RunningAttempt | undefined
  private readonly processes: ProcessHost
  private readonly host: ControlledRunnerHost
  private recovery: Awaited<ReturnType<typeof serveRunnerRecovery>> | undefined
  private endpoint: RunnerEndpoint | undefined
  private readonly recoveryRoot = mkdtempSync('/tmp/pa-run-')
  private readonly answerWrites = new Map<string, () => void>()
  private readonly inventory = new Map<string, { quiescent: boolean; evidence: readonly string[] }>()
  readonly spec: AttemptSpec
  private readonly store: ProductStore
  private readonly producer: RuntimeProducer
  private readonly current: () => boolean
  constructor(
    spec: AttemptSpec,
    store: ProductStore,
    contract: ContractRevision,
    mode: string,
    preparedPolicyRef: string,
    workspacePath: string,
    receiptsPath: string,
    producer: RuntimeProducer,
    sink: FactSink,
    current: () => boolean,
  ) {
    this.spec = spec
    this.store = store
    this.producer = producer
    this.current = current
    const owner = this
    class RegisteredProcesses extends ProcessHost {
      override async spawn(input: Parameters<ProcessHost['spawn']>[0]) {
        if (owner.closed || !owner.current()) throw new Error('Attempt admission closed before spawn')
        const pending = super.spawn(input)
        owner.spawning = pending
        try {
          const resource = await pending
          owner.inventory.set(resource.resourceRef, { quiescent: false, evidence: ['owned-process-spawn'] })
          owner.store.uow.atomic(() => {
            const binding = owner.store.bindings.binding<IngressBinding>(spec.attemptId)
            if (!binding) throw new Error('Physical resource has no registered binding')
            owner.store.bindings.record({
              ...binding,
              resources: [...binding.resources, { ref: resource.resourceRef, ownership: 'spawned_process' }],
            })
          })
          if (owner.closed || !owner.current()) {
            await this.stopOwned(resource.resourceRef, 1000)
            throw new Error('Attempt admission closed during spawn')
          }
          return resource
        } catch (error) {
          await super.stopAll(1500)
          throw error
        } finally {
          owner.spawning = undefined
        }
      }
      override async write(ref: string, frame: Uint8Array) {
        if (owner.closed || !owner.current()) throw new Error('Attempt admission closed before native write')
        return super.write(ref, frame)
      }
      override async stopOwned(ref: string, deadlineMs: number) {
        const known = owner.inventory.get(ref)
        if (known?.quiescent) return { quiescence: 'confirmed' as const, evidenceRefs: known.evidence }
        const result = await super.stopOwned(ref, deadlineMs)
        if (!owner.inventory.get(ref)?.quiescent)
          owner.inventory.set(ref, { quiescent: result.quiescence === 'confirmed', evidence: result.evidenceRefs })
        return result
      }
    }
    this.processes = new RegisteredProcesses({
      resolveCwd: (ref) => {
        if (ref !== spec.workspaceRef) throw new Error('Unknown workspace reference')
        return workspacePath
      },
      resolveEnv: (ref) => {
        if (ref !== spec.attemptId) throw new Error('Unknown environment reference')
        return { PATH: process.env.PATH, PA_FIXTURE_RECEIPTS: receiptsPath }
      },
    })
    this.host = new ControlledRunnerHost(
      (requested) => ({
        spec: requested,
        options: { payloads: storedAttemptPayloads(store), factSink: sink, processHost: this.processes },
      }),
      () =>
        new ProductFixtureDriver(contract, preparedPolicyRef, mode, (id) => {
          const before = this.answerWrites.get(id)
          if (!before) throw new Error('Answer write has no live Broker admission')
          before()
          this.answerWrites.delete(id)
        }),
    )
  }
  async launch(): Promise<RunningAttempt> {
    const credentialPath = join(this.recoveryRoot, 'key')
    createRunnerCredential(credentialPath)
    this.recovery = await serveRunnerRecovery(
      { socketPath: join(this.recoveryRoot, 'r.sock'), credentialPath },
      this.producer,
      { inspect: async () => this.state(), cancel: async () => this.closeAdmission() },
    )
    this.endpoint = this.recovery.endpoint
    registerRecoveryRunner(this.store, await connectRunnerRecovery(this.endpoint, this.producer).inspect())
    if (this.closed || !this.current()) throw new Error('Attempt stopped before launch')
    this.handle = await this.host.launch(this.spec)
    return this.handle
  }
  allowAnswer(id: string, beforeWrite: () => void): void {
    this.answerWrites.set(id, beforeWrite)
  }
  async feed(command: RunnerCommand): Promise<void> {
    if (this.closed || !this.current() || !this.handle) throw new Error('Current controlled attempt is unavailable')
    await this.handle.feed(command)
  }
  private state(): RunnerState {
    return {
      state: this.terminated ? 'terminated' : 'serving',
      admission: this.closed ? 'closed' : 'open',
      coverage: 'complete_owned_resources',
      resources: [...this.inventory].map(([ref, proof]) => ({
        ref,
        ownership: 'spawned_process',
        writer: proof.quiescent ? 'quiescent' : 'active',
        evidence: [...proof.evidence].slice(0, 32),
      })),
      evidence: ['controlled-product-fixture'],
    }
  }
  private async closeAdmission(): Promise<RunnerState> {
    this.closed = true
    if (!this.stopping)
      this.stopping = (async () => {
        // Closing admission is irreversible, including any spawn already in progress.
        await this.spawning?.catch(() => undefined)
        const stopped = await this.processes.stopAll(1500)
        if (stopped.quiescence === 'confirmed' && [...this.inventory.values()].every((proof) => proof.quiescent))
          this.terminated = true
        return this.state()
      })()
    return this.stopping
  }
  async quiesce() {
    await this.closeAdmission()
    if (!this.endpoint) throw new Error('No authenticated host endpoint')
    return confirmOwnedQuiescence(this.store, await connectRunnerRecovery(this.endpoint, this.producer).inspect())
      .result
  }
  async dispose(): Promise<void> {
    this.disposing ??= (async () => {
      await this.closeAdmission()
      await this.recovery?.close()
      rmSync(this.recoveryRoot, { recursive: true, force: true })
    })()
    return this.disposing
  }
}
