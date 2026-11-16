import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  trialConnectionMessage, trialModelConnectionDraft, trialModelConnectionFallback,
} from '../../src/trial/model-connection.ts'

const enabled = { enabled: true } as const
const base = { endpoint: 'https://api.example.test/v1', model: 'reasoner', apiKey: 'sk-local-example' }

test('a complete configuration becomes only a transient draft', () => {
  const result = trialModelConnectionDraft(base, enabled)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.draft, base)
})

test('values are trimmed without changing the secret semantics', () => {
  const result = trialModelConnectionDraft({ endpoint: ' https://api.example.test/v1 ', model: ' m1 ', apiKey: ' key ' }, enabled)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.draft.endpoint, 'https://api.example.test/v1')
  assert.equal(result.draft.model, 'm1')
  assert.equal(result.draft.apiKey, ' key ')
})

test('an unavailable entry never validates or echoes typed fields', () => {
  const result = trialModelConnectionDraft(base, { enabled: false, reason: '当前设置不支持连接模型' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.failure.kind, 'unavailable')
  assert.equal(result.failure.message, '当前设置不支持连接模型')
})

test('missing, malformed and overlong endpoint fields are refused', () => {
  const cases = [
    { ...base, endpoint: '' },
    { ...base, endpoint: 'api.example.test' },
    { ...base, endpoint: 'ftp://api.example.test/v1' },
    { ...base, endpoint: `https://api.example.test/${'a'.repeat(600)}` },
  ]
  for (const input of cases) {
    const result = trialModelConnectionDraft(input, enabled)
    assert.equal(result.ok, false)
    if (!result.ok && result.failure.kind === 'invalid') assert.equal(result.failure.field, 'endpoint')
  }
})

test('remote plain HTTP and embedded credentials are refused', () => {
  const remote = trialModelConnectionDraft({ ...base, endpoint: 'http://api.example.test/v1' }, enabled)
  assert.equal(remote.ok, false)
  if (!remote.ok && remote.failure.kind === 'invalid') assert.equal(remote.failure.field, 'endpoint')
  const credentials = trialModelConnectionDraft({ ...base, endpoint: 'https://user:pass@api.example.test/v1' }, enabled)
  assert.equal(credentials.ok, false)
  const loopback = trialModelConnectionDraft({ ...base, endpoint: 'http://127.0.0.1:8080/v1' }, enabled)
  assert.equal(loopback.ok, true)
})

test('model and secret fields are bounded and newlines are removed from the key', () => {
  const noModel = trialModelConnectionDraft({ ...base, model: ' ' }, enabled)
  assert.equal(noModel.ok, false)
  const longModel = trialModelConnectionDraft({ ...base, model: 'm'.repeat(129) }, enabled)
  assert.equal(longModel.ok, false)
  const noKey = trialModelConnectionDraft({ ...base, apiKey: '' }, enabled)
  assert.equal(noKey.ok, false)
  const hugeKey = trialModelConnectionDraft({ ...base, apiKey: 'k'.repeat(4097) }, enabled)
  assert.equal(hugeKey.ok, false)
  const newline = trialModelConnectionDraft({ ...base, apiKey: 'line1\nline2' }, enabled)
  assert.equal(newline.ok, true)
  if (newline.ok) assert.equal(newline.draft.apiKey, 'line1line2')
})

test('feedback containing the submitted secret is refused rather than partially redacted', () => {
  const message = trialConnectionMessage('failed for key sk-local-example', base.apiKey)
  assert.equal(message, trialModelConnectionFallback)
})

test('feedback strips token-shaped values, absolute paths and stack frames', () => {
  const message = trialConnectionMessage('token=abc123 at connect (/srv/app.ts:12) /Users/me/.config/key')
  assert.equal(message.includes('abc123'), false)
  assert.equal(message.includes('/Users/me'), false)
  assert.equal(message.includes('/srv/app.ts'), false)
  assert.equal(message.length <= 241, true)
})

test('absent or empty feedback uses fixed copy and long text is bounded', () => {
  assert.equal(trialConnectionMessage(undefined, 's'), trialModelConnectionFallback)
  assert.equal(trialConnectionMessage('   ', 's'), trialModelConnectionFallback)
  const long = trialConnectionMessage('连接失败'.repeat(120), 's')
  assert.equal(long.length <= 241, true)
  assert.equal(long.endsWith('…'), true)
})
