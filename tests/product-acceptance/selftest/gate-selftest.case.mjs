import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gateSelftestCases } from './gate.mjs'
import { STATUS } from '../lib/status.mjs'

/**
 * Standalone developer entry: `node --test tests/product-acceptance/selftest/gate-selftest.case.mjs`.
 * The same cases are collected into the release report by `run.mjs`; this wrapper only makes a local
 * red/green loop possible without writing a report.
 */
test('release gate rejects every constructed defect', async () => {
  const cases = await gateSelftestCases()
  const failed = cases.filter((item) => item.status !== STATUS.PASS)
  assert.deepEqual(
    failed.map((item) => `${item.id}: ${item.reason ?? 'unknown'}`),
    [],
    `${cases.length} gate self-tests must all pass`,
  )
  assert.ok(cases.length >= 20, 'The gate self-test set must stay broad')
})
