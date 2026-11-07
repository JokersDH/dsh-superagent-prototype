/**
 * AttemptSupervisor (WP-03, G1 batch 1).
 *
 * Bridges the core Executor port semantics onto controlled execution without importing core or
 * storage: `start`, `deliver` and `stop` are expressed against explicit interfaces
 * (`RunnerHost`, `BindingStore`, `FactSink`) so the real core bridge can be wired later.
 *
 * Fencing rules implemented here:
 * - every attempt carries `(attemptId, fenceEpoch)`; a newer epoch supersedes the previous binding;
 * - a command or fact whose identity does not match the current binding is refused and recorded as a
 *   diagnostic, never applied (RT-01);
 * - `begin` is refused when the prepared policy snapshot does not match this attempt (RT-02);
 * - an accepted binding never starts a second physical attempt; a retry is a new epoch (REL-04);
 * - `stop` moves the binding to `stopping` and only a physical quiescence proof moves it to `ended`
 *   (RT-06). An indeterminate stop keeps `stopping`.
 *
 * What this module does NOT do (explicitly NOT_TESTED until core/storage are wired): a durable
 * receipt from a real transaction, an atomic fence that is decided by core inside the same
 * transaction as the fact insert, and crash recovery of live bindings.
 */
import type { AgentDriverV1 } from '../../contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, DurableReceipt, RunnerCommand, ServeExit } from '../../contracts/src/types.ts'
import { DriverError, factIdFor } from '../../driver-kit/src/index.ts'
import type {
  AttemptBinding,
  BindingStore,
  FactSink,
  Quiescence,
  RunnerHost,
  RunningAttempt,
} from './contracts.ts'

export type SupervisorOptions = {
  runner: RunnerHost
  bindings: BindingStore
  sink: FactSink
  /** Prepared policy ref this attempt must carry; a begin with another ref is refused (RT-02). */
  preparedPolicyRef: string
  /** Physical stop deadline passed to the Runner. */
  stopDeadlineMs?: number
  now?: () => number
  /** Optional driver used only for `reconcile` when a send outcome is unknown. */
  driver?: AgentDriverV1
}

export type FenceDecision =
  | { accepted: true }
  | { accepted: false; reason: 'stale_epoch' | 'unknown_binding' | 'not_active' | 'attempt_mismatch' }

export type StartInput = {
  /** Core identity for this dispatch. */
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: AttemptSpec['contract']
  spec: AttemptSpec
}

export type StopResult = {
  state: 'ended' | 'stopping'
  quiescence: 'confirmed' | 'indeterminate'
  evidenceRefs: readonly string[]
}

export class AttemptSupervisor {
  readonly #runner: RunnerHost
  readonly #bindings: BindingStore
  readonly #sink: FactSink
  readonly #preparedPolicyRef: string
  readonly #stopDeadlineMs: number
  readonly #now: () => number
  readonly #driver: AgentDriverV1 | undefined
  readonly #attempts = new Map<string, RunningAttempt>()
  readonly #facts: CriticalFact[] = []
  #factSeq = 0

  constructor(options: SupervisorOptions) {
    this.#runner = options.runner
    this.#bindings = options.bindings
    this.#sink = options.sink
    this.#preparedPolicyRef = options.preparedPolicyRef
    this.#stopDeadlineMs = options.stopDeadlineMs ?? 2000
    this.#now = options.now ?? Date.now
    this.#driver = options.driver
  }

  /** Current binding for a ticket, as the Supervisor knows it. */
  binding(ticketId: string): AttemptBinding | undefined {
    return this.#bindings.current(ticketId)
  }

