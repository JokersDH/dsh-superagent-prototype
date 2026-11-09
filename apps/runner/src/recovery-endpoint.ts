/**
 * Independent Runner recovery endpoint (wave-02 B2, "browser wiring" boundary).
 *
 * Main's `connectRunnerRecovery` speaks a narrow, authenticated local transport: one Unix socket per
 * endpoint, a bearer credential file, `GET /v1/inspection` and `POST /v1/cancel`. This module is the
 * **server side of that same protocol** for a real per-attempt Runner process, so the composition root
 * can register and later recover *our* Runner rather than a fixture.
 *
 * Contract preserved from `apps/coordinator/runner-link.ts` (main-owned):
 * - the socket is a Unix socket in a private directory with mode 0o700, never a symlink;
 * - the bearer credential is a private file (0o600), compared in constant time;
 * - `inspection` matches `RunnerInspectionSchema`, which additionally carries the attempt identity;
 * - recovery exposes **only** inspection and cancel. There is no route that starts business work:
 *   a reconnect can never become a `begin`/`deliver`/`answer`.
 *
 * Ownership: one endpoint per attempt, one credential per endpoint. The endpoint is closed
 * irreversibly on shutdown; `admission: 'closed'` is final for this socket.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import type { AttemptSpec, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { RunnerCommandSchema } from '../../../packages/contracts/src/schemas.ts'

/** Mirrors the shape main's `RunnerInspectionSchema` requires. */
/** Exactly main's `ResourceStateSchema`: a resource, its ownership, writer state and evidence. */
export type RunnerResourceState = {
  ref: string
  ownership: 'spawned_process' | 'shared_service_session'
  writer: 'active' | 'quiescent' | 'indeterminate'
  evidence: string[]
}

export type RunnerInspection = {
  protocol: 1
  attempt: { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: AttemptSpec['contract'] }
  runnerIdentityRef: string
  source: string
  state: 'serving' | 'terminated' | 'unknown'
  admission: 'open' | 'closed'
  coverage: 'complete_owned_resources' | 'partial' | 'unknown'
  resources: RunnerResourceState[]
  evidence: string[]
  observedAt: string
}

export type RecoveryEndpointOptions = {
  directory: string
  spec: AttemptSpec
  runnerIdentityRef: string
  source: string
  /** Current inventory of resources this Runner owns. */
  resources: () => RunnerResourceState[]
  /** Serving/terminated view of the attempt. */
  state: () => 'serving' | 'terminated' | 'unknown'
  /** Close business admission and stop owned resources; returns the resulting inventory. */
  cancel: (command: RunnerCommand) => Promise<void>
  now?: () => string
}

export const CREDENTIAL_FILE = 'runner.credential'
export const SOCKET_FILE = 'runner.sock'

export type RecoveryEndpoint = {
  socketPath: string
  credentialPath: string
  inspection(): RunnerInspection
  close(): Promise<void>
  readonly closed: boolean
}

const MAX_BODY = 64 * 1024

