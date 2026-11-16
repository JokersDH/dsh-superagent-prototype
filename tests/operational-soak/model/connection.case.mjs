import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runModelConnection } from './connection2.mjs'

test('actual PrivateModelProvider saves only private config with no model request and refuses invalid inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-model-'))
  try {
    const report = await runModelConnection({ root })
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true)
    assert.deepEqual(failed, [], JSON.stringify({ failed, errors: report.errors }))
    assert.equal(report.networkFetches, 0)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.vendorTurns, 0)
    assert.equal(report.checks.privateFile0600, true)
    assert.equal(report.checks.privateDir0700, true)
    assert.equal(report.checks.apiKeyNotExposed, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
