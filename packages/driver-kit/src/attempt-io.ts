/**
 * AttemptIO construction helpers (WP-03). The interface itself is frozen in
 * `packages/contracts/src/ports.ts`; this module only wires the parts the Runner supplies and
 * stamps facts with the attempt identity. It deliberately performs no durable persistence: the
 * `record` implementation is the Runner's critical-fact ingress, and a real durable receipt cannot
 * be produced until the storage package is wired (reported NOT_TESTED for G1).
 */
import type { AttemptIO, OwnedProcessHost } from '../../contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, Json, ProgressUpdate, RunnerCommand, RuntimeFactKind } from '../../contracts/src/types.ts'
import { DriverError } from './errors.ts'

/** The identity subset every command and fact must carry. */
export type AttemptIdentity = Pick<AttemptSpec, 'ticketId' | 'assignmentId' | 'attemptId' | 'fenceEpoch' | 'contract'>

export function attemptIdentity(spec: AttemptSpec): AttemptIdentity {
  assertAttemptSpec(spec)
  return {
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch,
    contract: spec.contract,
  }
}

export type AttemptIOParts = {
  commands: AsyncIterable<RunnerCommand>
  record: (fact: CriticalFact) => Promise<import('../../contracts/src/types.ts').DurableReceipt>
  publishProgress: (update: ProgressUpdate) => void
  runtime: OwnedProcessHost
  payloads: AttemptIO['payloads']
}

/** Build the contract `AttemptIO` after checking the required parts are present. */
export function createAttemptIO(parts: AttemptIOParts): AttemptIO {
  if (!parts.commands || typeof parts.commands[Symbol.asyncIterator] !== 'function') {
    throw new DriverError('state_indeterminate', 'missing_commands', 'AttemptIO.commands must be an AsyncIterable')
  }
  if (typeof parts.record !== 'function') throw new DriverError('state_indeterminate', 'missing_record', 'AttemptIO.record is required')
  if (typeof parts.publishProgress !== 'function') throw new DriverError('state_indeterminate', 'missing_progress', 'AttemptIO.publishProgress is required')
  if (!parts.runtime) throw new DriverError('state_indeterminate', 'missing_runtime', 'AttemptIO.runtime is required')
  if (!parts.payloads || typeof parts.payloads.read !== 'function' || typeof parts.payloads.store !== 'function') {
    throw new DriverError('state_indeterminate', 'missing_payloads', 'AttemptIO.payloads is required')
  }
  return {
    commands: parts.commands,
    record: parts.record,
    publishProgress: parts.publishProgress,
    runtime: parts.runtime,
    payloads: parts.payloads,
  }
}

export type CriticalFactInput = {
  factId: string
  source: string
  kind: RuntimeFactKind
  /** Set when the native protocol carries its own reference (request/turn/session id). */
  nativeRef?: string
  /** Reference returned by `AttemptIO.payloads.store`. */
  payloadRef: string
}

/** Stamp a fact with the attempt identity; the ingress must still fence it against the current binding. */
export function criticalFact(spec: AttemptSpec, input: CriticalFactInput): CriticalFact {
  const identity = attemptIdentity(spec)
  return {
    ...identity,
    factId: input.factId,
    source: input.source,
    kind: input.kind,
    payloadRef: input.payloadRef,
    ...(input.nativeRef === undefined ? {} : { nativeRef: input.nativeRef }),
  }
}

/** Sequence-based fact ids are deterministic per attempt and stay inside the contract Id charset. */
export function factIdFor(attemptId: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError('fact sequence must be a positive integer')
  return `fact-${attemptId}-${seq}`
}

/**
 * Minimal structural guard for the identity fields the Runner depends on. Full contract validation
 * belongs to the frozen `packages/contracts` zod schemas at integration; this guard only prevents a
 * malformed local attempt from starting work.
 */
export function assertAttemptSpec(spec: unknown): asserts spec is AttemptSpec {
  if (spec === null || typeof spec !== 'object') throw invalid('attempt spec must be an object')
  const value = spec as Record<string, unknown>
  for (const field of ['ticketId', 'assignmentId', 'attemptId'] as const) {
    if (typeof value[field] !== 'string' || value[field].length === 0) throw invalid(`attempt.${field} must be a non-empty string`)
  }
  if (!Number.isInteger(value.fenceEpoch) || (value.fenceEpoch as number) < 1) throw invalid('attempt.fenceEpoch must be a positive integer')
  const contract = value.contract as Record<string, unknown> | undefined
  if (!contract || typeof contract !== 'object') throw invalid('attempt.contract is required')
  for (const field of ['workId', 'digest'] as const) {
    if (typeof contract[field] !== 'string' || (contract[field] as string).length === 0) throw invalid(`attempt.contract.${field} must be a non-empty string`)
  }
  if (!(typeof contract.revision === 'number' && Number.isInteger(contract.revision) && contract.revision >= 1)) {
    throw invalid('attempt.contract.revision must be a positive integer')
  }
  const profile = value.profile as Record<string, unknown> | undefined
  if (!profile || typeof profile.executable !== 'string' || !Array.isArray(profile.argv)) {
    throw invalid('attempt.profile.executable/argv is required')
  }
}

function invalid(message: string): DriverError {
  return new DriverError('protocol_error', 'invalid_attempt_spec', message)
}

export type { AttemptIO, Json }
