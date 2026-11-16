import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport } from '../src/transport.ts'

test('model configuration transport requires matching saved identity and refuses any secret echo', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const input = { baseURL: 'https://models.invalid/v1', model: 'model-one', apiKey: 'fixture-model-transport-secret', allowInsecureHttp: false }
  const status = { protocol: 'assistant-provider/1', configured: true, baseURL: input.baseURL, model: input.model,
    models: [input.model], state: 'configured', secureTransport: true }
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/v1/assistant/connection'); assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), input)
    return new Response(JSON.stringify(status))
  }
  assert.deepEqual(await new HttpTransport().configureAssistant(input), status)
  for (const changed of [{ ...status, model: 'other' }, { ...status, baseURL: 'https://foreign.invalid/v1' },
    { ...status, models: [input.apiKey] }, { ...status, configured: false }]) {
    globalThis.fetch = async () => new Response(JSON.stringify(changed))
    await assert.rejects(new HttpTransport().configureAssistant(input), error =>
      error instanceof Error && !error.message.includes(input.apiKey))
  }
})
