import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectRegistrationInput } from '@personal-agent/contracts'
import { HttpTransport, TransportError } from '../src/transport.ts'
import { fixtureConfiguration } from '../src/fixture.ts'

test('project import posts only the explicit operator settings and parses configuration', async (t) => {
  const original = globalThis.fetch
  const requests: { input: string; init: RequestInit | undefined }[] = []
  const configuration = fixtureConfiguration()
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init })
    return new Response(JSON.stringify(configuration), { status: 200 })
  }
  t.after(() => {
    globalThis.fetch = original
  })
  const input: ProjectRegistrationInput = {
    path: '/tmp/native-transport',
    displayName: 'Native transport',
    check: 'node_test',
  }
  const result = await new HttpTransport('http://127.0.0.1:9999').registerProject(input)
  assert.deepEqual(result, configuration)
  assert.equal(requests[0]?.input, 'http://127.0.0.1:9999/v1/projects')
  assert.equal(requests[0]?.init?.method, 'POST')
  assert.equal(requests[0]?.init?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), input)
})

test('an import cannot forward private credentials or actor fields', async (t) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response('{}')
  }
  t.after(() => {
    globalThis.fetch = original
  })
  const input = {
    path: '/tmp/native-transport',
    check: 'node_test',
    apiKey: 'unexpected-private-field',
  } as unknown as ProjectRegistrationInput
  await assert.rejects(new HttpTransport().registerProject(input))
  assert.equal(calls, 0)
})

test('work location validates the public shape and encodes the work identity', async (t) => {
  const original = globalThis.fetch
  const location = { projectPath: '/tmp/original', workspacePath: '/tmp/attempt', baseCommit: 'a'.repeat(40) }
  let requested = ''
  globalThis.fetch = async (input) => {
    requested = String(input)
    return new Response(JSON.stringify(location))
  }
  t.after(() => {
    globalThis.fetch = original
  })
  assert.deepEqual(await new HttpTransport().workLocation('work:one'), location)
  assert.equal(requested, '/v1/works/work%3Aone/location')
  globalThis.fetch = async () => new Response(JSON.stringify({ ...location, credentialPath: '/private/not-public' }))
  await assert.rejects(new HttpTransport().workLocation('work:one'))
})

test('an unavailable location reader degrades but authentication failures remain explicit', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 'unsupported_capability', message: 'Unavailable', retry: 'none' } }), {
      status: 422,
    })
  t.after(() => {
    globalThis.fetch = original
  })
  assert.equal(await new HttpTransport().workLocation('work-one'), undefined)
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Sign in', retry: 'user_action' } }), {
      status: 401,
    })
  await assert.rejects(
    new HttpTransport().workLocation('work-one'),
    (error) => error instanceof TransportError && error.code === 'auth_required',
  )
})
