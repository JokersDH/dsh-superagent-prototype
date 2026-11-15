import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tool = join(repoRoot, 'packages/context/tools/wave31-completion-history.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
const principal = { userId: 'wave31-reopen-user', authorityRef: 'wave31-reopen-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

function facts(database: string, workId: string, projectId: string): Record<string, any> {
  const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tool,
    '--a-worktree', aWorktree, '--db', database, '--work', workId, '--project', projectId], { encoding: 'utf8', timeout: 60000 })
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`reopen flow timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('two projects reopen from the same store with their works, conversations and previews intact', { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-reopen-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const paths = [join(root, 'project-a'), join(root, 'project-b')]
  const records = paths.map((path, index) => {
    ensureStarterProject(path)
    const record = registry.prepare({ path, displayName: `wave31-reopen-${index}`, check: 'node_test' })
    registry.save(record)
    return record
  })
  const database = join(stateRoot, 'state.sqlite')
  const projects = records.map((record) => ({ id: record.id, displayName: record.displayName,
    scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }))
  const createdIds: string[] = []
  {
    const store = new ProductStore({ path: database })
    const product = createProductRuntime({ store, stateRoot, scratchProject: paths[0]!, projectRegistry: registry,
      projects, principal, actionSecret: Buffer.alloc(32, 15) })
    const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
      allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
    product.start()
    try {
      for (const [index, record] of records.entries()) {
        const preview = (await (await app.request(`/v1/projects/${record.id}/recipes/preview`, { method: 'POST', headers,
          body: JSON.stringify({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })).json()) as Record<string, any>
        assert.equal(preview.status, 'draft')
        const command = { kind: 'create_work', commandId: `w31-reopen-create-${index}`, conversationId: `w31-reopen-chat-${index}`, ...preview.fields }
        const first = (await product.application.dispatch(command as never, actor)) as unknown as { workId: string }
        const replay = (await product.application.dispatch(command as never, actor)) as unknown as { workId: string }
        assert.equal(replay.workId, first.workId)
        const work = await until(async () => (await product.application.inspect({ workId: first.workId })).works[0],
          (value) => value !== undefined && value.actions.available.includes('accept_candidate'))
        await product.application.dispatch({ kind: 'accept_candidate', commandId: `w31-reopen-accept-${index}`,
          conversationId: `w31-reopen-chat-${index}`, candidate: work!.actions.currentCandidate! }, actor)
        assert.equal((await product.application.inspect({ workId: first.workId })).works[0]?.phase, 'delivered')
        createdIds.push(first.workId)
      }
    } finally { await product.close().catch(() => undefined); store.close() }
  }

  // Reopen the same store in a fresh runtime: works, conversations and per-project facts survive.
  const store = new ProductStore({ path: database })
  const product = createProductRuntime({ store, stateRoot, scratchProject: paths[0]!, projectRegistry: registry,
    projects, principal, actionSecret: Buffer.alloc(32, 15) })
  t.after(async () => { await product.close().catch(() => undefined); store.close(); rmSync(root, { recursive: true, force: true }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  const snapshot = (await (await app.request('/v1/snapshot', { headers })).json()) as { works: { work: { id: string; projectId: string }; phase: string }[] }
  assert.equal(snapshot.works.length, 2)
  assert.deepEqual(snapshot.works.map((work) => work.work.id).sort(), [...createdIds].sort())
  assert.equal(snapshot.works.every((work) => work.phase === 'delivered'), true)
  const conversations = (await (await app.request('/v1/conversations', { headers })).json()) as { conversations: { id: string; projectId: string }[] }
  for (const [index, record] of records.entries()) {
    assert.equal(conversations.conversations.some((conversation) => conversation.id === `w31-reopen-chat-${index}` && conversation.projectId === record.id), true)
  }
  for (const [index, record] of records.entries()) {
    const workFacts = facts(database, createdIds[index]!, record.id)
    assert.equal(workFacts.status, 'ok')
    assert.equal(workFacts.completion.reviews.length, 1)
    assert.equal(workFacts.completion.reviews[0].canonical, true)
    assert.equal(workFacts.completion.acceptances.length, 1)
    const evidence = (await (await app.request(`/v1/works/${createdIds[index]}/evidence`, { headers })).json()) as Record<string, any>
    assert.equal(evidence.workId, createdIds[index])
  }
  // A reopened preview stays read-only, and the duplicate command keeps the original work identity.
  const worksBefore = (await (await app.request('/v1/snapshot', { headers })).json() as { works: unknown[] }).works.length
  for (const record of records) {
    const preview = (await (await app.request(`/v1/projects/${record.id}/recipes/preview`, { method: 'POST', headers,
      body: JSON.stringify({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })).json()) as Record<string, any>
    assert.equal(preview.authorization, 'none')
  }
  assert.equal((await (await app.request('/v1/snapshot', { headers })).json() as { works: unknown[] }).works.length, worksBefore)
  // Reusing the command id with a different immutable body is refused instead of replacing the original Work.
  await assert.rejects(() => Promise.resolve(product.application.dispatch({ kind: 'create_work', commandId: 'w31-reopen-create-0',
    conversationId: 'w31-reopen-chat-0', projectId: records[0]!.id, goal: '另一个目标', profileId: 'profile-fixture-pass',
    scope: { projectId: records[0]!.id, allowedPaths: ['src/'], excludedPaths: ['src/'], externalActions: [] },
    criteria: [{ id: 'fixed-output', kind: 'machine', required: true, description: 'Output matches the registered check', checkDefinitionRef: 'check-fixture-output' }] } as never, actor)),
  /another immutable request/)
  assert.equal((await (await app.request('/v1/snapshot', { headers })).json() as { works: unknown[] }).works.length, worksBefore)
})
