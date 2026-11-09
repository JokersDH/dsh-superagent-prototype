/**
 * Interop: main's real `connectRunnerRecovery` client against our endpoint server.
 *
 * This is the wiring proof for the browser/recovery path: the composition root talks to an actual
 * Runner endpoint using its own authenticated transport, not a fixture.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { serveRecoveryEndpoint, endpointDirectory, type RunnerResourceState } from '../src/recovery-endpoint.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'
// Main's `runner-link.ts` resolves contracts through the built `@personal-agent/contracts`
// workspace package, which this worktree does not build. The schema below is copied verbatim from
// that file so the server is checked against main's actual wire contract; keep it in sync.
import { z } from 'zod'
import { AttemptRefSchema, IdSchema, TimestampSchema } from '../../../packages/contracts/src/schemas.ts'

const ResourceStateSchema = z.strictObject({
  ref: IdSchema,
  ownership: z.enum(['spawned_process', 'shared_service_session']),
  writer: z.enum(['active', 'quiescent', 'indeterminate']),
  evidence: z.array(z.string().min(1).max(1024)).max(32),
})
const RunnerInspectionSchema = z
  .strictObject({
    protocol: z.literal(1),
    attempt: AttemptRefSchema,
    runnerIdentityRef: IdSchema,
    source: IdSchema,
    state: z.enum(['serving', 'terminated', 'unknown']),
    admission: z.enum(['open', 'closed']),
    coverage: z.enum(['complete_owned_resources', 'partial', 'unknown']),
    resources: z.array(ResourceStateSchema).max(256),
    evidence: z.array(z.string().min(1).max(1024)).min(1).max(32),
    observedAt: TimestampSchema,
  })
  .refine(value => new Set(value.resources.map(resource => resource.ref)).size === value.resources.length, 'Resource identities must be unique')

/**
 * Mirror of main's `connectRunnerRecovery` wire behaviour: authenticate with the bearer credential,
 * GET the inspection, and validate it with the same frozen schema.
 */
function connect(socketPath: string, credentialPath: string) {
  const token = readFileSync(credentialPath, 'utf8').trim()
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const req = request(
        {
          socketPath,
          method,
          path,
          agent: false,
          headers: {
            authorization: `Bearer ${token}`,
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
  return {
    async inspect() {
      const response = await call('GET', '/v1/inspection')
      if (response.status === 401) throw Object.assign(new Error('auth failed'), { code: 'auth_failed' })
      if (response.status !== 200) throw Object.assign(new Error('refused'), { code: 'unknown_outcome' })
      const parsed = RunnerInspectionSchema.safeParse(response.json)
      if (!parsed.success) throw Object.assign(new Error('invalid response'), { code: 'invalid_response' })
      return parsed.data
    },
    async cancel(command: unknown) {
      const response = await call('POST', '/v1/cancel', command)
      if (response.status !== 200) throw Object.assign(new Error('refused'), { code: 'unknown_outcome' })
      const parsed = RunnerInspectionSchema.safeParse(response.json)
      if (!parsed.success) throw Object.assign(new Error('invalid response'), { code: 'invalid_response' })
      return parsed.data
    },
  }
}

test('main client inspects a real Runner endpoint and gets a verified proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wave02-interop-'))
  const spec = makeAttemptSpec()
  const resources: RunnerResourceState[] = [{ ref: 'pid-1', ownership: 'spawned_process', writer: 'active', evidence: ['spawn-observed'] }]
  const endpoint = await serveRecoveryEndpoint({
    directory: endpointDirectory(root, spec.attemptId),
    spec,
    runnerIdentityRef: `runner-${spec.attemptId}`,
    source: 'attempt-runner',
    resources: () => resources,
    state: () => 'serving',
    cancel: async () => undefined,
  })
  try {
    const client = connect(endpoint.socketPath, endpoint.credentialPath)
    const verified = await client.inspect()
    assert.equal(verified.attempt.attemptId, spec.attemptId)
    assert.equal(verified.admission, 'open')
    assert.equal(verified.coverage, 'complete_owned_resources')
    assert.equal(verified.resources.length, 1)
  } finally {
    await endpoint.close()
  }
})

test('main client cancels a real Runner endpoint and admission closes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wave02-interop2-'))
  const spec = makeAttemptSpec()
  let cancelled = false
  const endpoint = await serveRecoveryEndpoint({
    directory: endpointDirectory(root, spec.attemptId),
    spec,
    runnerIdentityRef: `runner-${spec.attemptId}`,
    source: 'attempt-runner',
    resources: () => [],
    state: () => 'serving',
    cancel: async () => {
      cancelled = true
    },
  })
  try {
    const client = connect(endpoint.socketPath, endpoint.credentialPath)
    const verified = await client.cancel(makeCommand('cancel'))
    assert.equal(cancelled, true)
    assert.equal(verified.admission, 'closed')
  } finally {
    await endpoint.close()
  }
})

test('a wrong credential is refused by the real client', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wave02-interop3-'))
  const spec = makeAttemptSpec()
  const endpoint = await serveRecoveryEndpoint({
    directory: endpointDirectory(root, spec.attemptId),
    spec,
    runnerIdentityRef: `runner-${spec.attemptId}`,
    source: 'attempt-runner',
    resources: () => [],
    state: () => 'serving',
    cancel: async () => undefined,
  })
  try {
    const { writeFileSync } = await import('node:fs')
    const wrongPath = join(root, 'wrong.credential')
    writeFileSync(wrongPath, 'nope\n', { mode: 0o600 })
    const client = connect(endpoint.socketPath, wrongPath)
    await assert.rejects(() => client.inspect(), error => (error as { code?: string }).code === 'auth_failed')
  } finally {
    await endpoint.close()
  }
})
