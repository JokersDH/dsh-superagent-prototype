import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProcessHost } from '../src/process-host.ts'
import { BoundedJournal, StderrRing, journalCoverage } from '../src/journal.ts'
import { FAKE_AGENT_PATH } from '../../../packages/testing/src/fake-driver.ts'

const nodePath = process.execPath

test('spawns with argv only, frames writes, and reports the real exit', async () => {
  const host = new ProcessHost()
  const resource = await host.spawn({
    executable: nodePath,
    argv: [FAKE_AGENT_PATH, '--scenario', 'happy'],
    cwdRef: 'cwd',
    environmentRef: 'env',
  })
  try {
    assert.match(resource.resourceRef, /^res-\d+-[a-f0-9]{12}$/)
    assert.equal(resource.identity.executable, nodePath)
    assert.deepEqual(resource.identity.argv.slice(0, 2), [FAKE_AGENT_PATH, '--scenario'])

    const chunks: string[] = []
    const reader = (async () => {
      for await (const chunk of resource.stdout) chunks.push(Buffer.from(chunk).toString('utf8'))
    })()

    await resource.write(Buffer.from(`${JSON.stringify({ type: 'shutdown' })}\n`))
    const exit = await resource.exited
    await reader
    assert.equal(exit.code, 0)
    assert.ok(chunks.join('').includes('"type":"ready"'), 'stdout should carry the ready frame')
  } finally {
    await host.stopAll(1000)
  }
})

test('refuses a relative executable and a NUL argument before spawning', async () => {
  const host = new ProcessHost()
  await assert.rejects(
    () => host.spawn({ executable: 'bin/agent', argv: [], cwdRef: 'cwd', environmentRef: 'env' }),
    error => (error as { reason?: string }).reason === 'relative_executable',
  )
  await assert.rejects(
    () => host.spawn({ executable: nodePath, argv: ['--x\0y'], cwdRef: 'cwd', environmentRef: 'env' }),
    error => (error as { reason?: string }).reason === 'invalid_argv',
  )
})

test('reports a missing executable as a stable executable_missing error', async () => {
  const host = new ProcessHost()
  await assert.rejects(
    () => host.spawn({ executable: '/nonexistent/definitely-not-an-agent', argv: [], cwdRef: 'cwd', environmentRef: 'env' }),
    error => (error as { code?: string }).code === 'executable_missing',
  )
})

test('stopOwned confirms quiescence for a live child and records exit evidence', async () => {
  const host = new ProcessHost()
  const resource = await host.spawn({
    executable: nodePath,
    argv: [FAKE_AGENT_PATH, '--scenario', 'ignore-cancel'],
    cwdRef: 'cwd',
    environmentRef: 'env',
  })
  const stopped = await host.stopOwned(resource.resourceRef, 2000)
  assert.equal(stopped.quiescence, 'confirmed')
  assert.ok(stopped.evidenceRefs.some(ref => ref.startsWith('sigterm-group')), JSON.stringify(stopped.evidenceRefs))
  // A parent exit alone is not quiescence: the host now proves the whole group is empty.
  assert.ok(stopped.evidenceRefs.includes('group-quiescent'), JSON.stringify(stopped.evidenceRefs))
  assert.ok(stopped.evidenceRefs.some(ref => ref.startsWith('leader:')), JSON.stringify(stopped.evidenceRefs))
  assert.deepEqual(host.resources(), [], 'a confirmed stop releases the handle')
  const repeated = await host.stopOwned(resource.resourceRef, 100)
  assert.equal(repeated.quiescence, 'confirmed', 'confirmed ownership evidence must not downgrade after releasing the handle')
  assert.deepEqual(repeated.evidenceRefs, stopped.evidenceRefs)
})

test('a stale start marker is treated as a reused pid and never signalled', async () => {
  // The marker read at spawn differs from the one observed at stop: identity is unproven.
  let reads = 0
  const host = new ProcessHost({
    readStartMarker: () => (reads++ === 0 ? 'Thu Nov  7 16:00:00 2026' : 'Thu Nov  7 17:30:00 2026'),
  })
  const resource = await host.spawn({
    executable: nodePath,
    argv: [FAKE_AGENT_PATH, '--scenario', 'ignore-cancel'],
    cwdRef: 'cwd',
    environmentRef: 'env',
  })
  try {
    const stopped = await host.stopOwned(resource.resourceRef, 500)
    assert.equal(stopped.quiescence, 'indeterminate')
    assert.deepEqual([...stopped.evidenceRefs], ['identity-mismatch'])
  } finally {
    // Real cleanup uses a host without the fake marker.
    process.kill(resource.identity.pid, 'SIGKILL')
    await resource.exited
  }
})

test('stopOwned on an unknown resource is indeterminate, not a silent success', async () => {
  const host = new ProcessHost()
  const result = await host.stopOwned('res-does-not-exist', 100)
  assert.equal(result.quiescence, 'indeterminate')
  assert.deepEqual([...result.evidenceRefs], ['unknown-resource'])
})

test('stopAll with no owned resources is trivially confirmed', async () => {
  const host = new ProcessHost()
  const result = await host.stopAll(100)
  assert.equal(result.quiescence, 'confirmed')
  assert.deepEqual([...result.evidenceRefs], ['no-owned-resources'])
})

test('the bounded journal refuses new critical entries past its reserve and reports gaps', () => {
  const journal = new BoundedJournal({ criticalCapacity: 2, diagnosticCapacity: 3, now: () => 1 })
  journal.commitCritical('fact-1', 'turn.ended')
  journal.commitCritical('fact-2', 'runtime.exited')
  assert.equal(journal.criticalFull, true)
  assert.throws(
    () => journal.assertCriticalCapacity(),
    error => (error as { reason?: string }).reason === 'critical_reserve_exhausted',
  )
  for (const index of [1, 2, 3, 4, 5]) journal.appendDiagnostic(`diag-${index}`)
  const snapshot = journal.snapshot()
  assert.equal(snapshot.diagnostics.length, 3)
  assert.equal(snapshot.droppedDiagnostics, 2)
  assert.equal(snapshot.gaps, 2)
  assert.equal(journalCoverage(snapshot), 'gapped')
  assert.equal(journalCoverage(new BoundedJournal().snapshot()), 'complete')
})

test('the stderr ring keeps only the tail and reports what it dropped', () => {
  const ring = new StderrRing({ maxBytes: 16 })
  ring.append(Buffer.from('aaaaaaaaaa'))
  ring.append(Buffer.from('bbbbbbbbbb'))
  ring.append(Buffer.from('cccccccccc'))
  const stats = ring.stats()
  assert.ok(stats.bytes <= 16, `bytes=${stats.bytes}`)
  assert.equal(stats.totalBytes, 30)
  assert.ok(stats.droppedBytes > 0)
  assert.ok(ring.text().endsWith('c'), 'the newest bytes are kept')
})