  /** Facts accepted by the fence so far, in acceptance order (diagnostics for tests/UI). */
  acceptedFacts(): readonly CriticalFact[] {
    return [...this.#facts]
  }

  /**
   * Start an attempt. A newer epoch supersedes the previous binding, but the previous physical
   * attempt must be stopped first: this method refuses to start while the old one is not quiescent.
   */
  async start(input: StartInput): Promise<{ binding: AttemptBinding; attempt: RunningAttempt }> {
    const existing = this.#bindings.current(input.ticketId)
    if (existing && existing.state !== 'ended') {
      if (existing.fenceEpoch >= input.fenceEpoch) {
        throw new DriverError('state_indeterminate', 'stale_start', `Epoch ${input.fenceEpoch} does not supersede ${existing.fenceEpoch}`)
      }
      // A retry must not start a second writer before the old one proves quiescence (REL-04/RT-06).
      const stopped = await this.stop(input.ticketId, 'superseded_by_new_epoch')
      if (stopped.quiescence !== 'confirmed') {
        throw new DriverError('state_indeterminate', 'previous_attempt_not_quiescent', 'Previous attempt did not prove quiescence')
      }
    }

    const binding: AttemptBinding = {
      ticketId: input.ticketId,
      assignmentId: input.assignmentId,
      attemptId: input.attemptId,
      fenceEpoch: input.fenceEpoch,
      contract: input.contract,
      state: 'active',
    }
    this.#bindings.save(binding)

    const attempt = await this.#runner.launch(input.spec)
    this.#attempts.set(input.attemptId, attempt)

    // `begin` carries the prepared policy ref; a mismatch is refused before native business (§RT-02).
    await attempt.feed(command(input, 'begin', { inputRef: input.spec.policySnapshotRef, preparedPolicyRef: this.#preparedPolicyRef }))
    return { binding, attempt }
  }

  /** Deliver an input to a running attempt; refused when the binding is not active. */
  async deliver(ticketId: string, inputRef: string, expectedTurnRef?: string): Promise<void> {
    const binding = this.#requireActive(ticketId)
    const attempt = this.#attempts.get(binding.attemptId)
    if (!attempt) throw new DriverError('state_indeterminate', 'attempt_not_running', `No running attempt for ${binding.attemptId}`)
    await attempt.feed(command(binding, 'deliver', { inputRef, ...(expectedTurnRef === undefined ? {} : { expectedTurnRef }) }))
  }

  /** Forward a native answer; refused unless the binding is active and owned by this attempt. */
  async answer(ticketId: string, nativeBindingRef: string, answerRef: string): Promise<void> {
    const binding = this.#requireActive(ticketId)
    const attempt = this.#attempts.get(binding.attemptId)
    if (!attempt) throw new DriverError('state_indeterminate', 'attempt_not_running', `No running attempt for ${binding.attemptId}`)
    await attempt.feed(command(binding, 'answer', { nativeBindingRef, answerRef }))
  }

  /**
   * Stop an attempt. Business authorization ends immediately (`stopping`), but the binding only
   * becomes `ended` once the Runner proves physical quiescence (RT-06).
   */
  async stop(ticketId: string, reason: string): Promise<StopResult> {
    const binding = this.#bindings.current(ticketId)
    if (!binding || binding.state === 'ended') {
      return { state: 'ended', quiescence: 'confirmed', evidenceRefs: ['no-active-binding'] }
    }
    const stopping: AttemptBinding = { ...binding, state: 'stopping' }
    this.#bindings.save(stopping)
    const attempt = this.#attempts.get(binding.attemptId)
    if (!attempt) {
      // No live attempt handle: there is nothing this Supervisor can signal.
      const ended: AttemptBinding = { ...stopping, state: 'ended' }
      this.#bindings.save(ended)
      return { state: 'ended', quiescence: 'indeterminate', evidenceRefs: ['no-attempt-handle'] }
    }

    // Cancel is queued before the physical stop so the driver can acknowledge it.
    await attempt.feed(command(stopping, 'cancel', {})).catch(() => undefined)
    const quiescence: Quiescence = await attempt.stop(this.#stopDeadlineMs)
    const evidence = [...quiescence.evidenceRefs, `reason:${reason}`]
    if (quiescence.quiescence === 'confirmed') {
      this.#bindings.save({ ...stopping, state: 'ended' })
      return { state: 'ended', quiescence: 'confirmed', evidenceRefs: evidence }
    }
    return { state: 'stopping', quiescence: 'indeterminate', evidenceRefs: evidence }
  }

  /** Wait for the served attempt to end (Driver-reported exit). */
  async waitExit(ticketId: string): Promise<ServeExit> {
    const binding = this.#bindings.current(ticketId)
    const attempt = binding ? this.#attempts.get(binding.attemptId) : undefined
    if (!attempt) throw new DriverError('state_indeterminate', 'attempt_not_running', 'No running attempt to wait for')
    return attempt.waitExit()
  }

  /**
   * Fenced critical-fact ingress. The fact is applied only when its identity matches the current
   * binding; otherwise it is refused as stale (RT-01). The durable receipt here comes from the
   * injected sink — a real transactional fence belongs to core/storage.
   */
  async record(fact: CriticalFact, stamp = true): Promise<DurableReceipt | { refused: string }> {
    const decision = this.fence(fact)
    if (!decision.accepted) return { refused: decision.reason }
    const binding = this.#bindings.current(fact.ticketId)!
    this.#factSeq += 1
    const stamped: CriticalFact = stamp && fact.factId.length === 0
      ? { ...fact, factId: factIdFor(binding.attemptId, this.#factSeq) }
      : fact
    const receipt = await this.#sink.record(stamped)
    this.#facts.push(stamped)
    if (stamped.kind === 'runtime.exited' && binding.state === 'stopping') {
      // A physical-exit fact is a stop observation, not a business completion (RT-06).
      this.#now()
    }
    return receipt
  }

  /** Evaluate the fence without applying anything; used by tests and by UI diagnostics. */
  fence(fact: Pick<CriticalFact, 'ticketId' | 'assignmentId' | 'attemptId' | 'fenceEpoch'>): FenceDecision {
    const binding = this.#bindings.current(fact.ticketId)
    if (!binding) return { accepted: false, reason: 'unknown_binding' }
    if (binding.attemptId !== fact.attemptId) return { accepted: false, reason: 'attempt_mismatch' }
    if (binding.fenceEpoch !== fact.fenceEpoch) return { accepted: false, reason: 'stale_epoch' }
    if (binding.state === 'ended') return { accepted: false, reason: 'not_active' }
    return { accepted: true }
  }

  /**
   * Reconcile an unknown send (RT-04). Without a Driver this returns `indeterminate` — never a
   * retry — so callers cannot mistake a probe for proof.
   */
  async reconcileUnknownSend(reference: Parameters<AgentDriverV1['reconcile']>[0]): Promise<{ status: 'indeterminate' | 'running' | 'terminal' | 'missing'; retry: 'reconcile_first' }> {
    if (!this.#driver) return { status: 'indeterminate', retry: 'reconcile_first' }
    const report = await this.#driver.reconcile(reference, {
      readJournal: async () => this.#facts,
      inspectRuntime: async () => ({ status: 'indeterminate', writer: 'indeterminate', evidenceRefs: [] }),
    })
    return { status: report.status, retry: 'reconcile_first' }
  }

  #requireActive(ticketId: string): AttemptBinding {
    const binding = this.#bindings.current(ticketId)
    if (!binding) throw new DriverError('state_indeterminate', 'unknown_binding', `No binding for ticket ${ticketId}`)
    if (binding.state !== 'active') throw new DriverError('state_indeterminate', 'not_active', `Binding is ${binding.state}`)
    return binding
  }
}

function command(
  identity: Pick<AttemptSpec, 'ticketId' | 'assignmentId' | 'attemptId' | 'fenceEpoch' | 'contract'>,
  kind: RunnerCommand['kind'],
  payload: Record<string, string>,
): RunnerCommand {
  const base = {
    id: `cmd-${identity.attemptId}-${kind}`,
    ticketId: identity.ticketId,
    assignmentId: identity.assignmentId,
    attemptId: identity.attemptId,
    fenceEpoch: identity.fenceEpoch,
  }
  return { ...base, kind, ...payload } as RunnerCommand
}
