import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport } from '../src/transport.ts'
const input = { projectId: 'one', kind: 'scoped_change' as const, allowedPaths: ['src/'], profileId: 'profile-one' }
const preview = { protocol: 'project-recipe-preview/1', input, configurationRevision: 'a'.repeat(64), factsDigest: null, catalogDigest: null,
  observedAt: '2026-11-15T01:00:00.000Z', status: 'needs_input', title: '变更', fields: null,
  issues: [{ code: 'unknown', message: '需要配置' }], authorization: 'none' }
test('recipe transport posts only selected identities and atoms, validates correspondence and preserves legacy absence', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/v1/projects/one/recipes/preview'); assert.equal(options?.method, 'POST'); assert.ok(options.signal)
    assert.deepEqual(JSON.parse(String(options.body)), input); return new Response(JSON.stringify(preview))
  }
  assert.deepEqual(await new HttpTransport().previewProjectRecipe(input), preview)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...preview, input: { ...input, projectId: 'other' } }))
  await assert.rejects(new HttpTransport().previewProjectRecipe(input))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 404 })
  assert.equal(await new HttpTransport().previewProjectRecipe(input), undefined)
})
