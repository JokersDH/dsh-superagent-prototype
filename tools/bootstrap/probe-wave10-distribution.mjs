import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { RecoveryTargetMaterialSchema, RecoveryTargetPreparationSchema } from '../../packages/contracts/dist/index.js'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { bindRecoveryTargetConfiguration } from '../../apps/coordinator/product/recovery-targets.ts'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { output: { type: 'string' } } })
const candidate = resolve(positionals[0] ?? '../superagent-agent-d')
const repository = resolve(new URL('../..', import.meta.url).pathname)
const { PortabilityRecoveryTargetMaterializer } = await import(pathToFileURL(join(candidate, 'packages/portability/src/recovery-target.ts')))
const { accountRegisteredResources } = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/upgrade.mjs')))
const root = mkdtempSync(join(tmpdir(), 'pa-wave10-distribution-'))
chmodSync(root, 0o700)
const cases = []
const ownedChildren = []
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const check = async (id, body) => {
  try { const observation = await body(); cases.push({ id, status: 'PASS', ...(observation ? { observation } : {}) }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message, ...(error.observation ? { observation: error.observation } : {}) }) }
}
const expect = (condition, message, observation) => {
  if (!condition) throw Object.assign(new Error(message), { observation })
}
const fixture = name => {
  const parent = join(root, name)
  mkdirSync(parent, { mode: 0o700 })
  const configuration = { protocol: 'recovery-target-configuration/1', projects: [{ sourceProjectId: 'old-project', targetProjectId: 'new-project',
    registration: { path: join(root, 'project'), check: 'node_test' } }], executor: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) } }
  const source = { protocol: 'recovery-activation-commit/1', sourceReceipt: { commandId: 'recovery-confirm', seq: 1 }, intent: {
    protocol: 'recovery-activation-intent/1', activationId: 'activation', commandId: 'recovery-confirm', planId: 'plan', planDigest: 'b'.repeat(64),
    source: { stateId: 'history', stateRoot: join(root, 'history'), markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
    target: { generationId: 'generation', stateRoot: join(parent, 'activation'), configurationDigest: canonicalDigest(configuration) },
    principal: { userId: 'local', authorityRef: 'authority' }, machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
    createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' } }
  const input = bindRecoveryTargetConfiguration(source, configuration)
  return { parent, input, materializer: new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 }) }
}
const childFor = async args => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...args], { stdio: 'ignore' })
  ownedChildren.push(child)
  await new Promise(resolveWait => setTimeout(resolveWait, 100))
  assert.equal(child.exitCode, null, 'The isolated control child must be alive before accounting')
  assert.equal(child.signalCode, null, 'The isolated control child must not have been stopped')
  return child
}
try {
  await check('MAIN_BOUND_INPUT_AND_REPEAT_POSITIVE_CONTROL', async () => {
    const { materializer, input } = fixture('repeat')
    assert.equal(RecoveryTargetPreparationSchema.safeParse(input).success, true)
    const first = await materializer.prepare(input), second = await materializer.prepare(input)
    assert.equal(first.manifestDigest, second.manifestDigest)
    assert.equal(first.startupAvailable, false)
    return { inputValid: true, idempotent: true, startupAvailable: first.startupAvailable }
  })
  await check('MATERIAL_OUTPUT_MATCHES_ACTUAL_SHARED_SCHEMA', async () => {
    const { materializer, input } = fixture('wire')
    const material = await materializer.prepare(input), result = RecoveryTargetMaterialSchema.safeParse(material)
    expect(result.success, 'Material from a valid main-bound input is rejected by the shared output schema', {
      intentDigest: material.intentDigest, configurationDigest: material.configurationDigest,
      manifestDigest: material.manifestDigest, issues: result.success ? [] : result.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
    })
  })
  await check('REQUESTED_TARGET_ROOT_IS_BOUND_BEFORE_WRITE', async () => {
    const { materializer, input, parent } = fixture('root-binding')
    input.source.intent.target.stateRoot = join(parent, 'different-target')
    let refused = false
    try { await materializer.prepare(input) } catch { refused = true }
    expect(refused && !existsSync(join(parent, 'activation')), 'Materializer ignored the confirmed target path and wrote another target', {
      refused, requested: input.source.intent.target.stateRoot, wroteUnexpectedTarget: existsSync(join(parent, 'activation')),
    })
  })
  await check('CONFIRMED_CONFIGURATION_DIGEST_IS_RECHECKED', async () => {
    const { materializer, input, parent } = fixture('config-binding')
    input.configuration.executor.identityDigest = '0'.repeat(64)
    let refused = false
    try { await materializer.prepare(input) } catch { refused = true }
    expect(refused && !existsSync(join(parent, 'activation')), 'Changed configuration was materialized despite the unchanged confirmed digest', {
      refused, wroteTarget: existsSync(join(parent, 'activation')),
    })
  })
  await check('TRUSTED_PARENT_REVALIDATED_AT_WRITE', async () => {
    const { materializer, input, parent } = fixture('parent-binding')
    const original = `${parent}-original`, elsewhere = `${parent}-elsewhere`
    renameSync(parent, original); mkdirSync(elsewhere, { mode: 0o700 }); symlinkSync(elsewhere, parent)
    let refused = false
    try { await materializer.prepare(input) } catch { refused = true }
    expect(refused && !existsSync(join(elsewhere, 'activation')), 'A parent replaced by a symlink after construction redirected preparation writes', {
      refused, wroteOutsideOriginalParent: existsSync(join(elsewhere, 'activation')),
    })
  })
  await check('SHARED_INSTALLATION_IS_NOT_CROSS_STATE_PROCESS_OWNERSHIP', async () => {
    const scope = join(root, 'resource-scope'), foreign = join(root, 'foreign-state'), sharedInstall = join(root, 'shared-install')
    mkdirSync(scope); mkdirSync(foreign); mkdirSync(sharedInstall)
    const roots = { install: sharedInstall, config: join(scope, 'config'), data: join(scope, 'data'), logs: join(scope, 'logs'), cache: join(scope, 'cache'), workspace: join(scope, 'workspace') }
    const target = { installDir: sharedInstall, appRoot: join(sharedInstall, 'app') }
    const child = await childFor([target.appRoot, '--state', foreign])
    const observed = await accountRegisteredResources({ roots, target })
    expect(!observed.owned.some(entry => entry.pid === child.pid), 'A process using the same install but a different state was claimed as owned', {
      childPid: child.pid, ownedPids: observed.owned.map(entry => entry.pid), considered: observed.considered,
    })
  })
  await check('JOURNAL_SPAWN_START_MISMATCH_CANNOT_REENTER_OWNED_SET', async () => {
    const scope = join(root, 'reuse-scope'); mkdirSync(scope)
    const roots = { config: join(scope, 'config'), data: join(scope, 'data'), logs: join(scope, 'logs'), cache: join(scope, 'cache'), workspace: join(scope, 'workspace') }
    const child = await childFor(['--state', roots.data])
    const observed = await accountRegisteredResources({ roots, target: null, spawnedPid: child.pid, spawnedStart: 'different-process-start',
      journalSpawn: { pid: child.pid, processStart: 'different-process-start' } })
    expect(!observed.owned.some(entry => entry.pid === child.pid), 'Unconditional journal pid registration bypassed the recorded process-start mismatch', {
      childPid: child.pid, pidReused: observed.pidReused, ownedPids: observed.owned.map(entry => entry.pid), unknownPids: observed.unknownLive.map(entry => entry.pid),
    })
  })
} finally {
  for (const child of ownedChildren) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited
  }
  rmSync(root, { recursive: true, force: true })
}
const report = {
  status: cases.every(item => item.status === 'PASS') ? 'PASS_DISTRIBUTION_ADMISSION' : 'FAIL_DISTRIBUTION_ADMISSION',
  command: ['node', 'tools/bootstrap/probe-wave10-distribution.mjs', candidate, ...(values.output ? ['--output', resolve(values.output)] : [])],
  sourceRoot: candidate,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(),
  sourceWorktreeClean: execFileSync('git', ['status', '--porcelain'], { cwd: candidate, encoding: 'utf8' }).trim() === '',
  sourceHashes: Object.fromEntries(['packages/portability/src/recovery-target.ts', 'apps/launcher/lib/upgrade.mjs'].map(path => [path, hash(join(candidate, path))])),
  checkedAt: new Date().toISOString(), exitCode: cases.every(item => item.status === 'PASS') ? 0 : 1, cases,
  modelCalls: 0, nativeTurns: 0,
  limitations: [
    'Direct candidate source; material fixtures are valid main-bound inert DTOs, not real committed recovery authority.',
    'Resource negative tests call readonly accounting only; candidate stop functions never receive test or external process ids.',
    'Only probe-created child processes are cleaned up; no user service or candidate source is changed.',
    'No real managed upgrade, artifact installation, target activation, model or native task is exercised by this probe.',
  ],
}
const output = values.output ? resolve(values.output) : join(repository, 'reports/releases/wave10-admission/distribution.json')
mkdirSync(resolve(output, '..'), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.exitCode
