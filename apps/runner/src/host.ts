/**
 * Controlled Runner host (WP-03): one isolated AttemptRunner per attempt, behind the Supervisor's
 * `RunnerHost` port.
 *
 * Isolation requirement (durable-runner batch 1): two concurrent attempts must not share a
 * ProcessHost, command queue, journal, stderr ring, payload store or fact sink. A single shared
 * `RunnerOptions` object would let one attempt's ACK context, capacity and resource registry leak into
 * another, so the real composition uses a **factory** that builds a fresh, per-attempt context from
 * the `AttemptSpec`. The flat-options constructor is kept only as a compatibility fixture for
 * single-attempt tests; it still creates a new `AttemptRunner` per launch, but shares its bound sink.
 *
 * The Driver factory is injected so tests use the fake driver and integration can plug a real one;
 * no vendor branch lives here.
 */
import type { AgentDriverV1 } from '../../../packages/contracts/src/ports.ts'
import type { AttemptSpec } from '../../../packages/contracts/src/types.ts'
import type { RunnerHost, RunningAttempt } from '../../../packages/execution/src/contracts.ts'
import { AttemptRunner, type RunnerOptions, type RunnerResult } from './runner.ts'

export type DriverFactory = (spec: AttemptSpec) => AgentDriverV1

/** Per-attempt wiring: everything that must not be shared between attempts. */
export type AttemptRunnerContext = {
  /** The AttemptSpec this context was built for; the host rejects a mismatch. */
  spec: AttemptSpec
  options: RunnerOptions
}

export type AttemptRunnerContextFactory = (spec: AttemptSpec) => AttemptRunnerContext | Promise<AttemptRunnerContext>

export class ControlledRunnerHost implements RunnerHost {
  readonly #contextFactory: AttemptRunnerContextFactory
  readonly #driverFactory: DriverFactory
  readonly #runners = new Map<string, AttemptRunner>()
  readonly #results = new Map<string, Promise<RunnerResult>>()
  readonly #specs = new Map<string, AttemptSpec>()

  constructor(contextFactory: AttemptRunnerContextFactory, driverFactory: DriverFactory) {
    this.#contextFactory = contextFactory
    this.#driverFactory = driverFactory
  }

  /**
   * Compatibility fixture for single-attempt tests. This shares the given options across launches;
   * do not use it where two attempts can be live at the same time.
   */
  static fromOptions(options: RunnerOptions, driverFactory: DriverFactory): ControlledRunnerHost {
    return new ControlledRunnerHost(spec => ({ spec, options }), driverFactory)
  }

  async launch(spec: AttemptSpec): Promise<RunningAttempt> {
    if (this.#runners.has(spec.attemptId)) {
      throw new Error(`Attempt ${spec.attemptId} already has a runner; attempt ids are single-use`)
    }
    const context = await this.#contextFactory(spec)
    assertContextMatches(context, spec)

    const runner = new AttemptRunner(context.options)
    this.#runners.set(spec.attemptId, runner)
    this.#specs.set(spec.attemptId, spec)
    const result = runner.launch(spec, this.#driverFactory(spec))
    this.#results.set(spec.attemptId, result)
    // Avoid an unhandled rejection when the host is discarded before anybody awaits the result.
    void result.catch(() => undefined)

    return {
      attemptId: spec.attemptId,
      feed: async command => {
        // A command for another attempt/tuple must never reach this attempt's native process.
        assertCommandBelongsTo(command, spec)
        runner.feed(command)
      },
      waitExit: async () => (await result).exit,
      stop: deadline => runner.stopPhysical(deadline),
    }
  }

  runner(attemptId: string): AttemptRunner | undefined {
    return this.#runners.get(attemptId)
  }

  result(attemptId: string): Promise<RunnerResult> | undefined {
    return this.#results.get(attemptId)
  }

  /** The spec an attempt runs under; used by the composition root to rebuild a bound sink. */
  specOf(attemptId: string): AttemptSpec | undefined {
    return this.#specs.get(attemptId)
  }
}

/** The factory must return the context for exactly the attempt it was asked for. */
function assertContextMatches(context: AttemptRunnerContext, spec: AttemptSpec): void {
  if (context.spec.attemptId !== spec.attemptId) {
    throw new Error(`Runner context belongs to ${context.spec.attemptId}, not ${spec.attemptId}`)
  }
  const fields = ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch'] as const
  for (const field of fields) {
    if (context.spec[field] !== spec[field]) throw new Error(`Runner context ${field} does not match the attempt`)
  }
  const left = context.spec.contract
  const right = spec.contract
  if (left.workId !== right.workId || left.revision !== right.revision || left.digest !== right.digest) {
    throw new Error('Runner context contract does not match the attempt')
  }
}

/** Reject a command whose frozen attempt tuple differs from the attempt this runner owns. */
function assertCommandBelongsTo(command: { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract?: AttemptSpec['contract'] }, spec: AttemptSpec): void {
  for (const field of ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch'] as const) {
    if (command[field] !== spec[field]) {
      throw new Error(`Command ${field} does not belong to attempt ${spec.attemptId}`)
    }
  }
  const contract = command.contract
  if (contract && (contract.workId !== spec.contract.workId || contract.revision !== spec.contract.revision || contract.digest !== spec.contract.digest)) {
    throw new Error(`Command contract does not belong to attempt ${spec.attemptId}`)
  }
}
