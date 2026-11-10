import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { AttemptRefSchema, IdSchema, JsonSchema } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import { jsonDigest } from './runtime-ingress.ts'
import type { IngressBinding, RuntimeProducer } from './runtime-ingress.ts'
import { verifiedRunnerInspection } from './runner-link.ts'
import type { VerifiedRunnerInspection } from './runner-link.ts'

const absolutePath = z.string().min(1).max(4096).refine(isAbsolute, 'A launcher path must be absolute')
const RegistrationBodySchema = z.strictObject({
  kind: z.literal('runner-registration/1'),
  producer: z.strictObject({ attempt: AttemptRefSchema, runnerIdentityRef: IdSchema, source: IdSchema }),
  endpoint: z.strictObject({ socketPath: absolutePath, credentialPath: absolutePath, socketIdentity: z.strictObject({ dev: z.number().int().nonnegative().safe(), ino: z.number().int().nonnegative().safe() }) }),
})
const RegistrationResultSchema = z.strictObject({ body: RegistrationBodySchema, proofRef: IdSchema, registeredEventSeq: z.number().int().positive().safe() })
export type RunnerRegistration = z.infer<typeof RegistrationResultSchema> & { commandId: string; digest: string; receiptSeq: number }

export class RunnerRegistrationError extends Error {
  readonly code: 'invalid_transaction' | 'unknown_binding' | 'identity_mismatch' | 'ended_binding' | 'invalid_registration'
  constructor(code: RunnerRegistrationError['code'], message: string) { super(message); this.code = code }
}
export const runnerRegistrationId = (attemptId: string): string => key('registered-runner', IdSchema.parse(attemptId))
export function producerForBinding(binding: IngressBinding): RuntimeProducer {
  return { attempt: { ticketId: binding.ticketId, assignmentId: binding.assignmentId, attemptId: binding.attemptId, fenceEpoch: binding.fenceEpoch, contract: binding.contract }, runnerIdentityRef: binding.runnerIdentityRef, source: binding.source }
}
function matchBinding(store: ProductStore, producer: RuntimeProducer): IngressBinding {
  const binding = store.bindings.binding<IngressBinding>(producer.attempt.attemptId)
  if (!binding) throw new RunnerRegistrationError('unknown_binding', 'Runner registration requires a known attempt')
  if (jsonDigest(JsonSchema.parse(producerForBinding(binding))) !== jsonDigest(JsonSchema.parse(producer))) throw new RunnerRegistrationError('identity_mismatch', 'Launcher registration differs from the immutable attempt identity')
  return binding
}

/** Trusted launcher entry only. Agent output and filesystem discovery cannot register a Runner. */
export function registerRecoveryRunner(store: ProductStore, proof: VerifiedRunnerInspection) {
  if (store.uow.nesting) throw new RunnerRegistrationError('invalid_transaction', 'Runner registration owns the outer commit')
  const { value, endpoint } = verifiedRunnerInspection(proof)
  const body = RegistrationBodySchema.parse({ kind: 'runner-registration/1', producer: { attempt: value.attempt, runnerIdentityRef: value.runnerIdentityRef, source: value.source }, endpoint })
  matchBinding(store, body.producer)
  const commandId = runnerRegistrationId(value.attempt.attemptId), digest = jsonDigest(JsonSchema.parse(body))
  // Endpoint/key references stay in the private command result, not public events or proof files.
  const existing = loadRecoveryRunner(store, value.attempt.attemptId)
  const proofRef = existing ? undefined : store.payloads.write(JsonSchema.parse({ protocol: 'runner-registration-proof/1', inspection: value, socketIdentity: endpoint.socketIdentity })).ref
  return store.uow.atomic(() => {
    verifiedRunnerInspection(proof)
    const binding = matchBinding(store, body.producer)
    if (!loadRecoveryRunner(store, binding.attemptId) && binding.state === 'ended') throw new RunnerRegistrationError('ended_binding', 'An ended attempt cannot acquire a new Runner endpoint')
    return store.commands.record(commandId, digest, () => {
      if (!proofRef) throw new Error('Stored Runner registration disappeared during confirmation')
      const registeredEventSeq = store.events.append({ topic: 'runtime.runner.registered', entityRef: binding.attemptId, payload: { producer: body.producer, registrationDigest: digest, proofRef } })
      return { body, proofRef, registeredEventSeq }
    })
  })
}

/** Indexed immutable command receipt is the registration source of truth; no parallel SQL registry. */
export function loadRecoveryRunner(store: ProductStore, attemptId: string): RunnerRegistration | undefined {
  const commandId = runnerRegistrationId(attemptId), receipt = store.commands.get(commandId)
  if (!receipt) return undefined
  const parsed = RegistrationResultSchema.safeParse(receipt.result)
  if (!parsed.success || receipt.status !== 'recorded' || !Number.isSafeInteger(receipt.seq) || receipt.seq <= 0) throw new RunnerRegistrationError('invalid_registration', 'Stored Runner registration is invalid')
  const result = parsed.data, digest = jsonDigest(JsonSchema.parse(result.body))
  if (digest !== receipt.payloadDigest || result.body.producer.attempt.attemptId !== attemptId) throw new RunnerRegistrationError('invalid_registration', 'Stored Runner registration digest or attempt does not match')
  matchBinding(store, result.body.producer)
  const event = store.events.after(result.registeredEventSeq - 1, 1)[0]
  if (!event || event.seq !== result.registeredEventSeq || event.seq >= receipt.seq || event.topic !== 'runtime.runner.registered' || event.entityRef !== attemptId
    || jsonDigest(JsonSchema.parse(event.payload)) !== jsonDigest(JsonSchema.parse({ producer: result.body.producer, registrationDigest: digest, proofRef: result.proofRef }))) throw new RunnerRegistrationError('invalid_registration', 'Runner registration lacks its committed matching event')
  return { ...result, commandId, digest, receiptSeq: receipt.seq }
}

/** A pinned launcher's fresh complete inventory can reveal children spawned after registration. */
export function adoptRegisteredRunnerResources(store: ProductStore, proof: VerifiedRunnerInspection): void {
  const { value, endpoint } = verifiedRunnerInspection(proof)
  const registration = loadRecoveryRunner(store, value.attempt.attemptId)
  if (!registration || value.coverage !== 'complete_owned_resources' ||
      jsonDigest(JsonSchema.parse(registration.body.endpoint)) !== jsonDigest(JsonSchema.parse(endpoint)))
    throw new RunnerRegistrationError('invalid_registration', 'Inventory must come from the exact registered endpoint')
  store.uow.atomic(() => {
    verifiedRunnerInspection(proof)
    const binding = matchBinding(store, registration.body.producer)
    if (binding.state === 'ended') return
    const resources = new Map(binding.resources.map(resource => [resource.ref, resource]))
    for (const resource of value.resources) {
      const known = resources.get(resource.ref)
      if (known && known.ownership !== resource.ownership) throw new RunnerRegistrationError('identity_mismatch', 'Known resource ownership cannot change')
      resources.set(resource.ref, { ref: resource.ref, ownership: resource.ownership })
    }
    store.bindings.record({ ...binding, resources: [...resources.values()] })
  })
}
