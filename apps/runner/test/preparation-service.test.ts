import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunnerLink } from '../src/runner-link-client.ts'
import { endpointDirectory } from '../src/recovery-endpoint.ts'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

const entry = fileURLToPath(new URL('./fixtures/preparation-worker.ts', import.meta.url))
async function until<T>(read: () => T | Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = await read()
    if (predicate(value)) return value
    if (Date.now() > deadline) throw new Error('Preparation condition timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
async function fixture(t: TestContext, mode = 'short') {
  const root = mkdtempSync('/tmp/pa-runner-preparation-'), workspace = join(root, 'workspace'), recovery = join(root, 'recovery')
  mkdirSync(workspace)
  let grant!: () => void
  const permitted = new Promise<void>(resolve => { grant = resolve })
  const spec = makeAttemptSpec()
  const producer = { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, runnerIdentityRef: 'preparation-host', source: 'preparation-test' }
  const link = new RunnerLink({
    executable: process.execPath, entry, args: [mode], stateRoot: join(root, 'state'),
    env: { PA_PREPARATION_WORKSPACE: workspace, PA_PREPARATION_RECOVERY: recovery },
    producer,
    payloads: { read: async () => { await permitted; return { allowed: true } } },
  })
  const child = await link.spawnAttempt(spec, async fact => ({ factId: fact.factId, persisted: true, seq: 1 }))
  t.after(async () => { grant(); await child.close(); rmSync(root, { recursive: true, force: true }) })
  const directory = endpointDirectory(recovery, spec.attemptId), socket = join(directory, 'runner.sock'), stat = lstatSync(socket)
  const client = connectRunnerRecovery({ socketPath: socket, credentialPath: join(directory, 'runner.credential'), socketIdentity: { dev: stat.dev, ino: stat.ino } }, producer)
  return { root, workspace, client, child, grant, spec }
}
test('independent Runner exposes recovery before preparation and holds every writer until the grant is received', { timeout: 10000 }, async t => {
  const h = await fixture(t)
  const before = verifiedRunnerInspection(await h.client.inspect()).value
  assert.equal(before.resources.length, 0)
  assert.equal(existsSync(join(h.workspace, 'prepared')), false)
  assert.equal(existsSync(join(h.workspace, 'native-started')), false)
  h.grant()
  await until(() => existsSync(join(h.workspace, 'native-started')), Boolean)
  assert.equal(readFileSync(join(h.workspace, 'prepared'), 'utf8'), 'yes')
  const after = verifiedRunnerInspection(await h.client.inspect()).value
  assert.equal(after.resources.length, 1)
  assert.equal(after.resources[0]?.writer, 'quiescent')
})
test('recovery cancellation while waiting for preparation grant prevents a late grant from starting native work', { timeout: 10000 }, async t => {
  const h = await fixture(t)
  const cancelled = verifiedRunnerInspection(await h.client.cancel(makeCommand('cancel'))).value
  assert.equal(cancelled.admission, 'closed')
  h.grant()
  await h.child.close()
  assert.equal(existsSync(join(h.workspace, 'prepared')), false)
  assert.equal(existsSync(join(h.workspace, 'native-started')), false)
})
test('a running installer is in the authenticated inventory and cancellation stops its actual writer', { timeout: 15000 }, async t => {
  const h = await fixture(t, 'long')
  h.grant()
  await until(() => existsSync(join(h.workspace, 'installer.pid')), Boolean)
  const pid = Number(readFileSync(join(h.workspace, 'installer.pid'), 'utf8'))
  const active = verifiedRunnerInspection(await h.client.inspect()).value
  assert.equal(active.resources.length, 1)
  assert.equal(active.resources[0]?.writer, 'active')
  const cancelled = verifiedRunnerInspection(await h.client.cancel(makeCommand('cancel'))).value
  assert.equal(cancelled.coverage, 'complete_owned_resources')
  assert.equal(cancelled.admission, 'closed')
  assert.ok(cancelled.resources.every(resource => resource.writer === 'quiescent'))
  assert.throws(() => process.kill(pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH')
  assert.equal(existsSync(join(h.workspace, 'native-started')), false)
})
