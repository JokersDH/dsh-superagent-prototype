import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { arch, hostname, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  RecoveryTargetAuthorizeSchema, RecoveryTargetAuthorizationSchema, RecoveryTargetGrantSchema,
  RecoveryTargetMaterialSchema, TrustedActorSchema,
} from '@personal-agent/contracts'
import type {
  AgentProfile, RecoveryActivationCommit, RecoveryTargetAuthorization, RecoveryTargetAuthorize,
  RecoveryTargetConfiguration, RecoveryTargetGrant, RecoveryTargetMaterial, TrustedActor,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { key } from '@personal-agent/orchestrator-core'
import { InstanceRegistry, ProductStore, PRODUCT_SCHEMA_VERSION, recoveryTargetInventory, WriterLock } from '@personal-agent/storage'
import { ApplicationFault } from '@personal-agent/application'
import { NativeProjectRegistry } from './project-registry.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const targetAuthorizationCommandId = (generationId: string) => key('recovery-target-authorize', generationId)
export const recoveryHostDigest = () => digest({ protocol: 'recovery-target-host/1', host: hostname(),
  platform: platform(), arch: arch(), uid: process.getuid?.() ?? null })
const identity = (path: string, directory: boolean) => {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()) || realpathSync(path) !== path)
    throw new ApplicationFault('forbidden', 'Recovery target is not the original canonical private material', 'none')
  return `${stat.dev}:${stat.ino}`
}
export function readRecoveryTargetMaterial(stateRoot: string): RecoveryTargetMaterial | undefined {
  identity(stateRoot, true)
  const path = join(stateRoot, 'recovery-target.json')
  try { lstatSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  identity(path, false)
  const stat = lstatSync(path)
  if (stat.size > 65536) throw new ApplicationFault('invalid_request', 'Recovery target material exceeds its bound', 'none')
  const material = RecoveryTargetMaterialSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const { manifestDigest, ...body } = material
  if (material.stateRoot !== stateRoot || manifestDigest !== digest(body))
    throw new ApplicationFault('conflict', 'Recovery target material or root changed', 'none')
  return material
}

function commandFor(grant: RecoveryTargetGrant): RecoveryTargetAuthorize {
  return { activationId: grant.source.intent.activationId, commandId: grant.commandId, configuration: grant.configuration,
    expectedManifestDigest: grant.material.manifestDigest, confirmNewExecution: true }
}
function validateReceipt(receipt: { status: string; seq: number; payloadDigest: string; result: unknown }, material: RecoveryTargetMaterial): RecoveryTargetAuthorization {
  const grant = RecoveryTargetGrantSchema.parse(receipt.result)
  if (receipt.status !== 'recorded' || grant.commandId !== targetAuthorizationCommandId(material.generationId) ||
    digest(grant.material) !== digest(material) || digest(grant.configuration) !== material.configurationDigest ||
    digest(grant.source.intent) !== material.intentDigest ||
    !(['local_ui', 'local_cli'] as const).some(source => receipt.payloadDigest === digest({ command: commandFor(grant), actor: { ...grant.principal, source } })))
    throw new ApplicationFault('storage_unavailable', 'Target authorization receipt is inconsistent', 'none')
  return RecoveryTargetAuthorizationSchema.parse({ protocol: 'recovery-target-authorization/1', grant,
    targetReceipt: { commandId: grant.commandId, seq: receipt.seq }, authorization: 'granted', started: false, startupAvailable: false })
}

/** Read only the original target receipt; never constructs a writable/migrating ProductStore. */
export function readRecoveryTargetAuthorization(stateRoot: string): RecoveryTargetAuthorization | undefined {
  const material = readRecoveryTargetMaterial(stateRoot)
  if (!material) return undefined
  const path = join(stateRoot, 'state.sqlite'), before = identity(path, false)
  const stamp = (file: string) => {
    try { const stat = lstatSync(file); identity(file, false); return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  const wal = `${path}-wal`, snapshotBefore = [stamp(path), stamp(wal)], snapshot = mkdtempSync(join(tmpdir(), 'pa-target-grant-read-'))
  let db: DatabaseSync | undefined
  try {
    // Even a readonly SQLite open in WAL mode may create -wal/-shm. Query an owned private copy so
    // a refused startup does not change the original selected target at all.
    copyFileSync(path, join(snapshot, 'state.sqlite'))
    if (snapshotBefore[1] !== null) copyFileSync(wal, join(snapshot, 'state.sqlite-wal'))
    if (JSON.stringify(snapshotBefore) !== JSON.stringify([stamp(path), stamp(wal)]))
      throw new ApplicationFault('storage_unavailable', 'Target authorization snapshot changed while being read', 'none')
    db = new DatabaseSync(join(snapshot, 'state.sqlite'), { readOnly: true })
    const row = db.prepare('SELECT payload_digest, status, seq, result FROM command_receipts WHERE command_id = ?')
      .get(targetAuthorizationCommandId(material.generationId))
    if (!row) return undefined
    const result = validateReceipt({ payloadDigest: String(row.payload_digest), status: String(row.status), seq: Number(row.seq),
      result: JSON.parse(String(row.result)) }, material)
    const event = db.prepare('SELECT topic, entity_ref, payload FROM event_log WHERE seq = ?').get(result.targetReceipt.seq)
    if (!event || event.topic !== 'command' || event.entity_ref !== result.grant.commandId || event.payload !== JSON.stringify({ status: 'recorded' }) ||
      before !== identity(path, false)) throw new ApplicationFault('storage_unavailable', 'Target authorization event or database changed', 'none')
    return result
  } finally { db?.close(); rmSync(snapshot, { recursive: true, force: true }) }
}

/** Startup must call this before enabling execution for a prepared target. A receipt is not a running service. */
export function verifyRecoveryTargetIdentity(stateRoot: string, principal: { userId: string; authorityRef: string }): RecoveryTargetAuthorization | undefined {
  const material = readRecoveryTargetMaterial(stateRoot)
  if (!material) return undefined
  const record = readRecoveryTargetAuthorization(stateRoot)
  if (!record) throw new ApplicationFault('forbidden', 'The prepared recovery target needs explicit new execution authorization', 'none')
  const { grant } = record
  if (digest(grant.principal) !== digest(principal) || grant.machineDigest !== recoveryHostDigest() ||
    grant.rootIdentity !== identity(stateRoot, true) || grant.source.intent.target.parentIdentity !== identity(dirname(stateRoot), true) ||
    grant.databaseIdentity !== identity(join(stateRoot, 'state.sqlite'), false) || material.productSchema !== PRODUCT_SCHEMA_VERSION)
    throw new ApplicationFault('forbidden', 'Recovery authorization belongs to another host, root, principal or executor', 'none')
  // The authorization binds the operator's explicit initial project configuration. Normal business
  // data and historical source availability are deliberately not startup preconditions.
  const registry = new NativeProjectRegistry(stateRoot)
  if (grant.registryDigest !== digest(registry.list()))
    throw new ApplicationFault('conflict', 'Recovery target project configuration changed; explicit authorization must be reviewed', 'none')
  return record
}
export function verifyRecoveryTargetStartup(stateRoot: string, principal: { userId: string; authorityRef: string }, profile: AgentProfile): void {
  const record = verifyRecoveryTargetIdentity(stateRoot, principal)
  if (!record) return
  if (record.grant.profileDigest !== digest(profile) || record.grant.executableDigest !== sha(readFileSync(profile.executable)))
    throw new ApplicationFault('forbidden', 'Recovery authorization belongs to another host, root, principal or executor', 'none')
}

type AuthorizationOptions = {
    principal: { userId: string; authorityRef: string }
    executor(): AgentProfile
    revalidateSource(commit: RecoveryActivationCommit, configuration: RecoveryTargetConfiguration): void
    now?: () => string
}
export class ProductRecoveryTargetAuthorization {
  private readonly options: AuthorizationOptions
  constructor(options: AuthorizationOptions) { this.options = { ...options, principal: structuredClone(options.principal) } }

  async authorize(commit: RecoveryActivationCommit, material: RecoveryTargetMaterial, raw: RecoveryTargetAuthorize,
    inputActor: TrustedActor): Promise<RecoveryTargetAuthorization> {
    const command = RecoveryTargetAuthorizeSchema.parse(raw), actor = TrustedActorSchema.parse(inputActor)
    if (actor.source === 'explicit_rule' || actor.userId !== this.options.principal.userId || actor.authorityRef !== this.options.principal.authorityRef ||
      digest(commit.intent.principal) !== digest(this.options.principal))
      throw new ApplicationFault('forbidden', 'Target authorization requires the authenticated local user', 'none')
    if (command.activationId !== commit.intent.activationId || command.commandId !== targetAuthorizationCommandId(material.generationId) ||
      command.expectedManifestDigest !== material.manifestDigest || digest(command.configuration) !== material.configurationDigest ||
      material.intentDigest !== digest(commit.intent) || digest(readRecoveryTargetMaterial(material.stateRoot)) !== digest(material))
      throw new ApplicationFault('conflict', 'Authorization differs from the original prepared target', 'none')
    const prior = readRecoveryTargetAuthorization(material.stateRoot)
    if (prior) {
      if (digest(commandFor(prior.grant)) !== digest(command) || digest(prior.grant.source) !== digest(commit))
        throw new ApplicationFault('conflict', 'This generation already has another authorization request', 'none')
      return prior // A lost response is an audit replay, not fresh startup authority, even after expiry.
    }
    this.options.revalidateSource(commit, command.configuration)
    const profile = this.options.executor(), executableDigest = sha(readFileSync(profile.executable))
    const executor = { profileId: profile.id, revision: profile.revision, version: profile.expectedVersion, executableDigest }
    if (command.configuration.executor.profileId !== profile.id || command.configuration.executor.revision !== profile.revision ||
      command.configuration.executor.identityDigest !== digest(executor) || commit.intent.resourcePolicyDigest !== digest({
        protocol: 'recovery-source-isolation-policy/1', sourceQueues: 'held', target: 'new_empty_state',
        startup: 'separate_local_permission_and_current_physical_resources_required', executor }))
      throw new ApplicationFault('conflict', 'The current executor differs from the confirmed recovery profile', 'none')
    const root = material.stateRoot, rootIdentity = identity(root, true), dbIdentity = identity(join(root, 'state.sqlite'), false)
    if (commit.intent.target.parentIdentity !== identity(dirname(root), true))
      throw new ApplicationFault('conflict', 'Confirmed recovery target parent changed', 'none')
    const inventory = recoveryTargetInventory.inspect(root)
    if (inventory.completeness !== 'complete' || inventory.integrity !== 'ok' || inventory.productSchema !== material.productSchema ||
      inventory.issues.length || inventory.tables.some(table => table.category === 'business' && table.rows > 0))
      throw new ApplicationFault('state_in_use', 'New execution authorization requires a complete empty target', 'none')
    const target = new ProductStore({ path: join(root, 'state.sqlite') }), lock = new WriterLock(root, new InstanceRegistry(target.db))
    try {
      lock.acquire()
      if (identity(root, true) !== rootIdentity || identity(join(root, 'state.sqlite'), false) !== dbIdentity)
        throw new ApplicationFault('conflict', 'Target identity changed before authorization', 'none')
      const registry = new NativeProjectRegistry(root)
      const records = command.configuration.projects.map(binding => {
        const record = registry.prepare(binding.registration, { allowSettingsChange: true, readOnlyInspection: true })
        const head = execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'rev-parse', '--verify', 'HEAD'],
          { cwd: record.path, encoding: 'utf8', timeout: 10000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
        if (!binding.baselineCommit || record.id !== binding.targetProjectId || head !== binding.baselineCommit)
          throw new ApplicationFault('conflict', 'Target project identity or committed baseline changed', 'none')
        return record
      })
      if (new Set(records.map(record => record.id)).size !== records.length ||
        registry.list().some(record => !records.some(expected => digest(expected) === digest(record))))
        throw new ApplicationFault('conflict', 'Target contains a different project configuration', 'none')
      for (const record of records) registry.save(record)
      const result = target.commands.record(command.commandId, digest({ command, actor }), () => {
        this.options.revalidateSource(commit, command.configuration)
        const current = recoveryTargetInventory.inspect(root)
        if (current.completeness !== 'complete' || current.integrity !== 'ok' || current.issues.length ||
          identity(root, true) !== rootIdentity || identity(join(root, 'state.sqlite'), false) !== dbIdentity ||
          digest(readRecoveryTargetMaterial(root)) !== digest(material) || digest(this.options.executor()) !== digest(profile))
          throw new ApplicationFault('conflict', 'Source, target, resources or executor changed before authorization commit', 'none')
        return RecoveryTargetGrantSchema.parse({ protocol: 'recovery-target-grant/1', commandId: command.commandId, source: commit,
          material, configuration: command.configuration, principal: this.options.principal, machineDigest: recoveryHostDigest(), rootIdentity,
          databaseIdentity: dbIdentity,
          profileDigest: digest(profile), executableDigest, registryDigest: digest(registry.list()), grantedAt: this.options.now?.() ?? new Date().toISOString() })
      })
      return validateReceipt({ ...result, status: 'recorded', payloadDigest: digest({ command, actor }) }, material)
    } finally { lock.release(); target.close() }
  }
}
