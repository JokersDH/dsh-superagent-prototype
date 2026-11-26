import { z } from 'zod'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ExecutorTrialCommandSchema, ExecutorTrialInspectionSchema, ExecutorTrialReceiptSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { ExecutorTrialCommand, ExecutorTrialInspection, ExecutorTrialReceipt, TrustedActor, ExecutionTrialAdmission } from '@personal-agent/contracts'
import type { ProductStore } from '@personal-agent/storage'
import { key } from '@personal-agent/orchestrator-core'
import { ApplicationFault } from '@personal-agent/application'
import { executionProfileView } from './execution-profile-view.ts'
import type { NativeExecutorInspection } from './native-inspection.ts'
import { NativeAdmissionError } from './native-startup.ts'
import { recoveryHostDigest } from './recovery-target-authorization.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const GrantSchema = z.strictObject({
  protocol: z.literal('executor-trial-grant/1'), command: ExecutorTrialCommandSchema,
  principal: z.strictObject({ userId: z.string(), authorityRef: z.string() }),
  stateScopeDigest: z.string().regex(/^[a-f0-9]{64}$/),
})
function stateScopeDigest(store: ProductStore): string {
  const database = realpathSync(store.db.name), root = dirname(database), folder = lstatSync(root), file = lstatSync(database)
  if (!folder.isDirectory() || folder.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() || file.nlink !== 1 ||
    folder.mode & 0o077 || (process.getuid && folder.uid !== process.getuid()))
    throw new ApplicationFault('forbidden', 'Executor consent requires the current private state identity', 'none')
  return digest({ root, rootIdentity: `${folder.dev}:${folder.ino}`, databaseIdentity: `${file.dev}:${file.ino}`, machineDigest: recoveryHostDigest() })
}
export function executorTrialCommandId(store: ProductStore, inspection: NativeExecutorInspection): string {
  return key('executor-trial-consent/v2', stateScopeDigest(store), inspection.profile.id, String(inspection.profile.revision), inspection.identityDigest, inspection.policyDigest)
}
function commandFor(store: ProductStore, inspection: NativeExecutorInspection): ExecutorTrialCommand {
  return { commandId: executorTrialCommandId(store, inspection), profileId: inspection.profile.id, revision: inspection.profile.revision,
    identityDigest: inspection.identityDigest, policyDigest: inspection.policyDigest, confirmUnverifiedVersion: true }
}
function current(inspection: NativeExecutorInspection) {
  const identity = inspection.verdict.identity
  return inspection.verdict.class === 'compatible_unverified' && !!identity && inspection.identityDigest === digest(identity) &&
    identity.profileId === inspection.profile.id && identity.profileRevision === inspection.profile.revision &&
    identity.permissionPolicyRevision === inspection.profile.permissionPolicyRevision &&
    inspection.operations.some(item => item.operation === 'begin' && item.supported === true && ['controlled', 'native'].includes(item.validation))
}

/** One original command receipt is the permission. No settings file or compatibility DTO grants it. */
export function readExecutorTrialAdmission(store: ProductStore, inspection: NativeExecutorInspection,
  principal: { userId: string; authorityRef: string }): ExecutionTrialAdmission | undefined {
  if (!current(inspection)) return undefined
  const command = commandFor(store, inspection), saved = store.commands.get(command.commandId)
  if (!saved) return undefined
  const receipt = readExecutorTrialReceipt(store, command.commandId, principal)
  if (!receipt || receipt.profileId !== command.profileId || receipt.revision !== command.revision ||
    receipt.identityDigest !== command.identityDigest || receipt.policyDigest !== command.policyDigest)
    throw new ApplicationFault('storage_unavailable', 'Executor consent does not bind the current inspection', 'none')
  return { mode: 'explicit_trial', identityDigest: inspection.identityDigest, policyDigest: inspection.policyDigest,
    confirmationCommandId: command.commandId }
}

