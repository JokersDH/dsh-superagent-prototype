/**
 * D1: requested roots versus recorded instance. A record is only authority for the roots it was
 * written for; stop/reuse/status must refuse without signalling or deleting the record.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { requestedScopeCheck } from '../lib/identity.mjs'
import { stopInstance } from '../lib/stop.mjs'

const makeRoots = (root) => {
  const install = join(root, 'install')
  const roots = {
    install,
    config: join(root, 'config'),
    data: join(root, 'state-a'),
    cache: join(root, 'cache'),
    logs: join(root, 'logs'),
    workspace: join(root, 'workspace'),
  }
  for (const path of [join(install, 'app'), roots.config, roots.data, join(root, 'state-b'), roots.cache, roots.logs, roots.workspace])
    mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(roots.config, 0o700)
  return roots
}
const recordFor = (roots, overrides = {}) => ({
  protocol: 'personal-product-instance/1', pid: 999_999, processStart: 'probe-start', apiPid: 999_998, consolePid: 999_999,
  apiArgv: [process.execPath, join(roots.install, 'app/apps/coordinator/product/demo.ts'), '--state', roots.data],
  apiProcessStart: 'probe-api-start', apiUid: process.getuid?.() ?? 0,
  apiURL: 'http://127.0.0.1:45001', consoleURL: 'http://127.0.0.1:45002', state: roots.data, install: join(roots.install, 'app'),
  buildId: 'probe-build', mode: 'fixture', access: 'local-development', startupMode: 'normal', startedAt: new Date().toISOString(),
  ...overrides,
})
const writeRecord = (config, record) => writeFileSync(join(config, 'instance.json'), JSON.stringify(record, null, 2), { mode: 0o600 })

test('a record matches its own requested roots but not another state or install', () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-scope-'))
  try {
    const roots = makeRoots(root)
    const record = recordFor(roots)
    assert.equal(requestedScopeCheck({ roots, record }).ok, true)
    const otherState = { ...roots, data: join(root, 'state-b') }
    const stateMismatch = requestedScopeCheck({ roots: otherState, record })
    assert.equal(stateMismatch.ok, false)
    assert.deepEqual(stateMismatch.failures, ['requested_state'])
    assert.equal(stateMismatch.recorded.state.endsWith('state-a'), true)
    const otherInstall = { ...roots, install: join(root, 'other-install') }
    mkdirSync(join(otherInstall.install, 'app'), { recursive: true })
    const installMismatch = requestedScopeCheck({ roots: otherInstall, record })
    assert.equal(installMismatch.ok, false)
    assert.deepEqual(installMismatch.failures, ['requested_install'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('stop for another requested state is refused, keeps the record and never signals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-scope-stop-'))
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    const roots = makeRoots(root)
    const record = recordFor(roots, { pid: 999_999, apiPid: child.pid, consolePid: 999_999 })
    writeRecord(roots.config, record)
    const result = await stopInstance({ roots: { ...roots, data: join(root, 'state-b') }, timeoutMs: 1000 })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'requested_root_mismatch')
    assert.equal(result.status, 'BLOCKED')
    assert.equal(existsSync(join(roots.config, 'instance.json')), true)
    assert.equal(JSON.parse(readFileSync(join(roots.config, 'instance.json'), 'utf8')).apiPid, child.pid)
    assert.equal(child.exitCode, null, 'the foreign state process must not be signalled')
    const matching = await stopInstance({ roots, timeoutMs: 1000 })
    assert.equal(matching.code !== 'requested_root_mismatch', true, 'the same-roots stop is not blocked by the scope check')
  } finally {
    try { child.kill('SIGKILL') } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true })
  }
})
