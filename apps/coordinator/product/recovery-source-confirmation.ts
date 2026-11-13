import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { arch, hostname, platform } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  RecoveryActivationIntentSchema, RecoveryActivationRecordSchema, RecoveryPlanSchema, RecoverySourceCheckpointSchema,
  RecoverySourceConfirmSchema, RecoverySourcePrepareSchema, RecoverySourcePreparedSchema, RecoveryTargetConfigurationSchema, TrustedActorSchema,
} from '@personal-agent/contracts'
import type { RecoveryActivationCommit, RecoveryActivationRecord, RecoveryPlan, RecoverySourceConfirm, RecoverySourcePrepare,
  RecoverySourcePrepared, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { key } from '@personal-agent/orchestrator-core'
import { RecoveryIntentCommitter } from './recovery-intents.ts'
import type { ProductRecovery } from './recovery.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const SignedSchema = z.strictObject({ version: z.literal(1), input: RecoverySourcePrepareSchema,
  plan: RecoveryPlanSchema, intent: RecoveryActivationIntentSchema })
type Signed = z.infer<typeof SignedSchema>
type SourceOptions = { stateRoot: string; startupMode: 'normal' | 'recovery_readonly';
  principal: { userId: string; authorityRef: string }; secret: Uint8Array; now?: () => string }
