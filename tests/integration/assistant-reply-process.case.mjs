import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/assistant-reply-process.mjs')
function run(root, mode) {
  const child = spawnSync(process.execPath, [fixture, root, mode], { encoding: 'utf8', timeout: 15000 })
  assert.equal(child.error, undefined, child.error?.message)
  if (mode === 'recover') assert.equal(child.status, 0, child.stderr)
  else assert.equal(child.signal, 'SIGKILL', child.stderr)
  const output = child.stdout.trim().split('\n').at(-1)
  assert.ok(output, child.stderr)
  return JSON.parse(output)
}
function temp(t) {
  const root = mkdtempSync('/tmp/pa-reply-process-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
test('the actual runtime recovers a committed result after SIGKILL without invoking the mock provider again', t => {
  const root = temp(t), crashed = run(root, 'after-result')
  assert.equal(crashed.modelCalls, 1); assert.ok(crashed.result); assert.equal(crashed.replies.length, 0)
  const recovered = run(root, 'recover')
  assert.equal(recovered.modelCalls, 0); assert.deepEqual(recovered.result, crashed.result)
  assert.equal(recovered.replies.length, 1); assert.equal(recovered.notices.length, 0)
  assert.equal(recovered.replies[0].text, 'Durable response from the original request.')
  assert.deepEqual(recovered.replies[0].sourceRefs, [crashed.result.sourceMessageId])
  const replay = run(root, 'recover')
  assert.equal(replay.modelCalls, 0); assert.deepEqual(replay.replies, recovered.replies)
})
test('SIGKILL during the provider leaves an unknown request and new processes cannot resend it', t => {
  const root = temp(t), crashed = run(root, 'during-provider')
  assert.equal(crashed.modelCalls, 1); assert.equal(crashed.requestRecorded, true); assert.equal(crashed.result, null)
  const recovered = run(root, 'recover')
  assert.equal(recovered.modelCalls, 0); assert.equal(recovered.result, null); assert.equal(recovered.replies.length, 0)
  assert.equal(recovered.notices.length, 1); assert.match(recovered.notices[0].text, /未自动重发/)
  assert.deepEqual(run(root, 'recover').notices, recovered.notices)
})
test('SIGKILL after the message commit keeps a single reply and completed result', t => {
  const root = temp(t), crashed = run(root, 'after-message'), recovered = run(root, 'recover')
  assert.equal(crashed.modelCalls, 1); assert.equal(recovered.modelCalls, 0)
  assert.deepEqual(recovered.result, crashed.result); assert.deepEqual(recovered.replies, crashed.replies)
  assert.equal(recovered.replies.length, 1)
})
test('a corrupted persisted result artifact refuses process recovery without any new inference', t => {
  const root = temp(t), crashed = run(root, 'after-result')
  const store = new ProductStore({ path: join(root, 'state/state.sqlite') })
  try { writeFileSync(store.artifacts.filePath(crashed.result.artifactRef), 'corrupt persisted reply') }
  finally { store.close() }
  const recovered = run(root, 'recover')
  assert.equal(recovered.modelCalls, 0); assert.equal(recovered.replies.length, 0)
  assert.equal(recovered.notices.length, 1); assert.match(recovered.notices[0].text, /无法核对/)
})
