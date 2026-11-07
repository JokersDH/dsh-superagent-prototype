/**
 * In-memory doubles for WP-03 tests. None of these is durable, atomic across processes, or a
 * recovery implementation: they exist so Runner/Supervisor logic can be exercised before the
 * storage and core packages are wired (explicitly NOT_TESTED in the G1 report).
 */
import type {
  AttemptSpec,
  CriticalFact,
  DurableReceipt,
  Json,
  ProgressUpdate,
  RunnerCommand,
  ServeExit,
} from '../../contracts/src/types.ts'
import type { AttemptBinding, FactSink, Quiescence, RunnerHost, RunningAttempt } from '../../execution/src/contracts.ts'
import { DriverError } from '../../driver-kit/src/index.ts'

export class InMemoryPayloadStore {
  #seq = 0
  readonly #payloads = new Map<string, { payload: Json; classification: 'critical' | 'diagnostic' }>()
  readonly #maxEntries: number

  constructor(options: { maxEntries?: number } = {}) {
    this.#maxEntries = options.maxEntries ?? 1024
  }

  async store(payload: Json, classification: 'critical' | 'diagnostic'): Promise<string> {
    if (this.#payloads.size >= this.#maxEntries) {
      throw new DriverError('state_indeterminate', 'payload_store_full', `Payload store holds ${this.#payloads.size} entries`)
    }
    const ref = `payload-${++this.#seq}`
    this.#payloads.set(ref, { payload, classification })
    return ref
  }

  async read(reference: string): Promise<Json> {
    const found = this.#payloads.get(reference)
    if (!found) throw new DriverError('protocol_error', 'payload_missing', `Unknown payload reference: ${reference}`)
    return found.payload
  }

  get size(): number {
    return this.#payloads.size
  }

  classificationOf(reference: string): 'critical' | 'diagnostic' | undefined {
    return this.#payloads.get(reference)?.classification
  }
}

export class InMemoryFactLedger implements FactSink {
  readonly records: CriticalFact[] = []
  readonly #receipts = new Map<string, DurableReceipt>()
  #seq = 0
  #failure: Error | undefined
  readonly #now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now
  }

  failNext(error: Error): void {
    this.#failure = error
  }

  async record(fact: CriticalFact): Promise<DurableReceipt> {
    const existing = this.#receipts.get(fact.factId)
    if (existing) return existing // idempotent by factId; the real sink must do this durably
    if (this.#failure) {
      const failure = this.#failure
      this.#failure = undefined
      throw failure
    }
    this.#seq += 1
    const receipt: DurableReceipt = { factId: fact.factId, persisted: true, seq: this.#seq }
    this.records.push(fact)
    this.#receipts.set(fact.factId, receipt)
    this.#now()
    return receipt
  }

  has(factId: string): boolean {
    return this.#receipts.has(factId)
  }

  get count(): number {
    return this.records.length
  }
}

export class FakeClock {
  #now: number
  #nextId = 1
  readonly #timers = new Map<number, { due: number; callback: () => void }>()

  constructor(start = 0) {
    this.#now = start
  }

  now = (): number => this.#now

  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.#nextId++
    this.#timers.set(id, { due: this.#now + ms, callback })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    this.#timers.delete(handle as number)
  }

  advance(ms: number): void {
    const target = this.#now + ms
    for (;;) {
      const due = [...this.#timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
      if (!due) break
      this.#timers.delete(due[0])
      this.#now = due[1].due
      due[1].callback()
    }
    this.#now = target
  }

  get pendingTimers(): number {
    return this.#timers.size
  }
}

export type FakeStopBehavior = { quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[]; delayMs?: number }

export class FakeRunningAttempt implements RunningAttempt {
  readonly attemptId: string
  readonly commands: RunnerCommand[] = []
  readonly stopCalls: number[] = []
  #resolveExit: ((exit: ServeExit) => void) | undefined
  readonly #exit: Promise<ServeExit>
  #stopBehavior: FakeStopBehavior

  constructor(attemptId: string, stopBehavior: FakeStopBehavior = { quiescence: 'confirmed', evidenceRefs: ['fake-stop'] }) {
    this.attemptId = attemptId
    this.#stopBehavior = stopBehavior
    this.#exit = new Promise(resolve => {
      this.#resolveExit = resolve
    })
  }

  async feed(command: RunnerCommand): Promise<void> {
    this.commands.push(command)
  }

  waitExit(): Promise<ServeExit> {
    return this.#exit
  }

  async stop(deadlineMs: number): Promise<Quiescence> {
    this.stopCalls.push(deadlineMs)
    if (this.#stopBehavior.delayMs) await new Promise(resolve => setTimeout(resolve, this.#stopBehavior.delayMs))
    return { quiescence: this.#stopBehavior.quiescence, evidenceRefs: this.#stopBehavior.evidenceRefs }
  }

  /** Test hook: complete the served attempt. */
  complete(exit: ServeExit): void {
    this.#resolveExit?.(exit)
  }

  setStopBehavior(behavior: FakeStopBehavior): void {
    this.#stopBehavior = behavior
  }
}

export class FakeRunnerHost implements RunnerHost {
  readonly specs: AttemptSpec[] = []
  readonly attempts: FakeRunningAttempt[] = []
  #failure: Error | undefined
  readonly #stopBehavior: FakeStopBehavior

  constructor(options: { stopBehavior?: FakeStopBehavior } = {}) {
    this.#stopBehavior = options.stopBehavior ?? { quiescence: 'confirmed', evidenceRefs: ['fake-stop'] }
  }

  failNextLaunch(error: Error): void {
    this.#failure = error
  }

  async launch(spec: AttemptSpec): Promise<RunningAttempt> {
    if (this.#failure) {
      const failure = this.#failure
      this.#failure = undefined
      throw failure
    }
    const attempt = new FakeRunningAttempt(spec.attemptId, this.#stopBehavior)
    this.specs.push(spec)
    this.attempts.push(attempt)
    return attempt
  }

  last(): FakeRunningAttempt | undefined {
    return this.attempts.at(-1)
  }
}

export type { AttemptBinding, ProgressUpdate }
