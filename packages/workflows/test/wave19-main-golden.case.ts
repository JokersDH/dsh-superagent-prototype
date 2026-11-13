/**
 * Wave-19 A2: consume main's genuine v1 golden. The recorded source/dist hashes, the 13-family
 * historical set and the old digest are read from the fixture; this package's own v1 recipe must
 * name exactly those families, while an explicit v2 snapshot uses the 21-family set.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { WorkflowSnapshots } from '../src/index.ts'

const golden = JSON.parse(readFileSync(new URL('../../../tests/integration/fixtures/genuine-v1-evidence.json', import.meta.url), 'utf8'))

test('main genuine v1 golden matches this package v1 family set while explicit v2 stays separate', async () => {
  assert.equal(golden.protocol, 'genuine-main-v1-evidence-golden/1')
  assert.equal(golden.snapshotProtocol, 'workflow-snapshot/1')
  assert.equal(golden.originalCreated, 'ok')
  assert.equal(golden.originalVerified, 'ok')
  assert.equal(golden.modelCalls, 0)
  assert.equal(golden.nativeTurns, 0)
  assert.equal(golden.containsDatabase, false)
  assert.match(golden.producer.source, /^[a-f0-9]{40}$/u)
  assert.equal(golden.producer.files['packages/storage/src/backup.ts'].length, 64)
  assert.equal(golden.producer.files['packages/workflows/src/snapshot.ts'].length, 64)
  assert.equal(golden.evidence.protocol, 'workflow-evidence/1')
  assert.equal(golden.evidence.familySetVersion, undefined)
  assert.equal(golden.evidence.families.length, 13)
  assert.equal(golden.evidence.digest, 'e339e38272cdadaf38059ffeea18476a10c839e78427c30940371395c49de4cd')
  assert.equal(golden.evidence.complete, true)

  const root = mkdtempSync(join(tmpdir(), 'wave19-main-golden-')), store = new ProductStore({ path: join(root, 'state.sqlite') })
  try {
    const v1 = await new WorkflowSnapshots(store).create({ destination: join(root, 'v1') })
    assert.equal(v1.status, 'ok', v1.message)
    assert.deepEqual(v1.manifest.evidence.families.map(family => family.name), golden.evidence.families.map((family: any) => family.name))
    assert.equal(v1.manifest.evidence.digest.length, 64)
    const v2 = await new WorkflowSnapshots(store).create({ destination: join(root, 'v2'), formatVersion: 2 })
    assert.equal(v2.status, 'ok', v2.message)
    assert.equal(v2.manifest.evidence.families.length, 21)
    assert.equal(v2.manifest.evidence.familySetVersion, 2)
    assert.equal(new WorkflowSnapshots(store).verify(join(root, 'v1')).status, 'ok')
    assert.equal(new WorkflowSnapshots(store).verify(join(root, 'v2')).status, 'ok')
    assert.equal(new WorkflowSnapshots(store).verify(join(root, 'v1')).manifestPath.endsWith('v1/snapshot.json'), true)
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
