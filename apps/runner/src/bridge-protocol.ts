/**
 * Runner bridge envelope (WP-03 / wave-02 B2).
 *
 * Processes cannot pass closures, so the coordinator and an independent per-attempt Runner talk
 * over a versioned NDJSON envelope. Every field is derived from the frozen contracts types:
 * `AttemptSpec` for bootstrap, `CriticalFact`/`DurableReceipt` for facts, `RunnerCommand` for
 * control and `ServeExit` for the terminal result. This module adds **no** new business command and
 * no product database writer; it is a transport for the existing ports only.
 *
 * Protocol v1. A frame is `{ v: 1, type, id, ... }`. Unknown `type` values are a protocol error; a
 * different `v` is refused before any attempt work.
 */
import type {
  AttemptSpec,
  CriticalFact,
  DurableReceipt,
  Json,
  RunnerCommand,
  ServeExit,
} from '../../../packages/contracts/src/types.ts'
import type { DriverError } from '../../../packages/driver-kit/src/index.ts'

export const RUNNER_BRIDGE_PROTOCOL = 1 as const

/** Server -> client frames. */
export type BridgeDownstream =
  /** Sent once, after spawn/bootstrap and before any command is accepted. */
  | { v: 1; type: 'ready'; id: string; attemptId: string; pid: number; journalPath: string; protocol: 1 }
  /** A durable receipt for a critical fact (only after the sink persisted it). */
  | { v: 1; type: 'receipt'; id: string; factId: string; receipt: DurableReceipt }
  | { v: 1; type: 'progress'; id: string; text: string; observedAt: string }
  | { v: 1; type: 'exited'; id: string; exit: ServeExit }
  | { v: 1; type: 'error'; id: string; code: string; reason: string; message: string }

/** Client -> server frames. */
export type BridgeUpstream =
  /** Bootstrap: the structured spec, payload roots and the owner of the attempt. */
  | {
      v: 1
      type: 'bootstrap'
      id: string
      spec: AttemptSpec
      /** Where the payload store lives; the Runner never opens a product database. */
      payloadRoot: string
      journalPath: string
      /** Bound identity the Runner must echo on every fact it forwards. */
      producer: { source: string; runnerIdentityRef: string }
    }
  | { v: 1; type: 'command'; id: string; command: RunnerCommand }
  /** Reply to a payload read request. */
  | { v: 1; type: 'payload'; id: string; requestId: string; value: Json }
  /** Coordinator decision for a fact whose sink call failed. */
  | { v: 1; type: 'ack-failed'; id: string; factId: string; reason: string }
  | { v: 1; type: 'shutdown'; id: string }

export type BridgeFrame = BridgeDownstream | BridgeUpstream

/** Server requests the coordinator's payload store; there is no shared memory between processes. */
export type PayloadRequest = { v: 1; type: 'payload-read'; id: string; requestId: string; reference: string }

export class BridgeProtocolError extends Error {
  readonly code = 'protocol_error'
  constructor(message: string) {
    super(message)
    this.name = 'BridgeProtocolError'
  }
}

/** Reject a frame whose protocol version or envelope is not v1. */
export function parseBridgeFrame(value: unknown): BridgeFrame {
  if (value === null || typeof value !== 'object') throw new BridgeProtocolError('Bridge frame must be an object')
  const frame = value as Record<string, unknown>
  if (frame.v !== RUNNER_BRIDGE_PROTOCOL) {
    throw new BridgeProtocolError(`Unsupported runner bridge protocol: ${String(frame.v)}`)
  }
  if (typeof frame.type !== 'string' || frame.type.length === 0) throw new BridgeProtocolError('Bridge frame needs a type')
  if (typeof frame.id !== 'string' || frame.id.length === 0) throw new BridgeProtocolError('Bridge frame needs an id')
  return frame as unknown as BridgeFrame
}

/** The subset of a Driver error that crosses the bridge: a stable code/reason, never a stack. */
export type BridgeFailure = { code: DriverError['code']; reason: string; message: string }

export function toBridgeFailure(error: unknown): BridgeFailure {
  const candidate = error as { code?: string; reason?: string; message?: string } | null
  return {
    code: (candidate?.code as DriverError['code']) ?? 'state_indeterminate',
    reason: candidate?.reason ?? 'unexpected_error',
    message: candidate?.message ?? String(error),
  }
}
