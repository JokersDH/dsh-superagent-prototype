/**
 * DriverKit public surface (WP-03). Everything exported here is transport/plumbing that a Driver,
 * Runner or conformance harness may use; product wire types come only from `packages/contracts`.
 */
export { DriverError, FramingError, asDriverError } from './errors.ts'
export type { FramingErrorReason } from './errors.ts'
export {
  JsonLineDecoder,
  decodeJsonLines,
  encodeFrame,
} from './framing.ts'
export type { DecodedFrame, DecoderStats, JsonLineDecoderOptions } from './framing.ts'
export { COMMAND_PRIORITY, CommandQueue, commandPriority } from './command-queue.ts'
export type { CommandQueueOptions } from './command-queue.ts'
export { ProgressCoalescer } from './progress.ts'
export type { ProgressCoalescerOptions, ProgressStats, Scheduler } from './progress.ts'
export {
  attemptIdentity,
  assertAttemptSpec,
  createAttemptIO,
  criticalFact,
  factIdFor,
} from './attempt-io.ts'
export type { AttemptIdentity, AttemptIOParts, CriticalFactInput } from './attempt-io.ts'

// --- wave-08 B1: production runtime description (read-only, no thread, no turn) ---------------
export {
  CAPABILITY_STATES,
  EVIDENCE_LAYERS,
  describeRuntime,
  descriptionDigest,
  probeHostEnforcement,
  resolveRuntimeIdentity,
  suppliedModelIdentity,
} from './runtime-diagnostics.ts'

// --- wave-08 B4: the one send-admission path shared by B and E --------------------------------
export { SENDER_OWNER, admitSend, consumeSendToken, inspectToken } from './send-admission.ts'

// --- wave-09 B4: the bounded sender E calls directly -------------------------------------------
export { NO_SEND, createReviewSender } from './review-sender.ts'