/** Historical readback is deliberately not a current execution grant. Startup separately binds fresh inspection. */
export function readExecutorTrialReceipt(store: ProductStore, commandId: string,
  principal: { userId: string; authorityRef: string }): ExecutorTrialReceipt | undefined {
  const saved = store.commands.get(commandId)
  if (!saved) return undefined
  const grant = GrantSchema.safeParse(saved.result)
  const event = store.events.after(saved.seq - 1, 1)[0]
  if (saved.status !== 'recorded' || !grant.success || grant.data.command.commandId !== commandId ||
    digest(grant.data.principal) !== digest(principal) ||
    grant.data.stateScopeDigest !== stateScopeDigest(store) ||
    !(['local_ui', 'local_cli'] as const).some(source => saved.payloadDigest === digest({ command: grant.data.command, actor: { ...principal, source } })) ||
    !event || event.seq !== saved.seq || event.topic !== 'command' || event.entityRef !== commandId ||
    digest(event.payload) !== digest({ status: 'recorded' }) || event.payloadRef !== null)
    throw new ApplicationFault('storage_unavailable', 'Executor trial receipt does not match the original explicit consent', 'none')
  const { confirmUnverifiedVersion: _, ...identity } = grant.data.command
  return ExecutorTrialReceiptSchema.parse({ protocol: 'executor-trial-receipt/1', ...identity, seq: saved.seq,
    authorization: 'granted', effective: 'next_normal_start' })
}

export class ProductExecutorTrials {
  constructor(options: { store: ProductStore; principal: { userId: string; authorityRef: string }; inspect(): Promise<NativeExecutorInspection> }) {
    this.store = options.store; this.principal = structuredClone(options.principal); this.inspect = options.inspect
  }
  private readonly store: ProductStore
  private readonly principal: { userId: string; authorityRef: string }
  private readonly inspect: () => Promise<NativeExecutorInspection>
  receipt(commandId: string): ExecutorTrialReceipt | undefined { return readExecutorTrialReceipt(this.store, commandId, this.principal) }
  private observing: Promise<NativeExecutorInspection> | undefined
  private observe(): Promise<NativeExecutorInspection> {
    if (!this.observing) {
      const active = this.inspect().catch(error => {
        if (!(error instanceof NativeAdmissionError)) throw error
        if (error.reason === 'needs_auth') throw new ApplicationFault('auth_required', 'Codex 尚未登录，请使用自己的账号登录后再检查。', 'user_action')
        throw new ApplicationFault('unsupported_capability', '当前执行器的版本或协议尚未核实，不能开放试用。', 'none')
      })
      this.observing = active
      void active.finally(() => { if (this.observing === active) this.observing = undefined }).catch(() => undefined)
    }
    return this.observing
  }
  async read(): Promise<ExecutorTrialInspection> {
    const inspection = await this.observe()
    const admitted = readExecutorTrialAdmission(this.store, inspection, this.principal)
    return ExecutorTrialInspectionSchema.parse({ protocol: 'executor-trial-inspection/1',
      profile: executionProfileView({ profile: inspection.profile, displayName: 'Codex · 版本检查', verdict: inspection.verdict, operations: inspection.operations }),
      identityDigest: inspection.identityDigest, policyDigest: inspection.policyDigest, confirmationCommandId: executorTrialCommandId(this.store, inspection),
      authorization: admitted ? 'granted' : 'not_granted', confirmationAvailable: current(inspection), observedAt: inspection.verdict.checkedAt })
  }
  async confirm(raw: ExecutorTrialCommand, inputActor: TrustedActor): Promise<ExecutorTrialReceipt> {
    const command = ExecutorTrialCommandSchema.parse(raw), actor = TrustedActorSchema.parse(inputActor)
    if (actor.source === 'explicit_rule' || actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef)
      throw new ApplicationFault('forbidden', 'Trial consent requires the authenticated local user', 'none')
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Executor inspection must run outside the Store transaction', 'none')
    const inspection = await this.observe()
    if (!current(inspection) || digest(command) !== digest(commandFor(this.store, inspection)))
      throw new ApplicationFault('conflict', 'Executor identity, protocol or policy changed; inspect it again', 'none')
    const saved = this.store.commands.get(command.commandId)
    if (saved && !readExecutorTrialAdmission(this.store, inspection, this.principal))
      throw new ApplicationFault('conflict', 'The command ID already names another request', 'none')
    const written = saved ?? this.store.commands.record(command.commandId, digest({ command, actor }), () =>
      GrantSchema.parse({ protocol: 'executor-trial-grant/1', command, principal: this.principal, stateScopeDigest: stateScopeDigest(this.store) }))
    const { confirmUnverifiedVersion: _, ...identity } = command
    return ExecutorTrialReceiptSchema.parse({ protocol: 'executor-trial-receipt/1', ...identity, seq: written.seq,
      authorization: 'granted', effective: 'next_normal_start' })
  }
}
