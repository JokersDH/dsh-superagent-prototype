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
import { RunnerCommandSchema } from '../../../packages/contracts/src/schemas.ts'
import {
  CommandQueue,
  DriverError,
  ProgressCoalescer,
  assertAttemptSpec,
  createAttemptIO,
} from '../../../packages/driver-kit/src/index.ts'
import type { FactSink } from '../../../packages/execution/src/contracts.ts'
import { BoundedJournal, StderrRing, journalCoverage } from './journal.ts'
import type { FileCriticalJournal } from './file-journal.ts'
import { factDigest } from './file-journal.ts'
import { DurableReceiptSchema } from '../../../packages/contracts/src/schemas.ts'
import { ProcessHost, type ProcessHostOptions } from './process-host.ts'

export type RunnerOptions = {
  payloads: AttemptIO['payloads']
  factSink: FactSink
  processHost?: ProcessHost
  processHostOptions?: ProcessHostOptions
  journal?: BoundedJournal
  stderrRing?: StderrRing
  /**
   * Crash-safe on-disk spool. When present, every critical fact and its payload are written here
   * **before** the sink is asked, so a crash between the two can be replayed with the original
   * factId/payloadRef/identity.
   */
  spool?: FileCriticalJournal
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
  readonly spool: FileCriticalJournal | undefined
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
    this.spool = options.spool
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

  /**
   * The smallest useful record is well above 1 byte; treating "some bytes left" as capacity would
   * start a native writer that cannot durably keep even one critical fact.
   */
  spoolCanAccept(minimumRecordBytes = 256): boolean {
    if (!this.spool) return true
    return this.spool.maxBytes - this.spool.bytes >= minimumRecordBytes
  }

  get spec(): AttemptSpec | undefined {
    return this.#spec
  }

  /**
   * Queue a command; capacity exhaustion refuses new business input but keeps control available.
   *
   * The frozen `RunnerCommandSchema` is applied at this boundary too, and a command whose ticket,
   * assignment, attempt, epoch or contract differs from the launched attempt is rejected **before**
   * anything can reach the native process.
   */
  feed(command: RunnerCommand): void {
    // A command may be queued before launch (the Supervisor does exactly that); when the attempt is
    // known, the full tuple must match it.
    const parsed = RunnerCommandSchema.safeParse(command)
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
      throw new DriverError('protocol_error', 'invalid_runner_command', `Not a valid RunnerCommand: ${issues}`)
    }
    if (this.#spec) assertCommandIdentity(parsed.data, this.#spec)
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
    // A spool that cannot accept a record must stop the attempt before a native writer exists;
    // otherwise the process would run with no way to durably keep its critical facts.
    if (!this.spoolCanAccept()) {
      this.#capacityExhausted = true
      throw new DriverError('state_indeterminate', 'journal_capacity_exhausted', 'Journal cannot hold another record')
    }
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

    // 1. Local durable spool first: after this line the fact can be replayed with its original
    //    identity even if the process dies before (or while) the sink acknowledges it.
    if (this.spool) {
      let payload: unknown
      try {
        payload = await this.#payloads.read(fact.payloadRef)
      } catch (error) {
        throw new DriverError('state_indeterminate', 'payload_unavailable', `Cannot spool fact ${fact.factId}: ${(error as Error).message}`)
      }
      try {
        this.spool.append(fact, payload)
      } catch (error) {
        // Capacity exhaustion stops new business input; it never drops a critical fact silently.
        this.#capacityExhausted = true
        throw error
      }
    }

    // 2. Authoritative ACK. A receipt is only propagated once the sink proves persistence for
    //    exactly this fact; a local spool is not platform acceptance.
    const receipt = await this.#factSink.record(fact)
    const validated = validateReceipt(receipt, fact.factId)
    this.journal.commitCritical(fact.factId, fact.kind)
    return validated
  }
}

/** The command's frozen attempt tuple must equal the attempt this runner launched. */
function assertCommandIdentity(command: RunnerCommand, spec: AttemptSpec): void {
  if (command.ticketId !== spec.ticketId || command.assignmentId !== spec.assignmentId) {
    throw new DriverError('state_indeterminate', 'command_identity_mismatch', 'Command belongs to another ticket or assignment')
  }
  if (command.attemptId !== spec.attemptId || command.fenceEpoch !== spec.fenceEpoch) {
    throw new DriverError('state_indeterminate', 'command_identity_mismatch', 'Command belongs to another attempt or epoch')
  }
  const left = command.contract
  const right = spec.contract
  if (left.workId !== right.workId || left.revision !== right.revision || left.digest !== right.digest) {
    throw new DriverError('state_indeterminate', 'command_identity_mismatch', 'Command contract differs from the attempt contract')
  }
}

