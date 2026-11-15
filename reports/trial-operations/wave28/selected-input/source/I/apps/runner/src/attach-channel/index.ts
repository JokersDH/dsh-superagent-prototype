/**
 * Public surface of the concrete attach channel.
 *
 * Callers (runner-service, RunnerLinkClient adapter, H's independent consumer) should import only
 * from this entry: the shared contract types plus the one implementation and its bounded errors.
 */
export { CoordinatorChannelModule, DEFAULT_LIMITS, sameCoordinatorChannelProducer } from './coordinator-channel.ts'
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
