/**
 * D-owned preparation of a private, empty recovery target.
 *
 * This implements the shared `RecoveryTargetMaterializer` port (packages/contracts/src/recovery-target.ts)
 * without importing the contracts package (so the portability dependency set stays unchanged): the
 * input is structurally the same `RecoveryTargetPreparation` JSON that main binds, and the output is
 * the same `RecoveryTargetMaterial` shape.
 *
 * It never starts a process, never copies a database/queue/native session/credential, and never
 * reports `startupAvailable: true`. A material or a directory name is not authorization: only main can
 * re-read committed source facts, current host/profile/resources and target bytes before activation.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { PortabilityError } from './errors.ts'

export const RECOVERY_TARGET_MATERIAL_PROTOCOL = 'recovery-target-material/1'
export const RECOVERY_TARGET_PREPARATION_PROTOCOL = 'recovery-target-preparation/1'
export const RECOVERY_TARGET_MANIFEST_FILE = 'recovery-target.json'

/** Structural mirror of the shared RecoveryTargetPreparation (main-owned; not a new authority). */
export interface RecoveryTargetPreparationLike {
  protocol: string
  /** RecoveryActivationCommit: { protocol, intent, sourceReceipt }. */
  source: {
    protocol?: string
    intent: {
      protocol?: string
      activationId: string
      commandId: string
      planId?: string
      planDigest?: string
      source: { stateId?: string; stateRoot: string; markerDigest?: string; inspectionFingerprint?: string }
      target: { generationId: string; stateRoot?: string; configurationDigest?: string }
      [key: string]: unknown
    }
    sourceReceipt?: { commandId?: string; seq?: number }
    [key: string]: unknown
  }
  configuration: {
    protocol: string
    projects: readonly { sourceProjectId: string; targetProjectId: string; registration: Record<string, unknown> }[]
    executor: Record<string, unknown>
  }
  startupAvailable: false
}

export interface RecoveryTargetMaterialLike {
  protocol: typeof RECOVERY_TARGET_MATERIAL_PROTOCOL
  activationId: string
  generationId: string
  stateRoot: string
  intentDigest: string
  configurationDigest: string
  manifestDigest: string
  productSchema: number
  preparedAt: string
  startupAvailable: false
}