/**
 * Replay spooled critical facts to a sink (WP-03 batch 2).
 *
 * Rules enforced here:
 * - only facts are re-sent; no begin/deliver/answer/tool action is ever issued by a replay;
 * - known/duplicate facts must return their original receipt from the sink, so a second replay does
 *   not create a second business effect;
 * - a fact whose epoch is no longer current must be refused as business and may only be retained as a
 *   physical observation — that decision belongs to the authoritative sink, so this function never
 *   widens what a fact may do;
 * - a native execution state that is unknown is never "recovered" by starting a new attempt.
 */
export type ReplayResult = {
  replayed: number
  duplicates: number
  refused: number
  failures: { factId: string; reason: string }[]
}

export async function replayJournal(spool: FileCriticalJournal, sink: FactSink): Promise<ReplayResult> {
  const result: ReplayResult = { replayed: 0, duplicates: 0, refused: 0, failures: [] }

  // Whole-file integrity gates every replay: a corrupt or unverified snapshot must not produce a
  // single sink call, because a "successful prefix" of a damaged journal is not a verified batch.
  if (spool.readOnly) {
    throw new DriverError('state_indeterminate', 'journal_snapshot_unverified', 'Journal snapshot carries corruption; replay is refused')
  }
  const snapshot = spool.recovery
  if (!snapshot || snapshot.corruptAt !== null || snapshot.readOnly) {
    throw new DriverError('state_indeterminate', 'journal_snapshot_unverified', 'Journal snapshot was not verified by open()')
  }
  // Appends made after open() are expected (the live path writes continuously); what must not change
  // is the *verified prefix*: every fact open() validated must still be present and identical.
  const current = spool.entries()
  for (const [index, verified] of snapshot.entries.entries()) {
    const now = current[index]
    if (!now || now.fact.factId !== verified.fact.factId || now.seq !== verified.seq) {
      throw new DriverError('state_indeterminate', 'journal_snapshot_changed', 'Verified prefix changed since open(); reopen before replaying')
    }
  }
  const seen = new Map<string, string>()
  for (const entry of spool.entries()) {
    const identity = factDigest(entry.fact, entry.payload)
    const known = seen.get(entry.fact.factId)
    if (known !== undefined) {
      if (known !== identity) {
        // Same id, different body: facts are immutable, so this is a failure, not a duplicate.
        result.failures.push({ factId: entry.fact.factId, reason: 'fact_conflict' })
        continue
      }
      result.duplicates += 1
      continue
    }
    seen.set(entry.fact.factId, identity)
    try {
      const receipt = await sink.record(entry.fact)
      // Same frozen validation as the live path: a receipt that is not a persisted receipt for this
      // exact fact must never be counted as replayed.
      validateReceipt(receipt, entry.fact.factId)
      result.replayed += 1
    } catch (error) {
      const reason = (error as { reason?: string }).reason ?? (error as Error).message
      if (reason === 'not_active' || reason === 'stale_epoch' || reason === 'stale_assignment' || reason === 'attempt_mismatch') {
        // The authoritative sink may still keep such facts as physical evidence; replay does not
        // retry them as business work.
        result.refused += 1
      } else {
        result.failures.push({ factId: entry.fact.factId, reason })
        // An unexpected persistence failure must stop the batch: continuing would advance past a
        // gap and make the remaining replay order unverifiable.
        break
      }
    }
  }
  return result
}

/**
 * A sink receipt is authoritative only when the frozen schema accepts it, it names the same fact and
 * it claims persistence. Anything else (including `persisted: false`) is refused, never propagated.
 */
export function validateReceipt(receipt: unknown, factId: string): DurableReceipt {
  const parsed = DurableReceiptSchema.safeParse(receipt)
  if (!parsed.success) {
    throw new DriverError('state_indeterminate', 'invalid_receipt', `Sink returned an invalid receipt for ${factId}: ${parsed.error.message}`)
  }
  if (parsed.data.factId !== factId) {
    throw new DriverError('state_indeterminate', 'invalid_receipt', `Sink receipt names ${parsed.data.factId}, expected ${factId}`)
  }
  // `persisted` is a literal `true` in the schema, so reaching here already proves it.
  return parsed.data
}
