/**
 * Wave-34 B3: actionable diagnostics for original Runner control failures.
 *
 * This maps a control error onto what the operator/consumer can actually do next. It is deliberately
 * NOT a retry policy: an unknown outcome is never retried automatically, and an admitted command is
 * never replayed because a response was lost. The original store/registration remains the authority.
 */
export type RunnerFailureCode =
  | 'missing_executor' | 'auth_failed' | 'version_mismatch' | 'foreign_attempt' | 'stale_proof'
  | 'terminal_channel' | 'old_lease' | 'late_callback' | 'unknown_outcome' | 'timeout'
  | 'unavailable' | 'invalid_response' | 'refused' | 'unknown'

export type RunnerFailureDiagnosis = {
  code: RunnerFailureCode
  summary: string
  action: string
  /** True only when replaying the SAME command/registration cannot change the product result. */
  needsOriginalReconciliation: boolean
}

const refusedReason = (error: unknown): string | null => {
  const value = error as { serverError?: unknown; reason?: unknown; code?: unknown }
  if (typeof value?.serverError === 'string') return value.serverError
  if (typeof value?.reason === 'string') return value.reason
  if (typeof value?.code === 'string') return value.code
  return null
}

export function describeRunnerFailure(error: unknown): RunnerFailureDiagnosis {
  const code = (error as { code?: unknown })?.code
  const codeName = typeof code === 'string' ? code : null
  if (codeName === 'ENOENT') return { code: 'missing_executor', summary: 'The configured Runner executable does not exist.', action: 'Reinstall or fix the Runner executable path; nothing was launched and no command was admitted.', needsOriginalReconciliation: false }
  if (codeName === 'auth_failed') return { code: 'auth_failed', summary: 'The Runner rejected the local credential.', action: 'Re-register the Runner / refresh its credential; do not retry with another attempt’s credential.', needsOriginalReconciliation: false }
  if (codeName === 'invalid_response') return { code: 'version_mismatch', summary: 'The Runner response does not match this build’s protocol.', action: 'Check the Runner and coordinator are the same source version; a protocol mismatch is not a transient error.', needsOriginalReconciliation: false }
  if (codeName === 'stale_proof') return { code: 'stale_proof', summary: 'The inspection proof is stale.', action: 'Inspect the same Runner again; the original attempt registration must not change.', needsOriginalReconciliation: false }
  if (codeName === 'unavailable') return { code: 'unavailable', summary: 'The Runner endpoint is not reachable.', action: 'Confirm the original Runner child is still alive and the registered socket is current; retain UNKNOWN rather than declaring exit.', needsOriginalReconciliation: true }
  if (codeName === 'timeout') return { code: 'timeout', summary: 'The Runner did not answer within the deadline.', action: 'Retain UNKNOWN and reconcile the original command/attempt; do not assume the stop or write failed.', needsOriginalReconciliation: true }
  if (codeName === 'identity_mismatch') return { code: 'foreign_attempt', summary: 'The endpoint or producer belongs to another attempt.', action: 'Use the registration from the original Work/attempt; a foreign registration is never adopted.', needsOriginalReconciliation: false }
  if (codeName === 'unknown_outcome') return { code: 'unknown_outcome', summary: 'The control outcome is unknown, not necessarily a failure.', action: 'Re-read the original Store/binding and reconcile the same command id; do not automatically retry.', needsOriginalReconciliation: true }
  const reason = refusedReason(error)
  if (reason === 'stale_connection') return { code: 'terminal_channel', summary: 'The channel is terminal or the callback lease changed.', action: 'Stop writing to this channel; a replacement consumer must rebind explicitly before serving callbacks.', needsOriginalReconciliation: true }
  if (reason === 'stale_lease') return { code: 'late_callback', summary: 'A callback answer arrived after the lease/attempt ended.', action: 'Do not resend it under a new id; the original fact is already resolved or must be reconciled from the Store.', needsOriginalReconciliation: true }
  if (reason === 'foreign_producer') return { code: 'foreign_attempt', summary: 'A different Runner producer claimed this action.', action: 'Only the original immutable registration producer may feed or cancel this attempt.', needsOriginalReconciliation: false }
  if (reason === 'channel_closed') return { code: 'terminal_channel', summary: 'The Runner service is terminal.', action: 'No feed/cancel can revive it; reconcile the original binding and start a successor only through the original lifecycle.', needsOriginalReconciliation: true }
  if (reason === 'admission_closed') return { code: 'terminal_channel', summary: 'Business admission is closed for this attempt.', action: 'Do not feed further business commands; use the original stop/recovery path.', needsOriginalReconciliation: true }
  if (codeName === 'refused') return { code: 'refused', summary: `The Runner refused the control request${reason ? ` (${reason})` : ''}.`, action: 'Use the named refusal; do not treat refused as applied or as a transport failure.', needsOriginalReconciliation: true }
  return { code: 'unknown', summary: 'The control request failed for an unrecognized reason.', action: 'Retain the material and reconcile the original attempt; no automatic replay.', needsOriginalReconciliation: true }
}
