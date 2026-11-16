/** Wave-32 A: two original projects complete through the current product chain and reopen with original IDs. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'

const principal = { userId: 'wave32-user', authorityRef: 'wave32-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const until = async <T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 60000): Promise<T> => {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) { latest = await read(); if (predicate(latest)) return latest; await new Promise(resolve => setTimeout(resolve, 25)) }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('two original projects complete and reopen with their Work/contract/candidate/artifact/receipt facts', { timeout: 120000 }, async t => {
  const root = mkdtempSync(join('/tmp', 'pa-wave32-two-')), stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const records = ['alpha', 'beta'].map(name => {
    const path = join(root, name); ensureStarterProject(path)
    const record = registry.prepare({ path, displayName: name, check: 'node_test' }); registry.save(record); return record
  })
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({ store, stateRoot, scratchProject: records[0]!.path, projectRegistry: registry,
    projects: records.map(record => ({ id: record.id, displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })), principal, actionSecret: Buffer.alloc(32, 11) })
  const completed: { projectId: string; workId: string; contractDigest: string; createId: string; acceptId: string }[] = []
  try {
    product.start()
    for (const index of [0, 1] as const) {
      const projectId = records[index]!.id
      const preview = await product.read.projectRecipePreview!({ projectId, kind: index ? 'verification_followup' : 'scoped_change',
        allowedPaths: ['src/'], profileId: 'profile-fixture-pass' })
      assert.equal(preview.status, 'draft', JSON.stringify(preview))
      const fields = preview.fields
      if (!fields || !fields.projectId || !fields.goal || !fields.scope || !fields.criteria || !fields.profileId) throw new Error('preview fields are incomplete')
      const createId = `wave32-create-${index}`, acceptId = `wave32-accept-${index}`
      const created = await product.application.dispatch({ kind: 'create_work', commandId: createId, conversationId: `wave32-chat-${index}`, ...fields } as any, actor)
      assert.equal(created.status, 'recorded', JSON.stringify(created))
      const ready = await until(async () => (await product.application.inspect({ workId: created.workId })).works[0],
        work => work!.actions.available.includes('accept_candidate'))
      const candidate = ready!.actions.currentCandidate
      assert.ok(candidate)
      const accepted = await product.application.dispatch({ kind: 'accept_candidate', commandId: acceptId, conversationId: `wave32-chat-${index}`, candidate }, actor)
      assert.equal(accepted.status, 'recorded')
      completed.push({ projectId, workId: created.workId!, contractDigest: candidate.contract.digest, createId, acceptId })
    }
    store.queue.enqueue('application.execute', 'wave32-held', '{}', 1, 0, new Date().toISOString())
    await product.close(); store.close()

    store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
    for (const item of completed) {
      const work = store.workflows.index.work(item.workId, [item.projectId])!
      assert.equal(work.work.projectId, item.projectId)
      assert.equal(work.contract?.digest, item.contractDigest)
      assert.equal(work.completion.reviews.length >= 1, true)
      const review = work.completion.reviews[0]!
      const artifactDigest = String((review.proposal as any).artifactDigest)
      assert.match(artifactDigest, /^[a-f0-9]{64}$/)
      assert.equal(work.completion.verifications.some(value => value.artifactDigest === artifactDigest), true)
      assert.ok(review.artifactIds.length >= 1)
      for (const artifactId of review.artifactIds) {
        const artifact = store.artifacts.read(artifactId)
        assert.ok(artifact); assert.equal(artifact.record.bytes, artifact.data.byteLength)
        assert.equal(createHash('sha256').update(artifact.data).digest('hex'), artifact.record.digest)
      }
      assert.equal(store.commands.get(item.createId)?.status, 'recorded')
      assert.equal(store.commands.get(item.acceptId)?.status, 'recorded')
      const reader = spawnSync(process.execPath, [join(import.meta.dirname, 'fixtures', 'wave33-project-reader.mjs'), store.database.path,
        item.workId, item.projectId, item.createId, item.acceptId], { encoding: 'utf8', timeout: 20000 })
      assert.equal(reader.status, 0, reader.stderr || reader.stdout)
      const reopened = JSON.parse(reader.stdout)
      assert.notEqual(reopened.pid, process.pid); assert.equal(reopened.workId, item.workId)
      assert.equal(reopened.receipts.create, 'recorded'); assert.equal(reopened.receipts.accept, 'recorded')
      assert.equal(reopened.artifacts.length, review.artifactIds.length)
      assert.equal(reopened.artifacts.every((value: any) => value.bytes > 0 && value.digest.length === 64), true)
    }
    assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 20).some(row => row.key === 'wave32-held'), true)

    const cRoot = process.env.PA_C_WORKTREE ?? '/Users/hh/Desktop/joker/superagent-agent-c'
    const driver = join(cRoot, 'packages/context/tools/wave30-completion-history.mjs')
    if (existsSync(driver)) {
      for (const item of completed) {
        const run = spawnSync(process.execPath, [driver, '--a-worktree', join(import.meta.dirname, '../../..'), '--db', store.database.path,
          '--work', item.workId, '--project', item.projectId, '--limit', '10'], { encoding: 'utf8', timeout: 20000 })
        assert.equal(run.status, 0, run.stderr || run.stdout)
        const value = JSON.parse(run.stdout)
        assert.equal(value.status, 'ok'); assert.equal(value.workId, item.workId); assert.equal(value.projectId, item.projectId)
        assert.equal(value.coverage.reviews.returned >= 1, true)
      }
    }
    console.log('WAVE32_TWO_PROJECT_REOPEN', JSON.stringify({ works: completed.map(item => ({ projectId: item.projectId, workId: item.workId,
      contractDigest: item.contractDigest })), heldQueue: true }))
  } finally {
    await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  }
})
