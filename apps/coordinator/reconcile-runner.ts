import { IdSchema, JsonSchema, RunnerCommandSchema } from '@personal-agent/contracts'
import type { RunnerCommand } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import { jsonDigest } from './runtime-ingress.ts'
import type { IngressBinding } from './runtime-ingress.ts'
import { connectRunnerRecovery, RunnerLinkError, verifiedRunnerInspection } from './runner-link.ts'
import type { VerifiedRunnerInspection } from './runner-link.ts'
import { confirmOwnedQuiescence, ownedResourceManifestDigest, ResourceBarrierError } from './resource-barrier.ts'
import type { OwnedQuiescenceReceipt } from './resource-barrier.ts'
import { loadRecoveryRunner, RunnerRegistrationError } from './runner-registry.ts'
import type { RunnerRegistration } from './runner-registry.ts'

type Barrier = { replayed: boolean; result: OwnedQuiescenceReceipt; seq: number }
export type ReconciledRunner =
  | { status: 'running'; attemptId: string; businessResumed: false }
  | { status: 'held'; attemptId: string; reason: string; cancelCommandId?: string }
  | { status: 'quiescent'; attemptId: string; barrier: Barrier }
type Cancel = Extract<RunnerCommand, { kind: 'cancel' }>

function cancelIntent(store: ProductStore, registration: RunnerRegistration): Cancel {
  const { producer } = registration.body
  const command = RunnerCommandSchema.parse({ ...producer.attempt, kind: 'cancel', id: key('recovery-cancel', registration.commandId, registration.digest) })
  if (command.kind !== 'cancel') throw new TypeError('Expected a recovery cancellation')
  const body = { kind: 'runner-cancel-intent/1', command, registrationId: registration.commandId, registrationDigest: registration.digest }
  return store.uow.atomic(() => {
    const current = loadRecoveryRunner(store, producer.attempt.attemptId)
    const binding = store.bindings.binding<IngressBinding>(producer.attempt.attemptId)
    if (!current || current.digest !== registration.digest || binding?.state !== 'stopping') throw new RunnerRegistrationError('identity_mismatch', 'Cancellation requires the same registered stopping attempt')
    const recorded = store.commands.record(command.id, jsonDigest(JsonSchema.parse(body)), () => {
      store.events.append({ topic: 'runtime.recovery.cancel-requested', entityRef: binding.attemptId, payload: { commandId: command.id, registrationId: registration.commandId, registrationDigest: registration.digest } })
      return body
    })
    if (jsonDigest(JsonSchema.parse(recorded.result)) !== jsonDigest(JsonSchema.parse(body))) throw new RunnerRegistrationError('invalid_registration', 'Stored cancellation intent differs from the immutable command')
    return command
  })
}
function assertOutsideTransaction(store: ProductStore): void {
  if (store.uow.nesting) throw new RunnerRegistrationError('invalid_transaction', 'Recovery I/O cannot run inside a database transaction')
}

/** One bounded physical reconciliation. It never begins/delivers/answers, resumes business or completes a Ticket. */
export async function reconcileRegisteredRunner(store: ProductStore, inputAttemptId: string, options: { timeoutMs?: number } = {}): Promise<ReconciledRunner> {
  assertOutsideTransaction(store)
  const attemptId = IdSchema.parse(inputAttemptId), timeoutMs = options.timeoutMs ?? 3000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RangeError('Recovery timeout must be between 0 and 60000 milliseconds')
  const held = (reason: string, cancelCommandId?: string): ReconciledRunner => ({ status: 'held', attemptId, reason, ...(cancelCommandId ? { cancelCommandId } : {}) })
  let registration: RunnerRegistration | undefined
  try { registration = loadRecoveryRunner(store, attemptId) }
  catch (error) { if (error instanceof RunnerRegistrationError) return held(error.code); throw error }
  if (!registration) return held('registration_missing')
  let client: ReturnType<typeof connectRunnerRecovery>, proof: VerifiedRunnerInspection
  try {
    assertOutsideTransaction(store)
    client = connectRunnerRecovery(registration.body.endpoint, registration.body.producer, timeoutMs)
    proof = await client.inspect()
  } catch (error) { return held(error instanceof RunnerLinkError ? error.code : 'connection_unavailable') }
  assertOutsideTransaction(store)

  const finish = (inspection: VerifiedRunnerInspection): ReconciledRunner => {
    try { return { status: 'quiescent', attemptId, barrier: confirmOwnedQuiescence(store, inspection) } }
    catch (error) {
      if (error instanceof ResourceBarrierError || error instanceof RunnerLinkError) return held(error.code)
      throw error
    }
  }
  const observed = verifiedRunnerInspection(proof).value
  if (observed.state === 'terminated') return finish(proof)
  const binding = store.bindings.binding<IngressBinding>(attemptId)!
  if (binding.state !== 'stopping') {
    if (binding.state === 'active' && observed.state === 'serving' && observed.admission === 'open' && observed.coverage === 'complete_owned_resources'
      && observed.resources.every(resource => resource.writer !== 'indeterminate') && ownedResourceManifestDigest(binding.resources) === ownedResourceManifestDigest(observed.resources)) return { status: 'running', attemptId, businessResumed: false }
    return held('inspection_incomplete')
  }

  // Commit the stable control identity before contacting the peer. Reopen uses this exact ID.
  const command = cancelIntent(store, registration)
  try {
    assertOutsideTransaction(store)
    proof = await client.cancel(command)
  } catch (error) { return held(error instanceof RunnerLinkError ? error.code : 'connection_unavailable', command.id) }
  assertOutsideTransaction(store)
  return finish(proof)
}
