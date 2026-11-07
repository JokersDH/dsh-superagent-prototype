/**
 * AttemptSupervisor (WP-03, G1 batch 2).
 *
 * Bridges the core Executor port semantics onto controlled execution without importing core or
 * storage: `start`, `deliver`, `answer`, `pause` and `stop` are expressed against explicit
 * interfaces (`RunnerHost`, `BindingStore`, `FactSink`) so the authoritative ingress can be wired
 * later (RFC-0002).
 *
 * Reviewer-mandated invariants implemented here:
 * - every command is built from the full `AttemptRef` tuple and validated with the frozen
 *   `RunnerCommandSchema`; there is no cast that can hide a missing field (B-FROZEN-COMMAND);
 * - a command id is derived from its kind plus the business identity it carries, so two different
 *   deliveries can never share an id, and a retry of the same logical input keeps the same id
 *   (B-COMMAND-IDENTITY);
 * - the fence compares the complete tuple ticket/assignment/attempt/epoch/contract
 *   (B-ASSIGNMENT-FENCE). The local check is diagnostic only: RFC-0002 makes the authoritative
 *   decision belong to the composition root's single transaction;
 * - `begin` carries the attempt's real initial `ExecutionInput` reference, never the policy snapshot
 *   (B-FROZEN-COMMAND), and the `StartInput` tuple must equal the `AttemptSpec` tuple;
 * - an unknown physical state can never be inferred from a missing handle or binding: `stop` keeps
 *   the binding `stopping`/`indeterminate` across repeated calls until real evidence arrives
 *   (B-UNKNOWN-STOP). A missing handle is recorded as `unknown`, and a later command aimed at an
 *   unknown physical writer is refused instead of being treated as a clean start.
 *
 * Still NOT_TESTED until core/storage are wired: a durable receipt from a real transaction, an
 * atomic fence decided by core, and crash recovery of live bindings (RFC-0002).
 */
import type { AgentDriverV1 } from '../../contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, DurableReceipt, RunnerCommand, ServeExit } from '../../contracts/src/types.ts'
import { RunnerCommandSchema } from '../../contracts/src/schemas.ts'
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
  | {
      accepted: false
      reason: 'stale_epoch' | 'unknown_binding' | 'not_active' | 'attempt_mismatch' | 'assignment_mismatch' | 'contract_mismatch'
    }

/** The attempt tuple every command and fact must agree on. */
export type AttemptTuple = {
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: AttemptSpec['contract']
}

export type StartInput = AttemptTuple & {
  spec: AttemptSpec
  /**
   * The attempt's initial business `ExecutionInput` reference (contracts `ExecutionInput.inputId`).
   * It is deliberately separate from `spec.policySnapshotRef`: one is "what work to do", the other
   * is "under which prepared policy". A begin without it cannot be expressed (B-FROZEN-COMMAND).
   */
  initialInputRef: string
}

export type CommandKey =
  | { kind: 'begin'; inputRef: string }
  | { kind: 'deliver'; inputRef: string }
  | { kind: 'answer'; answerRef: string; nativeBindingRef: string }
  | { kind: 'cancel'; reason: string }
  | { kind: 'pause_at_boundary' }

export type StopResult = {
  state: 'ended' | 'stopping'
  /** `unknown` is a third outcome: a physical writer may still exist but nothing proved or disproved it. */
  quiescence: 'confirmed' | 'indeterminate' | 'unknown'
  evidenceRefs: readonly string[]
}

/** Result of a command attempt, so callers cannot mistake a refusal for a delivery. */
export type CommandResult = { queued: true; commandId: string } | { queued: false; reason: string }

