import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConversationCommand, ProjectRegistrationInput, ProjectSettingsCommand, VerificationRetryCommand } from '@personal-agent/contracts'
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

test('verification status refuses another work and recovery requires its matching receipt', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const command: VerificationRetryCommand = { kind: 'retry_verification', commandId: 'recheck-one',
    conversationId: 'conversation-one', candidate: { ticketId: 'ticket-one', assignmentId: 'assignment-one',
      contract: { workId: 'work-one', revision: 1, digest: 'a'.repeat(64) }, candidateGeneration: 1 }, blockedId: 'block-one' }
  const status = { protocol: 'work-verification/1', workId: 'work-one', state: 'blocked', candidate: command.candidate,
    failure: { id: command.blockedId, code: 'storage_unavailable', failureCount: 3 }, retryAvailable: true }
  globalThis.fetch = async () => new Response(JSON.stringify({ ...status, workId: 'another-work', candidate: undefined }))
  await assert.rejects(new HttpTransport().workVerification('work-one'))
  const requests: { input: string; init: RequestInit | undefined }[] = []
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init })
    return new Response(JSON.stringify(init?.method === 'POST'
      ? { status: 'recorded', commandId: command.commandId, workId: 'work-one', seq: 1 } : status))
  }
  assert.deepEqual(await new HttpTransport().workVerification('work-one'), status)
  assert.equal((await new HttpTransport().retryVerification(command)).status, 'recorded')
  assert.equal(requests[1]?.input, '/v1/works/work-one/verification/retry')
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), command)
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'recorded', commandId: 'wrong-command', seq: 1 }))
  await assert.rejects(new HttpTransport().retryVerification(command), error => error instanceof TransportError && error.code === 'schema_mismatch')
})

test('older backend may omit the optional status route, while malformed results and auth failures stay explicit', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response('404 Not Found', { status: 404 })
  assert.equal(await new HttpTransport().workVerification('work-one'), undefined)
  globalThis.fetch = async () => new Response('', { status: 200 })
  await assert.rejects(new HttpTransport().workVerification('work-one'))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Sign in', retry: 'user_action' } }), { status: 401 })
  await assert.rejects(new HttpTransport().workVerification('work-one'), error => error instanceof TransportError && error.code === 'auth_required')
})

test('conversation transport encodes filters, validates commands and preserves backend capability errors', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const requests: { input: string; init: RequestInit | undefined }[] = []
  const command: ConversationCommand = { kind: 'rename_conversation', commandId: 'rename-one', conversationId: 'conversation-one', expectedTitleRevision: 1, title: '方案终稿' }
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init })
    return new Response(JSON.stringify(init?.method === 'POST' ? { status: 'recorded', commandId: command.commandId, seq: 1 }
      : { protocol: 'conversation-catalog/1', conversations: [], hasMore: false }))
  }
  await new HttpTransport().conversations({ query: '方案', includeArchived: true, limit: 30 })
  assert.equal(new URL(requests[0]!.input, 'http://localhost').searchParams.get('query'), '方案')
  assert.equal(new URL(requests[0]!.input, 'http://localhost').searchParams.get('includeArchived'), 'true')
  assert.equal((await new HttpTransport().conversationCommand(command)).status, 'recorded')
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), command)
  globalThis.fetch = async () => new Response('404 Not Found', { status: 404 })
  assert.equal(await new HttpTransport().conversations({}), undefined)
  globalThis.fetch = async () => new Response('{}', { status: 200 })
  await assert.rejects(new HttpTransport().conversations({}))
})

test('project settings transport preserves immutable command identity and rejects misbound results', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const version = { projectId: 'project-one', revision: 1, digest: 'a'.repeat(64), displayName: 'Project', check: 'node_test', environment: { policy: 'existing_only' }, checkDefinitionRef: 'check-one', createdAt: '2026-11-10T00:00:00.000Z' }
  const page = { protocol: 'project-settings/1', current: { ...version, archived: false, archiveRevision: 0 }, history: [version] }
  globalThis.fetch = async () => new Response(JSON.stringify(page))
  assert.deepEqual(await new HttpTransport().projectSettings('project-one'), page)
  await assert.rejects(new HttpTransport().projectSettings('project-other'))
  const command: ProjectSettingsCommand = { kind: 'archive_project', commandId: 'archive-one', projectId: 'project-one', expectedArchiveRevision: 0, archived: true }
  let requested = ''
  globalThis.fetch = async (input, init) => { requested = String(input); assert.deepEqual(JSON.parse(String(init?.body)), command); return new Response(JSON.stringify({ commandId: command.commandId, seq: 1, status: 'recorded' })) }
  assert.equal((await new HttpTransport().projectSettingsCommand(command)).status, 'recorded')
  assert.equal(requested, '/v1/projects/project-one/settings')
  globalThis.fetch = async () => new Response(JSON.stringify({ commandId: 'wrong-command', seq: 1, status: 'recorded' }))
  await assert.rejects(new HttpTransport().projectSettingsCommand(command), error => error instanceof TransportError && error.code === 'schema_mismatch')
})
