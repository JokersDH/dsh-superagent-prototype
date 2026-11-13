/** Zero-model environment diagnostics: stable codes before any daemon starts. */
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { probeAuthorExecutor, probePorts, probeRuntime, readAuthorEvidence } from '../lib/diagnostics.mjs'

const release = (overrides = {}) => ({
  producer: { node: process.versions.node, platform: process.platform, arch: process.arch, ...(overrides.producer ?? {}) },
  admission: { abi: String(process.versions.modules), ...(overrides.admission ?? {}) },
})

const fakeCodex = (root, { version = 'codex-cli 0.164.0', exit = 0 } = {}) => {
  const path = join(root, 'codex')
  writeFileSync(path, `#!/bin/sh\necho "${version}"\nexit ${exit}\n`, { mode: 0o755 })
  chmodSync(path, 0o755)
  return path
}

test('runtime probe reports node/platform/ABI mismatches before loading the database', () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-diag-runtime-'))
  try {
    assert.equal(probeRuntime({ installRoot: root, release: release() }).code, 'sqlite_binding_unavailable')
    assert.equal(probeRuntime({ installRoot: root, release: release({ producer: { platform: 'linux' } }) }).code, 'platform_mismatch')
    assert.equal(probeRuntime({ installRoot: root, release: release({ admission: { abi: '999' } }) }).code, 'abi_mismatch')
    assert.equal(probeRuntime({ installRoot: root, release: release({ producer: { node: '22.0.0' } }) }).code, 'node_mismatch')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('author executor probe distinguishes missing binary, missing auth and version drift', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-diag-executor-'))
  const previousBin = process.env.PA_CODEX_BIN
  const previousHome = process.env.CODEX_HOME
  t.after(() => {
    if (previousBin === undefined) delete process.env.PA_CODEX_BIN
    else process.env.PA_CODEX_BIN = previousBin
    if (previousHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  })
  process.env.PA_CODEX_BIN = join(root, 'missing-codex')
  const missing = probeAuthorExecutor({ installRoot: root, required: true })
  assert.equal(missing.code, 'author_executor_unavailable')

  const bin = fakeCodex(root)
  process.env.PA_CODEX_BIN = bin
  process.env.CODEX_HOME = join(root, 'codex-home')
  mkdirSync(process.env.CODEX_HOME, { recursive: true, mode: 0o700 })
  const noAuth = probeAuthorExecutor({ installRoot: root, required: true, expectedVersion: 'codex-cli 0.164.0' })
  assert.equal(noAuth.code, 'author_auth_unavailable')
  assert.equal(noAuth.facts.authPresent, false)
  assert.equal(noAuth.facts.version, 'codex-cli 0.164.0')

  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), '{}', { mode: 0o600 })
  const ok = probeAuthorExecutor({ installRoot: root, required: true, expectedVersion: 'codex-cli 0.164.0' })
  assert.equal(ok.ok, true)
  assert.equal(ok.facts.authPresent, true)
  assert.equal(ok.facts.authMode, '600')

  const drifted = probeAuthorExecutor({ installRoot: root, required: true, expectedVersion: 'codex-cli 0.999.0' })
  assert.equal(drifted.code, 'author_executor_version_mismatch')
})

test('port probing reports a busy loopback port without stopping its owner', async () => {
  const socket = createServer()
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  try {
    const [busy] = await probePorts([['test', port]])
    assert.equal(busy.ok, false)
    assert.equal(busy.code, 'EADDRINUSE')
  } finally {
    await new Promise((resolve) => socket.close(resolve))
  }
})

test('checked-in native evidence is read as facts, not a live admission', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-diag-evidence-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'reports/releases/native-mvp'), { recursive: true })
  writeFileSync(join(root, 'reports/releases/native-mvp/native-product.json'), JSON.stringify({
    status: 'PASS_REAL_NATIVE_PRODUCT',
    profileVersion: 'codex-cli 0.164.0',
    sourceCommit: 'abc123',
    checkedAt: '2026-11-09T00:00:00.000Z',
    cases: [{ id: 'NATIVE-DELEGATION', status: 'PASS' }],
  }))
  const evidence = readAuthorEvidence(root)
  assert.equal(evidence.status, 'PASS_REAL_NATIVE_PRODUCT')
  assert.equal(evidence.profileVersion, 'codex-cli 0.164.0')
  assert.deepEqual(evidence.cases, [{ id: 'NATIVE-DELEGATION', status: 'PASS' }])
  assert.equal(readAuthorEvidence(join(root, 'empty')), null)
})
