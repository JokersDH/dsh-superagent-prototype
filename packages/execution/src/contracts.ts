/**
 * WP-03 execution interfaces (explicit seams for core/storage integration).
 *
 * These are local product ports, not wire contracts: the wire types remain the frozen
 * `packages/contracts`. The Supervisor is written against these interfaces so that the real
 * durable fact store, core Executor bridge and recovery can be wired later without the Supervisor
 * importing storage or the legacy core. Until that wiring exists, durable ACK, atomic fence and
 * recovery are NOT_TESTED (see docs/adr/runtime/g1-wp03-report.md).
 */
import type { AttemptSpec, CriticalFact, DurableReceipt, RunnerCommand, ServeExit } from '../../contracts/src/types.ts'

/** What the Supervisor believes about the current execution for one ticket. */
export type AttemptBinding = {
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: AttemptSpec['contract']
  state: 'active' | 'stopping' | 'ended'
}

export type Quiescence = { quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }

/** One launched attempt, as seen by the Supervisor. */
export interface RunningAttempt {
  readonly attemptId: string
  /** Queue a command; resolves once accepted by the Runner, not once the native side acted. */
  feed(command: RunnerCommand): Promise<void>
  /** Resolves when the Driver's serve() ends. */
  waitExit(): Promise<ServeExit>
  /** Ask the Runner to stop; resolves only with physical-stop evidence. */
  stop(deadlineMs: number): Promise<Quiescence>
}

/** Launches attempts. The real implementation lives in apps/runner; tests inject a fake. */
export interface RunnerHost {
  launch(spec: AttemptSpec): Promise<RunningAttempt>
}

/** Durable critical-fact sink. A receipt may only be returned after the fact is persisted. */
export interface FactSink {
  record(fact: CriticalFact): Promise<DurableReceipt>
}

/** Current binding lookup and update; the real implementation belongs to core/storage. */
export interface BindingStore {
  current(ticketId: string): AttemptBinding | undefined
  save(binding: AttemptBinding): void
}

/** Classification of a send when its native outcome is unknown (04 §4, RT-04). */
export type DispatchClassification = {
  delivery: 'not_sent' | 'written' | 'native_accepted' | 'indeterminate'
  retry: 'same_key_safe' | 'reconcile_first' | 'user_action' | 'none'
}
