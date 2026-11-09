import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateModelProvider } from '../../apps/coordinator/product/model-provider.ts'

async function fixture(t, status = 200, content = 'SDK reply') {
  const directory = mkdtempSync('/tmp/pa-provider-')
  let calls = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const bytes of req) body += bytes
    calls++
    assert.equal(req.headers.authorization, 'Bearer fixture-private-api-key')
    const input = JSON.parse(body)
    assert.equal(input.model, 'model-1')
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify(
        status === 200
          ? {
              id: 'reply-1',
              object: 'chat.completion',
              created: 1,
              model: input.model,
              choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            }
          : { error: { message: 'fixture-private-api-key must never escape', type: 'upstream_error' } },
      ),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const file = join(directory, 'model.json'),
    key = 'fixture-private-api-key'
  writeFileSync(
    file,
    JSON.stringify({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: key,
      model: 'model-1',
      allowedModels: ['model-1', 'model-2'],
      allowInsecureHttp: true,
      maxOutputTokens: 64,
    }),
    { mode: 0o600 },
  )
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    file,
    key,
    provider: new PrivateModelProvider(file),
    get calls() {
      return calls
    },
  }
}
test('the SDK makes one completion call and public status never contains the private key', async (t) => {
  const h = await fixture(t)
  assert.doesNotMatch(JSON.stringify(h.provider.status()), /fixture-private-api-key|model\.json/)
  assert.equal((await h.provider.reply([{ role: 'user', content: 'hello' }])).text, 'SDK reply')
  assert.equal(h.calls, 1)
  assert.equal(h.provider.status().state, 'available')
})
test('an upstream success cannot disclose the configured credential in conversation text', async (t) => {
  const h = await fixture(t, 200, 'fixture-private-api-key')
  assert.doesNotMatch((await h.provider.reply([{ role: 'user', content: 'hello' }])).text, /fixture-private-api-key/)
})
test('upstream error payloads are redacted and never automatically retried', async (t) => {
  const h = await fixture(t, 500)
  await assert.rejects(
    h.provider.reply([{ role: 'user', content: 'hello' }]),
    (error) => !String(error).includes(h.key),
  )
  assert.equal(h.calls, 1)
  assert.equal(h.provider.status().state, 'error')
})
test('only configured model IDs can be selected and the private key stays server-side', async (t) => {
  const h = await fixture(t)
  assert.throws(() => h.provider.selectModel('untrusted-model'))
  const status = h.provider.selectModel('model-2')
  assert.equal(status.model, 'model-2')
  assert.equal(JSON.parse(readFileSync(h.file, 'utf8')).apiKey, h.key)
  assert.doesNotMatch(JSON.stringify(status), /fixture-private-api-key/)
})
test('unsafe private configuration permissions disable model use without leaking its contents', async (t) => {
  const h = await fixture(t)
  chmodSync(h.file, 0o644)
  assert.equal(h.provider.status().configured, false)
  await assert.rejects(
    h.provider.reply([{ role: 'user', content: 'hello' }]),
    (error) => !String(error).includes(h.key),
  )
  assert.equal(h.calls, 0)
})
