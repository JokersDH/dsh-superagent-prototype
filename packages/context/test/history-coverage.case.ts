import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeHistoryWindow, normalizeSourceState } from '../tools/history-coverage.mjs'

test('history coverage never turns an unknown upstream state into a complete slice', () => {
  const complete = composeHistoryWindow({ sourceState: 'complete', total: 1, offset: 0, limit: 10 })
  assert.equal(complete.state, 'complete')
  assert.equal(complete.complete, true)
  assert.equal(complete.availableKnown, true)
  assert.equal(complete.available, 1)
  assert.equal(complete.truncated, false)

  const local = composeHistoryWindow({ sourceState: 'complete', total: 3, offset: 1, limit: 1 })
  assert.equal(local.state, 'truncated_local')
  assert.equal(local.complete, false)
  assert.equal(local.availableKnown, true)
  assert.equal(local.nextOffset, 2)
  assert.equal(local.truncated, true)

  const capped = composeHistoryWindow({ sourceState: 'truncated', total: 50, offset: 0, limit: 5000 })
  assert.equal(capped.state, 'truncated_source')
  assert.equal(capped.complete, false)
  assert.equal(capped.availableKnown, false)
  assert.equal(capped.available, null)
  assert.equal(capped.truncated, true)

  for (const unknown of [undefined, null, '', 'unknown', 'partial', 'COMPLETE']) {
    const value = composeHistoryWindow({ sourceState: unknown as never, total: 2, offset: 0, limit: 10 })
    assert.equal(value.state, 'unknown', String(unknown))
    assert.equal(value.complete, false, String(unknown))
    assert.equal(value.availableKnown, false, String(unknown))
    assert.equal(value.available, null, String(unknown))
    assert.equal(value.returned, 2)
  }
  assert.equal(normalizeSourceState('truncated'), 'truncated')
  assert.equal(normalizeSourceState('weird'), 'unknown')
})
