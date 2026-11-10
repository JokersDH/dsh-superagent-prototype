/**
 * A2/A3: signed receipts, cross-process verification, trusted cleanup, drift/replacement refusal,
 * single-installer locking, interrupted state and injected process-port/diagnostic paths.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  cleanupPreparedEnvironment, prepareEnvironment, standaloneProcessPort, verifyPreparedEnvironment,
  type EnvironmentProcessPort, type EnvironmentRef, type PreparationResult,
} from '../src/index.ts'
import {
  clean, copies, input, makePnpmFixture, pnpmVersion, tempDir, writeFakeManager, writeJson,
} from './helpers.ts'

const entry = pathToFileURL(fileURLToPath(new URL('../src/index.ts', import.meta.url))).href
const ready = (result: PreparationResult) => {
  assert.equal(result.status, 'ready', result.status === 'blocked' ? `${result.code}: ${result.message}` : 'ready')
  return result as Extract<PreparationResult, { status: 'ready' }>
}
const blockedCode = (result: { status: string; code?: string }, code: string) => {
  assert.equal(result.status, 'blocked')
  assert.equal(result.code, code)
}
const runInProcess = (refPath: string, action: 'verify' | 'cleanup'): Record<string, unknown> => {
  const code = `
    import { readFileSync } from 'node:fs'
    import { verifyPreparedEnvironment, cleanupPreparedEnvironment } from ${JSON.stringify(entry)}
    const ref = JSON.parse(readFileSync(process.argv[1], 'utf8'))
    const result = ${JSON.stringify(action)} === 'cleanup'
      ? await cleanupPreparedEnvironment(ref)
      : verifyPreparedEnvironment(ref)
    console.log(JSON.stringify(result))
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, refPath], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(child.status, 0, String(child.stderr))
  return JSON.parse(child.stdout.trim().split('\n').at(-1)!) as Record<string, unknown>
}

test('a signed receipt verifies and cleans from a second Node process', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const result = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'cross-process', authorityRoot,
    })))
    assert.ok(result.environmentRef)
    assert.equal(result.ownedPaths?.length, 2)
    const refPath = join(fixture.root, 'ref.json')
    writeJson(refPath, result.environmentRef)
    const verified = runInProcess(refPath, 'verify')
    assert.equal(verified.status, 'valid')
    assert.equal(verified.fingerprint, result.fingerprint)
    const cleaned = runInProcess(refPath, 'cleanup')
    assert.equal(cleaned.status, 'cleaned')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
    assert.equal(existsSync(join(authorityRoot, 'receipts', `${result.environmentRef.receiptId}.json`)), false)
    assert.equal(readFileSync(join(workspace, 'smoke.test.cjs'), 'utf8').includes('local dependency'), true)
  } finally { clean(fixture.root, authorityRoot) }
})

test('tampered receipts, replaced owned paths and dependency drift are refused', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const result = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'tamper', authorityRoot,
    })))
    const ref = result.environmentRef as EnvironmentRef
    const receiptPath = join(authorityRoot, 'receipts', `${ref.receiptId}.json`)
    const original = readFileSync(receiptPath, 'utf8')
    const tampered = JSON.parse(original) as { body: { fingerprint: string } }
    tampered.body.fingerprint = 'f'.repeat(64)
    writeFileSync(receiptPath, JSON.stringify(tampered))
    blockedCode(verifyPreparedEnvironment(ref), 'receipt_forged')
    const cleanupRefused = await cleanupPreparedEnvironment(ref)
    assert.equal(cleanupRefused.status, 'blocked')
    assert.equal(cleanupRefused.code, 'receipt_forged')
    assert.equal(existsSync(join(workspace, 'node_modules')), true)
    writeFileSync(receiptPath, original)

    // Replace the owned node_modules inode: cleanup must refuse and leave the replacement.
    const realModules = join(workspace, 'node_modules.real')
    renameSync(join(workspace, 'node_modules'), realModules)
    mkdirSync(join(workspace, 'node_modules'))
    writeFileSync(join(workspace, 'node_modules', 'user-file'), 'not ours')
    const replaced = await cleanupPreparedEnvironment(ref)
    assert.equal(replaced.status, 'blocked')
    assert.equal(replaced.code, 'cleanup_forbidden')
    assert.equal(readFileSync(join(workspace, 'node_modules', 'user-file'), 'utf8'), 'not ours')
    rmSync(join(workspace, 'node_modules'), { recursive: true, force: true })
    renameSync(realModules, join(workspace, 'node_modules'))

    // Installed version drift invalidates readiness but a trusted cleanup still works.
    writeJson(join(workspace, 'node_modules/env-dep/package.json'), { name: 'env-dep', version: '9.0.0', main: 'index.js' })
    blockedCode(verifyPreparedEnvironment(ref), 'environment_drift')
    const cleaned = await cleanupPreparedEnvironment(ref)
    assert.equal(cleaned.status, 'cleaned')
  } finally { clean(fixture.root, authorityRoot) }
})

test('changing package.json after preparation invalidates the receipt', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const result = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'inputs', authorityRoot,
    })))
    const packageJson = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
    writeJson(join(workspace, 'package.json'), { ...packageJson, description: 'native changed the manifest' })
    blockedCode(verifyPreparedEnvironment(result.environmentRef!), 'environment_inputs_changed')
  } finally { clean(fixture.root, authorityRoot) }
})

test('one live installer per workspace; stale ESRCH locks are recoverable', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const fake = join(fixture.root, 'fake-sleep')
    writeFakeManager(fake, pnpmVersion(), 'sleep')
    const controller = new AbortController()
    const first = prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'first', managerCommand: fake, timeoutMs: 30_000,
      authorityRoot, signal: controller.signal,
    }))
    await new Promise(resolve => setTimeout(resolve, 300))
    const second = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'second', authorityRoot,
    }))
    blockedCode(second, 'workspace_busy')
    controller.abort()
    blockedCode(await first, 'cancelled')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)

    // A lock written by an exited process is ESRCH evidence: it may be removed and preparation retried.
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' })
    const pid = exited.pid ?? 0
    assert.ok(pid > 0)
    const lockDir = join(authorityRoot, 'locks')
    mkdirSync(lockDir, { recursive: true })
    const key = (await import('../src/authority.ts')).workspaceKey(workspace)
    writeJson(join(lockDir, `${key}.json`), { pid, requestId: 'dead', token: 'dead', startedAt: new Date().toISOString() })
    const recovered = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'recovered', authorityRoot,
    })))
    assert.equal(recovered.status, 'ready')
  } finally { clean(fixture.root, authorityRoot) }
})

test('an interrupted marker or an old v1 marker never authorizes reuse or cleanup', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    mkdirSync(join(workspace, '.product-environment'), { recursive: true })
    writeJson(join(workspace, '.product-environment', 'state.json'), {
      protocol: 'environment-preparation/2', requestId: 'old', inputFingerprint: 'a'.repeat(64), fingerprint: 'b'.repeat(64),
      installedDigest: '', owned: true, phase: 'preparing', manager: { name: 'pnpm' }, policy: 'offline_install',
      workspaceReal: workspace, projectReal: project, createdAt: new Date().toISOString(),
    })
    writeFileSync(join(workspace, '.product-environment', 'keep.txt'), 'previous state')
    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'interrupted', authorityRoot,
    })), 'interrupted_preparation')
    assert.equal(readFileSync(join(workspace, '.product-environment', 'keep.txt'), 'utf8'), 'previous state')

    writeJson(join(workspace, '.product-environment', 'state.json'), {
      protocol: 'environment-preparation/1', requestId: 'v1', fingerprint: 'c'.repeat(64), owned: true, phase: 'ready',
      manager: { name: 'pnpm' }, policy: 'offline_install', createdAt: new Date().toISOString(),
    })
    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'v1', authorityRoot,
    })), 'workspace_environment_untrusted')
    assert.equal(readFileSync(join(workspace, '.product-environment', 'keep.txt'), 'utf8'), 'previous state')
  } finally { clean(fixture.root, authorityRoot) }
})

test('an injected process port controls version/install execution and indeterminate quiescence blocks', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const calls: string[][] = []
    const port: EnvironmentProcessPort = {
      run: async (command, args, options) => {
        calls.push([...args])
        return standaloneProcessPort.run(command, args, options)
      },
    }
    ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'port', authorityRoot, processPort: port,
    })))
    assert.equal(calls[0]?.join(' '), '--version')
    const install = calls[1] ?? []
    assert.ok(install.includes('--offline') && install.includes('--frozen-lockfile') && install.includes('--ignore-scripts'))

    const uncertain: EnvironmentProcessPort = {
      run: async (command, args, options) => {
        const result = await standaloneProcessPort.run(command, args, options)
        return args[0] === 'install' ? { ...result, quiescence: 'indeterminate' } : result
      },
    }
    const second = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'uncertain', authorityRoot, processPort: uncertain,
    }))
    blockedCode(second, 'cleanup_unproven')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
  } finally { clean(fixture.root, authorityRoot) }
})

test('cancellation during the manager probe and disk-budget monitoring are bounded', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const probe = join(fixture.root, 'fake-probe')
    writeFakeManager(probe, pnpmVersion(), 'probe-sleep')
    const controller = new AbortController()
    const pending = prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'probe-cancel', managerCommand: probe, authorityRoot, signal: controller.signal,
    }))
    await new Promise(resolve => setTimeout(resolve, 200))
    controller.abort()
    blockedCode(await pending, 'cancelled')
    assert.equal(existsSync(join(workspace, '.product-environment')), false)

    const disk = join(fixture.root, 'fake-disk')
    writeFakeManager(disk, pnpmVersion(), 'disk')
    const limited = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'disk', managerCommand: disk, authorityRoot, maxWorkspaceBytes: 20_000, timeoutMs: 10_000,
    }))
    blockedCode(limited, 'disk_limit')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
  } finally { clean(fixture.root, authorityRoot) }
})

test('authority roots inside project/workspace are refused before preparation', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'bad-authority', authorityRoot: join(workspace, 'authority'),
    })), 'authority_invalid')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, 'authority')), false)
  } finally { clean(fixture.root) }
})


test('a forged workspace marker never authorizes deletion, even with a valid authority root', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    mkdirSync(join(workspace, '.product-environment'), { recursive: true })
    writeJson(join(workspace, '.product-environment', 'state.json'), {
      protocol: 'environment-preparation/2', requestId: 'forged', inputFingerprint: 'a'.repeat(64), fingerprint: 'b'.repeat(64),
      installedDigest: '', owned: true, phase: 'ready', manager: { name: 'pnpm' }, policy: 'offline_install',
      workspaceReal: workspace, projectReal: project, createdAt: new Date().toISOString(),
    })
    mkdirSync(join(workspace, 'node_modules'), { recursive: true })
    writeFileSync(join(workspace, 'node_modules', 'user-note.txt'), 'keep me')
    const originalPackage = readFileSync(join(workspace, 'package.json'), 'utf8')
    // An invalid manifest blocks before any marker-derived state could be claimed.
    writeFileSync(join(workspace, 'package.json'), '{ not json')
    const blocked = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'forged-request', authorityRoot,
    }))
    assert.equal(blocked.status, 'blocked')
    const cleanup = await blocked.cleanup()
    assert.deepEqual(cleanup.removed, [])
    assert.equal(readFileSync(join(workspace, 'node_modules', 'user-note.txt'), 'utf8'), 'keep me')
    assert.equal(readFileSync(join(workspace, '.product-environment', 'state.json'), 'utf8').includes('forged'), true)

    // A valid manifest with the same forged ready marker is still refused: no signed receipt exists.
    writeFileSync(join(workspace, 'package.json'), originalPackage)
    const untrusted = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'different-request', authorityRoot,
    }))
    blockedCode(untrusted, 'environment_state_untrusted')
    const untrustedCleanup = await untrusted.cleanup()
    assert.deepEqual(untrustedCleanup.removed, [])
    assert.equal(readFileSync(join(workspace, 'node_modules', 'user-note.txt'), 'utf8'), 'keep me')
  } finally { clean(fixture.root, authorityRoot) }
})

test('an unknown process-group observation is never confirmed quiescence', async () => {
  const cwd = tempDir('environment-observe-')
  const originalKill = process.kill
  try {
    process.kill = ((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid < 0 && (signal === 0 || signal === undefined)) {
        const error = new Error('operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
      return originalKill.call(process, pid, signal as NodeJS.Signals)
    }) as typeof process.kill
    const result = await standaloneProcessPort.run(process.execPath, ['-e', 'process.exit(0)'], {
      cwd, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 10_000, maxOutputBytes: 4096,
    })
    assert.notEqual(result.quiescence, 'confirmed')
    assert.equal(result.quiescence, 'unknown')
  } finally {
    process.kill = originalKill
    clean(cwd)
  }
})

test('stdout and stderr share one interleaved byte budget without splitting characters', async () => {
  const cwd = tempDir('environment-output-')
  try {
    const script = [
      "process.stdout.write('é'.repeat(6))",
      "process.stderr.write('€'.repeat(6))",
      'setTimeout(() => {}, 10)',
    ].join(';')
    const result = await standaloneProcessPort.run(process.execPath, ['-e', script], {
      cwd, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 10_000, maxOutputBytes: 20,
    })
    assert.equal(result.outputLimited, true)
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 20)
    assert.equal(result.stdout.includes('\uFFFD'), false)
    assert.equal(result.stderr.includes('\uFFFD'), false)
  } finally { clean(cwd) }
})
