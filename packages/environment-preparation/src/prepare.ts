import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultEnvironmentExclusions, EnvironmentPreparationError,
  type BlockedEnvironment, type CleanupResult, type EnvironmentDiagnostic, type EnvironmentEvidence,
  type EnvironmentManager, type EnvironmentPreparationInput, type PreparationResult, type ReadyEnvironment,
} from './types.ts'
import { canonical, directoryBytes, inside, isDirectory, projectSnapshot, realInside, samePath, sha256 } from './paths.ts'
import { dependencyDigest, inspectWorkspace, type WorkspaceInspection } from './project.ts'
import { runOwned } from './process.ts'

const PROTOCOL = 'environment-preparation/1'
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DEFAULTS = { timeoutMs: 120_000, maxOutputBytes: 256 * 1024, maxWorkspaceBytes: 1024 * 1024 * 1024 }

interface Marker {
  protocol: typeof PROTOCOL
  requestId: string
  fingerprint: string
  owned: true
  phase: 'preparing' | 'ready'
  manager: EnvironmentManager
  policy: string
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
    if (marker?.owned === true) targets.push(ctx.nodeModules)
    if (existsSync(ctx.envRoot)) targets.push(ctx.envRoot)
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

function depsProblem(ctx: Context, inspection: WorkspaceInspection): { code: string; message: string } | undefined {
  if (!inspection.dependencies.length) return undefined
  if (!existsSync(ctx.nodeModules)) return { code: 'dependencies_missing', message: `node_modules is missing for ${inspection.dependencies.length} declared dependencies.` }
  const modulesLink = lstatSync(ctx.nodeModules)
  const modulesReal = realInside(ctx.workspace, ctx.nodeModules)
  if (modulesLink.isSymbolicLink() && !modulesReal.inside)
    return { code: 'unsafe_link', message: 'node_modules resolves outside the private workspace.' }
  const missing: string[] = []
  for (const dependency of inspection.dependencies) {
    const target = join(ctx.nodeModules, dependency.name)
    if (!existsSync(target)) { missing.push(dependency.name); continue }
    const { inside: contained } = realInside(ctx.workspace, target)
    if (!contained) return { code: 'unsafe_link', message: `Dependency ${dependency.name} resolves outside the private workspace.` }
    if (!existsSync(join(target, 'package.json'))) missing.push(dependency.name)
  }
  if (missing.length) return { code: 'dependencies_missing', message: `Dependencies are not prepared: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}` }
  return undefined
}

function fingerprintOf(input: EnvironmentPreparationInput, inspection: WorkspaceInspection, manager: EnvironmentManager): string {
  return sha256(JSON.stringify({
    protocol: PROTOCOL, policy: input.policy, node: process.version,
    manager: { name: manager.name, declaredVersion: manager.declaredVersion ?? null, actualVersion: manager.actualVersion ?? null },
    packageJson: inspection.packageJsonDigest,
    locks: inspection.lockFiles.map(lock => ({ name: lock.name, digest: lock.digest })),
    dependencies: dependencyDigest(inspection.dependencies),
  }))
}

async function probeManager(command: string, ctx: Context): Promise<{ version?: string; error?: string; missing?: boolean }> {
  const home = mkdtempSync(join(tmpdir(), 'pa-environment-probe-'))
  let result
  try {
    result = await runOwned(command, ['--version'], {
      cwd: ctx.workspace, env: { PATH: process.env.PATH ?? '', HOME: home, ...corepackEnvironment() }, timeoutMs: 10_000, maxOutputBytes: 8192,
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  if (result.spawnError) return { error: result.spawnError, missing: true }
  if (result.timedOut) return { error: 'version probe timed out' }
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

export async function prepareEnvironment(input: EnvironmentPreparationInput): Promise<PreparationResult> {
  const { project, workspace } = validateInput(input)
  const ctx = contextFor(input, project, workspace)
  const cleanup = cleanupHandle(ctx)
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

  if (input.policy === 'offline_install' && hasDependencies) {
    if (inspection.manager !== 'pnpm')
      return blockedResult(input, ctx, 'offline_install_unsupported', `offline_install currently supports pnpm only; detected ${inspection.manager}.`)
    const store = storeProblem(input, project, workspace)
    if (store) return blockedResult(input, ctx, store.code, store.message)
    const command = input.managerCommand ?? 'pnpm'
    const probe = await probeManager(command, ctx)
    if (!probe.version) {
      if (probe.missing) return blockedResult(input, ctx, 'manager_missing', `The package manager could not be executed (${command}): ${probe.error ?? 'unknown error'}`)
      if (declaredVersion) {
        return blockedResult(input, ctx, 'manager_version_mismatch',
          `packageManager declares ${inspection.manager}@${declaredVersion} but that manager version cannot be executed offline (${probe.error ?? 'unknown error'}); this module never auto-upgrades or downloads another manager.`)
      }
      return blockedResult(input, ctx, 'manager_missing', `The package manager could not be executed (${command}): ${probe.error ?? 'unknown error'}`)
    }
    actualVersion = probe.version
    if (declaredVersion && declaredVersion !== actualVersion) {
      return blockedResult(input, ctx, 'manager_version_mismatch',
        `packageManager declares ${inspection.manager}@${declaredVersion} but ${actualVersion} is available; this module never auto-upgrades or downloads another manager.`)
    }
    manager = { name: 'pnpm', ...(declaredVersion ? { declaredVersion } : {}), actualVersion }
  }
  const fingerprint = fingerprintOf(input, inspection, manager)
  evidence(ctx, `environment:fingerprint:${fingerprint}`, `${input.policy} environment fingerprint`)

  const marker = readMarker(ctx.markerPath)
  const currentDepsProblem = depsProblem(ctx, inspection)

  if (input.policy === 'existing_only') {
    if (hasDependencies && currentDepsProblem) return blockedResult(input, ctx, currentDepsProblem.code, currentDepsProblem.message, fingerprint)
    diagnostic(ctx, 'existing_dependencies', hasDependencies ? 'Existing node_modules validated inside the workspace.' : 'No dependencies are declared; no preparation is needed.')
    const environment = environmentFor(ctx, 'existing_only')
    const ready: ReadyEnvironment = {
      status: 'ready', requestId: input.requestId, fingerprint, manager, nodeVersion: process.versions.node, policy: input.policy,
      environment, excludedPaths: (input.exclusion ?? defaultEnvironmentExclusions).excludedPaths(workspace),
      diagnostics: ctx.diagnostics, evidence: ctx.evidence, cleanup,
    }
    return ready
  }

  if (!hasDependencies) {
    diagnostic(ctx, 'no_dependencies', 'No dependencies are declared; offline installation is a no-op.')
    return {
      status: 'ready', requestId: input.requestId, fingerprint, manager, nodeVersion: process.versions.node, policy: input.policy,
      environment: { PATH: process.env.PATH ?? '' }, excludedPaths: (input.exclusion ?? defaultEnvironmentExclusions).excludedPaths(workspace),
      diagnostics: ctx.diagnostics, evidence: ctx.evidence, cleanup,
    }
  }

  const modulesExist = existsSync(ctx.nodeModules)
  if (modulesExist && marker?.owned !== true)
    return blockedResult(input, ctx, 'workspace_has_dependencies', 'node_modules already exists but is not owned by this preparation module; refusing to purge it.', fingerprint)

  if (marker?.owned === true && marker.requestId === input.requestId && marker.fingerprint === fingerprint && marker.phase === 'ready' && !currentDepsProblem) {
    diagnostic(ctx, 'environment_reused', 'The same request and fingerprint resolve to the existing prepared environment.', 'info')
    evidence(ctx, `environment:marker:${fingerprint}`, 'reused owned environment marker')
    const environment = environmentFor(ctx, 'offline_install')
    return {
      status: 'ready', requestId: input.requestId, fingerprint, manager, nodeVersion: process.versions.node, policy: input.policy,
      environment, excludedPaths: (input.exclusion ?? defaultEnvironmentExclusions).excludedPaths(workspace),
      diagnostics: ctx.diagnostics, evidence: ctx.evidence, cleanup,
    }
  }

  if (modulesExist || existsSync(ctx.envRoot)) {
    diagnostic(ctx, 'stale_environment_cleared', 'A previous owned environment is removed because the request or inputs changed.', 'warning')
    const cleared = await cleanup()
    if (cleared.leftovers.length)
      return blockedResult(input, ctx, 'cleanup_unproven', `Could not remove the previous environment: ${cleared.leftovers.join(', ')}`, fingerprint)
  }

  if (input.signal.aborted) return blockedResult(input, ctx, 'cancelled', 'Preparation was cancelled before installation.', fingerprint)
  mkdirSync(ctx.envRoot, { recursive: true, mode: 0o700 })
  const preparing: Marker = {
    protocol: PROTOCOL, requestId: input.requestId, fingerprint, owned: true, phase: 'preparing', manager,
    policy: input.policy, createdAt: new Date().toISOString(),
  }
  writeFileSync(ctx.markerPath, `${JSON.stringify(preparing, null, 2)}\n`, { mode: 0o600 })
  const environment = environmentFor(ctx, 'offline_install')
  const store = input.storeDir!
  const command = input.managerCommand ?? 'pnpm'
  const started = Date.now()
  const result = await runOwned(command, [
    'install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only', '--store-dir', canonical(store),
  ], {
    cwd: workspace, env: environment, signal: input.signal,
    timeoutMs: input.timeoutMs ?? DEFAULTS.timeoutMs,
    maxOutputBytes: input.maxOutputBytes ?? DEFAULTS.maxOutputBytes,
  })
  const installOutput = `${result.stdout}\n${result.stderr}`
  diagnostic(ctx, 'install_command', `pnpm install offline/frozen/ignore-scripts exited ${String(result.code)} in ${Date.now() - started}ms.`)
  evidence(ctx, `environment:install-output:${sha256(installOutput)}`, installOutput.slice(-3200))

  const fail = async (code: string, message: string, severity: EnvironmentDiagnostic['severity'] = 'error'): Promise<BlockedEnvironment> => {
    diagnostic(ctx, code, message, severity)
    const cleared = await cleanup()
    if (cleared.leftovers.length) diagnostic(ctx, 'cleanup_unproven', `Leftovers: ${cleared.leftovers.join(', ')}`, 'error')
    return blockedResult(input, ctx, cleared.leftovers.length ? 'cleanup_unproven' : code,
      cleared.leftovers.length ? `Cleanup could not be proven; leftovers: ${cleared.leftovers.join(', ')}` : message, fingerprint)
  }
  if (result.cancelled || input.signal.aborted) return fail('cancelled', 'Preparation was cancelled; the owned process group and environment files were cleaned.', 'warning')
  if (result.timedOut) return fail('timeout', `Dependency installation exceeded ${input.timeoutMs ?? DEFAULTS.timeoutMs}ms.`)
  if (result.outputLimited) return fail('output_limit', `Dependency installation produced more than ${input.maxOutputBytes ?? DEFAULTS.maxOutputBytes} bytes of output.`)
  if (result.groupAlive) return fail('cleanup_unproven', 'The owned process group could not be proven gone after SIGKILL.')
  if (result.spawnError) return fail('manager_missing', `The package manager could not be executed: ${result.spawnError}`)
  if (result.code !== 0) {
    const mapped = mapInstallError(installOutput)
    return fail(mapped.code, `${mapped.message}${installOutput ? ` ${installOutput.slice(-800)}` : ''}`)
  }

  const afterDeps = depsProblem(ctx, inspection)
  if (afterDeps) return fail(afterDeps.code, afterDeps.message)
  const bytes = directoryBytes(workspace, input.maxWorkspaceBytes ?? DEFAULTS.maxWorkspaceBytes)
  if (bytes.truncated) return fail('disk_limit', `Prepared workspace exceeds ${input.maxWorkspaceBytes ?? DEFAULTS.maxWorkspaceBytes} bytes.`)
  const projectAfter = projectSnapshot(project)
  if (projectAfter !== projectBefore) {
    diagnostic(ctx, 'project_modified', 'The original project snapshot changed during preparation.', 'error')
    const cleared = await cleanup()
    return blockedResult(input, ctx, 'project_modified',
      `The original project changed during preparation${cleared.leftovers.length ? `; cleanup leftovers: ${cleared.leftovers.join(', ')}` : ''}.`, fingerprint)
  }

  const readyMarker: Marker = { ...preparing, phase: 'ready' }
  writeFileSync(ctx.markerPath, `${JSON.stringify(readyMarker, null, 2)}\n`, { mode: 0o600 })
  diagnostic(ctx, 'environment_ready', `Prepared ${inspection.dependencies.length} dependencies in the private workspace.`)
  return {
    status: 'ready', requestId: input.requestId, fingerprint, manager, nodeVersion: process.versions.node, policy: input.policy,
    environment, excludedPaths: (input.exclusion ?? defaultEnvironmentExclusions).excludedPaths(workspace),
    diagnostics: ctx.diagnostics, evidence: ctx.evidence, cleanup,
  }
}
