import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateModelProvider } from '../../apps/coordinator/product/model-provider.ts'

async function fixture(t, status = 200, content = 'SDK reply', chunks = [content], finish = true) {
  const directory = mkdtempSync('/tmp/pa-provider-')
  let calls = 0
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const bytes of req) body += bytes
    calls++
    assert.equal(req.headers.authorization, 'Bearer fixture-private-api-key')
    const input = JSON.parse(body)
    requests.push(input)
    assert.equal(input.model, 'model-1')
    if (status === 200 && input.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const chunk of chunks)
        res.write(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`,
        )
      res.end(
        finish
          ? `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
          : '',
      )
      return
    }
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
    requests,
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
test('a credential split across network chunks is redacted before any display delta', async (t) => {
  const h = await fixture(t, 200, '', ['safe fixture-', 'private-', 'api-key end'])
  const deltas = []
  const reply = await h.provider.reply([{ role: 'user', content: 'hello' }], (text) => deltas.push(text))
  assert.doesNotMatch(deltas.join(''), /fixture-private-api-key/)
  assert.equal(reply.text, 'safe [密钥已隐藏] end')
  assert.equal(deltas.join(''), reply.text)
})
test('a stream without a completion marker remains interrupted and is never retried', async (t) => {
  const h = await fixture(t, 200, '', ['partial reply'], false)
  const deltas = []
  await assert.rejects(
    h.provider.reply([{ role: 'user', content: 'hello' }], (text) => deltas.push(text)),
    (error) => error.code === 'stream_interrupted',
  )
  assert.equal(deltas.join(''), 'partial reply')
  assert.equal(h.calls, 1)
  assert.equal(h.provider.status().state, 'error')
})
test('an external abort cancels SDK streaming without a retry or raw error disclosure', async (t) => {
  const h = await fixture(t, 200, '', ['first', 'second'])
  const controller = new AbortController()
  await assert.rejects(
    h.provider.reply([{ role: 'user', content: 'hello' }], () => controller.abort(), controller.signal),
    (error) => error.code === 'cancelled' && !String(error).includes(h.key),
  )
  assert.equal(h.calls, 1)
})
test('model text arrives incrementally before the upstream stream has finished', async (t) => {
  const directory = mkdtempSync('/tmp/pa-stream-provider-')
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let firstDelta
  const first = new Promise((resolve) => {
    firstDelta = resolve
  })
  let streamingRequested = false
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const bytes of req) body += bytes
    const input = JSON.parse(body)
    streamingRequested = input.stream === true
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '第一段' }, finish_reason: null }] })}\n\n`,
    )
    await gate
    res.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '第二段' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const file = join(directory, 'model.json')
  writeFileSync(
    file,
    JSON.stringify({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'fixture-stream-key',
      model: 'model-1',
      allowedModels: ['model-1'],
      allowInsecureHttp: true,
    }),
    { mode: 0o600 },
  )
  t.after(async () => {
    release()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    rmSync(directory, { recursive: true, force: true })
  })
  const deltas = []
  const pending = new PrivateModelProvider(file).reply([{ role: 'user', content: 'hello' }], (delta) => {
    deltas.push(delta)
    firstDelta()
  })
  const outcome = await Promise.race([
    first.then(() => 'delta'),
    pending.then(() => 'ended'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
  ])
  release()
  await pending.catch(() => {})
  assert.equal(streamingRequested, true)
  assert.equal(outcome, 'delta')
  assert.equal(deltas.join(''), '第一段第二段')
})

test('a prepared request pins the exact model/configuration and can only send once', async t => {
  const h = await fixture(t)
  const prepared = h.provider.prepareReply(), original = prepared.configurationDigest
  assert.equal(prepared.model, 'model-1')
  assert.match(original, /^[a-f0-9]{64}$/)
  h.provider.selectModel('model-2')
  const changed = JSON.parse(readFileSync(h.file, 'utf8'))
  writeFileSync(h.file, JSON.stringify({ ...changed, apiKey: 'different-fixture-private-key', maxOutputTokens: 128 }))
  assert.notEqual(h.provider.prepareReply().configurationDigest, original)
  assert.equal((await prepared.reply([{ role: 'user', content: 'hello' }])).model, 'model-1')
  assert.equal(h.provider.status().model, 'model-2')
  await assert.rejects(prepared.reply([{ role: 'user', content: 'again' }]), error => error.code === 'request_already_used')
  assert.equal(h.calls, 1)
  assert.equal(h.requests[0].max_tokens, 64)
  assert.doesNotMatch(JSON.stringify(prepared), /fixture-private-api-key|apiKey|model\.json/)
})
