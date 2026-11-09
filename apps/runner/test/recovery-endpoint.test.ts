/**
 * Recovery endpoint: the server side of main's authenticated local runner transport.
 *
 * Proves the properties the composition root relies on: a private socket + bearer credential, an
 * inspection that carries the full attempt identity, admission that closes on cancel, and **no route
 * that can start business work**.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveRecoveryEndpoint, endpointDirectory, type RunnerResourceState } from '../src/recovery-endpoint.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

const open = async (options: { resources?: RunnerResourceState[]; onCancel?: () => Promise<void> } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'wave02-endpoint-'))
  const spec = makeAttemptSpec()
  const endpoint = await serveRecoveryEndpoint({
    directory: endpointDirectory(root, spec.attemptId),
    spec,
    runnerIdentityRef: `runner-${spec.attemptId}`,
    source: 'attempt-runner',
    resources: () => options.resources ?? [],
    state: () => 'serving',
    cancel: options.onCancel ?? (async () => undefined),
  })
  const token = readFileSync(endpoint.credentialPath, 'utf8').trim()
  return { endpoint, spec, token }
}

const call = (socketPath: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: unknown }> =>
  new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = request(
      {
        socketPath,
        method,
        path,
        agent: false,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}),
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined })
        })
      },
    )
    req.once('error', reject)
    req.end(bytes)
  })

test('the endpoint lives in a private directory with a private credential', async () => {
  const { endpoint } = await open()
  try {
    assert.equal(statSync(endpoint.credentialPath).mode & 0o777, 0o600)
    const socketMode = statSync(endpoint.socketPath).mode
    assert.ok(statSync(endpoint.socketPath).isSocket())
    void socketMode
  } finally {
    await endpoint.close()
  }
})

test('an unauthenticated request is refused', async () => {
  const { endpoint } = await open()
  try {
    const response = await call(endpoint.socketPath, 'GET', '/v1/inspection')
    assert.equal(response.status, 401)
    const wrong = await call(endpoint.socketPath, 'GET', '/v1/inspection', 'deadbeef')
    assert.equal(wrong.status, 401)
  } finally {
    await endpoint.close()
  }
})

test('inspection carries the full attempt identity and complete inventory', async () => {
  const resources: RunnerResourceState[] = [
    { ref: 'pid-100', ownership: 'spawned_process', writer: 'active', evidence: ['spawn-observed'] },
  ]
  const { endpoint, spec, token } = await open({ resources })
  try {
    const { status, json } = await call(endpoint.socketPath, 'GET', '/v1/inspection', token)
    assert.equal(status, 200)
    const inspection = json as Record<string, unknown>
    assert.equal(inspection.protocol, 1)
    assert.deepEqual(inspection.attempt, {
      ticketId: spec.ticketId,
      assignmentId: spec.assignmentId,
      attemptId: spec.attemptId,
      fenceEpoch: spec.fenceEpoch,
      contract: spec.contract,
    })
    assert.equal(inspection.state, 'serving')
    assert.equal(inspection.admission, 'open')
    assert.equal(inspection.coverage, 'complete_owned_resources')
    assert.equal((inspection.resources as unknown[]).length, 1)
    assert.ok((inspection.evidence as string[]).length > 0)
  } finally {
    await endpoint.close()
  }
})

test('cancel closes admission before stopping and the result is reported', async () => {
  let cancelled = false
  const { endpoint, token } = await open({ onCancel: async () => { cancelled = true } })
  try {
    const response = await call(endpoint.socketPath, 'POST', '/v1/cancel', token, makeCommand('cancel'))
    assert.equal(response.status, 200)
    assert.equal(cancelled, true)
    const inspection = response.json as { admission: string }
    assert.equal(inspection.admission, 'closed')
    // Closed admission is irreversible for this endpoint.
    const again = await call(endpoint.socketPath, 'GET', '/v1/inspection', token)
    assert.equal((again.json as { admission: string }).admission, 'closed')
  } finally {
    await endpoint.close()
  }
})

test('only a cancel command is accepted on the cancel route', async () => {
  const { endpoint, token } = await open()
  try {
    const begin = await call(endpoint.socketPath, 'POST', '/v1/cancel', token, makeCommand('begin', { inputRef: 'i', preparedPolicyRef: 'prepared-1' }))
    assert.equal(begin.status, 403)
    const malformed = await call(endpoint.socketPath, 'POST', '/v1/cancel', token, { kind: 'nonsense' })
    assert.equal(malformed.status, 503)
  } finally {
    await endpoint.close()
  }
})

test('there is no route that starts business work', async () => {
  const { endpoint, token } = await open()
  try {
    const routes: Array<[string, string]> = [['POST', '/v1/begin'], ['POST', '/v1/command'], ['POST', '/v1/deliver'], ['GET', '/v1/answer']]
    for (const [method, path] of routes) {
      const response = await call(endpoint.socketPath, method, path, token, {})
      assert.equal(response.status, 404, `${method} ${path}`)
    }
  } finally {
    await endpoint.close()
  }
})

test('a closed endpoint refuses further requests', async () => {
  const { endpoint, token } = await open()
  await endpoint.close()
  const response = await call(endpoint.socketPath, 'GET', '/v1/inspection', token).catch(() => ({ status: 0 }))
  assert.notEqual(response.status, 200)
})

test('an existing socket is never reused', async () => {
  const { endpoint, spec } = await open()
  try {
    await assert.rejects(
      () =>
        serveRecoveryEndpoint({
          directory: endpoint.socketPath.replace(/\/runner\.sock$/, ''),
          spec,
          runnerIdentityRef: 'runner-again',
          source: 'attempt-runner',
          resources: () => [],
          state: () => 'serving',
          cancel: async () => undefined,
        }),
      /already exists/,
    )
  } finally {
    await endpoint.close()
  }
})
test('a long macOS temporary root gets a private short socket reference without weakening auth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'long-native-endpoint-'))
  const spec = makeAttemptSpec()
  const directory = endpointDirectory(join(root, 'nested-'.repeat(20)), spec.attemptId)
  assert.ok(Buffer.byteLength(`${directory}/runner.sock`) <= 90)
  const endpoint = await serveRecoveryEndpoint({ directory, spec, source: 'attempt-runner', runnerIdentityRef: 'long-runner', resources: () => [], state: () => 'serving', cancel: async () => undefined })
  try {
    assert.equal(statSync(directory).mode & 0o777, 0o700)
    assert.equal(readFileSync(endpoint.credentialPath).length, 64)
    assert.equal((await call(endpoint.socketPath, 'GET', '/v1/inspection', 'wrong-key')).status, 401)
    assert.equal((await call(endpoint.socketPath, 'GET', '/v1/inspection', readFileSync(endpoint.credentialPath, 'utf8'))).status, 200)
  } finally { await endpoint.close() }
})
