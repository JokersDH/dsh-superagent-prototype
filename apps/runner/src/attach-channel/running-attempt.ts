/**
 * wave-35: conformance guard for the object `runtime.launch` returns.
 *
 * `RunningAttempt.attachPort` and `RunningAttempt.attachCallbacks` exist only on the object the host
 * returns after its own registration/policy-ready/current checks. A consumer that receives such an
 * object must not trust its shape claim: the handle identity, the immutable producer tuple and the
 * three callbacks are validated *before* any endpoint is opened. The guard is pure — it never binds,
 * never connects, never grants a native write and keeps no state.
 */
import { AttemptRefSchema, IdSchema } from '@personal-agent/contracts'
import type { AttachedAttemptCallbacks } from '../../../../packages/execution/src/attached-attempt.ts'
import type { AttachedAttemptPort } from '../../../../packages/execution/src/contracts.ts'

/** Reasons a handle is not a trustworthy attach source. Bounded, stable and safe for diagnostics. */
export type RunningAttemptRefusal =
  | 'handle_missing'
  | 'port_missing'
  | 'registration_incomplete'
  | 'attempt_incomplete'
  | 'handle_producer_mismatch'
  | 'binding_mismatch'
  | 'callbacks_missing'

export type RunningAttemptExpectation = {
  readonly ticketId: string
  readonly assignmentId: string
  readonly attemptId: string
  readonly fenceEpoch: number
  readonly contract: { readonly workId: string; readonly revision: number; readonly digest: string }
}

export type InspectedRunningAttempt = {
  readonly attemptId: string
  readonly port: AttachedAttemptPort
  readonly callbacks: AttachedAttemptCallbacks
}

export type RunningAttemptInspection =
  | { readonly ok: true; readonly value: InspectedRunningAttempt }
  | { readonly ok: false; readonly refusal: RunningAttemptRefusal; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && IdSchema.safeParse(value).success
}

function isBoundedPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0')
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCallbacks(value: unknown): value is AttachedAttemptCallbacks {
  return (
    isRecord(value) &&
    typeof value.fact === 'function' &&
    typeof value.payload === 'function' &&
    typeof value.nativeWrite === 'function'
  )
}

function sameContract(left: RunningAttemptExpectation['contract'], right: RunningAttemptExpectation['contract']): boolean {
  return left.workId === right.workId && left.revision === right.revision && left.digest === right.digest
}

function isExpectation(value: unknown): value is RunningAttemptExpectation {
  return (
    isRecord(value) &&
    isId(value.ticketId) &&
    isId(value.assignmentId) &&
    isId(value.attemptId) &&
    isCount(value.fenceEpoch) &&
    isRecord(value.contract) &&
    isId(value.contract.workId) &&
    isCount(value.contract.revision) &&
    typeof value.contract.digest === 'string'
  )
}

/**
 * Validate one `RunningAttempt`-shaped value.
 *
 * `expectation` is the caller's own current binding; when supplied, the handle must name that exact
 * ticket/assignment/attempt/fence/contract. A handle whose own `attemptId` disagrees with the producer
 * it carries is refused even without an expectation, which is the shape a mismatched handle takes.
 */
export function inspectRunningAttempt(running: unknown, expectation?: RunningAttemptExpectation): RunningAttemptInspection {
  const refuse = (refusal: RunningAttemptRefusal, message: string): RunningAttemptInspection => ({ ok: false, refusal, message })
  if (!isRecord(running)) return refuse('handle_missing', 'attach source is not a running attempt object')
  const attemptId = running.attemptId
  if (!isId(attemptId)) return refuse('handle_missing', 'running attempt has no bounded attemptId')

  const port = running.attachPort
  if (!isRecord(port)) return refuse('port_missing', 'running attempt exposes no attach port')
  const registration = port.registration
  const socketPath = isRecord(registration) ? registration.socketPath : undefined
  const credentialPath = isRecord(registration) ? registration.credentialPath : undefined
  const socketIdentity = isRecord(registration) ? registration.socketIdentity : undefined
  if (
    !isBoundedPath(socketPath) ||
    !isBoundedPath(credentialPath) ||
    !isRecord(socketIdentity) ||
    !isCount(socketIdentity.dev) ||
    !isCount(socketIdentity.ino)
  )
    return refuse('registration_incomplete', 'attach registration is missing or incomplete')

  const producer = port.producer
  if (!isRecord(producer) || !isRecord(producer.attempt))
    return refuse('attempt_incomplete', 'attach port carries no producer attempt tuple')
  const parsedAttempt = AttemptRefSchema.safeParse(producer.attempt)
  const runnerIdentityRef = producer.runnerIdentityRef
  const source = producer.source
  if (!parsedAttempt.success || !isId(runnerIdentityRef) || !isId(source))
    return refuse('attempt_incomplete', 'producer attempt/runnerIdentityRef/source is incomplete')

  // The handle must name the attempt the port carries; a mismatched handle never reaches the endpoint.
  if (attemptId !== parsedAttempt.data.attemptId)
    return refuse('handle_producer_mismatch', 'handle attemptId does not match the port producer attempt')

  if (expectation !== undefined) {
    if (!isExpectation(expectation)) return refuse('binding_mismatch', 'expectation is not a current binding')
    if (
      expectation.ticketId !== parsedAttempt.data.ticketId ||
      expectation.assignmentId !== parsedAttempt.data.assignmentId ||
      expectation.attemptId !== parsedAttempt.data.attemptId ||
      expectation.fenceEpoch !== parsedAttempt.data.fenceEpoch ||
      !sameContract(expectation.contract, parsedAttempt.data.contract)
    )
      return refuse('binding_mismatch', 'attach port names a different current binding')
  }

  const callbacks = running.attachCallbacks
  if (!isCallbacks(callbacks)) return refuse('callbacks_missing', 'attach callbacks are missing or incomplete')

  return {
    ok: true,
    value: {
      attemptId,
      port: {
        registration: {
          socketPath,
          credentialPath,
          socketIdentity: { dev: socketIdentity.dev, ino: socketIdentity.ino },
        },
        producer: {
          attempt: parsedAttempt.data,
          runnerIdentityRef,
          source,
        },
      },
      callbacks,
    },
  }
}
