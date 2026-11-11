import { IdSchema, RecoveryActivationCommitSchema, RecoveryActivationIntentSchema, RecoveryActivationRecordSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { RecoveryActivationCommit, RecoveryActivationFacts, RecoveryActivationIntent, RecoveryActivationRecord, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))

/** Production A facts plus the original main receipt; read-only and intentionally not a startup grant. */
export function readRecoveryActivationRecord(store: ProductStore, activationId: string,
  principal: { userId: string; authorityRef: string }): RecoveryActivationRecord | undefined {
  const id = IdSchema.parse(activationId)
  return store.uow.atomic(() => {
    const intent = store.workflows.recoveryActivations.get(id)
    if (!intent) return undefined
    if (intent.principal.userId !== principal.userId || intent.principal.authorityRef !== principal.authorityRef)
      throw new ApplicationFault('forbidden', 'Recovery record belongs to another principal', 'none')
    const byCommand = store.workflows.recoveryActivations.forCommand(intent.commandId), receipt = store.commands.get(intent.commandId)
    if (digest(byCommand ?? null) !== digest(intent) || !receipt || receipt.status !== 'recorded' || digest(receipt.result) !== digest(intent) ||
      !(['local_ui', 'local_cli'] as const).some(source => receipt.payloadDigest === digest({ intent, actor: { ...principal, source } })))
      throw new ApplicationFault('storage_unavailable', 'Recovery fact and confirming receipt are inconsistent', 'none')
    return RecoveryActivationRecordSchema.parse({ protocol: 'recovery-activation-record/1', authorization: 'not_granted', startupAvailable: false,
      committed: { protocol: 'recovery-activation-commit/1', intent, sourceReceipt: { commandId: intent.commandId, seq: receipt.seq } } })
  })
}

/** Source transaction only. Target materialization/startup must verify this source receipt separately. */
export class RecoveryIntentCommitter {
  private readonly principal: { userId: string; authorityRef: string }
  private readonly store: ProductStore
  private readonly facts: RecoveryActivationFacts
  private readonly revalidate: (intent: RecoveryActivationIntent) => void
  private readonly now: () => string
  constructor(store: ProductStore, facts: RecoveryActivationFacts,
    principal: { userId: string; authorityRef: string },
    revalidate: (intent: RecoveryActivationIntent) => void,
    now = () => new Date().toISOString()) {
    this.principal = structuredClone(principal)
    this.store = store; this.facts = facts; this.revalidate = revalidate; this.now = now
    if (Object.prototype.toString.call(revalidate) === '[object AsyncFunction]')
      throw new TypeError('Recovery intent revalidation must be synchronous')
  }
  commit(input: RecoveryActivationIntent, inputActor: TrustedActor): RecoveryActivationCommit {
    const intent = RecoveryActivationIntentSchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule' ||
      intent.principal.userId !== actor.userId || intent.principal.authorityRef !== actor.authorityRef)
      throw new ApplicationFault('forbidden', 'Recovery intent requires the authenticated confirming principal', 'none')
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Recovery intent commit owns the source transaction', 'none')
    const payloadDigest = digest({ intent, actor })
    return this.store.uow.atomic(() => {
      const prior = this.store.commands.get(intent.commandId)
      if (prior) {
        if (prior.payloadDigest !== payloadDigest || prior.status !== 'recorded')
          throw new ApplicationFault('conflict', 'Recovery command already names another request')
        const result = RecoveryActivationIntentSchema.parse(prior.result)
        if (digest(result) !== digest(intent)) throw new ApplicationFault('storage_unavailable', 'Recovery receipt body is inconsistent', 'none')
        this.requireFact(result)
        return RecoveryActivationCommitSchema.parse({ protocol: 'recovery-activation-commit/1', intent: result,
          sourceReceipt: { commandId: intent.commandId, seq: prior.seq } })
      }
      const at = Date.parse(this.now())
      if (Date.parse(intent.createdAt) > at || Date.parse(intent.expiresAt) <= at)
        throw new ApplicationFault('stale_contract', 'Recovery intent is not currently confirmable')
      // The runtime owns current marker/path/machine/plan and physical-resource checks.
      this.store.uow.atomic(() => this.revalidate(structuredClone(intent)))
      const receipt = this.store.commands.record(intent.commandId, payloadDigest, () => {
        const written = this.facts.put(structuredClone(intent))
        if (digest(written.intent) !== digest(intent))
          throw new ApplicationFault('storage_unavailable', 'Recovery fact differs from the confirmed intent', 'none')
        this.requireFact(intent)
        this.store.events.append({ topic: 'application.recovery.intent', entityRef: intent.activationId, payload: intent })
        return intent
      })
      return RecoveryActivationCommitSchema.parse({ protocol: 'recovery-activation-commit/1', intent: receipt.result,
        sourceReceipt: { commandId: intent.commandId, seq: receipt.seq } })
    })
  }
  private requireFact(intent: RecoveryActivationIntent): void {
    if (digest(this.facts.get(intent.activationId) ?? null) !== digest(intent) ||
      digest(this.facts.forCommand(intent.commandId) ?? null) !== digest(intent))
      throw new ApplicationFault('storage_unavailable', 'Committed source recovery fact is missing or inconsistent', 'none')
  }
}
