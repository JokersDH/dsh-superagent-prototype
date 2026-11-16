/**
 * Public surface of the concrete attach channel.
 *
 * Callers (runner-service, RunnerLinkClient adapter, H's independent consumer) should import only
 * from this entry: the shared contract types plus the one implementation and its bounded errors.
 */
export { CoordinatorChannelModule, DEFAULT_LIMITS, sameCoordinatorChannelProducer } from './coordinator-channel.ts'
export { RunnerAttachChannel } from './attach.ts'
export type { AttachHooks, AttachNext, AttachOptions, AttachOwnership, AttachRefusal, AttachReply } from './attach.ts'
export { inspectRunningAttempt } from './running-attempt.ts'
export type {
  InspectedRunningAttempt,
  RunningAttemptExpectation,
  RunningAttemptInspection,
  RunningAttemptRefusal,
} from './running-attempt.ts'
export { createCoordinatorSinkResponder } from './sink-responder.ts'
export type { CoordinatorSinkResponder, CoordinatorSinkResponderOptions } from './sink-responder.ts'
export { toAttachFailure, refusalFailure } from './refusals.ts'
export type { AttachFailure, AttachFailureCode } from './refusals.ts'
export { CoordinatorChannelError, NativeWriteDenied, isCoordinatorChannelError } from './errors.ts'
export {
  CoordinatorChannelLimitsSchema,
  CoordinatorChannelProducerSchema,
  CoordinatorChannelReplySchema,
  CoordinatorChannelRequestSchema,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
export type {
  CoordinatorChannel,
  CoordinatorChannelFailure,
  CoordinatorChannelLease,
  CoordinatorChannelLimits,
  CoordinatorChannelOptions,
  CoordinatorChannelProducer,
  CoordinatorChannelReply,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
export type { CoordinatorChannelModuleOptions, CoordinatorChannelSettlement } from './coordinator-channel.ts'
