/** Wave-19 A2: consume main's genuine v1 golden instead of relabeling a v2 snapshot. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore, readWorkflowEvidence } from '@personal-agent/storage'
import { WorkflowSnapshots } from '../src/index.ts'

const golden = JSON.parse(readFileSync(join(import.meta.dirname, '../../../tests/integration/fixtures/genuine-v1-evidence.json'), 'utf8')) as any

test('the genuine main v1 golden matches the legacy recipe and differs from explicit v2 only where versioned', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wave19-golden-'))
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  try {
    const bundle = store.artifacts.write(Buffer.from(golden.fixture.bundleText))
    store.artifacts.insert(bundle)
    store.workflows.assistant.contextBindings.put({
      ...golden.fixture.binding,
      bundleRef: bundle.id,
      bundleDigest: bundle.digest,
    })
    const v1Evidence = readWorkflowEvidence(join(root, 'state.sqlite'), 1)
    assert.equal(v1Evidence.protocol, 'workflow-evidence/1')
    assert.equal(v1Evidence.digest, golden.evidence.digest)
    assert.deepEqual(v1Evidence.families, golden.evidence.families)
    assert.equal(v1Evidence.families.find(family => family.name === 'assistant_context_bindings')?.digest,
      '51d53c57b7d4be9c586f5b6a255a9d8f6bbd8db64c71f3e032e70a2df6cce7dd')

    const v1 = await new WorkflowSnapshots(store).create({ destination: join(root, 'v1') })
    assert.equal(v1.status, 'ok', v1.message)
    assert.equal(v1.manifest.evidence.protocol, 'workflow-evidence/1')
    assert.equal(v1.manifest.evidence.digest, golden.evidence.digest)
    assert.equal(new WorkflowSnapshots(store).verify(join(root, 'v1')).status, 'ok')

    const v2Evidence = readWorkflowEvidence(join(root, 'state.sqlite'), 2)
    assert.equal(v2Evidence.protocol, 'workflow-evidence/2')
    assert.equal(v2Evidence.families.length, 21)
    assert.notEqual(v2Evidence.families.find(family => family.name === 'assistant_context_bindings')?.digest,
      v1Evidence.families.find(family => family.name === 'assistant_context_bindings')?.digest)
    const v2 = await new WorkflowSnapshots(store).create({ destination: join(root, 'v2'), formatVersion: 2 })
    assert.equal(v2.status, 'ok', v2.message)
    assert.equal(new WorkflowSnapshots(store).verify(join(root, 'v2')).status, 'ok')
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
