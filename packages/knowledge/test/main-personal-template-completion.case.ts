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
const factsTool = join(repoRoot, 'packages/context/tools/wave29-completion-facts.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
const principal = { userId: 'template-user', authorityRef: 'template-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise((done) => setTimeout(done, 20)) }
  throw new Error('work did not reach the expected state')
}

test('a registered project recipe enters the original form/create/accept flow and A completion facts read it', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave29-template-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const path = join(root, 'project')
  ensureStarterProject(path)
  const record = registry.prepare({ path, displayName: 'template', check: 'node_test' })
  registry.save(record)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({
    store, stateRoot, scratchProject: path, projectRegistry: registry,
    projects: [{ id: record.id, displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }],
    principal, actionSecret: Buffer.alloc(32, 11),
  })
  t.after(async () => { await product.close().catch(() => undefined); store.close(); rmSync(root, { recursive: true, force: true }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  const input = { projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }
  const preview = await (await app.request(`/v1/projects/${record.id}/recipes/preview`, { method: 'POST', headers, body: JSON.stringify(input) })).json()
  assert.equal(preview.status, 'draft', JSON.stringify(preview.issues))
  assert.equal(preview.authorization, 'none')
  assert.equal(preview.fields.projectId, record.id)
  assert.deepEqual(preview.fields.scope.allowedPaths, ['src/'])
  assert.equal(JSON.stringify(preview).includes(root), false)

  const created = await product.application.dispatch({ kind: 'create_work', commandId: 'template-create',
    conversationId: 'template-chat', ...preview.fields }, actor)
  assert.equal(created.status, 'recorded')
  const workId = (created as unknown as { workId: string }).workId
  const ready = await until(async () => (await product.application.inspect({ workId })).works[0], (work) => work !== undefined && work.actions.available.includes('accept_candidate'))
  if (!ready!.actions.currentCandidate) throw new Error('template work has no candidate')
  await product.application.dispatch({ kind: 'accept_candidate', commandId: 'template-accept',
    conversationId: 'template-chat', candidate: ready!.actions.currentCandidate }, actor)
  assert.equal((await product.application.inspect({ workId })).works[0]?.phase, 'delivered')
  await product.close()

  const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', factsTool,
    '--a-worktree', aWorktree, '--db', join(stateRoot, 'state.sqlite'), '--work', workId, '--project', record.id], { encoding: 'utf8', timeout: 60000 })
  const facts = JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
  assert.equal(facts.status, 'ok')
  assert.equal(facts.contract.workId, workId)
  assert.equal(facts.completion.reviews.length, 1)
  assert.equal(facts.completion.reviews[0].canonical, true)
  assert.equal(facts.completion.verifications.length >= 1, true)
  assert.equal(facts.completion.acceptances.length >= 1, true)
})
