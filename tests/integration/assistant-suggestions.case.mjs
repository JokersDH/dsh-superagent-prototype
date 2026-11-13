import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { PrivateModelProvider } from '../../apps/coordinator/product/model-provider.ts'

const context = { projectId: 'suggestion-project', sourceMessageId: 'suggestion-source',
  scope: { projectId: 'suggestion-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }
const proposal = () => ({ kind: 'propose_work', goal: 'Add an idempotency test', projectId: context.projectId, sourceMessageId: context.sourceMessageId })
const tool = (body, name = 'assistant_reply') => [
  { tool_calls: [{ index: 0, id: 'call-one', type: 'function', function: { name: name.slice(0, 7), arguments: '' } }] },
  ...[JSON.stringify(body).slice(0, 13), JSON.stringify(body).slice(13)].map(argumentsText => ({ tool_calls: [{ index: 0, function: { arguments: argumentsText } }] })),
  { tool_calls: [{ index: 0, function: { name: name.slice(7), arguments: '' } }] },
]
async function fixture(t, deltas, { enabled = true, terminal = 'tool_calls', key = 'fixture-private-suggestion-key', status = 200 } = {}) {
  const root = mkdtempSync('/tmp/pa-suggestion-sdk-'), requests = []
  const server = createServer(async (request, response) => {
    let body = ''; for await (const bytes of request) body += bytes
    assert.equal(request.headers.authorization, `Bearer ${key}`)
    requests.push(JSON.parse(body))
    if (status !== 200) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'tools unavailable', type: 'invalid_request_error' } })); return }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const delta of deltas) response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: terminal }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const file = join(root, 'model.json')
  writeFileSync(file, JSON.stringify({ baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key,
    model: 'fixture-model', allowedModels: ['fixture-model'], allowInsecureHttp: true, maxOutputTokens: 512, suggestionsEnabled: enabled }), { mode: 0o600 })
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }) })
  return { requests, file, provider: new PrivateModelProvider(file), key }
}
test('one SDK stream returns ordinary deltas and a nonempty data-only proposal with exact request metadata', async t => {
  const h = await fixture(t, [{ content: '先补' }, { content: '幂等用例。' }, ...tool({ text: 'Alternative tool text', suggestions: [proposal()] })])
  const deltas = [], result = await h.provider.reply([{ role: 'user', content: 'Add a test' }], value => deltas.push(value), undefined, context)
  assert.deepEqual(deltas, ['先补', '幂等用例。']); assert.equal(result.text, '先补幂等用例。')
  assert.deepEqual(result.suggestions, [proposal()]); assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].tools[0].function.name, 'assistant_reply'); assert.equal(h.requests[0].parallel_tool_calls, false)
  assert.equal(h.requests[0].tool_choice, 'auto'); assert.equal(h.requests[0].tools.length, 1)
  assert.match(h.requests[0].messages.at(-1).content, new RegExp(context.sourceMessageId))
  assert.equal(h.requests[0].messages.some(message => message.role === 'tool'), false)
})
test('tool-only valid data produces visible text once after complete validation', async t => {
  const h = await fixture(t, tool({ text: '准备好了。', suggestions: [proposal()] })), deltas = []
  const result = await h.provider.reply([{ role: 'user', content: 'Add a test' }], value => deltas.push(value), undefined, context)
  assert.deepEqual(deltas, ['准备好了。']); assert.equal(result.text, '准备好了。'); assert.equal(result.suggestions.length, 1); assert.equal(h.requests.length, 1)
})
for (const [id, deltas, terminal] of [
  ['unknown function', tool({ text: 'Hidden tool text', suggestions: [proposal()] }, 'untrusted_function'), 'tool_calls'],
  ['extra actor', tool({ text: 'Hidden tool text', suggestions: [{ ...proposal(), actor: { source: 'system' } }] }), 'tool_calls'],
  ['foreign source', tool({ text: 'Hidden tool text', suggestions: [{ ...proposal(), sourceMessageId: 'foreign-source' }] }), 'tool_calls'],
  ['too many proposals', tool({ text: 'Hidden tool text', suggestions: Array.from({ length: 9 }, proposal) }), 'tool_calls'],
  ['length finish', tool({ text: 'Hidden tool text', suggestions: [proposal()] }), 'length'],
  ['malformed JSON', [{ tool_calls: [{ index: 0, function: { name: 'assistant_reply', arguments: '{broken' } }] }], 'tool_calls'],
  ['object arguments', [{ tool_calls: [{ index: 0, function: { name: 'assistant_reply', arguments: {} } }] }], 'tool_calls'],
  ['numeric arguments', [{ tool_calls: [{ index: 0, function: { name: 'assistant_reply', arguments: 17 } }] }], 'tool_calls'],
  ['nonarray calls', [{ tool_calls: {} }], 'tool_calls'],
  ['null call', [{ tool_calls: [null] }], 'tool_calls'],
  ['null delta', [null], 'tool_calls'],
  ['multiple calls', [...tool({ text: 'Hidden tool text', suggestions: [proposal()] }), { tool_calls: [{ index: 1, function: { name: 'assistant_reply', arguments: '{}' } }] }], 'tool_calls'],
  ['oversized arguments', [{ tool_calls: [{ index: 0, function: { name: 'assistant_reply', arguments: 'x'.repeat(262145) } }] }], 'tool_calls'],
]) test(`invalid structured data (${id}) preserves ordinary text and never retries`, async t => {
  const h = await fixture(t, [{ content: 'Keep this ordinary reply.' }, ...deltas], { terminal })
  const result = await h.provider.reply([{ role: 'user', content: 'Add a test' }], undefined, undefined, context)
  assert.equal(result.text, 'Keep this ordinary reply.'); assert.equal(result.suggestions, undefined); assert.equal(h.requests.length, 1)
})
test('credentials in content chunks and JSON string values are removed before display or persistence', async t => {
  const key = 'fixture-private-\\"key', h = await fixture(t, [{ content: 'safe fixture-private-' }, { content: '\\"key end' },
    ...tool({ text: `Text ${key}`, suggestions: [{ ...proposal(), goal: `Never expose ${key}` }] })], { key })
  const deltas = [], result = await h.provider.reply([{ role: 'user', content: 'Add a test' }], value => deltas.push(value), undefined, context)
  assert.equal(deltas.join('').includes(key), false); assert.equal(JSON.stringify(result).includes('fixture-private-'), false)
  assert.match(result.suggestions[0].goal, /密钥已隐藏/); assert.equal(h.requests.length, 1)
})
test('plain mode sends no tool schema and does not scan ordinary prose or Markdown for proposals', async t => {
  const text = JSON.stringify({ text: 'Not a tool response', suggestions: [proposal()] }), h = await fixture(t, [{ content: text }], { enabled: false, terminal: 'stop' })
  const result = await h.provider.reply([{ role: 'user', content: 'Add a test' }], undefined, undefined, context)
  assert.equal(result.text, text); assert.equal(result.suggestions, undefined); assert.equal(h.requests[0].tools, undefined)
})
test('mode/config changes cannot alter a prepared one-use request', async t => {
  const h = await fixture(t, tool({ text: 'Pinned structured result.', suggestions: [proposal()] })), prepared = h.provider.prepareReply()
  h.provider.setSuggestionsEnabled(false)
  const result = await prepared.reply([{ role: 'user', content: 'Add a test' }], undefined, undefined, context)
  assert.equal(prepared.suggestionsEnabled, true); assert.equal(h.provider.status().suggestionsEnabled, false)
  assert.equal(result.suggestions.length, 1); assert.equal(h.requests.length, 1)
  await assert.rejects(prepared.reply([]), error => error.code === 'request_already_used')
  assert.equal(h.requests.length, 1); assert.equal(JSON.parse(readFileSync(h.file, 'utf8')).apiKey, h.key)
})
test('unsupported tools fail once without an automatic plain request', async t => {
  const h = await fixture(t, [], { status: 400 })
  await assert.rejects(h.provider.reply([{ role: 'user', content: 'hello' }]), error => error.code === 'provider_error')
  assert.equal(h.requests.length, 1)
})
test('the preference sidecar leaves legacy strict model configuration bytes and keys compatible', async t => {
  const h = await fixture(t, [], { enabled: false })
  const config = JSON.parse(readFileSync(h.file, 'utf8')); delete config.suggestionsEnabled
  writeFileSync(h.file, JSON.stringify(config))
  const before = readFileSync(h.file)
  assert.equal(h.provider.setSuggestionsEnabled(true).suggestionsEnabled, true)
  assert.deepEqual(readFileSync(h.file), before)
  const sidecar = `${h.file}.assistant-settings.json`
  assert.equal(statSync(sidecar).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(sidecar, 'utf8')), { protocol: 'assistant-suggestion-settings/1', enabled: true })
  h.provider.selectModel('fixture-model')
  assert.equal('suggestionsEnabled' in JSON.parse(readFileSync(h.file, 'utf8')), false)
  assert.equal(h.provider.status().suggestionsEnabled, true); assert.equal(h.requests.length, 0)
})
