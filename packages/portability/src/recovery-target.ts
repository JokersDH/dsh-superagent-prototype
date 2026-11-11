/**
 * D-owned preparation of a private, empty recovery target.
 *
 * Implements the shared `RecoveryTargetMaterializer` port
 * (packages/contracts/src/recovery-target.ts) structurally: the input is the same main-bound
 * `RecoveryTargetPreparation` JSON, the output is the same `RecoveryTargetMaterial` shape with bare
 * lowercase hex digests. It never starts a process, never creates a database (main/A initialize the
 * new empty state through the public Store), never copies a database/queue/session/credential, and
 * never reports `startupAvailable: true`. A prepared material is not authorization.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmdirSync, unlinkSync, writeSync,
} from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { PortabilityError } from './errors.ts'

export const RECOVERY_TARGET_MATERIAL_PROTOCOL = 'recovery-target-material/1'
export const RECOVERY_TARGET_PREPARATION_PROTOCOL = 'recovery-target-preparation/1'
export const RECOVERY_TARGET_MANIFEST_FILE = 'recovery-target.json'
const TEMP_PREFIX = `${RECOVERY_TARGET_MANIFEST_FILE}.tmp-`
const DIGEST = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export interface RecoveryTargetPreparationLike {
  protocol: string
  source: {
    protocol?: string
    intent: {
      protocol?: string
      activationId: string
      commandId: string
      planId?: string
      planDigest?: string
      source: { stateId?: string; stateRoot: string; markerDigest?: string; inspectionFingerprint?: string }
      target: { generationId: string; stateRoot: string; configurationDigest: string }
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
  /** Absolute, private (0700), current-user directory fixed at construction; never caller-supplied per call. */
  trustedParent: string
  /** The product schema main/A will initialize in the prepared root; recorded, not inferred. */
  productSchema: number
  now?: () => Date
}

const fail = (code: ConstructorParameters<typeof PortabilityError>[0], message: string, detail: Record<string, unknown> = {}): never => {
  throw new PortabilityError(code, message, detail)
}