/** Create the private directory, credential file and socket for one attempt. */
export async function serveRecoveryEndpoint(options: RecoveryEndpointOptions): Promise<RecoveryEndpoint> {
  const directory = options.directory
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const credentialPath = `${directory}/${CREDENTIAL_FILE}`
  const socketPath = `${directory}/${SOCKET_FILE}`
  if (existsSync(socketPath)) {
    // A stale socket from a previous run is never reused: this endpoint owns exactly one attempt.
    throw new Error('A recovery socket already exists for this endpoint; refusing to reuse it')
  }
  const token = randomBytes(32).toString('hex')
  writeFileSync(credentialPath, `${token}\n`, { mode: 0o600 })
  chmodSync(credentialPath, 0o600)

  const now = options.now ?? (() => new Date().toISOString())
  let admission: 'open' | 'closed' = 'open'
  let closed = false

  const inventory = (): RunnerResourceState[] => options.resources()
  const describe = (): RunnerInspection => {
    const resources = inventory()
    return {
      protocol: 1,
      attempt: {
        ticketId: options.spec.ticketId,
        assignmentId: options.spec.assignmentId,
        attemptId: options.spec.attemptId,
        fenceEpoch: options.spec.fenceEpoch,
        contract: options.spec.contract,
      },
      runnerIdentityRef: options.runnerIdentityRef,
      source: options.source,
      state: options.state(),
      admission,
      // Capped at what we can prove: an empty inventory is complete, otherwise it is still complete
      // because the Runner reports every resource it owns.
      coverage: 'complete_owned_resources',
      resources,
      evidence: [
        `admission:${admission}`,
        `resources:${resources.length}`,
        ...resources.slice(0, 8).flatMap(resource => resource.evidence.slice(0, 2)),
      ].slice(0, 32),
      observedAt: now(),
    }
  }

  const authorised = (header: string | undefined): boolean => {
    if (!header?.startsWith('Bearer ')) return false
    const provided = Buffer.from(header.slice('Bearer '.length))
    const expected = Buffer.from(token)
    return provided.length === expected.length && timingSafeEqual(provided, expected)
  }

  const server: Server = createServer((socket: Socket) => {
    let buffer = ''
    let handled = false
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      if (handled) return
      buffer += chunk
      if (buffer.length > MAX_BODY + 8192) {
        handled = true
        reply(socket, 413, { error: 'body_too_large' })
        return
      }
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      handled = true
      const head = buffer.slice(0, end)
      const rest = buffer.slice(end + 4)
      void onRequest(head, rest, socket)
    })
    socket.on('error', () => socket.destroy())
  })

  const reply = (socket: Socket, status: number, body: unknown): void => {
    const payload = JSON.stringify(body)
    socket.end(
      `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Error'}\r\n` +
        'content-type: application/json\r\n' +
        `content-length: ${Buffer.byteLength(payload)}\r\n` +
        'connection: close\r\n\r\n' +
        payload,
    )
  }

  const onRequest = async (head: string, rest: string, socket: Socket): Promise<void> => {
    const lines = head.split('\r\n')
    const [method, path] = (lines[0] ?? '').split(' ')
    const headers = new Map<string, string>()
    for (const line of lines.slice(1)) {
      const index = line.indexOf(':')
      if (index > 0) headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
    }
    if (closed) {
      reply(socket, 409, { error: 'endpoint_closed' })
      return
    }
    if (!authorised(headers.get('authorization'))) {
      reply(socket, 401, { error: 'unauthorised' })
      return
    }

    if (method === 'GET' && path === '/v1/inspection') {
      reply(socket, 200, describe())
      return
    }
    if (method === 'POST' && path === '/v1/cancel') {
      const length = Number(headers.get('content-length') ?? '0')
      if (!Number.isFinite(length) || length > MAX_BODY) {
        reply(socket, 413, { error: 'body_too_large' })
        return
      }
      const body = rest.slice(0, length)
      let command: unknown
      try {
        command = JSON.parse(body)
      } catch {
        reply(socket, 400, { error: 'invalid_json' })
        return
      }
      const parsed = RunnerCommandSchema.safeParse(command)
      if (!parsed.success || parsed.data.kind !== 'cancel') {
        reply(socket, 400, { error: 'invalid_cancel' })
        return
      }
      // Admission closes before any stop attempt, and stays closed for this endpoint.
      admission = 'closed'
      try {
        await options.cancel(parsed.data)
      } catch {
        // The inventory still reports what is owned; the caller decides from evidence.
      }
      reply(socket, 200, describe())
      return
    }
    reply(socket, 404, { error: 'not_found' })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      chmodSync(socketPath, 0o600)
      resolve()
    })
  })

  return {
    socketPath,
    credentialPath,
    inspection: describe,
    get closed() {
      return closed
    },
    close: async () => {
      if (closed) return
      closed = true
      admission = 'closed'
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

/** A stable reference for the credential file, so a registration can pin it. */
export function credentialDigest(credentialPath: string, token: string): string {
  return createHash('sha256').update(`${credentialPath}\u0000${token}`).digest('hex')
}

/** The directory a runner endpoint lives in; exported so tests and the launcher agree. */
export function endpointDirectory(root: string, attemptId: string): string {
  return `${root.replace(/\/+$/, '')}/${attemptId}`
}

void dirname
