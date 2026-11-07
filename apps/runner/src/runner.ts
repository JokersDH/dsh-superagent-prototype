/**
 * AttemptRunner (WP-03): hosts one Driver attempt with bounded resources and explicit stops.
 *
 * It owns an AttemptIO built from frozen contract ports, the command priority queue, the bounded
 * journal and a ProcessHost. It does NOT decide business outcomes: `driver.serve` returns a
 * ServeExit, facts go to the injected FactSink (whose receipt is only returned after persistence),
 * and physical stop evidence comes from the ProcessHost.
 */
import type { AgentDriverV1, AttemptIO } from '../../../packages/contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, DurableReceipt, RunnerCommand, ServeExit } from '../../../packages/contracts/src/types.ts'
import {
  CommandQueue,
  DriverError,
  ProgressCoalescer,
  assertAttemptSpec,
  createAttemptIO,
} from '../../../packages/driver-kit/src/index.ts'
import type { FactSink } from '../../../packages/execution/src/contracts.ts'
import { BoundedJournal, StderrRing, journalCoverage } from './journal.ts'
import { ProcessHost, type ProcessHostOptions } from './process-host.ts'

export type RunnerOptions = {
  payloads: AttemptIO['payloads']
  factSink: FactSink
  processHost?: ProcessHost
  processHostOptions?: ProcessHostOptions
  journal?: BoundedJournal
  stderrRing?: StderrRing
  progressIntervalMs?: number
  commandCapacity?: number
}

export type RunnerResult = {
  exit: ServeExit
  journal: ReturnType<BoundedJournal['snapshot']>
  journalCoverage: 'complete' | 'gapped'
  stderr: ReturnType<StderrRing['stats']>
  capacityExhausted: boolean
  progress: ReturnType<ProgressCoalescer['stats']>
}

export class AttemptRunner {
  readonly commands: CommandQueue
  readonly journal: BoundedJournal
  readonly stderrRing: StderrRing
  readonly #payloads: AttemptIO['payloads']
  readonly #factSink: FactSink
  readonly #processHost: ProcessHost
  readonly #progress: ProgressCoalescer
  #spec: AttemptSpec | undefined
  #capacityExhausted = false

  constructor(options: RunnerOptions) {
    this.#payloads = options.payloads
    this.#factSink = options.factSink
    this.journal = options.journal ?? new BoundedJournal()
    this.stderrRing = options.stderrRing ?? new StderrRing()
    this.#processHost =
      options.processHost ??
      new ProcessHost({ stderrRing: this.stderrRing, ...options.processHostOptions })
    this.commands = new CommandQueue({ maxPending: options.commandCapacity ?? 256 })
    this.#progress = new ProgressCoalescer({
      publish: update => this.journal.appendDiagnostic('progress', update.text),
      windowMs: options.progressIntervalMs ?? 100,
    })
  }

  get capacityExhausted(): boolean {
    return this.#capacityExhausted
  }

  get spec(): AttemptSpec | undefined {
    return this.#spec
  }

  /** Queue a command; capacity exhaustion refuses new business input but keeps control available. */
  feed(command: RunnerCommand): void {
    const business = command.kind === 'begin' || command.kind === 'deliver'
    if (business && (this.#capacityExhausted || this.journal.criticalFull)) {
      // REL-05: if the critical reserve cannot take another fact, stop accepting new business input.
      // Control commands (cancel/answer) stay accepted so stopping remains possible.
      this.#capacityExhausted = true
      throw new DriverError('state_indeterminate', 'capacity_exhausted', 'Critical reserve exhausted; new business input is refused')
    }
    this.commands.push(command)
  }

  /** Run the attempt to its Driver-reported exit. */
  async launch(spec: AttemptSpec, driver: AgentDriverV1): Promise<RunnerResult> {
    if (this.#spec) throw new DriverError('state_indeterminate', 'runner_reused', 'AttemptRunner runs one attempt')
    assertAttemptSpec(spec)
    this.#spec = spec

    const io: AttemptIO = createAttemptIO({
      commands: this.commands,
      record: fact => this.#record(spec, fact),
      publishProgress: update => this.#progress.push(update),
      runtime: this.#processHost,
      payloads: this.#payloads,
    })

    let exit: ServeExit
    try {
      exit = await driver.serve(spec, io)
    } finally {
      this.commands.close('serve_ended')
      this.#progress.flush()
    }
    this.journal.appendDiagnostic('serve.ended', exit.reason)
    return this.result(exit)
  }

  /** Physical stop: signal owned resources and return only proven quiescence. */
  stopPhysical(deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    return this.#processHost.stopAll(deadlineMs)
  }

  result(exit: ServeExit): RunnerResult {
    const journal = this.journal.snapshot()
    return {
      exit,
      journal,
      journalCoverage: journalCoverage(journal),
      stderr: this.stderrRing.stats(),
      capacityExhausted: this.#capacityExhausted,
      progress: this.#progress.stats(),
    }
  }

  async #record(spec: AttemptSpec, fact: CriticalFact): Promise<DurableReceipt> {
    if (fact.attemptId !== spec.attemptId || fact.fenceEpoch !== spec.fenceEpoch || fact.assignmentId !== spec.assignmentId) {
      throw new DriverError('state_indeterminate', 'fact_identity_mismatch', 'Fact identity does not match the running attempt')
    }
    try {
      this.journal.assertCriticalCapacity()
    } catch (error) {
      this.#capacityExhausted = true
      throw error
    }
    // Durable ACK only after the sink resolves; the fake sink is not durable (NOT_TESTED).
    const receipt = await this.#factSink.record(fact)
    this.journal.commitCritical(fact.factId, fact.kind)
    return receipt
  }
}
