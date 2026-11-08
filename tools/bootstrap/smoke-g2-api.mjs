import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:8787' },
    state: { type: 'string', default: '.local-state/http-demo' },
  },
})
const base = values.base,
  token = readFileSync(resolve(values.state, 'api.key'), 'utf8')
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    if ((await fetch(base + '/v1/health', { signal: AbortSignal.timeout(1000) })).ok) break
  } catch {}
  await delay(100)
}
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const dispatch = async (command) => {
  const response = await fetch(base + '/v1/commands', {
    method: 'POST',
    headers,
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3000),
  })
  assert.equal(response.status, 200)
  return response.json()
}
const command = JSON.parse(
  readFileSync(new URL('../../packages/application/fixtures/create-work.json', import.meta.url), 'utf8'),
)
command.commandId = 'smoke-' + randomUUID()
const first = await dispatch(command),
  again = await dispatch(command)
assert.equal(first.status, 'recorded')
assert.deepEqual(again, first)
const snapshot = await (
  await fetch(base + '/v1/snapshot?conversationId=conversation-main', { headers, signal: AbortSignal.timeout(3000) })
).json()
assert.ok(snapshot.works.some((work) => work.work.id === first.workId))
const stopped = await dispatch({
  kind: 'stop_work',
  commandId: 'stop-' + randomUUID(),
  conversationId: command.conversationId,
  workId: first.workId,
})
assert.equal(stopped.status, 'recorded')
console.log(
  JSON.stringify(
    {
      status: 'PASS_LOOPBACK_API_SANDBOX',
      base,
      mode: 'fixture',
      durableReceiptReplayed: true,
      createInspectStop: true,
      vendorCalls: 0,
    },
    null,
    2,
  ),
)
