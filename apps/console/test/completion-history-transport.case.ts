import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport } from '../src/transport.ts'

const page = { protocol: 'work-completion-history/1', workId: 'work-one', projectId: 'one',
  currentContract: { workId: 'work-one', revision: 1, digest: 'a'.repeat(64) }, kind: 'contracts', observedAt: '2026-11-17T00:00:00.000Z',
  mode: 'live_keyset', authorization: 'none', status: 'ok', reason: null, limit: 10, returned: 1, available: 1,
  entries: [{ kind: 'contracts', id: 'contract-one', revision: 1, digest: 'a'.repeat(64) }], hasMore: false, coverage: 'complete', maxBytes: 131072 }
test('history transport validates exact context, strict metadata, optional absence and streamed response bytes', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/v1/works/work-one/completion-history?kind=contracts&limit=10'); assert.ok(init?.signal)
    return new Response(JSON.stringify(page))
  }
  assert.deepEqual(await new HttpTransport().workCompletionHistory('work-one', { kind: 'contracts', limit: 10 }), page)
  for (const changed of [{ ...page, workId: 'other' }, { ...page, kind: 'acceptances' }, { ...page, limit: 1 },
    { ...page, entries: [{ ...page.entries[0], argv: ['/private'] }] }, { ...page, hasMore: true }]) {
    globalThis.fetch = async () => new Response(JSON.stringify(changed))
    await assert.rejects(new HttpTransport().workCompletionHistory('work-one', { kind: 'contracts', limit: 10 }))
  }
  let cancelled = false
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('x'.repeat(131073)))
  }, cancel() { cancelled = true } }))
  await assert.rejects(new HttpTransport().workCompletionHistory('work-one', { kind: 'contracts', limit: 10 }))
  assert.equal(cancelled, true)
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 404 })
  assert.equal(await new HttpTransport().workCompletionHistory('work-one', { kind: 'contracts', limit: 10 }), undefined)
})
