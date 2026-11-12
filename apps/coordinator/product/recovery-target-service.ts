import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { ApplicationFault } from '@personal-agent/application'
import {
  IdSchema, RecoveryTargetInventorySchema, RecoveryTargetMaterialSchema,
  RecoveryTargetPrepareInputSchema, RecoveryTargetStatusSchema, TrustedActorSchema,
} from '@personal-agent/contracts'
import type {
  RecoveryActivationCommit, RecoveryTargetInventory, RecoveryTargetInventoryReader, RecoveryTargetMaterial,
  RecoveryTargetMaterializer, RecoveryTargetPrepareInput, RecoveryTargetStatus, TrustedActor,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { ProductStore } from '@personal-agent/storage'
import { readRecoveryActivationRecord } from './recovery-intents.ts'
import { bindRecoveryTargetConfiguration } from './recovery-targets.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value ?? null)))
type Blocker = RecoveryTargetStatus['blockers'][number]
type Options = {
  store: ProductStore
  principal: { userId: string; authorityRef: string }
  stateRoot: string
  materializer: RecoveryTargetMaterializer
  inventory: RecoveryTargetInventoryReader
  revalidateSource(commit: RecoveryActivationCommit): void
  initialize(material: RecoveryTargetMaterial): Promise<void>
  now?: () => string
}

/** Preparation consumes committed production facts; material, an empty DB and this status grant no startup. */
export class ProductRecoveryTargets {
  private readonly options: Options
  private readonly active = new Map<string, { bodyDigest: string; promise: Promise<RecoveryTargetStatus> }>()
  constructor(options: Options) {
    this.options = { ...options, principal: structuredClone(options.principal), stateRoot: resolve(options.stateRoot) }
    if (Object.prototype.toString.call(options.revalidateSource) === '[object AsyncFunction]')
      throw new TypeError('Recovery target source revalidation must be synchronous')
  }
  private now() { return this.options.now?.() ?? new Date().toISOString() }
  private outsideTransaction() {
    if (this.options.store.uow.nesting)
      throw new ApplicationFault('invalid_request', 'Target preparation cannot run inside the source transaction', 'none')
  }
  private source(activationId: string): RecoveryActivationCommit | undefined {
    this.outsideTransaction()
    const record = readRecoveryActivationRecord(this.options.store, activationId, this.options.principal)
    if (!record) return undefined
    const commit = record.committed
    let sourceRoot: string
    try { sourceRoot = realpathSync(commit.intent.source.stateRoot) }
    catch { throw new ApplicationFault('conflict', 'Recovery source directory is unavailable') }
    let configuredRoot: string
    try { configuredRoot = realpathSync(this.options.stateRoot) }
    catch { throw new ApplicationFault('conflict', 'Configured recovery source is unavailable') }
    let storeRoot: string
    try { storeRoot = dirname(realpathSync(this.options.store.db.name)) }
    catch { throw new ApplicationFault('conflict', 'The source database identity is unavailable') }
    if (sourceRoot !== configuredRoot || storeRoot !== configuredRoot || resolve(commit.intent.target.stateRoot) !== commit.intent.target.stateRoot ||
      resolve(commit.intent.target.stateRoot) === configuredRoot)
      throw new ApplicationFault('forbidden', 'Recovery source or target does not match this instance', 'none')
    return commit
  }
  private expired(commit: RecoveryActivationCommit) {
    const now = Date.parse(this.now())
    return Date.parse(commit.intent.createdAt) > now || Date.parse(commit.intent.expiresAt) <= now
  }
  private check(commit: RecoveryActivationCommit, revalidate: boolean) {
    const current = this.source(commit.intent.activationId)
    if (!current || digest(current) !== digest(commit))
      throw new ApplicationFault('conflict', 'Recovery source or confirming receipt changed')
    if (!revalidate) return
    if (this.expired(commit)) throw new ApplicationFault('stale_contract', 'Recovery confirmation expired; confirm again')
    const result: unknown = this.options.revalidateSource(structuredClone(commit))
    if (result && typeof result === 'object' && 'then' in result) {
      void Promise.resolve(result).catch(() => undefined)
      throw new ApplicationFault('invalid_request', 'Recovery source revalidation must be synchronous', 'none')
    }
    const after = this.source(commit.intent.activationId)
    if (!after || digest(after) !== digest(commit))
      throw new ApplicationFault('conflict', 'Recovery source changed during revalidation')
    if (this.expired(commit)) throw new ApplicationFault('stale_contract', 'Recovery confirmation expired; confirm again')
  }
  private material(input: unknown, commit: RecoveryActivationCommit): RecoveryTargetMaterial {
    const parsed = RecoveryTargetMaterialSchema.safeParse(input)
    if (!parsed.success) throw new ApplicationFault('verification_failed', 'Target material does not match the shared protocol')
    const value = parsed.data, intent = commit.intent
    if (value.activationId !== intent.activationId || value.generationId !== intent.target.generationId ||
      value.stateRoot !== intent.target.stateRoot || value.intentDigest !== digest(intent) ||
      value.configurationDigest !== intent.target.configurationDigest)
      throw new ApplicationFault('conflict', 'Target material differs from the confirmed identity or configuration')
    return value
  }
  private inventory(material: RecoveryTargetMaterial): RecoveryTargetInventory {
    const parsed = RecoveryTargetInventorySchema.safeParse(this.options.inventory.inspect(material.stateRoot))
    if (!parsed.success || parsed.data.stateRoot !== material.stateRoot)
      throw new ApplicationFault('verification_failed', 'Target inventory identity or protocol is invalid')
    return parsed.data
  }
  private missingDatabase(inventory: RecoveryTargetInventory) {
    return inventory.issues.length === 1 && inventory.issues[0] === 'missing_database' &&
      inventory.completeness === 'unsupported' &&
      inventory.tables.length === 0 && inventory.productSchema === null && inventory.databaseDigest === null &&
      inventory.integrity === 'unknown'
  }
  private inventoryBlockers(inventory: RecoveryTargetInventory, material: RecoveryTargetMaterial): Blocker[] {
    if (inventory.issues.some(issue => issue === 'not_private' || issue === 'unsafe_link'))
      return [{ code: 'target_unsafe', owner: 'D', detail: 'Target privacy or filesystem identity could not be verified' }]
    if (inventory.issues.includes('business_rows_present') || inventory.tables.some(table => table.category === 'business' && table.rows > 0))
      return [{ code: 'business_rows_present', owner: 'A', detail: 'The new target contains business history; no initialization or startup is allowed' }]
    if (inventory.completeness !== 'complete' || inventory.integrity !== 'ok' || !inventory.databaseDigest ||
      inventory.productSchema !== material.productSchema || inventory.issues.length ||
      !inventory.tables.some(table => table.category === 'business') || inventory.tables.some(table => table.category === 'unknown'))
      return [{ code: 'inventory_incomplete', owner: 'A', detail: 'The exact target schema and complete empty inventory have not been verified' }]
    return []
  }
  private status(commit: RecoveryActivationCommit, material?: RecoveryTargetMaterial, inventory?: RecoveryTargetInventory,
    blockers: Blocker[] = []): RecoveryTargetStatus {
    const expired = this.expired(commit)
    const all = [...(expired ? [{ code: 'source_expired' as const, owner: 'main' as const,
      detail: 'The original confirmation expired; a new explicit confirmation is required' }] : []), ...blockers]
    const missing = !!inventory && this.missingDatabase(inventory)
    const step = all.length ? 'blocked' : !material ? 'not_prepared' : missing || !inventory ? 'material_prepared' : 'inventory_complete'
    return RecoveryTargetStatusSchema.parse({ protocol: 'recovery-target-status/1', activationId: commit.intent.activationId,
      generationId: commit.intent.target.generationId, stateRoot: commit.intent.target.stateRoot, sourceReceipt: commit.sourceReceipt,
      observedAt: this.now(), expiresAt: commit.intent.expiresAt, step,
      ...(material ? { material } : {}), ...(inventory ? { inventory } : {}),
      blockers: [...all, { code: 'authorization_not_implemented', owner: 'main', detail: 'Target startup requires separate current host, resource and explicit authorization checks' }],
      authorization: 'not_granted', startupAvailable: false })
  }
  async prepare(input: RecoveryTargetPrepareInput, inputActor: TrustedActor): Promise<RecoveryTargetStatus> {
    this.outsideTransaction()
    const actor = TrustedActorSchema.parse(inputActor), value = RecoveryTargetPrepareInputSchema.parse(input)
    if (actor.source === 'explicit_rule' || actor.userId !== this.options.principal.userId || actor.authorityRef !== this.options.principal.authorityRef)
      throw new ApplicationFault('forbidden', 'Target preparation requires the authenticated confirming principal', 'none')
    const commit = this.source(value.activationId)
    if (!commit) throw new ApplicationFault('invalid_request', 'Recovery confirmation was not found')
    this.check(commit, true)
    const preparation = bindRecoveryTargetConfiguration(commit, value.configuration), bodyDigest = digest(preparation)
    const active = this.active.get(value.activationId)
    if (active) {
      if (active.bodyDigest !== bodyDigest) throw new ApplicationFault('conflict', 'Another target preparation names different input')
      return structuredClone(await active.promise)
    }
    const promise = this.prepareOne(commit, preparation)
    this.active.set(value.activationId, { bodyDigest, promise })
    try { return structuredClone(await promise) }
    finally { if (this.active.get(value.activationId)?.promise === promise) this.active.delete(value.activationId) }
  }
  private async prepareOne(commit: RecoveryActivationCommit,
    preparation: ReturnType<typeof bindRecoveryTargetConfiguration>): Promise<RecoveryTargetStatus> {
    this.check(commit, true)
    let prepared: RecoveryTargetMaterial
    try { prepared = await this.options.materializer.prepare(structuredClone(preparation)) }
    catch {
      this.check(commit, true)
      return this.status(commit, undefined, undefined, [{ code: 'target_unsafe', owner: 'D', detail: 'Target preparation failed; its bound material must be inspected before continuing' }])
    }
    this.check(commit, true)
    const material = this.material(prepared, commit)
    let readback: RecoveryTargetMaterial | undefined
    try { readback = await this.options.materializer.read(material.stateRoot) }
    catch {
      this.check(commit, true)
      return this.status(commit, material, undefined, [{ code: 'target_unsafe', owner: 'D', detail: 'Prepared target material cannot be read safely' }])
    }
    this.check(commit, true)
    if (digest(this.material(readback, commit)) !== digest(material))
      throw new ApplicationFault('conflict', 'Target material changed before readback')
    let inventory: RecoveryTargetInventory
    try { inventory = this.inventory(material) }
    catch {
      this.check(commit, true)
      return this.status(commit, material, undefined, [{ code: 'inventory_incomplete', owner: 'A', detail: 'Target inventory cannot be read or verified' }])
    }
    this.check(commit, true)
    if (this.missingDatabase(inventory)) {
      try { await this.options.initialize(structuredClone(material)) }
      catch {
        this.check(commit, true)
        return this.status(commit, material, inventory, [{ code: 'initialization_unknown', owner: 'main',
          detail: 'Target initialization did not complete with a verified result; inspect it before retrying' }])
      }
      this.check(commit, true)
      let after: RecoveryTargetMaterial | undefined
      try { after = await this.options.materializer.read(material.stateRoot) }
      catch {
        this.check(commit, true)
        return this.status(commit, material, undefined, [{ code: 'target_unsafe', owner: 'D', detail: 'Target material cannot be verified after initialization' }])
      }
      this.check(commit, true)
      if (digest(this.material(after, commit)) !== digest(material))
        throw new ApplicationFault('conflict', 'Target material changed during database initialization')
      try { inventory = this.inventory(material) }
      catch {
        this.check(commit, true)
        return this.status(commit, material, undefined, [{ code: 'inventory_incomplete', owner: 'A', detail: 'Initialized target inventory cannot be read or verified' }])
      }
      this.check(commit, true)
      if (this.missingDatabase(inventory))
        return this.status(commit, material, inventory, [{ code: 'initialization_unknown', owner: 'main', detail: 'Target database is still missing after initialization' }])
    }
    return this.status(commit, material, inventory, this.inventoryBlockers(inventory, material))
  }
  async read(activationId: string): Promise<RecoveryTargetStatus | undefined> {
    const commit = this.source(IdSchema.parse(activationId))
    if (!commit) return undefined
    let raw: unknown
    try { raw = await this.options.materializer.read(commit.intent.target.stateRoot) }
    catch {
      this.check(commit, false)
      return this.status(commit, undefined, undefined, [{ code: 'target_unsafe', owner: 'D', detail: 'Target material cannot be read safely' }])
    }
    this.check(commit, false)
    if (!raw) return this.status(commit)
    let material: RecoveryTargetMaterial
    try { material = this.material(raw, commit) }
    catch {
      this.check(commit, false)
      return this.status(commit, undefined, undefined, [{ code: 'material_mismatch', owner: 'D', detail: 'Target material does not match the original confirmation' }])
    }
    let inventory: RecoveryTargetInventory
    try { inventory = this.inventory(material) }
    catch {
      this.check(commit, false)
      return this.status(commit, material, undefined, [{ code: 'inventory_incomplete', owner: 'A', detail: 'Target inventory cannot be read or verified' }])
    }
    this.check(commit, false)
    return this.status(commit, material, inventory, this.missingDatabase(inventory) ? [] : this.inventoryBlockers(inventory, material))
  }
}
