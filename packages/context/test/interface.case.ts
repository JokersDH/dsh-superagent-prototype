import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ContextError,
  ContextRequestSchema,
  ContextGrantSchema,
  authorizeContextRequest,
  isDeniedPath,
  isExternalReference,
} from '../src/index.ts'
import { COMMIT, NOW, descriptor, makeGrant, makeRequest, staticPort } from './helpers.ts'

const now = new Date(NOW)

test('a valid conversation grant and request parse', () => {
  const request = makeRequest()
  assert.deepEqual(ContextRequestSchema.parse(request), request)
  assert.deepEqual(ContextGrantSchema.parse(makeGrant()), makeGrant())
})

test('executor workspace authorization cannot be reused for the main conversation', async () => {
  const request = makeRequest({ grant: makeGrant({ gateway: 'executor' }) })
  const port = staticPort([])
  await assert.rejects(authorizeContextRequest(request, port, now), (error: unknown) =>
    error instanceof ContextError && error.code === 'grant_gateway')
})

test('grant purpose must match the request purpose', async () => {
  const request = makeRequest({ purpose: 'work_authoring' })
  await assert.rejects(authorizeContextRequest(request, staticPort([]), now), (error: unknown) =>
    error instanceof ContextError && error.code === 'grant_purpose')
})

test('a grant or request cannot straddle projects', () => {
  const wrongGrant = () => makeGrant({ projectId: 'project-2' })
  assert.throws(() => ContextRequestSchema.parse(makeRequest({ grant: wrongGrant() })))
  const wrongScope = () => makeGrant({ scope: { ...makeGrant().scope, projectId: 'project-2' } })
  assert.throws(() => ContextGrantSchema.parse(wrongScope()))
})

test('an expired or future-confirmed grant is refused', async () => {
  const expired = makeRequest({ grant: makeGrant({ expiresAt: '2026-11-09T12:00:00.000Z' }) })
  await assert.rejects(authorizeContextRequest(expired, staticPort([]), now), (error: unknown) =>
    error instanceof ContextError && error.code === 'grant_expired')
  const future = makeRequest({ grant: makeGrant({ confirmedAt: '2026-11-11T00:00:00.000Z' }) })
  await assert.rejects(authorizeContextRequest(future, staticPort([]), now), (error: unknown) =>
    error instanceof ContextError && error.code === 'grant_unconfirmed')
})

test('denied account, credential, native-home and binary paths are refused', () => {
  for (const path of [
    '.env',
    'config/.env.local',
    '.git/config',
    '.ssh/id_rsa',
    '.codex/sessions/run.jsonl',
    '.claude/settings.json',
    'native-home/account.json',
    'node_modules/pkg/index.js',
    'secret.pem',
    'state.sqlite',
    '/etc/passwd',
    'src/../secret',
    'C:\\Users\\me\\key',
    'https://example.com/raw',
    '//host/share',
    'file:///tmp/x',
  ]) {
    assert.equal(isDeniedPath(path), true, `expected denied: ${path}`)
  }
  for (const path of ['src/app.ts', 'docs/guide.md', 'README.md', 'package.json', 'config/app.yaml']) {
    assert.equal(isDeniedPath(path), false, `expected allowed: ${path}`)
  }
  assert.equal(isExternalReference('http://example.com'), true)
  assert.equal(isExternalReference('src/app.ts'), false)
})

test('a grant containing a denied root is refused before listing', async () => {
  const request = makeRequest({
    grant: makeGrant({ scope: { ...makeGrant().scope, allowedPaths: ['.env', 'src'] } }),
  })
  await assert.rejects(authorizeContextRequest(request, staticPort([]), now), (error: unknown) =>
    error instanceof ContextError && error.code === 'denied_path')
})

test('a requested contract must be current and remain inside the grant scope', async () => {
  const contract = { workId: 'work-1', revision: 2, digest: 'b'.repeat(64) }
  const work = {
    workId: 'work-1',
    contract,
    scope: makeGrant().scope,
    title: 'Parser work',
    validity: 'current' as const,
  }
  const request = makeRequest({ workId: 'work-1', contract })
  await authorizeContextRequest(request, staticPort([], { works: [work] }), now)

  const stale = staticPort([], { works: [{ ...work, validity: 'stale' }] })
  await assert.rejects(authorizeContextRequest(request, stale, now), (error: unknown) =>
    error instanceof ContextError && error.code === 'contract_stale')

  const changed = staticPort([], { works: [{ ...work, contract: { ...contract, revision: 1 } }] })
  await assert.rejects(authorizeContextRequest(request, changed, now), (error: unknown) =>
    error instanceof ContextError && error.code === 'contract_stale')

  const foreign = staticPort([], {
    works: [{ ...work, scope: { ...work.scope, allowedPaths: ['everything'] } }],
  })
  await assert.rejects(authorizeContextRequest(request, foreign, now), (error: unknown) =>
    error instanceof ContextError && error.code === 'contract_scope')
})

test('a contract request needs a port that can verify it', async () => {
  const contract = { workId: 'work-1', revision: 1, digest: 'c'.repeat(64) }
  const base = staticPort([{ descriptor: descriptor('src/app.ts', 'export {}'), content: 'export {}' }])
  const port = {
    projectBaseline: (projectId: string) => base.projectBaseline(projectId),
    listSources: base.listSources.bind(base),
    readSource: base.readSource.bind(base),
  }
  await assert.rejects(authorizeContextRequest(makeRequest({ contract }), port, now), (error: unknown) =>
    error instanceof ContextError && error.code === 'unsupported_port')
})

test('descriptors carry provenance and never an absolute root', () => {
  const source = descriptor('src/app.ts', 'export const x = 1')
  assert.equal(source.baseline.contentDigest.length, 64)
  assert.equal(source.baseline.commit, COMMIT)
  assert.equal(source.baseline.digestScope, 'content')
})
