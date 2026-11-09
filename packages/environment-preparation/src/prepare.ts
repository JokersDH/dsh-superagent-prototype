import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultEnvironmentExclusions, EnvironmentPreparationError,
  type BlockedEnvironment, type CleanupResult, type EnvironmentDiagnostic, type EnvironmentEvidence,
  type EnvironmentManager, type EnvironmentPreparationInput, type EnvironmentRef, type EnvironmentProcessPort,
  type PreparationResult, type ReadyEnvironment,
} from './types.ts'
import { canonical, directoryBytes, inside, isDirectory, projectSnapshot, realInside, samePath, sha256 } from './paths.ts'
import { dependencyDigest, inspectWorkspace, versionsEqual, type WorkspaceInspection } from './project.ts'
import { scanInstalledTree } from './installed.ts'
import { runOwned, standaloneProcessPort } from './process.ts'
import { acquireWorkspaceLock, ensureAuthority, ownedPath, writeReceipt, type Authority, type ReceiptBody } from './authority.ts'
import { cleanupPreparedEnvironment } from './verify.ts'

const PROTOCOL = 'environment-preparation/2'
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DEFAULTS = { timeoutMs: 120_000, maxOutputBytes: 256 * 1024, maxWorkspaceBytes: 1024 * 1024 * 1024 }

interface Marker {
  protocol: typeof PROTOCOL
  requestId: string
  inputFingerprint: string
  fingerprint: string
  installedDigest: string
  owned: true
  phase: 'preparing' | 'ready'
  manager: EnvironmentManager
  policy: string
  workspaceReal: string
  projectReal: string
  createdAt: string
}

interface Context {
  workspace: string
  project: string
  envRoot: string
  markerPath: string
  nodeModules: string
  diagnostics: EnvironmentDiagnostic[]
  evidence: EnvironmentEvidence[]
}

const diagnostic = (ctx: Context, code: string, message: string, severity: EnvironmentDiagnostic['severity'] = 'info'): void => {
  ctx.diagnostics.push({ code, severity, message })
}
const evidence = (ctx: Context, ref: string, note: string): void => {
  ctx.evidence.push({ ref, note })
}

function validateInput(input: EnvironmentPreparationInput): { project: string; workspace: string } {
  if (!input || typeof input !== 'object') throw new EnvironmentPreparationError('invalid_request', 'A preparation request is required.')
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId))
    throw new EnvironmentPreparationError('invalid_request', 'requestId must be a stable caller-chosen id (1-128 safe characters).')
  if (input.policy !== 'existing_only' && input.policy !== 'offline_install')
    throw new EnvironmentPreparationError('invalid_request', 'policy must be existing_only or offline_install.')
  if (!(input.signal instanceof AbortSignal))
    throw new EnvironmentPreparationError('invalid_request', 'An AbortSignal is required for cancellation.')
  for (const field of ['projectPath', 'workspacePath'] as const) {
    if (typeof input[field] !== 'string' || !input[field].startsWith('/'))
      throw new EnvironmentPreparationError('invalid_request', `${field} must be an absolute path.`)
    if (!isDirectory(input[field]))
      throw new EnvironmentPreparationError('invalid_request', `${field} does not exist or is not a directory.`)
  }
  const project = canonical(input.projectPath), workspace = canonical(input.workspacePath)
  if (samePath(project, workspace) || inside(project, workspace) || inside(workspace, project))
    throw new EnvironmentPreparationError('unsafe_paths', 'The original project and the private workspace must be separate, non-containing directories.')
  return { project, workspace }
}

function contextFor(input: EnvironmentPreparationInput, project: string, workspace: string): Context {
  const envRoot = join(workspace, '.product-environment')
  return {
    project, workspace, envRoot, markerPath: join(envRoot, 'state.json'), nodeModules: join(workspace, 'node_modules'),
    diagnostics: [], evidence: [],
  }
}

function readMarker(path: string): Marker | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Marker
    if (value.protocol !== PROTOCOL || value.owned !== true || typeof value.fingerprint !== 'string') return undefined
    return value
  } catch { return undefined }
}

