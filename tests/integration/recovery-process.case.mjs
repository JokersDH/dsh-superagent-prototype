import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fixture, actor, createCommand } from '../../packages/application/test/helpers.ts'

test('actual restored demo exposes readonly preflight while old execution stays untouched', { timeout: 30000 }, async t => {
  const h = fixture(t)
  await h.app.dispatch(createCommand('restore-pending-work'), actor)
  const queued = h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100)
  assert.equal(queued.length, 1)
  const project = join(h.directory, 'rebound-repository')
  mkdirSync(project); writeFileSync(join(project, 'index.mjs'), 'export const recovered = true\n')
  const git = args => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs']); git(['-c', 'user.name=Restore Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Restored fixture base'])
  const marker = join(h.directory, 'restore-report.json')
  const bytes = JSON.stringify({ protocol: 'personal-restore/1', targetPath: h.directory,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 13 }, evidence: { status: 'verified' } })
  writeFileSync(marker, bytes, { mode: 0o600 }); chmodSync(h.directory, 0o700)
  h.store.close()
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [resolve('apps/coordinator/product/demo.ts'), '--state', h.directory, '--port', String(port),
    '--console-origin', origin, '--local-access', '--startup-mode', 'recovery_readonly'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', chunk => { log = (log + chunk.toString()).slice(-16000) })
  child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-16000) })
  const exited = once(child, 'exit')
  try {
    const deadline = Date.now() + 15000
    let health
    while (Date.now() < deadline) {
      try { const response = await fetch(`${origin}/v1/health`, { signal: AbortSignal.timeout(500) }); if (response.ok) { health = await response.json(); break } } catch {}
      if (child.exitCode !== null) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(health?.startupMode, 'recovery_readonly', log)
    const inspection = await (await fetch(`${origin}/v1/recovery/inspect`)).json()
    assert.equal(inspection.commitAvailable, false)
    assert.equal(inspection.heldQueue.waiting, 1)
    const input = { expectedFingerprint: inspection.inspectionFingerprint,
      bindings: [{ sourceProjectId: 'project-atlas', project: { path: project, check: 'node_test' } }] }
    const prepared = await fetch(`${origin}/v1/recovery/prepare`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input) })
    assert.equal(prepared.status, 200, await prepared.clone().text())
    const plan = await prepared.json()
    assert.equal(plan.authorization, 'not_granted')
    assert.equal(plan.bindings.length, 1)
    const forbidden = await fetch(`${origin}/v1/commands`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(createCommand('must-not-dispatch')) })
    assert.equal(forbidden.status, 422)
    assert.equal((await fetch(`${origin}/v1/recovery/commit`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status, 422)
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    try { await exited } finally { clearTimeout(timeout); h.reopen() }
  }
  assert.deepEqual(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100), queued)
  assert.equal(readFileSync(marker, 'utf8'), bytes)
})
