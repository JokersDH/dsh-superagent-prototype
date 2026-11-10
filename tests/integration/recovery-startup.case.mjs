import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { localCredentials } from '../../apps/coordinator/http/local-state.ts'
import { NativeProjectRegistry, ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'

for (const withProjectBindings of [false, true]) test(withProjectBindings
  ? 'restored native project bindings remain visible without authorizing or consuming business'
  : 'a restored first start never consumes queued business, even when normal/native/assistant flags are supplied', { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recovery-startup-'))
  const credential = localCredentials(root)
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  store.queue.enqueue('application.execute', 'old-begin', JSON.stringify({ kind: 'old-business' }), 1, 0, new Date().toISOString())
  store.queue.enqueue('application.assistant.reply', 'old-chat', JSON.stringify({ messageId: 'missing-message' }), 2, 0, new Date().toISOString())
  store.queue.enqueue('question.answer', 'old-answer', '{}', 3, 0, new Date().toISOString())
  const before = ['application.execute', 'application.assistant.reply', 'question.answer'].map(kind => store.queue.dueRows(kind, Number.MAX_SAFE_INTEGER, 10))
  store.close()
  let restoredProjectId
  if (withProjectBindings) {
    const project = join(root, 'source-project'); ensureStarterProject(project)
    const registry = new NativeProjectRegistry(root), record = registry.prepare({ path: project, check: 'node_test' })
    registry.save(record); restoredProjectId = record.id
  }
  writeFileSync(join(root, 'restore-report.json'), '{"protocol":"personal-restore/1"}\n', { mode: 0o600 })
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['apps/coordinator/product/demo.ts', '--state', root, '--port', String(port),
    '--startup-mode', 'normal', '--native', '--assistant'], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', bytes => { logs += bytes.toString() })
  child.stderr.on('data', bytes => { logs += bytes.toString() })
  const closed = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed }
    rmSync(root, { recursive: true, force: true })
  })
  const deadline = Date.now() + 10000
  let health
  while (Date.now() < deadline) {
    try { health = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json(); break } catch {}
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Recovery entry exited: ${logs}`)
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.equal(health?.startupMode, 'recovery_readonly')
  const configuration = await (await fetch(`http://127.0.0.1:${port}/v1/configuration`, {
    headers: { authorization: `Bearer ${credential('api.key')}` },
  })).json()
  assert.ok(configuration.projects.length > 0)
  if (withProjectBindings) {
    const restored = configuration.projects.find(project => project.id === restoredProjectId)
    assert.ok(restored)
    assert.deepEqual(restored.scope.allowedPaths, ['.'])
    assert.deepEqual(restored.scope.excludedPaths, ['.git'])
  }
  assert.ok(configuration.profiles.every(profile => !profile.dispatchAllowed))
  assert.ok(configuration.projects.every(project => !project.dispatchAllowed && project.profileIds.length === 0))
  const response = await fetch(`http://127.0.0.1:${port}/v1/commands`, { method: 'POST', headers: {
    authorization: `Bearer ${credential('api.key')}`, 'content-type': 'application/json' }, body: '{}' })
  assert.equal(response.status, 422)
  assert.match(logs, /business queues and model providers are disabled/)
  child.kill('SIGTERM'); await closed
  const reopened = new ProductStore({ path: join(root, 'state.sqlite') })
  try {
    const after = ['application.execute', 'application.assistant.reply', 'question.answer'].map(kind => reopened.queue.dueRows(kind, Number.MAX_SAFE_INTEGER, 10))
    assert.deepEqual(after, before)
    assert.equal(reopened.domain.tickets.list().length, 0)
  } finally { reopened.close() }
})