const COMMAND_ID_MAX = 128

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

  binding(ticketId: string): AttemptBinding | undefined {
    return this.#bindings.current(ticketId)
  }

  /** Facts accepted by the local pre-check so far (diagnostics; not an authority). */
  acceptedFacts(): readonly CriticalFact[] {
    return [...this.#facts]
  }

  /**
   * Start an attempt. A newer epoch supersedes the previous binding only after the previous physical
   * attempt proves quiescence; an unknown previous state blocks the new writer.
   */
  async start(input: StartInput): Promise<{ binding: AttemptBinding; attempt: RunningAttempt }> {
    assertStartInput(input)

    const existing = this.#bindings.current(input.ticketId)
    if (existing && existing.state !== 'ended') {
      if (existing.fenceEpoch >= input.fenceEpoch) {
        throw new DriverError('state_indeterminate', 'stale_start', `Epoch ${input.fenceEpoch} does not supersede ${existing.fenceEpoch}`)
      }
      const stopped = await this.stop(input.ticketId, 'superseded_by_new_epoch')
      if (stopped.quiescence !== 'confirmed') {
        // B-UNKNOWN-STOP: an unproven previous writer must keep blocking the resource.
        throw new DriverError(
          'state_indeterminate',
          'previous_attempt_not_quiescent',
          `Previous attempt did not prove quiescence (${stopped.quiescence})`,
        )
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

    const begin = this.#command(binding, { kind: 'begin', inputRef: input.initialInputRef }, {
      preparedPolicyRef: this.#preparedPolicyRef,
    })
    await attempt.feed(begin)
    return { binding, attempt }
  }

  /** Deliver an input to a running attempt. */
  async deliver(ticketId: string, inputRef: string, expectedTurnRef?: string): Promise<CommandResult> {
    const binding = this.#requireActive(ticketId)
    const command = this.#command(binding, { kind: 'deliver', inputRef }, {
      ...(expectedTurnRef === undefined ? {} : { expectedTurnRef }),
    })
    return this.#feed(binding, command)
  }

  /** Forward a native answer. Refused unless the binding is active. */
  async answer(ticketId: string, nativeBindingRef: string, answerRef: string): Promise<CommandResult> {
    const binding = this.#requireActive(ticketId)
    const command = this.#command(binding, { kind: 'answer', answerRef, nativeBindingRef })
    return this.#feed(binding, command)
  }

  /** Ask the attempt to pause at the next turn boundary. */
  async pause(ticketId: string): Promise<CommandResult> {
    const binding = this.#requireActive(ticketId)
    return this.#feed(binding, this.#command(binding, { kind: 'pause_at_boundary' }))
  }

  /**
   * Stop an attempt. The binding leaves `active` immediately, but it only becomes `ended` when a
   * physical quiescence proof exists. Every path that cannot prove the writer stopped — no handle,
   * no binding record, an indeterminate runner answer — stays `stopping` with an `unknown` or
   * `indeterminate` quiescence, and repeated calls keep saying so (B-UNKNOWN-STOP).
   */
  async stop(ticketId: string, reason: string): Promise<StopResult> {
    const binding = this.#bindings.current(ticketId)
    if (!binding) {
      // Nothing is known about this ticket's physical writer. A clean `ended` would be an inference.
      return { state: 'stopping', quiescence: 'unknown', evidenceRefs: ['unknown-binding'] }
    }
    if (binding.state === 'ended') {
      return { state: 'ended', quiescence: 'confirmed', evidenceRefs: ['already-ended'] }
    }

    const stopping: AttemptBinding = binding.state === 'stopping' ? binding : { ...binding, state: 'stopping' }
    this.#bindings.save(stopping)

    const attempt = this.#attempts.get(binding.attemptId)
    if (!attempt) {
      // No handle: the writer may exist in another process. Never report confirmed without evidence.
      return { state: 'stopping', quiescence: 'unknown', evidenceRefs: ['no-attempt-handle', `reason:${reason}`] }
    }

    await attempt.feed(this.#command(stopping, { kind: 'cancel', reason })).catch(() => undefined)
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
   * Local, diagnostic fact pre-check. The authoritative decision belongs to the composition-root
   * bridge inside one transaction (RFC-0002); this method only prevents an obviously stale fact from
   * reaching the sink and lets tests observe the rule cheaply.
   */
  async record(fact: CriticalFact, stamp = true): Promise<DurableReceipt | { refused: string }> {
    const decision = this.fence(fact)
    if (!decision.accepted) return { refused: decision.reason }
    const binding = this.#bindings.current(fact.ticketId)!
    this.#factSeq += 1
    const stamped: CriticalFact = stamp && fact.factId.length === 0 ? { ...fact, factId: factIdFor(binding.attemptId, this.#factSeq) } : fact
    const receipt = await this.#sink.record(stamped)
    this.#facts.push(stamped)
    return receipt
  }

  /** Evaluate the full attempt tuple; anything that differs is refused. */
  fence(fact: Pick<CriticalFact, 'ticketId' | 'assignmentId' | 'attemptId' | 'fenceEpoch' | 'contract'>): FenceDecision {
    const binding = this.#bindings.current(fact.ticketId)
    if (!binding) return { accepted: false, reason: 'unknown_binding' }
    if (binding.attemptId !== fact.attemptId) return { accepted: false, reason: 'attempt_mismatch' }
    if (binding.assignmentId !== fact.assignmentId) return { accepted: false, reason: 'assignment_mismatch' }
    if (!sameContract(binding.contract, fact.contract)) return { accepted: false, reason: 'contract_mismatch' }
    if (binding.fenceEpoch !== fact.fenceEpoch) return { accepted: false, reason: 'stale_epoch' }
    if (binding.state === 'ended') return { accepted: false, reason: 'not_active' }
    return { accepted: true }
  }

  /** Unknown sends are always reconciled first; never replayed as same-key safe (RT-04). */
  async reconcileUnknownSend(reference: Parameters<AgentDriverV1['reconcile']>[0]): Promise<{ status: 'indeterminate' | 'running' | 'terminal' | 'missing'; retry: 'reconcile_first' }> {
    if (!this.#driver) return { status: 'indeterminate', retry: 'reconcile_first' }
    const report = await this.#driver.reconcile(reference, {
      readJournal: async () => this.#facts,
      inspectRuntime: async () => ({ status: 'indeterminate', writer: 'indeterminate', evidenceRefs: [] }),
    })
    return { status: report.status, retry: 'reconcile_first' }
  }

  /** Stable command id: kind plus the business identity it carries, never just attempt+kind. */
  static commandId(tuple: Pick<AttemptTuple, 'attemptId' | 'fenceEpoch'>, key: CommandKey): string {
    const subject =
      key.kind === 'begin'
        ? `begin:${key.inputRef}`
        : key.kind === 'deliver'
          ? `deliver:${key.inputRef}`
          : key.kind === 'answer'
            ? `answer:${key.nativeBindingRef}:${key.answerRef}`
            : key.kind === 'cancel'
              ? `cancel:${key.reason}`
              : 'pause'
    const raw = `cmd-${tuple.attemptId}-${tuple.fenceEpoch}-${subject}`
    // Contract ids allow [A-Za-z0-9._:-] up to 128 chars; collapse any other character.
    const safe = raw.replace(/[^A-Za-z0-9._:-]/g, '-')
    if (safe.length <= COMMAND_ID_MAX) return safe
    // Keep the identity readable and collapse the excess deterministically.
    const digest = shortHash(safe)
    return `${safe.slice(0, COMMAND_ID_MAX - digest.length - 1)}-${digest}`
  }

  /**
   * Build a command from the **complete** attempt tuple and validate it with the frozen schema.
   *
   * `RunnerCommandSchema` is `AttemptRef & { id }` plus the per-kind fields, and `AttemptRef`
   * includes `ticketId/assignmentId/attemptId/fenceEpoch/contract`. Every field is emitted here and
   * the result is parsed — never cast — so a missing or renamed field fails loudly (B-FROZEN-COMMAND).
   */
  #command(binding: AttemptBinding, key: CommandKey, extra: Record<string, string> = {}): RunnerCommand {
    const base = {
      id: AttemptSupervisor.commandId(binding, key),
      ticketId: binding.ticketId,
      assignmentId: binding.assignmentId,
      attemptId: binding.attemptId,
      fenceEpoch: binding.fenceEpoch,
      contract: binding.contract,
      kind: key.kind,
    }
    const candidate =
      key.kind === 'begin'
        ? { ...base, inputRef: key.inputRef, preparedPolicyRef: extra.preparedPolicyRef }
        : key.kind === 'deliver'
          ? { ...base, inputRef: key.inputRef, ...(extra.expectedTurnRef === undefined ? {} : { expectedTurnRef: extra.expectedTurnRef }) }
          : key.kind === 'answer'
            ? { ...base, nativeBindingRef: key.nativeBindingRef, answerRef: key.answerRef }
            : base
    const parsed = RunnerCommandSchema.safeParse(candidate)
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
      throw new DriverError('protocol_error', 'invalid_runner_command', `Command ${key.kind} is not a valid RunnerCommand: ${issues}`)
    }
    return parsed.data
  }

  async #feed(binding: AttemptBinding, command: RunnerCommand): Promise<CommandResult> {
    const attempt = this.#attempts.get(binding.attemptId)
    if (!attempt) return { queued: false, reason: 'attempt_not_running' }
    await attempt.feed(command)
    return { queued: true, commandId: command.id }
  }

  #requireActive(ticketId: string): AttemptBinding {
    const binding = this.#bindings.current(ticketId)
    if (!binding) throw new DriverError('state_indeterminate', 'unknown_binding', `No binding for ticket ${ticketId}`)
    if (binding.state !== 'active') {
      throw new DriverError('state_indeterminate', 'not_active', `Binding is ${binding.state}; no new business command is accepted`)
    }
    return binding
  }
}

