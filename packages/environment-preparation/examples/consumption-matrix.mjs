#!/usr/bin/env node
/**
 * Package-local independent-consumption matrix. Uses only public exports for preparation,
 * verification and cleanup; verification and trusted cleanup run in a second Node process via
 * verify-consumer.mjs. Fixtures, local tarballs and the offline pnpm store stay in a temporary
 * directory; no account, vendor, model, network install or user project is touched.
 *
 * Usage: node examples/consumption-matrix.mjs [--out <report.json>]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  cleanupPreparedEnvironment, prepareEnvironment, verifyPreparedEnvironment,
} from '../src/index.ts'
import {
  clean, copies, input, makePnpmFixture, pnpmVersion, tempDir, writeFakeManager, writeJson,
} from '../test/helpers.ts'

const here = dirname(fileURLToPath(import.meta.url))
const verifyCli = join(here, 'verify-consumer.mjs')
const sourceCommit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(here, '..'), encoding: 'utf8' }).trim() } catch { return undefined } })()
const { values } = parseArgs({ options: { out: { type: 'string' } } })
const cases = []
const json = (path, value) => writeFileSync(path, JSON.stringify(value) + '\n')

function child(refPath, cleanup = false) {
  const result = spawnSync(process.execPath, [verifyCli, '--ref', refPath, ...(cleanup ? ['--cleanup'] : [])], {
    encoding: 'utf8', timeout: 30_000,
  })
  const output = String(result.stdout).trim()
  return { exitCode: result.status, result: output ? JSON.parse(output) : undefined, stderr: String(result.stderr).slice(-800) }
}

async function check(id, expectation, action) {
  try {
    const observed = await action()
    const stays = expectation(observed)
    cases.push({ id, passesInvariant: stays, observed })
  } catch (error) {
    cases.push({ id, passesInvariant: false, observed: { error: String(error).slice(0, 1200) } })
  }
}

await check('prepare-ref-second-process-verify-cleanup', value => value.verify === 'valid' && value.cleanup === 'cleaned' && Boolean(value.removed),
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const result = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'consumer-valid', authorityRoot,
      }))
      if (result.status !== 'ready' || !result.environmentRef) throw new Error(`${result.status}: ${result.code}`)
      const refPath = join(fixture.root, 'consumer-ref.json')
      writeJson(refPath, result.environmentRef)
      const verified = child(refPath)
      const cleaned = child(refPath, true)
      return {
        verify: verified.result?.status, cleanup: cleaned.result?.status,
        removed: cleaned.result?.removed?.length,
        secondProcess: verified.result?.status === 'valid',
        workspaceEmptyAfterCleanup: !existsSync(join(workspace, 'node_modules')) && !existsSync(join(workspace, '.product-environment')),
        pnpm: pnpmVersion(),
      }
    } finally { clean(fixture.root, authorityRoot) }
  })

await check('forged-marker-does-not-replace-signed-ref', value => value.verify === 'valid' && value.cleanup === 'cleaned',
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const result = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'forged-marker-consumer', authorityRoot,
      }))
      if (result.status !== 'ready' || !result.environmentRef) throw new Error(`${result.status}: ${result.code}`)
      json(join(workspace, '.product-environment', 'state.json'), {
        protocol: 'environment-preparation/2', requestId: 'forged', inputFingerprint: 'a'.repeat(64),
        fingerprint: 'b'.repeat(64), installedDigest: '', owned: true, phase: 'ready', manager: { name: 'pnpm' },
        policy: 'offline_install', workspaceReal: workspace, projectReal: project, createdAt: new Date().toISOString(),
      })
      const refPath = join(fixture.root, 'forged-ref.json')
      writeJson(refPath, result.environmentRef)
      const verified = child(refPath)
      const cleaned = child(refPath, true)
      return { verify: verified.result?.status, cleanup: cleaned.result?.status, cleanupCode: cleaned.result?.code ?? null }
    } finally { clean(fixture.root, authorityRoot) }
  })

await check('forged-receipt-blocks-verify-and-delete', value => value.verify === 'receipt_forged' && value.cleanup === 'receipt_forged' && value.preserved,
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const result = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'forged-receipt', authorityRoot,
      }))
      if (result.status !== 'ready' || !result.environmentRef) throw new Error(`${result.status}: ${result.code}`)
      const receiptPath = join(authorityRoot, 'receipts', `${result.environmentRef.receiptId}.json`)
      const tampered = JSON.parse(readFileSync(receiptPath, 'utf8'))
      tampered.body.fingerprint = 'f'.repeat(64)
      writeFileSync(receiptPath, JSON.stringify(tampered))
      const refPath = join(fixture.root, 'forged-receipt-ref.json')
      writeJson(refPath, result.environmentRef)
      const verified = child(refPath)
      const cleaned = child(refPath, true)
      return {
        verify: verified.result?.status === 'blocked' ? verified.result.code : verified.result?.status,
        cleanup: cleaned.result?.status === 'blocked' ? cleaned.result.code : cleaned.result?.status,
        preserved: existsSync(join(workspace, 'node_modules')),
      }
    } finally { clean(fixture.root, authorityRoot) }
  })

await check('workspace-replacement-blocks-verify-and-delete', value => value.verify === 'workspace_replaced' && value.cleanup === 'workspace_replaced',
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const result = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'replacement', authorityRoot,
      }))
      if (result.status !== 'ready' || !result.environmentRef) throw new Error(`${result.status}: ${result.code}`)
      const refPath = join(fixture.root, 'replacement-ref.json')
      writeJson(refPath, result.environmentRef)
      renameSync(workspace, `${workspace}.old`)
      mkdirSync(workspace)
      const verified = child(refPath)
      const cleaned = child(refPath, true)
      return {
        verify: verified.result?.status === 'blocked' ? verified.result.code : verified.result?.status,
        cleanup: cleaned.result?.status === 'blocked' ? cleaned.result.code : cleaned.result?.status,
        oldWorkspacePreserved: existsSync(join(`${workspace}.old`, 'node_modules')),
      }
    } finally { clean(fixture.root, authorityRoot) }
  })

await check('manifest-lock-and-installed-drift-block-verify', value => value.manifest === 'environment_inputs_changed' && value.lock === 'environment_inputs_changed' && value.drift === 'environment_drift',
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const first = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'input-drift', authorityRoot,
      }))
      if (first.status !== 'ready' || !first.environmentRef) throw new Error(`${first.status}: ${first.code}`)
      const manifestRef = join(fixture.root, 'manifest-ref.json')
      writeJson(manifestRef, first.environmentRef)
      const packagePath = join(workspace, 'package.json')
      const packageJsonText = readFileSync(packagePath, 'utf8')
      const packageJson = JSON.parse(packageJsonText)
      json(packagePath, { ...packageJson, description: 'native changed manifest' })
      const manifest = child(manifestRef)
      writeFileSync(packagePath, packageJsonText)

      const lockPath = join(workspace, 'pnpm-lock.yaml')
      const lock = readFileSync(lockPath, 'utf8')
      writeFileSync(lockPath, `${lock}\n# changed outside preparation\n`)
      const lockResult = child(manifestRef)
      writeFileSync(lockPath, lock)

      json(join(workspace, 'node_modules/env-dep/package.json'), { name: 'env-dep', version: '9.0.0', main: 'index.js' })
      const drift = verifyPreparedEnvironment(first.environmentRef)
      await cleanupPreparedEnvironment(first.environmentRef)
      return {
        manifest: manifest.result?.status === 'blocked' ? manifest.result.code : manifest.result?.status,
        lock: lockResult.result?.status === 'blocked' ? lockResult.result.code : lockResult.result?.status,
        drift: drift.status === 'blocked' ? drift.code : drift.status,
      }
    } finally { clean(fixture.root, authorityRoot) }
  })

await check('missing-cache-and-project-hooks-block-before-install', value => value.cache === 'offline_cache_missing' && value.hooks === 'project_hooks_unsupported' && value.hookExecuted === false,
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const fakeOffline = join(fixture.root, 'fake-offline')
      writeFakeManager(fakeOffline, pnpmVersion(), 'offline-error')
      const cache = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'missing-cache', managerCommand: fakeOffline, authorityRoot,
      }))
      const marker = join(fixture.root, 'hook-marker')
      writeFileSync(join(workspace, '.pnpmfile.cjs'), `module.exports={hooks:{readPackage(pkg){require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');return pkg}}}\n`)
      const hooks = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'hooks', authorityRoot,
      }))
      return {
        cache: cache.status === 'blocked' ? cache.code : cache.status,
        hooks: hooks.status === 'blocked' ? hooks.code : hooks.status,
        hookExecuted: existsSync(marker),
        controlledManager: 'offline-error fixture',
      }
    } finally { clean(fixture.root, authorityRoot) }
  })

await check('concurrency-preparing-cancel-are-bounded', value => value.concurrent === 'workspace_busy' && value.preparing === 'interrupted_preparation' && value.cancelled === 'cancelled',
  async () => {
    const fixture = makePnpmFixture()
    const { project, workspace } = copies(fixture)
    const authorityRoot = tempDir('environment-consumer-authority-')
    try {
      const fake = join(fixture.root, 'fake-sleep')
      writeFakeManager(fake, pnpmVersion(), 'sleep')
      const controller = new AbortController()
      const pending = prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'first', managerCommand: fake, timeoutMs: 30_000,
        authorityRoot, signal: controller.signal,
      }))
      await new Promise(resolve => setTimeout(resolve, 350))
      const second = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'second', authorityRoot,
      }))
      controller.abort()
      const cancelled = await pending
      // A crash leaves only a worker-writable preparing marker: no second installer may claim it.
      mkdirSync(join(workspace, '.product-environment'), { recursive: true })
      json(join(workspace, '.product-environment', 'state.json'), {
        protocol: 'environment-preparation/2', requestId: 'crashed', inputFingerprint: 'a'.repeat(64),
        fingerprint: 'b'.repeat(64), installedDigest: '', owned: true, phase: 'preparing', manager: { name: 'pnpm' },
        policy: 'offline_install', workspaceReal: workspace, projectReal: project, createdAt: new Date().toISOString(),
      })
      const preparing = await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: fixture.store, requestId: 'after-cancel', authorityRoot,
      }))
      return {
        concurrent: second.status === 'blocked' ? second.code : second.status,
        cancelled: cancelled.status === 'blocked' ? cancelled.code : cancelled.status,
        preparing: preparing.status === 'blocked' ? preparing.code : preparing.status,
        crashedMarkerPreserved: existsSync(join(workspace, '.product-environment', 'state.json')),
      }
    } finally { clean(fixture.root, authorityRoot) }
  })

const report = {
  protocol: 'environment-consumption-matrix/1',
  scope: 'package-local; public exports + second Node process; local temporary fixtures and offline store only; no model/account/network install/user project',
  ...(sourceCommit ? { sourceCommit } : {}),
  node: process.version, pnpm: pnpmVersion(), platform: process.platform, architecture: process.arch,
  commands: [
    'node examples/consumption-matrix.mjs --out reports/independent-consumption.json',
    'node --test test/*.case.ts',
    'node examples/prepare-consumer.mjs ...  # one-process prepare',
    'node examples/verify-consumer.mjs --ref <ref> [--cleanup]  # second process',
  ],
  status: cases.every(item => item.passesInvariant) ? 'PASS_INDEPENDENT_CONSUMPTION' : 'BLOCKED_INDEPENDENT_CONSUMPTION',
  cases,
}
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (report.status !== 'PASS_INDEPENDENT_CONSUMPTION') process.exitCode = 1
