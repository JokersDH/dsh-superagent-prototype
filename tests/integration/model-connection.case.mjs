import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateModelProvider } from '../../apps/coordinator/product/model-provider.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const key = 'fixture-model-connection-secret', token = 'a'.repeat(64)
const input = { baseURL: 'https://gateway.invalid/v1', model: 'model-one', apiKey: key, allowInsecureHttp: false }
function fixture(t, startupMode = 'normal') {
  const root = mkdtempSync('/tmp/pa-connection-'), file = join(root, 'private/model.json')
  const provider = new PrivateModelProvider(file)
  const app = createLocalHttpApp({ application: {}, principal: { userId: 'model-user', authorityRef: 'model-authority' },
    apiToken: token, bootstrapToken: 'b'.repeat(64), mode: 'personal', startupMode,
    allowedOrigins: ['http://127.0.0.1:4100'], read: { configureAssistant: value => provider.configure(value), assistant: () => provider.status() } })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const post = (value = input, headers = {}) => app.request('http://127.0.0.1/v1/assistant/connection', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value),
  })
  return { root, file, provider, app, post }
}

test('authenticated configuration creates a private file and returns only sanitized configured status without a model request', async t => {
  const h = fixture(t), originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error('Saving must not contact a model') }
  try {
    assert.equal(h.provider.status().configured, false)
    const response = await h.post(), text = await response.text(), status = JSON.parse(text)
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(status.state, 'configured'); assert.equal(status.configured, true); assert.equal(requests, 0)
    assert.doesNotMatch(text, /fixture-model-connection-secret|model\.json/)
    assert.equal(lstatSync(h.file).mode & 0o777, 0o600); assert.equal(lstatSync(join(h.root, 'private')).mode & 0o777, 0o700)
    assert.equal(JSON.parse(readFileSync(h.file)).apiKey, key)
  } finally { globalThis.fetch = originalFetch }
})

test('saving preserves current allowed models and limits, replaces choices for another endpoint, and survives reopening', async t => {
  const h = fixture(t)
  await h.post()
  const config = JSON.parse(readFileSync(h.file)); config.maxOutputTokens = 256
  writeFileSync(h.file, JSON.stringify(config), { mode: 0o600 })
  assert.equal((await h.post({ ...input, model: 'model-two' })).status, 200)
  assert.deepEqual(h.provider.status().models, ['model-one', 'model-two'])
  assert.equal(JSON.parse(readFileSync(h.file)).maxOutputTokens, 256)
  assert.equal((await h.post({ ...input, baseURL: 'https://other.invalid/v1', model: 'other-model' })).status, 200)
  assert.deepEqual(new PrivateModelProvider(h.file).status().models, ['other-model'])
  assert.equal(new PrivateModelProvider(h.file).status().state, 'configured')
})

test('auth, origin, readonly, strict input and HTTP consent refuse before altering private configuration', async t => {
  const h = fixture(t)
  assert.equal((await h.post(input, { authorization: '' })).status, 401)
  assert.equal((await h.post(input, { origin: 'https://foreign.invalid' })).status, 403)
  assert.equal((await fixture(t, 'recovery_readonly').post()).status, 422)
  for (const value of [
    { ...input, path: '/private/injected' }, { ...input, apiKey: 'short' },
    { ...input, baseURL: 'http://gateway.invalid/v1' }, { ...input, baseURL: 'https://user:pass@gateway.invalid/v1' },
    { ...input, baseURL: 'https://gateway.invalid/v1?key=hidden' }, { ...input, model: key },
  ]) {
    const response = await h.post(value); assert.equal(response.status, 400)
    assert.equal((await response.text()).includes(key), false)
  }
  assert.equal(h.provider.status().configured, false)
  assert.equal((await h.post({ ...input, baseURL: 'http://gateway.invalid/v1', allowInsecureHttp: true })).status, 200)
  assert.equal(h.provider.status().secureTransport, false)
})

test('unsafe existing file, symlink and directory are retained unchanged', t => {
  const h = fixture(t); mkdirSync(join(h.root, 'private'), { mode: 0o700 })
  writeFileSync(h.file, JSON.stringify({ ...input, allowedModels: ['model-one'] }), { mode: 0o644 })
  const original = readFileSync(h.file, 'utf8')
  assert.throws(() => h.provider.configure(input)); assert.equal(readFileSync(h.file, 'utf8'), original)
  rmSync(h.file); const victim = join(h.root, 'victim'); writeFileSync(victim, 'preserve')
  symlinkSync(victim, h.file); assert.throws(() => h.provider.configure(input)); assert.equal(readFileSync(victim, 'utf8'), 'preserve')
  rmSync(h.file); chmodSync(join(h.root, 'private'), 0o755)
  assert.throws(() => h.provider.configure(input)); assert.equal(lstatSync(join(h.root, 'private')).mode & 0o777, 0o755)
})

test('a missing optional configuration port returns an explicit unsupported response', async () => {
  const app = createLocalHttpApp({ application: {}, principal: { userId: 'u', authorityRef: 'a' },
    apiToken: token, bootstrapToken: 'b'.repeat(64), mode: 'personal', allowedOrigins: [] })
  const response = await app.request('http://127.0.0.1/v1/assistant/connection', { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) })
  assert.equal((await response.json()).error.code, 'unsupported_capability')
})