const SUBTUPLE_FIELDS = ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch'] as const

/** The StartInput tuple must be exactly the one carried by the AttemptSpec (no divergence allowed). */
export function assertStartInput(input: StartInput): void {
  if (!input || typeof input !== 'object') throw invalid('start input must be an object')
  for (const field of SUBTUPLE_FIELDS) {
    if (input.spec?.[field] !== input[field]) {
      throw invalid(`start.${field} (${String(input[field])}) does not match attempt spec (${String(input.spec?.[field])})`)
    }
  }
  if (!sameContract(input.spec?.contract, input.contract)) throw invalid('start.contract does not match the attempt spec')
  if (typeof input.initialInputRef !== 'string' || input.initialInputRef.length === 0) {
    throw invalid('start.initialInputRef is required: begin must carry the initial ExecutionInput, not the policy snapshot')
  }
  if (input.initialInputRef === input.spec.policySnapshotRef) {
    throw invalid('start.initialInputRef must name an ExecutionInput, not the policy snapshot reference')
  }
}

function sameContract(left: AttemptSpec['contract'] | undefined, right: AttemptSpec['contract'] | undefined): boolean {
  if (!left || !right) return false
  return left.workId === right.workId && left.revision === right.revision && left.digest === right.digest
}

function invalid(message: string): DriverError {
  return new DriverError('protocol_error', 'invalid_start_input', message)
}

/** Small deterministic hash so over-long ids stay unique without a dependency. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