const inside = (parent: string, child: string) => {
  const path = relative(parent, child)
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
const planFacts = (plan: RecoveryPlan) => ({ inspectionFingerprint: plan.inspectionFingerprint,
  logicalSource: plan.logicalSource, bindings: plan.bindings, executor: plan.executor,
  artifactsChecked: plan.artifactsChecked, artifactScanTruncated: plan.artifactScanTruncated, blockers: plan.blockers })

/** Confirms source intent only. It creates no target, permission, runner or business queue entry. */
export class ProductRecoverySource {
  private readonly secret: Buffer
  private readonly store: ProductStore
  private readonly recovery: ProductRecovery
  private readonly options: SourceOptions
  constructor(store: ProductStore, recovery: ProductRecovery, options: SourceOptions) {
    if (options.secret.byteLength < 32) throw new TypeError('Source confirmation requires a private signing key')
    this.secret = Buffer.from(options.secret)
    this.store = store; this.recovery = recovery
    this.options = { ...options, principal: structuredClone(options.principal) }
  }
  private now() { return this.options.now?.() ?? new Date().toISOString() }
  private actor(input: TrustedActor) {
    const actor = TrustedActorSchema.parse(input)
    if (this.options.startupMode !== 'recovery_readonly')
      throw new ApplicationFault('unsupported_capability', 'Source confirmation requires restored read-only startup', 'none')
    if (actor.source === 'explicit_rule' || actor.userId !== this.options.principal.userId || actor.authorityRef !== this.options.principal.authorityRef)
      throw new ApplicationFault('forbidden', 'Source confirmation requires the authenticated local user', 'none')
    return actor
  }
  private signature(body: string) { return createHmac('sha256', this.secret).update(`recovery-source-confirmation/1:${body}`).digest('base64url') }
  private machine() {
    return createHmac('sha256', this.secret).update(JSON.stringify({ protocol: 'recovery-local-host/1',
      host: hostname(), platform: platform(), arch: arch(), uid: process.getuid?.() ?? null })).digest('hex')
  }
  private target(input: string) {
    try {
      const requested = resolve(input), parent = realpathSync(dirname(requested)), stat = lstatSync(parent)
      if (!stat.isDirectory() || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Nonprivate parent')
      const target = join(parent, basename(requested)), source = realpathSync(this.options.stateRoot)
      if (inside(source, target) || inside(target, source)) throw new Error('Historical target')
      try { lstatSync(target); throw new Error('Existing target') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      return target
    } catch { throw new ApplicationFault('verification_failed', 'Target must be a new distinct directory in a verified private parent', 'none') }
  }
  private configuration(input: RecoverySourcePrepare, plan: RecoveryPlan) {
    if (!plan.executor || !plan.logicalSource?.fingerprint || plan.logicalSource.coverage !== 'complete' ||
      plan.blockers.some(value => !['authorization_not_implemented', 'historical_resources_need_revalidation'].includes(value.code)))
      throw new ApplicationFault('verification_failed', 'Source confirmation requires complete preflight and current local executor identity', 'none')
    return RecoveryTargetConfigurationSchema.parse({ protocol: 'recovery-target-configuration/1',
      projects: plan.bindings.map(binding => ({ sourceProjectId: binding.sourceProjectId, targetProjectId: binding.proposedProjectId,
        registration: input.preflight.bindings.find(value => value.sourceProjectId === binding.sourceProjectId)!.project })),
      executor: { profileId: plan.executor.profileId, revision: plan.executor.revision, identityDigest: digest(plan.executor) } })
  }
  private policy(plan: RecoveryPlan) {
    return digest({ protocol: 'recovery-source-isolation-policy/1', sourceQueues: 'held', target: 'new_empty_state',
      startup: 'separate_local_permission_and_current_physical_resources_required', executor: plan.executor })
  }
  prepare(input: RecoverySourcePrepare, inputActor: TrustedActor): RecoverySourcePrepared {
    const value = RecoverySourcePrepareSchema.parse(input), actor = this.actor(inputActor)
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Source preparation runs outside transactions')
    const target = this.target(value.targetStateRoot), plan = this.recovery.prepare(value.preflight, actor)
    const configuration = this.configuration(value, plan), inspection = this.recovery.inspect()
    if (inspection.inspectionFingerprint !== plan.inspectionFingerprint || !inspection.markerDigest)
      throw new ApplicationFault('conflict', 'Source changed during preparation')
    const intent = RecoveryActivationIntentSchema.parse({ protocol: 'recovery-activation-intent/1',
      activationId: `recovery-activation-${randomUUID()}`, commandId: `recovery-confirm-${randomUUID()}`,
      planId: plan.planId, planDigest: digest(plan),
      source: { stateId: key('recovery-source-state', realpathSync(this.options.stateRoot), inspection.markerDigest),
        stateRoot: realpathSync(this.options.stateRoot), markerDigest: inspection.markerDigest, inspectionFingerprint: plan.inspectionFingerprint },
      target: { generationId: `recovery-generation-${randomUUID()}`, stateRoot: target, configurationDigest: digest(configuration) },
      principal: this.options.principal, machineDigest: this.machine(), resourcePolicyDigest: this.policy(plan),
      createdAt: plan.createdAt, expiresAt: plan.expiresAt })
    const signed = SignedSchema.parse({ version: 1, input: value, plan, intent })
    const body = Buffer.from(JSON.stringify(signed)).toString('base64url')
    if (body.length > 245700) throw new ApplicationFault('invalid_request', 'Source confirmation exceeds its bounded input size')
    return RecoverySourcePreparedSchema.parse({ protocol: 'recovery-source-prepared/1', intent, plan, configuration,
      token: `${body}.${this.signature(body)}`, authorization: 'not_granted', startupAvailable: false })
  }
  private decode(input: RecoverySourceConfirm, actor: TrustedActor): Signed {
    const value = RecoverySourceConfirmSchema.parse(input), [body, signature] = value.token.split('.') as [string, string]
    const expected = Buffer.from(this.signature(body)), supplied = Buffer.from(signature)
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new ApplicationFault('forbidden', 'Source confirmation signature is invalid', 'none')
    let signed: Signed
    try { signed = SignedSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))) }
    catch { throw new ApplicationFault('forbidden', 'Source confirmation token is invalid', 'none') }
    if (signed.intent.principal.userId !== actor.userId || signed.intent.principal.authorityRef !== actor.authorityRef ||
      signed.intent.source.stateRoot !== realpathSync(this.options.stateRoot) || signed.intent.planDigest !== digest(signed.plan) ||
      signed.intent.planId !== signed.plan.planId || signed.intent.source.inspectionFingerprint !== signed.plan.inspectionFingerprint)
      throw new ApplicationFault('forbidden', 'Source confirmation belongs to another principal or state', 'none')
    return signed
  }
  private assertUnchanged(signed: Signed, commit?: RecoveryActivationCommit) {
    const inspection = this.recovery.inspect()
    if (inspection.state !== 'recovery_readonly' || inspection.markerDigest !== signed.intent.source.markerDigest ||
      signed.intent.machineDigest !== this.machine() || signed.intent.resourcePolicyDigest !== this.policy(signed.plan) ||
      this.target(signed.input.targetStateRoot) !== signed.intent.target.stateRoot)
      throw new ApplicationFault('conflict', 'Source marker, host, policy or target changed')
    if (!commit) {
      if (inspection.inspectionFingerprint !== signed.plan.inspectionFingerprint)
        throw new ApplicationFault('conflict', 'Source changed before confirmation')
    } else {
      const source = RecoverySourceCheckpointSchema.parse(this.store.workflows.recoverySource.inspect({ ignoreCommitted: commit }))
      if (source.coverage !== 'complete' || source.sourceFingerprint !== signed.plan.logicalSource?.fingerprint ||
        source.ignoredConfirmation?.commandId !== commit.intent.commandId || source.ignoredConfirmation.receiptSeq !== commit.sourceReceipt.seq)
        throw new ApplicationFault('conflict', 'Source changed beyond the exact confirming transaction')
    }
  }
  confirm(input: RecoverySourceConfirm, inputActor: TrustedActor): RecoveryActivationRecord {
    const actor = this.actor(inputActor), signed = this.decode(input, actor)
    const prior = this.store.commands.get(signed.intent.commandId)
    if (!prior) {
      const fresh = this.recovery.prepare(signed.input.preflight, actor)
      if (digest(planFacts(fresh)) !== digest(planFacts(signed.plan)) ||
        digest(this.configuration(signed.input, fresh)) !== signed.intent.target.configurationDigest)
        throw new ApplicationFault('conflict', 'Project, executor or source preflight changed')
    }
    const committer = new RecoveryIntentCommitter(this.store, this.store.workflows.recoveryActivations,
      this.options.principal, () => this.assertUnchanged(signed), () => this.now(), commit => this.assertUnchanged(signed, commit))
    const committed = committer.commit(signed.intent, actor)
    return RecoveryActivationRecordSchema.parse({ protocol: 'recovery-activation-record/1', committed,
      authorization: 'not_granted', startupAvailable: false })
  }
}