/** Corepack may wrap pnpm; allow its read-only cached manager but never let it download/upgrade. */
function corepackEnvironment(): Record<string, string> {
  const corepackHome = process.env.COREPACK_HOME ?? join(process.env.HOME ?? tmpdir(), '.cache/node/corepack')
  return { COREPACK_HOME: corepackHome, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
}

function environmentFor(ctx: Context, policy: 'existing_only' | 'offline_install'): Record<string, string> {
  const path = process.env.PATH ?? ''
  if (policy === 'existing_only') return { PATH: path }
  const home = join(ctx.envRoot, 'home')
  for (const directory of ['', '.config', '.cache', '.local/share', '.pnpm']) {
    mkdirSync(join(home, directory), { recursive: true, mode: 0o700 })
  }
  return {
    PATH: path, HOME: home, CI: '1',
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'), PNPM_HOME: join(home, '.pnpm'),
    ...corepackEnvironment(),
  }
}

function cleanupHandle(ctx: Context): () => Promise<CleanupResult> {
  return async (): Promise<CleanupResult> => {
    const marker = readMarker(ctx.markerPath)
    const targets: string[] = []
    // Only state created by this module is removable. A pre-existing .product-environment without a
    // trusted marker belongs to someone else and is preserved (or preparation refuses to use it).
    if (marker?.owned === true) {
      targets.push(ctx.nodeModules)
      if (existsSync(ctx.envRoot)) targets.push(ctx.envRoot)
    }
    const removed: string[] = []
    const leftovers: string[] = []
    for (const target of targets) {
      const { inside: contained } = realInside(ctx.workspace, target)
      if (!contained) { leftovers.push(target); continue }
      try { rmSync(target, { recursive: true, force: true }) } catch { /* retry below */ }
      if (existsSync(target)) leftovers.push(target)
      else removed.push(target)
    }
    return { removed, leftovers }
  }
}

function blockedResult(
  input: EnvironmentPreparationInput, ctx: Context, code: string, message: string, fingerprint?: string,
): BlockedEnvironment {
  const cleanup = cleanupHandle(ctx)
  return {
    status: 'blocked', requestId: input.requestId, code, message,
    ...(fingerprint ? { fingerprint } : {}),
    diagnostics: ctx.diagnostics, evidence: ctx.evidence, cleanup,
  }
}

function inputFingerprintOf(input: EnvironmentPreparationInput, inspection: WorkspaceInspection, manager: EnvironmentManager): string {
  return sha256(JSON.stringify({
    protocol: PROTOCOL, policy: input.policy, node: process.version,
    manager: { name: manager.name, declaredVersion: manager.declaredVersion ?? null, actualVersion: manager.actualVersion ?? null },
    packageJson: inspection.packageJsonDigest,
    locks: inspection.lockFiles.map(lock => ({ name: lock.name, digest: lock.digest })),
    dependencies: dependencyDigest(inspection.dependencies),
  }))
}

/** The ready identity binds the actual installed layout, not only the declared inputs. */
function environmentFingerprint(inputFingerprint: string, installedDigest: string): string {
  return sha256(JSON.stringify({ protocol: PROTOCOL, input: inputFingerprint, installed: installedDigest }))
}

async function probeManager(command: string, ctx: Context, port: EnvironmentProcessPort, signal?: AbortSignal): Promise<{ version?: string; error?: string; missing?: boolean }> {
  const home = mkdtempSync(join(tmpdir(), 'pa-environment-probe-'))
  let result
  try {
    result = await port.run(command, ['--version'], {
      cwd: ctx.workspace, env: { PATH: process.env.PATH ?? '', HOME: home, ...corepackEnvironment() }, timeoutMs: 10_000, maxOutputBytes: 8192, ...(signal ? { signal } : {}),
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  if (result.spawnError) return { error: result.spawnError, missing: true }
  if (result.cancelled) return { error: 'version probe cancelled' }
  if (result.timedOut) return { error: 'version probe timed out' }
  if (result.quiescence !== 'confirmed') return { error: 'version probe group quiescence is unproven' }
  if (result.code !== 0) return { error: `version probe exited ${String(result.code)}: ${result.stderr.slice(-400)}` }
  const version = result.stdout.trim().replace(/^v/, '')
  return version ? { version } : { error: 'empty version output' }
}

function storeProblem(input: EnvironmentPreparationInput, project: string, workspace: string): { code: string; message: string } | undefined {
  if (!input.storeDir) return { code: 'offline_store_missing', message: 'offline_install requires an authorized offline storeDir; no online fallback is attempted.' }
  if (!input.storeDir.startsWith('/')) return { code: 'invalid_store', message: 'storeDir must be an absolute path.' }
  if (!isDirectory(input.storeDir)) return { code: 'offline_store_missing', message: `Offline store does not exist: ${input.storeDir}` }
  const store = canonical(input.storeDir)
  if (inside(project, store) || inside(workspace, store) || samePath(project, store) || samePath(workspace, store))
    return { code: 'unsafe_store', message: 'The offline store must not be inside the original project or the private workspace.' }
  return undefined
}

function mapInstallError(stderr: string): { code: string; message: string } {
  if (/ERR_PNPM_NO_OFFLINE|ERR_PNPM_NO_OFFLINE_META|ENOTCACHED|ERR_PNPM_META_FETCH_FAIL|No matching version|offline/i.test(stderr))
    return { code: 'offline_cache_missing', message: 'The offline store does not contain every required package. Warm the authorized cache outside this module; the module never falls back to the network.' }
  if (/ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile|lockfile is not up to date|Cannot install with "frozen-lockfile"/i.test(stderr))
    return { code: 'lock_mismatch', message: 'The lockfile does not match package.json under the frozen-lockfile policy.' }
  if (/ERR_PNPM_UNSUPPORTED_ENGINE|Unsupported environment/i.test(stderr))
    return { code: 'manager_incompatible', message: 'The package manager cannot run in this environment (engine/version incompatibility).' }
  return { code: 'install_failed', message: 'Offline dependency installation failed.' }
}

const earlyBlocked = (input: EnvironmentPreparationInput, code: string, message: string): BlockedEnvironment => ({
  status: 'blocked', requestId: input.requestId, code, message, diagnostics: [], evidence: [],
  cleanup: async () => ({ removed: [], leftovers: [] }),
})

function finishReady(
  ctx: Context,
  input: EnvironmentPreparationInput,
  authority: Authority | undefined,
  values: {
    fingerprint: string
    inputFingerprint: string
    installedDigest: string
    manager: EnvironmentManager
    environment: Record<string, string>
    ownedRelatives: readonly string[]
    packageJsonDigest: string
    lockFiles: readonly { name: string; digest: string }[]
    dependencies: readonly { name: string; spec: string }[]
    legacyCleanup: () => Promise<CleanupResult>
  },
): ReadyEnvironment {
  const excludedPaths = (input.exclusion ?? defaultEnvironmentExclusions).excludedPaths(ctx.workspace)
  const entries = values.ownedRelatives
    .map(relative => ownedPath(ctx.workspace, relative))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
  let environmentRef: EnvironmentRef | undefined
  let cleanup = values.legacyCleanup
  if (authority) {
    const body: ReceiptBody = {
      protocol: 'environment-receipt/2', requestId: input.requestId,
      inputFingerprint: values.inputFingerprint, fingerprint: values.fingerprint, installedDigest: values.installedDigest,
      workspaceReal: ctx.workspace, projectReal: ctx.project, manager: values.manager, nodeVersion: process.versions.node,
      policy: input.policy, environment: values.environment, excludedPaths: [...excludedPaths], ownedPaths: entries,
      packageJsonDigest: values.packageJsonDigest, lockFiles: [...values.lockFiles], dependencies: [...values.dependencies],
      phase: 'ready', createdAt: new Date().toISOString(),
    }
    const { id } = writeReceipt(authority, body)
    environmentRef = {
      protocol: 'environment-ref/2', authorityRoot: authority.root, receiptId: id,
      requestId: input.requestId, fingerprint: values.fingerprint, workspacePath: ctx.workspace,
    }
    evidence(ctx, `environment:receipt:${id}`, 'signed authority receipt')
    const ref = environmentRef
    cleanup = async (): Promise<CleanupResult> => {
      const trusted = await cleanupPreparedEnvironment(ref)
      return { removed: trusted.removed, leftovers: trusted.leftovers }
    }
  } else {
    diagnostic(ctx, 'authority_root_missing', 'No authorityRoot was supplied; the ready environment has no cross-process receipt and cleanup is only in-process.', 'warning')
  }
  return {
    status: 'ready', requestId: input.requestId, fingerprint: values.fingerprint, manager: values.manager,
    nodeVersion: process.versions.node, policy: input.policy, environment: values.environment,
    excludedPaths, diagnostics: ctx.diagnostics, evidence: ctx.evidence,
    ...(environmentRef ? { environmentRef } : {}),
    ownedPaths: entries.map(entry => entry.real),
    cleanup,
  }
}

async function prepareEnvironmentInner(input: EnvironmentPreparationInput, authority?: Authority): Promise<PreparationResult> {
  const { project, workspace } = validateInput(input)
  const ctx = contextFor(input, project, workspace)
  const cleanup = cleanupHandle(ctx)
  const processPort = input.processPort ?? standaloneProcessPort
  if (input.signal.aborted) {
    diagnostic(ctx, 'cancelled', 'Preparation was cancelled before inspection.', 'warning')
    return blockedResult(input, ctx, 'cancelled', 'Preparation was cancelled before inspection.')
  }

  const projectBefore = projectSnapshot(project)
  const inspection = inspectWorkspace(workspace)
  ctx.diagnostics.push(...inspection.diagnostics)
  diagnostic(ctx, 'project_inspected', `package.json digest ${inspection.packageJsonDigest || 'missing'}; manager ${inspection.manager}.`)
  if (inspection.packageJsonDigest) evidence(ctx, `environment:package-json:${inspection.packageJsonDigest}`, 'workspace package.json')
  for (const lock of inspection.lockFiles) evidence(ctx, `environment:lock:${lock.name}:${lock.digest}`, `workspace ${lock.name}`)
  if (inspection.blocked) {
    return blockedResult(input, ctx, inspection.blocked.code, inspection.blocked.message)
  }

  const hasDependencies = inspection.dependencies.length > 0
  let manager: EnvironmentManager = { name: inspection.manager, ...(inspection.declaredVersion ? { declaredVersion: inspection.declaredVersion } : {}) }
  const declaredVersion = inspection.declaredVersion
  let actualVersion: string | undefined

  const inputFingerprint = inputFingerprintOf(input, inspection, manager)
  const marker = readMarker(ctx.markerPath)

  if (input.policy === 'existing_only') {
    if (hasDependencies && inspection.unsupportedProjectFiles.length)
      diagnostic(ctx, 'project_hooks_present', `Project hook/config files are present (${inspection.unsupportedProjectFiles.join(', ')}); existing_only performs no install and does not read them.`, 'warning')
    const scan = scanInstalledTree(workspace, inspection.dependencies)
    if (hasDependencies && scan.problem) return blockedResult(input, ctx, scan.problem.code, scan.problem.message, inputFingerprint)
    if (hasDependencies) diagnostic(ctx, 'existing_dependencies', `Existing node_modules validated inside the workspace (${scan.entries} entries).`)
    else diagnostic(ctx, 'no_dependencies', 'No dependencies are declared; no preparation is needed.')
    const fingerprint = environmentFingerprint(inputFingerprint, scan.digest)
    evidence(ctx, `environment:input-fingerprint:${inputFingerprint}`, 'declared inputs fingerprint')
    evidence(ctx, `environment:installed:${scan.digest}`, `installed layout (${scan.entries} entries)`)
    return finishReady(ctx, input, authority, {
      fingerprint, inputFingerprint, installedDigest: scan.digest, manager,
      environment: environmentFor(ctx, 'existing_only'), ownedRelatives: [],
      packageJsonDigest: inspection.packageJsonDigest, lockFiles: inspection.lockFiles, dependencies: inspection.dependencies,
      legacyCleanup: cleanup,
    })
  }

  if (!hasDependencies) {
    diagnostic(ctx, 'no_dependencies', 'No dependencies are declared; offline installation is a no-op.')
    const emptyScan = scanInstalledTree(workspace, [])
    return finishReady(ctx, input, authority, {
      fingerprint: environmentFingerprint(inputFingerprint, emptyScan.digest), inputFingerprint, installedDigest: emptyScan.digest, manager,
      environment: { PATH: process.env.PATH ?? '' }, ownedRelatives: [],
      packageJsonDigest: inspection.packageJsonDigest, lockFiles: inspection.lockFiles, dependencies: inspection.dependencies,
      legacyCleanup: cleanup,
    })
  }

  // Offline installation executes pnpm; project hooks/config that can execute code or redirect output
  // are refused before any manager process starts.
  if (inspection.unsupportedProjectFiles.length)
    return blockedResult(input, ctx, 'project_hooks_unsupported',
      `Project hook/config is unsupported for offline installation (${inspection.unsupportedProjectFiles.join(', ')}); remove it or use an explicitly supported configuration.`, inputFingerprint)

  if (inspection.manager !== 'pnpm')
    return blockedResult(input, ctx, 'offline_install_unsupported', `offline_install currently supports pnpm only; detected ${inspection.manager}.`, inputFingerprint)
  const store = storeProblem(input, project, workspace)
  if (store) return blockedResult(input, ctx, store.code, store.message, inputFingerprint)
  const command = input.managerCommand ?? 'pnpm'
  const probe = await probeManager(command, ctx, processPort, input.signal)
  if (input.signal.aborted) return blockedResult(input, ctx, 'cancelled', 'Preparation was cancelled during the manager probe.', inputFingerprint)
  if (!probe.version) {
    if (probe.missing) return blockedResult(input, ctx, 'manager_missing', `The package manager could not be executed (${command}): ${probe.error ?? 'unknown error'}`)
    if (declaredVersion) {
      return blockedResult(input, ctx, 'manager_version_mismatch',
        `packageManager declares ${inspection.manager}@${declaredVersion} but that manager version cannot be executed offline (${probe.error ?? 'unknown error'}); this module never auto-upgrades or downloads another manager.`)
    }
    return blockedResult(input, ctx, 'manager_missing', `The package manager could not be executed (${command}): ${probe.error ?? 'unknown error'}`)
  }
  actualVersion = probe.version
  if (declaredVersion && !versionsEqual(declaredVersion, actualVersion)) {
    return blockedResult(input, ctx, 'manager_version_mismatch',
      `packageManager declares ${inspection.manager}@${declaredVersion} but ${actualVersion} is available; this module never auto-upgrades or downloads another manager.`)
  }
  manager = { name: 'pnpm', ...(declaredVersion ? { declaredVersion } : {}), actualVersion }

  const modulesExist = existsSync(ctx.nodeModules)
  const environmentExists = existsSync(ctx.envRoot)
  if (environmentExists && marker?.owned !== true)
    return blockedResult(input, ctx, 'workspace_environment_untrusted',
      'A .product-environment directory exists without a trusted v2 ownership marker; it is preserved and preparation refuses to use or replace it.', inputFingerprint)
  if (modulesExist && marker?.owned !== true)
    return blockedResult(input, ctx, 'workspace_has_dependencies',
      'node_modules already exists but is not owned by this preparation module; refusing to purge it.', inputFingerprint)

  if (marker?.owned === true) {
    if (marker.phase === 'preparing')
      return blockedResult(input, ctx, 'interrupted_preparation',
        'A previous preparation is marked in progress; no second installer is started and the state is not cleaned automatically.', inputFingerprint)
    if (marker.requestId === input.requestId && marker.inputFingerprint === inputFingerprint && marker.phase === 'ready') {
      const scan = scanInstalledTree(workspace, inspection.dependencies)
      if (scan.problem) return blockedResult(input, ctx, scan.problem.code, scan.problem.message, marker.fingerprint)
      if (marker.installedDigest !== scan.digest || marker.fingerprint !== environmentFingerprint(inputFingerprint, scan.digest))
        return blockedResult(input, ctx, 'environment_drift',
          'The installed dependency tree no longer matches the prepared fingerprint; the environment is not reused.', marker.fingerprint)
      diagnostic(ctx, 'environment_reused', 'The same request and fingerprint resolve to the existing prepared environment.', 'info')
      evidence(ctx, `environment:installed:${scan.digest}`, `reused installed layout (${scan.entries} entries)`)
      evidence(ctx, `environment:marker:${marker.fingerprint}`, 'reused owned environment marker')
      return finishReady(ctx, input, authority, {
        fingerprint: marker.fingerprint, inputFingerprint, installedDigest: scan.digest, manager: marker.manager,
        environment: environmentFor(ctx, 'offline_install'), ownedRelatives: ['.product-environment', 'node_modules'],
        packageJsonDigest: inspection.packageJsonDigest, lockFiles: inspection.lockFiles, dependencies: inspection.dependencies,
        legacyCleanup: cleanup,
      })
    }
    diagnostic(ctx, 'stale_environment_cleared', 'A previous owned environment is removed because the request or declared inputs changed.', 'warning')
    const cleared = await cleanup()
    if (cleared.leftovers.length)
      return blockedResult(input, ctx, 'cleanup_unproven', `Could not remove the previous environment: ${cleared.leftovers.join(', ')}`, inputFingerprint)
  }

  if (input.signal.aborted) return blockedResult(input, ctx, 'cancelled', 'Preparation was cancelled before installation.', inputFingerprint)
  mkdirSync(ctx.envRoot, { recursive: true, mode: 0o700 })
  const preparing: Marker = {
    protocol: PROTOCOL, requestId: input.requestId, inputFingerprint, fingerprint: inputFingerprint,
    installedDigest: '', owned: true, phase: 'preparing', manager, policy: input.policy,
    workspaceReal: workspace, projectReal: project, createdAt: new Date().toISOString(),
  }
  writeFileSync(ctx.markerPath, `${JSON.stringify(preparing, null, 2)}\n`, { mode: 0o600 })
  const environment = environmentFor(ctx, 'offline_install')
  const workspaceLimit = input.maxWorkspaceBytes ?? DEFAULTS.maxWorkspaceBytes
  const controller = new AbortController()
  const abortFromInput = (): void => controller.abort()
  input.signal.addEventListener('abort', abortFromInput)
  let diskExceeded = false
  const monitor = setInterval(() => {
    const usage = directoryBytes(workspace, workspaceLimit)
    if (usage.truncated) { diskExceeded = true; controller.abort() }
  }, 250)
  const started = Date.now()
  let result
  try {
    result = await processPort.run(command, [
      'install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only', '--store-dir', canonical(input.storeDir!),
    ], {
      cwd: workspace, env: environment, signal: controller.signal,
      timeoutMs: input.timeoutMs ?? DEFAULTS.timeoutMs,
      maxOutputBytes: input.maxOutputBytes ?? DEFAULTS.maxOutputBytes,
    })
  } finally {
    clearInterval(monitor)
    input.signal.removeEventListener('abort', abortFromInput)
  }
  const installOutput = `${result.stdout}\n${result.stderr}`
  diagnostic(ctx, 'install_command', `pnpm install offline/frozen/ignore-scripts exited ${String(result.code)} in ${Date.now() - started}ms.`)
  evidence(ctx, `environment:install-output:${sha256(installOutput)}`, installOutput.slice(-3200))

  const fail = async (code: string, message: string, severity: EnvironmentDiagnostic['severity'] = 'error'): Promise<BlockedEnvironment> => {
    diagnostic(ctx, code, message, severity)
    const cleared = await cleanup()
    if (cleared.leftovers.length) diagnostic(ctx, 'cleanup_unproven', `Leftovers: ${cleared.leftovers.join(', ')}`, 'error')
    return blockedResult(input, ctx, cleared.leftovers.length ? 'cleanup_unproven' : code,
      cleared.leftovers.length ? `Cleanup could not be proven; leftovers: ${cleared.leftovers.join(', ')}` : message, inputFingerprint)
  }
  if (diskExceeded) return fail('disk_limit', `Prepared workspace exceeded the ${workspaceLimit}-byte disk budget during installation.`)
  if (result.cancelled || input.signal.aborted) return fail('cancelled', 'Preparation was cancelled; the owned process group and environment files were cleaned.', 'warning')
  if (result.timedOut) return fail('timeout', `Dependency installation exceeded ${input.timeoutMs ?? DEFAULTS.timeoutMs}ms.`)
  if (result.outputLimited) return fail('output_limit', `Dependency installation produced more than ${input.maxOutputBytes ?? DEFAULTS.maxOutputBytes} bytes of output.`)
  if (result.quiescence !== 'confirmed') return fail('cleanup_unproven', 'The owned process group quiescence is not confirmed.')
  if (result.spawnError) return fail('manager_missing', `The package manager could not be executed: ${result.spawnError}`)
  if (result.code !== 0) {
    const mapped = mapInstallError(installOutput)
    return fail(mapped.code, `${mapped.message}${installOutput ? ` ${installOutput.slice(-800)}` : ''}`)
  }

  const scan = scanInstalledTree(workspace, inspection.dependencies)
  if (scan.problem) return fail(scan.problem.code, scan.problem.message)
  const fingerprint = environmentFingerprint(inputFingerprint, scan.digest)
  const bytes = directoryBytes(workspace, input.maxWorkspaceBytes ?? DEFAULTS.maxWorkspaceBytes)
  if (bytes.truncated) return fail('disk_limit', `Prepared workspace exceeds ${input.maxWorkspaceBytes ?? DEFAULTS.maxWorkspaceBytes} bytes.`)
  const projectAfter = projectSnapshot(project)
  if (projectAfter !== projectBefore) {
    diagnostic(ctx, 'project_modified', 'The original project snapshot changed during preparation.', 'error')
    const cleared = await cleanup()
    return blockedResult(input, ctx, 'project_modified',
      `The original project changed during preparation${cleared.leftovers.length ? `; cleanup leftovers: ${cleared.leftovers.join(', ')}` : ''}.`, fingerprint)
  }

  const readyMarker: Marker = { ...preparing, phase: 'ready', fingerprint, installedDigest: scan.digest }
  writeFileSync(ctx.markerPath, `${JSON.stringify(readyMarker, null, 2)}\n`, { mode: 0o600 })
  evidence(ctx, `environment:input-fingerprint:${inputFingerprint}`, 'declared inputs fingerprint')
  evidence(ctx, `environment:installed:${scan.digest}`, `installed layout (${scan.entries} entries)`)
  evidence(ctx, `environment:fingerprint:${fingerprint}`, 'verified environment fingerprint')
  diagnostic(ctx, 'environment_ready', `Prepared ${inspection.dependencies.length} dependencies in the private workspace.`)
  return finishReady(ctx, input, authority, {
    fingerprint, inputFingerprint, installedDigest: scan.digest, manager, environment,
    ownedRelatives: ['.product-environment', 'node_modules'],
    packageJsonDigest: inspection.packageJsonDigest, lockFiles: inspection.lockFiles, dependencies: inspection.dependencies,
    legacyCleanup: cleanup,
  })
}

/**
 * Stable entry point. With an authorityRoot it takes one workspace lock, writes signed receipts and
 * exposes trusted verify/cleanup; without one it preserves the earlier in-process behaviour.
 */
export async function prepareEnvironment(input: EnvironmentPreparationInput): Promise<PreparationResult> {
  const { project, workspace } = validateInput(input)
  if (!input.authorityRoot) return prepareEnvironmentInner(input)
  let authority: Authority
  try { authority = ensureAuthority(input.authorityRoot, project, workspace) } catch (error) {
    return earlyBlocked(input, 'authority_invalid', String((error as Error).message ?? error))
  }
  const acquired = acquireWorkspaceLock(authority, workspace, input.requestId)
  if (!acquired.ok) return earlyBlocked(input, acquired.code, acquired.message)
  try {
    return await prepareEnvironmentInner(input, authority)
  } finally {
    acquired.lock.release()
  }
}
