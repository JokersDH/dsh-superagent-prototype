import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport, TransportError } from '../src/transport.ts'

test('context transport preserves selection and refuses a preview for a different conversation or work', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const input = { projectId: 'project', conversationId: 'original', selections: ['conversation' as const], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } }
  const preview = { protocol: 'context-preview/1', requestId: 'request', projectId: 'project', conversationId: 'original',
    observedAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z', status: 'insufficient', trust: 'untrusted_data',
    selections: ['conversation'], sources: [], groups: [], omitted: [], injectionFlags: [], issues: [], budgetClamped: [],
    budget: input.budget, totals: { files: 0, bytes: 0, tokens: 0 } }
  let body: unknown
  globalThis.fetch = async (_url, options) => { body = JSON.parse(String(options?.body)); return new Response(JSON.stringify(preview)) }
  assert.deepEqual(await new HttpTransport().contextPreview(input), preview)
  assert.deepEqual(body, input)
  for (const mismatch of [{ conversationId: 'foreign' }, { projectId: 'other' }, { selections: ['project'] },
    { contract: { workId: 'foreign', revision: 1, digest: 'a'.repeat(64) } }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...preview, ...mismatch }))
    await assert.rejects(new HttpTransport().contextPreview(input), error => error instanceof TransportError && error.code === 'schema_mismatch')
  }
})
