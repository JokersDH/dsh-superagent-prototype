/**
 * Controlled Runner host: one AttemptRunner per attempt, behind the Supervisor's `RunnerHost` port.
 * The Driver factory is injected so the same Runner serves fake drivers in tests and real drivers
 * at integration; no vendor branch lives here.
 */
import type { AgentDriverV1 } from '../../../packages/contracts/src/ports.ts'
import type { AttemptSpec } from '../../../packages/contracts/src/types.ts'
import type { RunnerHost, RunningAttempt } from '../../../packages/execution/src/contracts.ts'
import { AttemptRunner, type RunnerOptions, type RunnerResult } from './runner.ts'

export type DriverFactory = (spec: AttemptSpec) => AgentDriverV1

export class ControlledRunnerHost implements RunnerHost {
  readonly #options: RunnerOptions
  readonly #driverFactory: DriverFactory
  readonly #runners = new Map<string, AttemptRunner>()
  readonly #results = new Map<string, Promise<RunnerResult>>()

  constructor(options: RunnerOptions, driverFactory: DriverFactory) {
    this.#options = options
    this.#driverFactory = driverFactory
  }

  async launch(spec: AttemptSpec): Promise<RunningAttempt> {
    const runner = new AttemptRunner(this.#options)
    const result = runner.launch(spec, this.#driverFactory(spec))
    this.#runners.set(spec.attemptId, runner)
    this.#results.set(spec.attemptId, result)
    return {
      attemptId: spec.attemptId,
      feed: async command => {
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
}