/** Same canonical JSON/digest as the shared contracts canonical helper (bare lowercase hex). */
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`
}
const canonicalDigest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex')

const isDirectoryEntry = (path: string) => {
  try { return lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() } catch { return false }
}
const assertPrivateDirectory = (path: string, code: ConstructorParameters<typeof PortabilityError>[0], detail: Record<string, unknown>) => {
  let stat
  try { stat = lstatSync(path) } catch { return fail(code, 'The directory is missing', { ...detail, path }) }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code, 'A real directory is required (no symlink)', { ...detail, path })
  if ((stat.mode & 0o077) !== 0) fail(code, 'The directory must be private (0700)', { ...detail, path, mode: (stat.mode & 0o777).toString(8) })
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(code, 'The directory must be owned by the current user', { ...detail, path, uid: stat.uid })
  return stat
}

export class PortabilityRecoveryTargetMaterializer {
  readonly trustedParent: string
  readonly productSchema: number
  readonly #parent: { raw: string; realpath: string; dev: number; ino: number }
  readonly #now: () => Date

  constructor(options: RecoveryTargetMaterializerOptions) {
    if (!Number.isInteger(options?.productSchema) || options.productSchema <= 0)
      fail('target_invalid', 'A positive product schema is required for materialization')
    if (typeof options?.trustedParent !== 'string' || !isAbsolute(options.trustedParent) || options.trustedParent.includes('\0'))
      fail('target_parent_unsafe', 'The trusted parent must be an absolute path', { parent: options?.trustedParent })
    const stat = assertPrivateDirectory(options.trustedParent, 'target_parent_unsafe', { parent: options.trustedParent })
    this.trustedParent = options.trustedParent
    this.#parent = { raw: resolve(options.trustedParent), realpath: realpathSync(options.trustedParent), dev: stat.dev, ino: stat.ino }
    this.productSchema = options.productSchema
    this.#now = options.now ?? (() => new Date())
  }

  /** Parent identity is rechecked on every operation: a swapped symlink/inode/owner/mode is refused. */
  #revalidateParent(): void {
    const stat = assertPrivateDirectory(this.trustedParent, 'target_parent_unsafe', { parent: this.trustedParent })
    if (stat.dev !== this.#parent.dev || stat.ino !== this.#parent.ino)
      fail('target_parent_unsafe', 'The trusted parent was replaced after construction', { parent: this.trustedParent })
    if (realpathSync(this.trustedParent) !== this.#parent.realpath)
      fail('target_parent_unsafe', 'The trusted parent now resolves to a different path', { parent: this.trustedParent })
  }

  async prepare(input: RecoveryTargetPreparationLike): Promise<RecoveryTargetMaterialLike> {
    this.#revalidateParent()
    if (input === null || typeof input !== 'object') fail('target_invalid', 'A preparation object is required')
    if (input.protocol !== RECOVERY_TARGET_PREPARATION_PROTOCOL) fail('target_invalid', 'Unsupported preparation protocol', { protocol: input.protocol })
    if (input.startupAvailable !== false) fail('target_invalid', 'A preparation must never claim startup availability')
    const source = input.source
    if (source === null || typeof source !== 'object' || source.protocol !== 'recovery-activation-commit/1' || typeof source.intent !== 'object' || source.intent === null)
      fail('target_invalid', 'The preparation needs a committed recovery activation (recovery-activation-commit/1)', { protocol: source?.protocol ?? null })
    const intent = source.intent
    if (!ID.test(String(intent.activationId ?? ''))) fail('target_invalid', 'A well-formed activation identity is required')
    if (!ID.test(String(intent.target?.generationId ?? ''))) fail('target_invalid', 'A well-formed target generation identity is required')
    if (!DIGEST.test(String(intent.target?.configurationDigest ?? ''))) fail('target_invalid', 'The confirmed configuration digest must be bare lowercase hex')
    if (source.sourceReceipt?.commandId !== intent.commandId)
      fail('target_identity_mismatch', 'The source receipt does not name the intent command', { receipt: source.sourceReceipt?.commandId ?? null, intent: intent.commandId })
    const configuration = input.configuration
    if (configuration === null || typeof configuration !== 'object' || configuration.protocol !== 'recovery-target-configuration/1')
      fail('target_invalid', 'The preparation needs a recovery-target-configuration/1 configuration')
    if (!Array.isArray(configuration.projects) || configuration.projects.length === 0 || configuration.projects.length > 20)
      fail('target_invalid', 'The preparation needs 1..20 project mappings')
    const sourceIds = new Set(configuration.projects.map((project) => project?.sourceProjectId))
    const targetIds = new Set(configuration.projects.map((project) => project?.targetProjectId))
    if (sourceIds.size !== configuration.projects.length || targetIds.size !== configuration.projects.length)
      fail('target_identity_mismatch', 'Project mappings must be unique on both sides')
    for (const project of configuration.projects)
      if (typeof project?.sourceProjectId !== 'string' || typeof project?.targetProjectId !== 'string' || project?.registration === null || typeof project?.registration !== 'object')
        fail('target_invalid', 'Each mapping needs source/target project ids and a registration object')
    if (configuration.executor === null || typeof configuration.executor !== 'object')
      fail('target_invalid', 'The preparation needs an execution profile reference')

    // Recompute the confirmed configuration digest: a materially changed configuration never creates
    // a target under the old confirmation.
    const configurationDigest = canonicalDigest(configuration)
    if (configurationDigest !== intent.target.configurationDigest)
      fail('target_identity_mismatch', 'The configuration does not match the confirmed digest', {
        confirmed: intent.target.configurationDigest, actual: configurationDigest,
      })

    const activationId = String(intent.activationId)
    const generationId = String(intent.target.generationId)
    const requestedRoot = resolve(String(intent.target.stateRoot ?? ''))
    const expectedRoots = new Set([join(this.#parent.raw, activationId), join(this.#parent.realpath, activationId)])
    if (!expectedRoots.has(requestedRoot))
      fail('target_identity_mismatch', 'The confirmed target path is not the exact child of the trusted parent', {
        requested: requestedRoot, expected: [...expectedRoots],
      })
    const sourceRoot = resolve(String(intent.source?.stateRoot ?? ''))
    if (sourceRoot === requestedRoot || sourceRoot === this.#parent.raw || sourceRoot === this.#parent.realpath ||
        sourceRoot.startsWith(`${this.#parent.raw}${sep}`) || sourceRoot.startsWith(`${this.#parent.realpath}${sep}`))
      fail('target_parent_unsafe', 'The target must not overwrite the historical source state', { requestedRoot, sourceRoot })

    const intentDigest = canonicalDigest(intent)
    const manifestPath = join(requestedRoot, RECOVERY_TARGET_MANIFEST_FILE)

    if (existsSync(requestedRoot)) {
      assertPrivateDirectory(requestedRoot, 'target_exists', { targetRoot: requestedRoot })
      const existing = this.#readMaterial(requestedRoot)
      if (existing !== undefined) {
        if (existing.activationId !== activationId || existing.intentDigest !== intentDigest || existing.configurationDigest !== configurationDigest)
          fail('target_identity_mismatch', 'Existing target material belongs to a different preparation', {
            existing: { activationId: existing.activationId, intentDigest: existing.intentDigest },
            incoming: { activationId, intentDigest },
          })
        return existing
      }
      // A half-written prepare leaves only our own temp files; foreign content is never removed.
      const entries = readdirSync(requestedRoot)
      const foreign = entries.filter((entry) => !entry.startsWith(TEMP_PREFIX))
      if (foreign.length > 0) fail('target_exists', 'The target directory already contains foreign content', { targetRoot: requestedRoot, entries: entries.slice(0, 8) })
      for (const entry of entries) unlinkSync(join(requestedRoot, entry))
    } else {
      mkdirSync(requestedRoot, { recursive: false, mode: 0o700 })
    }

    const body = {
      protocol: RECOVERY_TARGET_MATERIAL_PROTOCOL,
      activationId,
      generationId,
      stateRoot: requestedRoot,
      intentDigest,
      configurationDigest,
      productSchema: this.productSchema,
      preparedAt: this.#now().toISOString(),
      startupAvailable: false as const,
    }
    const manifest = { ...body, manifestDigest: canonicalDigest(body) }
    const tempPath = join(requestedRoot, `${TEMP_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`)
    const fd = openSync(tempPath, 'wx', 0o600)
    try {
      writeSync(fd, `${JSON.stringify(manifest, null, 2)}\n`)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    renameSync(tempPath, manifestPath)
    const readBack = this.#readMaterial(requestedRoot)
    if (readBack === undefined || readBack.manifestDigest !== manifest.manifestDigest)
      fail('target_manifest_invalid', 'The written target material did not read back', { targetRoot: requestedRoot })
    return readBack as RecoveryTargetMaterialLike
  }

  async read(stateRoot: string): Promise<RecoveryTargetMaterialLike | undefined> {
    this.#revalidateParent()
    return this.#readMaterial(stateRoot)
  }

  #readMaterial(stateRoot: string): RecoveryTargetMaterialLike | undefined {
    if (typeof stateRoot !== 'string' || !isAbsolute(stateRoot) || stateRoot.includes('\0'))
      fail('target_invalid', 'The target state root must be absolute', { stateRoot })
    const root = resolve(stateRoot)
    const parentOfRoot = resolve(join(root, '..'))
    if (parentOfRoot !== this.#parent.raw && parentOfRoot !== this.#parent.realpath)
      fail('target_identity_mismatch', 'The target root must be an exact child of the trusted parent', { stateRoot: root, parent: this.#parent.realpath })
    const manifestPath = join(root, RECOVERY_TARGET_MANIFEST_FILE)
    if (!existsSync(manifestPath)) return undefined
    const stat = lstatSync(manifestPath)
    if (stat.isSymbolicLink() || !stat.isFile()) fail('target_manifest_invalid', 'The target material must be a regular file', { manifestPath })
    if ((stat.mode & 0o077) !== 0) fail('target_manifest_invalid', 'The target material must be private', { manifestPath, mode: (stat.mode & 0o777).toString(8) })
    if (stat.nlink !== 1) fail('target_manifest_invalid', 'The target material must not be hard-linked', { manifestPath, links: stat.nlink })
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown> } catch (error) {
      return fail('target_manifest_invalid', 'The target material is not valid JSON', { manifestPath, cause: String(error) })
    }
    const expectedKeys = ['protocol', 'activationId', 'generationId', 'stateRoot', 'intentDigest', 'configurationDigest', 'manifestDigest', 'productSchema', 'preparedAt', 'startupAvailable'].sort()
    const keys = Object.keys(parsed).sort()
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]))
      fail('target_manifest_invalid', 'The target material has unexpected or missing fields', { keys })
    if (parsed.protocol !== RECOVERY_TARGET_MATERIAL_PROTOCOL || parsed.startupAvailable !== false)
      fail('target_manifest_invalid', 'The target material protocol/availability is invalid', { protocol: parsed.protocol ?? null })
    for (const field of ['activationId', 'generationId', 'stateRoot', 'preparedAt']) if (typeof parsed[field] !== 'string') fail('target_manifest_invalid', `Missing ${field}`)
    for (const field of ['intentDigest', 'configurationDigest', 'manifestDigest']) if (typeof parsed[field] !== 'string' || !DIGEST.test(parsed[field] as string)) fail('target_manifest_invalid', `Invalid ${field}`)
    if (!Number.isInteger(parsed.productSchema) || (parsed.productSchema as number) <= 0) fail('target_manifest_invalid', 'Invalid product schema')
    if (resolve(String(parsed.stateRoot)) !== root)
      fail('target_identity_mismatch', 'The target material names a different state root', { expected: root, recorded: parsed.stateRoot })
    const { manifestDigest, ...body } = parsed
    if (canonicalDigest(body) !== manifestDigest) fail('target_manifest_invalid', 'The target material digest does not match its body', { manifestPath })
    return parsed as unknown as RecoveryTargetMaterialLike
  }

  async discardStaging(activationId: string): Promise<void> {
    this.#revalidateParent()
    if (!ID.test(activationId)) fail('target_invalid', 'A well-formed activation identity is required', { activationId })
    const targetRoot = join(this.#parent.raw, activationId)
    if (!existsSync(targetRoot)) return
    assertPrivateDirectory(targetRoot, 'target_invalid', { targetRoot })
    const material = this.#readMaterial(targetRoot)
    if (material === undefined) return fail('target_not_staging', 'The directory is not a prepared staging target', { targetRoot })
    if (material.activationId !== activationId) fail('target_identity_mismatch', 'The material belongs to another activation', { activationId, recorded: material.activationId })
    // Main/A may initialize a brand-new empty database at this exact root; an initialized target is
    // never staging and is never removed. Only the manifest and our own temp files are removable.
    const entries = readdirSync(targetRoot)
    const foreign = entries.filter((entry) => entry !== RECOVERY_TARGET_MANIFEST_FILE && !entry.startsWith(TEMP_PREFIX))
    if (foreign.length > 0) fail('target_not_staging', 'The target is not a manifest-only staging directory; refusing to remove it', { targetRoot, entries: foreign.slice(0, 8) })
    for (const entry of entries) unlinkSync(join(targetRoot, entry))
    rmdirSync(targetRoot)
  }
}
