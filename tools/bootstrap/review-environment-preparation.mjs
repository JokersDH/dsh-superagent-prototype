import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { environment: { type: 'string' }, record: { type: 'boolean', default: false } } })
if (!values.environment) throw new Error('Provide --environment <committed candidate checkout>')
const candidate = resolve(values.environment)
const { prepareEnvironment } = await import(pathToFileURL(join(candidate, 'packages/environment-preparation/src/index.ts')))
const { makePnpmFixture, copies } = await import(pathToFileURL(join(candidate, 'packages/environment-preparation/test/helpers.ts')))
const cases = []
const json = (path, value) => writeFileSync(path, JSON.stringify(value) + '\n')
function fixture(dependencies = false) {
  const root = mkdtempSync('/tmp/pa-env-admission-'), project = join(root, 'project'), workspace = join(root, 'workspace')
  for (const path of [project, workspace]) {
    mkdirSync(path, { mode: 0o700 })
    json(join(path, 'package.json'), { name: 'environment-admission', private: true, ...(dependencies ? { dependencies: { 'env-dep': '1.0.0' } } : {}) })
    if (dependencies) json(join(path, 'package-lock.json'), { name: 'environment-admission', lockfileVersion: 3, packages: { '': { dependencies: { 'env-dep': '1.0.0' } }, 'node_modules/env-dep': { version: '1.0.0' } } })
  }
  if (dependencies) {
    mkdirSync(join(workspace, 'node_modules/env-dep'), { recursive: true })
    json(join(workspace, 'node_modules/env-dep/package.json'), { name: 'env-dep', version: '1.0.0', main: 'index.js' })
    writeFileSync(join(workspace, 'node_modules/env-dep/index.js'), 'module.exports=1\n')
  }
  return { root, project, workspace }
}
const input = (h, policy = 'existing_only') => ({ projectPath: h.project, workspacePath: h.workspace, policy, requestId: 'environment-admission', signal: new AbortController().signal })
async function check(id, action) {
  try { const result = await action(); cases.push({ id, ...result }) }
  catch (error) { cases.push({ id, passesInvariant: false, observed: { error: String(error).slice(0, 1000) } }) }
}

await check('ENV-CLEANUP-PRESERVES-UNOWNED-PATH', async () => {
  const h = fixture()
  try {
    mkdirSync(join(h.workspace, '.product-environment'))
    const file = join(h.workspace, '.product-environment/user-note.txt')
    writeFileSync(file, 'pre-existing user content\n')
    const result = await prepareEnvironment(input(h))
    await result.cleanup()
    const preserved = existsSync(file) && readFileSync(file, 'utf8') === 'pre-existing user content\n'
    return { passesInvariant: preserved, observed: { status: result.status, preExistingContentPreserved: preserved } }
  } finally { rmSync(h.root, { recursive: true, force: true }) }
})
await check('ENV-REJECTS-NESTED-DEPENDENCY-ESCAPE', async () => {
  const h = fixture(true)
  try {
    const target = join(h.root, 'outside-entry.js')
    writeFileSync(target, 'module.exports=2\n')
    rmSync(join(h.workspace, 'node_modules/env-dep/index.js'))
    symlinkSync(target, join(h.workspace, 'node_modules/env-dep/index.js'))
    const result = await prepareEnvironment(input(h))
    return { passesInvariant: result.status === 'blocked', observed: { status: result.status, code: result.code ?? null, nestedEntryEscapesWorkspace: true } }
  } finally { rmSync(h.root, { recursive: true, force: true }) }
})
await check('ENV-INSTALLED-VERSION-DRIFT-NOT-REUSED', async () => {
  const h = fixture(true)
  try {
    const first = await prepareEnvironment(input(h))
    assert.equal(first.status, 'ready')
    json(join(h.workspace, 'node_modules/env-dep/package.json'), { name: 'env-dep', version: '9.0.0', main: 'index.js' })
    const second = await prepareEnvironment(input(h))
    return { passesInvariant: second.status === 'blocked' || second.fingerprint !== first.fingerprint,
      observed: { declaredVersion: '1.0.0', installedVersion: '9.0.0', status: second.status, sameFingerprint: second.fingerprint === first.fingerprint } }
  } finally { rmSync(h.root, { recursive: true, force: true }) }
})
await check('ENV-VALID-NODE-ENGINE-OR-RANGE', async () => {
  const h = fixture()
  try {
    json(join(h.workspace, 'package.json'), { name: 'engine-range-admission', private: true, engines: { node: '^22.19.0 || >=24.0.0' } })
    const result = await prepareEnvironment(input(h))
    return { passesInvariant: result.status === 'ready', observed: { node: process.versions.node, engine: '^22.19.0 || >=24.0.0', status: result.status, code: result.code ?? null } }
  } finally { rmSync(h.root, { recursive: true, force: true }) }
})
await check('ENV-OFFLINE-INSTALL-DOES-NOT-EXECUTE-PNPMFILE', async () => {
  let h
  try {
    const prepared = makePnpmFixture()
    h = { ...prepared, ...copies(prepared) }
    const marker = join(h.root, 'outside-workspace-hook-marker')
    writeFileSync(join(h.workspace, '.pnpmfile.cjs'), `module.exports={hooks:{readPackage(pkg){require('node:fs').writeFileSync(${JSON.stringify(marker)},'hook executed');return pkg}}}\n`)
    const result = await prepareEnvironment({ ...input(h, 'offline_install'), storeDir: h.store })
    const executed = existsSync(marker)
    await result.cleanup()
    return { passesInvariant: !executed, observed: { status: result.status, code: result.code ?? null, hookExecutedOutsideWorkspace: executed, modelCalls: 0, fixturePolicy: 'local tarball, pnpm offline, no network request in hook' } }
  } finally { if (h) rmSync(h.root, { recursive: true, force: true }) }
})
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_ENVIRONMENT_ADMISSION' : 'BLOCKED_ENVIRONMENT_ADMISSION', checkedAt: new Date().toISOString(),
  reviewerCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, architecture: process.arch, cases, scope: 'Private temporary files/local offline package fixture only; no vendor/model/account/user-project operation' }
if (values.record) {
  mkdirSync('reports/releases/native-followup', { recursive: true })
  writeFileSync('reports/releases/native-followup/environment-admission.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
if (!cases.every(item => item.passesInvariant)) process.exitCode = 1