export interface RecoveryTargetMaterializerOptions {
  /** Absolute, private (0700), current-user directory created by the operator/main. Never caller-supplied per call. */
  trustedParent: string
  /** The product schema this build can materialize; recorded, not inferred from a database. */
  productSchema: number
  now?: () => Date
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const fail = (code: ConstructorParameters<typeof PortabilityError>[0], message: string, detail: Record<string, unknown> = {}): never => {
  throw new PortabilityError(code, message, detail)
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`

const directory = (path: string) => {
  try { return statSync(path) } catch { return null }
}

const isRealDirectory = (path: string) => {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch { return false }
}

const assertTrustedParent = (parent: string) => {
  if (typeof parent !== 'string' || !isAbsolute(parent) || parent.includes('\0'))
    fail('target_parent_unsafe', 'The trusted parent must be an absolute path', { parent })
  const stat = directory(parent)
  if (stat === null || !stat.isDirectory()) fail('target_parent_unsafe', 'The trusted parent does not exist or is not a directory', { parent })
  if (stat === null) return
  const link = lstatSync(parent)
  if (link.isSymbolicLink()) fail('target_parent_unsafe', 'The trusted parent must not be a symlink', { parent })
  if ((stat.mode & 0o077) !== 0) fail('target_parent_unsafe', 'The trusted parent must be private (0700)', { parent, mode: (stat.mode & 0o777).toString(8) })
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    fail('target_parent_unsafe', 'The trusted parent must be owned by the current user', { parent, uid: stat.uid })
}

/** The D materializer: deterministic, idempotent, no process, no database, no credential. */
export class PortabilityRecoveryTargetMaterializer {
  readonly trustedParent: string
  readonly productSchema: number
  readonly #now: () => Date

  constructor(options: RecoveryTargetMaterializerOptions) {
    if (!Number.isInteger(options?.productSchema) || options.productSchema <= 0)
      fail('target_invalid', 'A positive product schema is required for materialization')
    assertTrustedParent(options.trustedParent)
    this.trustedParent = resolve(options.trustedParent)
    this.productSchema = options.productSchema
    this.#now = options.now ?? (() => new Date())
  }

  async prepare(input: RecoveryTargetPreparationLike): Promise<RecoveryTargetMaterialLike> {
    if (input === null || typeof input !== 'object') fail('target_invalid', 'A preparation object is required')
    if (input.protocol !== RECOVERY_TARGET_PREPARATION_PROTOCOL)
      fail('target_invalid', 'Unsupported preparation protocol', { protocol: input.protocol })
    if (input.startupAvailable !== false)
      fail('target_invalid', 'A preparation must never claim startup availability', { startupAvailable: input.startupAvailable })
    const source = input.source
    if (source === null || typeof source !== 'object' || source.protocol !== 'recovery-activation-commit/1' || typeof source.intent !== 'object' || source.intent === null)
      fail('target_invalid', 'The preparation needs a committed recovery activation (recovery-activation-commit/1)', { protocol: source?.protocol ?? null })
    const intent = source.intent
    if (!ID.test(String(intent.activationId ?? '')))
      fail('target_invalid', 'The preparation needs a well-formed activation identity', { activationId: intent?.activationId ?? null })
    if (source.sourceReceipt?.commandId !== intent.commandId)
      fail('target_identity_mismatch', 'The source receipt does not name the intent command', {
        receipt: source.sourceReceipt?.commandId ?? null, intent: intent.commandId ?? null,
      })
    if (!ID.test(String(intent.target?.generationId ?? '')))
      fail('target_invalid', 'The preparation needs a well-formed target generation identity', { generationId: intent?.target?.generationId ?? null })
    const configuration = input.configuration
    if (configuration === null || typeof configuration !== 'object' || !Array.isArray(configuration.projects) || configuration.projects.length === 0)
      fail('target_invalid', 'The preparation needs at least one project mapping')
    if (configuration.projects.length > 20) fail('target_invalid', 'Too many project mappings', { count: configuration.projects.length })
    const sourceProjectIds = new Set(configuration.projects.map((project) => project?.sourceProjectId))
    const targetProjectIds = new Set(configuration.projects.map((project) => project?.targetProjectId))
    if (sourceProjectIds.size !== configuration.projects.length || targetProjectIds.size !== configuration.projects.length)
      fail('target_identity_mismatch', 'Project mappings must be unique on both sides')
    for (const project of configuration.projects)
      if (typeof project?.sourceProjectId !== 'string' || typeof project?.targetProjectId !== 'string' || project?.registration === null || typeof project?.registration !== 'object')
        fail('target_invalid', 'Each mapping needs source/target project ids and a registration object')
    if (configuration.executor === null || typeof configuration.executor !== 'object')
      fail('target_invalid', 'The preparation needs an execution profile reference')

    const sourceRoot = typeof intent.source?.stateRoot === 'string' ? resolve(intent.source.stateRoot) : null
    if (sourceRoot !== null && (sourceRoot === this.trustedParent || sourceRoot.startsWith(`${this.trustedParent}${sep}`)))
      fail('target_parent_unsafe', 'The trusted parent must not contain the historical source state', { trustedParent: this.trustedParent, sourceRoot })

    const activationId = String(intent.activationId)
    const targetRoot = join(this.trustedParent, activationId)
    const generationId = String(intent.target.generationId)
    const intentDigest = digest(intent)
    const configurationDigest = digest(configuration)
    const manifestPath = join(targetRoot, RECOVERY_TARGET_MANIFEST_FILE)

    if (existsSync(targetRoot)) {
      if (!isRealDirectory(targetRoot)) fail('target_exists', 'The target path exists and is not a private directory', { targetRoot })
      const stat = lstatSync(targetRoot)
      if ((stat.mode & 0o077) !== 0) fail('target_exists', 'The existing target directory is not private', { targetRoot, mode: (stat.mode & 0o777).toString(8) })
      const existing = this.read(targetRoot)
      if (existing !== undefined) {
        if (existing.activationId !== activationId || existing.intentDigest !== intentDigest || existing.configurationDigest !== configurationDigest)
          fail('target_identity_mismatch', 'An existing target material belongs to a different preparation', {
            existing: { activationId: existing.activationId, intentDigest: existing.intentDigest },
            incoming: { activationId, intentDigest },
          })
        return existing
      }
      // A directory with no material is not ours to reuse.
      const entries = readdirSync(targetRoot)
      if (entries.length > 0) fail('target_exists', 'The target directory already contains foreign content', { targetRoot, entries: entries.slice(0, 8) })
    }

    mkdirSync(targetRoot, { recursive: false, mode: 0o700 })
    const preparedAt = this.#now().toISOString()
    const materialBody = {
      protocol: RECOVERY_TARGET_MATERIAL_PROTOCOL,
      activationId,
      generationId,
      stateRoot: targetRoot,
      intentDigest,
      configurationDigest,
      productSchema: this.productSchema,
      preparedAt,
      startupAvailable: false as const,
    }
    const manifest = { ...materialBody, manifestDigest: digest(materialBody) }
    writePrivateJson(manifestPath, manifest)
    const readBack = this.read(targetRoot)
    if (readBack === undefined || readBack.manifestDigest !== manifest.manifestDigest)
      fail('target_manifest_invalid', 'The written target material did not read back', { targetRoot })
    return readBack as RecoveryTargetMaterialLike
  }

  read(stateRoot: string): RecoveryTargetMaterialLike | undefined {
    if (typeof stateRoot !== 'string' || !isAbsolute(stateRoot)) fail('target_invalid', 'The target state root must be absolute', { stateRoot })
    const manifestPath = join(stateRoot, RECOVERY_TARGET_MANIFEST_FILE)
    if (!existsSync(manifestPath)) return undefined
    const stat = lstatSync(manifestPath)
    if (stat.isSymbolicLink() || !stat.isFile()) fail('target_manifest_invalid', 'The target material must be a regular file', { manifestPath })
    if ((stat.mode & 0o077) !== 0) fail('target_manifest_invalid', 'The target material must be private', { manifestPath, mode: (stat.mode & 0o777).toString(8) })
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown> } catch (error) {
      return fail('target_manifest_invalid', 'The target material is not valid JSON', { manifestPath, cause: String(error) })
    }
    if (parsed.protocol !== RECOVERY_TARGET_MATERIAL_PROTOCOL || parsed.startupAvailable !== false)
      fail('target_manifest_invalid', 'The target material protocol/availability is invalid', { protocol: parsed.protocol ?? null })
    if (typeof parsed.activationId !== 'string' || typeof parsed.generationId !== 'string' || typeof parsed.stateRoot !== 'string' ||
        typeof parsed.intentDigest !== 'string' || typeof parsed.configurationDigest !== 'string' || typeof parsed.manifestDigest !== 'string' ||
        typeof parsed.productSchema !== 'number' || typeof parsed.preparedAt !== 'string')
      fail('target_manifest_invalid', 'The target material is missing required fields')
    const recordedRoot = String(parsed.stateRoot)
    if (resolve(recordedRoot) !== resolve(stateRoot))
      fail('target_identity_mismatch', 'The target material names a different state root', { expected: stateRoot, recorded: parsed.stateRoot })
    const { manifestDigest, ...body } = parsed
    if (digest(body) !== manifestDigest) fail('target_manifest_invalid', 'The target material digest does not match its body', { manifestPath })
    return parsed as unknown as RecoveryTargetMaterialLike
  }

  async discardStaging(activationId: string): Promise<void> {
    if (!ID.test(activationId)) fail('target_invalid', 'A well-formed activation identity is required', { activationId })
    const targetRoot = join(this.trustedParent, activationId)
    if (!existsSync(targetRoot)) return
    if (!isRealDirectory(targetRoot)) fail('target_invalid', 'The target path is not a private directory', { targetRoot })
    const material = this.read(targetRoot)
    if (material === undefined) return fail('target_not_staging', 'The directory is not a prepared staging target', { targetRoot })
    if (material.activationId !== activationId) fail('target_identity_mismatch', 'The material belongs to another activation', { activationId, recorded: material.activationId })
    // A prepared target that already has a database may have been started by main; deleting it would
    // destroy a running/activated target. Only the manifest-only staging form is removable.
    const entries = readdirSync(targetRoot).filter((entry) => entry !== RECOVERY_TARGET_MANIFEST_FILE)
    const database = entries.find((entry) => entry === 'state.sqlite' || entry === 'state.sqlite-wal' || entry === 'state.sqlite-shm')
    if (database !== undefined || entries.some((entry) => entry !== 'state'))
      fail('target_not_staging', 'The target is not a manifest-only staging directory; refusing to remove it', { targetRoot, entries: entries.slice(0, 8) })
    for (const entry of entries) {
      const path = join(targetRoot, entry)
      if (isRealDirectory(path)) rmdirSync(path)
      else unlinkSync(path)
    }
    unlinkSync(join(targetRoot, RECOVERY_TARGET_MANIFEST_FILE))
    rmdirSync(targetRoot)
  }
}

function writePrivateJson(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalJson(value)}\n`, { mode: 0o600, flag: 'wx' })
}
