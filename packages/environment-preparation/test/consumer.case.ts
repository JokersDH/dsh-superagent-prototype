/** A5: rebuildable recipes, public consumer examples and cross-process recovery. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanupPreparedEnvironment, listPreparedEnvironments, prepareEnvironment, verifyPreparedEnvironment,
  type EnvironmentRef, type PreparationResult,
} from '../src/index.ts'
import { clean, copies, input, makePnpmFixture, tempDir, writeJson } from './helpers.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const ready = (result: PreparationResult) => {
  assert.equal(result.status, 'ready', result.status === 'blocked' ? `${result.code}: ${result.message}` : 'ready')
  return result as Extract<PreparationResult, { status: 'ready' }>
}
const blocked = (result: { status: string; code?: string }, code: string) => {
  assert.equal(result.status, 'blocked')
  assert.equal(result.code, code)
}
const runTest = (cwd: string, env: Readonly<Record<string, string>>) =>
  spawnSync(process.execPath, ['--test'], { cwd, env: { ...env }, encoding: 'utf8', timeout: 30_000 })

test('both offline recipes prepare, install and run their real tests', async () => {
  const root = tempDir('environment-recipes-')
  const out = join(root, 'recipes')
  const authorityRoot = tempDir('environment-recipes-authority-')
  try {
    execFileSync(process.execPath, [join(packageRoot, 'recipes', 'build-recipes.mjs'), '--out', out], { stdio: 'ignore', timeout: 120_000 })
    const store = join(out, 'store')
    for (const name of ['plain-js', 'dev-deps']) {
      const workspace = join(out, name)
      const project = join(out, `project-${name}`)
      mkdirSync(project)
      writeJson(join(project, 'package.json'), { name: `original-${name}`, private: true })
      const prepared = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
        storeDir: store, requestId: `recipe-${name}`, authorityRoot,
      })))
      assert.ok(prepared.environmentRef, 'recipes use the production receipt path')
      assert.equal(verifyPreparedEnvironment(prepared.environmentRef).status, 'valid')
      if (name === 'dev-deps') execFileSync(process.execPath, ['build.mjs'], { cwd: workspace })
      const run = runTest(workspace, prepared.environment as Readonly<Record<string, string>>)
      assert.equal(run.status, 0, `${name}: ${String(run.stdout)}\n${String(run.stderr)}`)
      await prepared.cleanup()
      assert.equal(existsSync(join(workspace, 'node_modules')), false)
    }
  } finally { clean(root, authorityRoot) }
})

test('consumer examples prepare in one process and verify/cleanup in a second', () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  const refPath = join(fixture.root, 'consumer-ref.json')
  try {
    const prepared = spawnSync(process.execPath, [
      join(packageRoot, 'examples', 'prepare-consumer.mjs'), '--project', project, '--workspace', workspace,
      '--authority', authorityRoot, '--store', fixture.store, '--out', refPath, '--request', 'consumer',
    ], { encoding: 'utf8', timeout: 120_000 })
    assert.equal(prepared.status, 0, String(prepared.stderr))
    const summary = JSON.parse(prepared.stdout) as { status: string; receiptId: string }
    assert.equal(summary.status, 'ready')
    const verify = spawnSync(process.execPath, [join(packageRoot, 'examples', 'verify-consumer.mjs'), '--ref', refPath], { encoding: 'utf8' })
    assert.equal(verify.status, 0, String(verify.stderr))
    assert.equal((JSON.parse(verify.stdout) as { status: string }).status, 'valid')
    const cleanup = spawnSync(process.execPath, [join(packageRoot, 'examples', 'verify-consumer.mjs'), '--ref', refPath, '--cleanup'], { encoding: 'utf8' })
    assert.equal(cleanup.status, 0, String(cleanup.stderr))
    assert.equal((JSON.parse(cleanup.stdout) as { status: string }).status, 'cleaned')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
  } finally { clean(fixture.root, authorityRoot) }
})

test('a restarted caller recovers receipts, replays are refused and cleanup/rebuild is possible', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const first = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'lost-ref', authorityRoot,
    })))
    const recovered = listPreparedEnvironments(authorityRoot)
    assert.equal(recovered.length, 1)
    assert.equal(recovered[0]!.fingerprint, first.fingerprint)
    assert.equal(verifyPreparedEnvironment(recovered[0]!).status, 'valid')
    const oldRef = recovered[0] as EnvironmentRef
    assert.equal((await cleanupPreparedEnvironment(oldRef)).status, 'cleaned')
    blocked(verifyPreparedEnvironment(oldRef), 'receipt_missing')

    const rebuilt = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'rebuilt', authorityRoot,
    })))
    assert.equal(verifyPreparedEnvironment(rebuilt.environmentRef!).status, 'valid')

    // Replacing the workspace path invalidates the previous receipt's owned paths.
    const moved = workspace + '-moved'
    renameSync(workspace, moved)
    mkdirSync(workspace)
    cpSync(join(moved, 'package.json'), join(workspace, 'package.json'))
    cpSync(join(moved, 'pnpm-lock.yaml'), join(workspace, 'pnpm-lock.yaml'))
    cpSync(join(moved, 'vendor'), join(workspace, 'vendor'), { recursive: true })
    const replaced = verifyPreparedEnvironment(rebuilt.environmentRef!)
    assert.equal(replaced.status, 'blocked')
    assert.ok(['workspace_replaced', 'ownership_changed', 'environment_inputs_changed'].includes(replaced.code), `replaced code: ${replaced.code}`)
    await rebuilt.cleanup()
    rmSync(workspace, { recursive: true, force: true })
    renameSync(moved, workspace)
  } finally { clean(fixture.root, authorityRoot) }
})

test('a corrupted authority key denies verification and cleanup without deleting owned paths', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const authorityRoot = tempDir('environment-authority-')
  try {
    const result = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'key', authorityRoot,
    })))
    writeFileSync(join(authorityRoot, 'authority.key'), 'not-a-key\n')
    blocked(verifyPreparedEnvironment(result.environmentRef!), 'authority_unavailable')
    const cleanup = await cleanupPreparedEnvironment(result.environmentRef!)
    assert.equal(cleanup.status, 'blocked')
    assert.equal(existsSync(join(workspace, 'node_modules')), true)
  } finally { clean(fixture.root, authorityRoot) }
})

test('performance measurements are recorded for a small and a thousand-file dependency tree', async () => {
  const root = tempDir('environment-perf-')
  try {
    const results: Record<string, unknown> = { node: process.version, platform: process.platform, runs: [] }
    for (const [label, files] of [['small', 10], ['large', 1_000]] as const) {
      const project = join(root, `project-${label}`), workspace = join(root, `workspace-${label}`)
      const authority = join(root, `authority-${label}`)
      mkdirSync(project); mkdirSync(workspace)
      writeJson(join(project, 'package.json'), { name: `project-${label}`, private: true })
      writeJson(join(workspace, 'package.json'), { name: `perf-${label}`, private: true, dependencies: { dep: '1.0.0' } })
      writeFileSync(join(workspace, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
      const dep = join(workspace, 'node_modules', 'dep')
      mkdirSync(dep, { recursive: true })
      writeJson(join(dep, 'package.json'), { name: 'dep', version: '1.0.0' })
      for (let index = 0; index < files; index += 1) writeFileSync(join(dep, `file-${index}.js`), `module.exports=${index}\n`)
      const started = Date.now()
      const prepared = ready(await prepareEnvironment(input(project, workspace, 'existing_only', { requestId: label, authorityRoot: authority })))
      const prepareMs = Date.now() - started
      const verifyStart = Date.now()
      assert.equal(verifyPreparedEnvironment(prepared.environmentRef!).status, 'valid')
      const verifyMs = Date.now() - verifyStart
      const cleanupStart = Date.now()
      await prepared.cleanup()
      const cleanupMs = Date.now() - cleanupStart
      const bytes = execFileSync('du', ['-sk', workspace], { encoding: 'utf8' }).split('\t')[0]
      ;(results.runs as unknown[]).push({
        label, files, prepareMs, verifyMs, cleanupMs, workspaceKb: Number(bytes),
        fingerprint: prepared.fingerprint, manager: prepared.manager.name,
      })
      rmSync(authority, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
    writeFileSync(join(packageRoot, 'reports', 'performance.json'), JSON.stringify(results, null, 2) + '\n')
    assert.equal((results.runs as unknown[]).length, 2)
  } finally { clean(root) }
})

