import { request, createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { openSync, writeSync, fsyncSync, closeSync, lstatSync, readFileSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { AttemptRefSchema, IdSchema, RunnerCommandSchema, TimestampSchema } from '@personal-agent/contracts'
import type { RuntimeProducer } from './contracts.ts'

const MAX_BYTES = 64 * 1024
const ResourceStateSchema = z.strictObject({
  ref: IdSchema, ownership: z.enum(['spawned_process', 'shared_service_session']),
  writer: z.enum(['active', 'quiescent', 'indeterminate']), evidence: z.array(z.string().min(1).max(1024)).max(32),
})
export const RunnerInspectionSchema = z.strictObject({
  protocol: z.literal(1), attempt: AttemptRefSchema, runnerIdentityRef: IdSchema, source: IdSchema,
  state: z.enum(['serving', 'terminated', 'unknown']), admission: z.enum(['open', 'closed']),
  coverage: z.enum(['complete_owned_resources', 'partial', 'unknown']),
  resources: z.array(ResourceStateSchema).max(256), evidence: z.array(z.string().min(1).max(1024)).min(1).max(32), observedAt: TimestampSchema,
}).refine(value => new Set(value.resources.map(resource => resource.ref)).size === value.resources.length, 'Resource identities must be unique')
export type RunnerInspection = z.infer<typeof RunnerInspectionSchema>
export type RunnerState = Pick<RunnerInspection, 'state' | 'admission' | 'coverage' | 'resources' | 'evidence'>
export type RunnerEndpoint = { socketPath: string; credentialPath: string; socketIdentity: { dev: number; ino: number } }
export interface RecoveryRunnerPort {
  /** Inventory must include every owned writer; terminated/closed is irreversible for this endpoint. */
  inspect(): Promise<RunnerState>
  /** Must close business admission before attempting to stop owned resources. */
  cancel(command: Extract<ReturnType<typeof RunnerCommandSchema.parse>, { kind: 'cancel' }>): Promise<RunnerState>
  /**
   * Business facts already recorded by this Runner, from `since` onward. Replay is what lets a second
   * client recover the original work without a second ledger: the frames come from the Runner's own
   * durable journal, not from the caller's memory.
   */
  facts?(since: number, maxBytes: number): Promise<{ frames: unknown[]; next: number; done: boolean }>
  /**
   * Business command intake for an attached client. The Runner applies it to the SAME attempt and
   * child; this is admission of an authenticated command, not a second execution lifecycle.
   */
  command?(command: ReturnType<typeof RunnerCommandSchema.parse>): Promise<RunnerState>
}
export class RunnerLinkError extends Error {
  readonly code: 'unavailable' | 'auth_failed' | 'identity_mismatch' | 'invalid_response' | 'timeout' | 'unknown_outcome' | 'stale_proof'
  constructor(code: RunnerLinkError['code'], message: string) { super(message); this.code = code }
}

function privateDirectory(path: string): void {
  if (!isAbsolute(path)) throw new Error('Runner state paths must be absolute')
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Runner state directory must be private and owned by this user')
}
export function createRunnerCredential(path: string): void {
  privateDirectory(dirname(path))
  const fd = openSync(path, 'wx', 0o600)
  try {
    const key = Buffer.from(randomBytes(32).toString('hex'))
    let offset = 0
    while (offset < key.length) offset += writeSync(fd, key, offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}
function credential(path: string): string {
  privateDirectory(dirname(path))
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 64 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new RunnerLinkError('auth_failed', 'Runner credential reference is not a private owned file')
  const key = readFileSync(path, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(key)) throw new RunnerLinkError('auth_failed', 'Invalid runner credential format')
  return key
}
function identity(context: RuntimeProducer): RuntimeProducer {
  return { attempt: AttemptRefSchema.parse(context.attempt), runnerIdentityRef: IdSchema.parse(context.runnerIdentityRef), source: IdSchema.parse(context.source) }
}
/** A business command must name the same attempt it claims to act for. */
function matchesProducerAttempt(attempt: RuntimeProducer['attempt'], command: { ticketId?: unknown; fenceEpoch?: unknown }): boolean {
  return command.ticketId === attempt.ticketId && command.fenceEpoch === attempt.fenceEpoch
}
function matches(a: RuntimeProducer, b: RuntimeProducer): boolean {
  const left = a.attempt, right = b.attempt
  return a.runnerIdentityRef === b.runnerIdentityRef && a.source === b.source && left.ticketId === right.ticketId && left.assignmentId === right.assignmentId && left.attemptId === right.attemptId && left.fenceEpoch === right.fenceEpoch
    && left.contract.workId === right.contract.workId && left.contract.revision === right.contract.revision && left.contract.digest === right.contract.digest
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > MAX_BYTES) throw new Error('Request too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function reply(res: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.length > MAX_BYTES) { res.writeHead(500); res.end('{"error":"response_limit"}'); return }
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length }); res.end(bytes)
}

/** Local recovery transport only: there is deliberately no start/begin/deliver/answer route. */
export async function serveRunnerRecovery(endpoint: Pick<RunnerEndpoint, 'socketPath' | 'credentialPath'>, context: RuntimeProducer, backend: RecoveryRunnerPort) {
  if (process.platform === 'win32') throw new Error('Unix runner recovery is not admitted on Windows')
  privateDirectory(dirname(endpoint.socketPath))
  if (Buffer.byteLength(endpoint.socketPath) > 90) throw new Error('Runner socket path is too long')
  try { lstatSync(endpoint.socketPath); throw new Error('Runner socket path already exists') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const trusted = identity(context), key = credential(endpoint.credentialPath)
  const cancels = new Map<string, { body: string; result: Promise<RunnerInspection> }>()
  // Business commands get their own replay map so a control cancel and a business command cannot
  // shadow each other's id, while both keep the same conflict and capacity rules.
  const commands = new Map<string, { body: string; result: Promise<RunnerInspection> }>()
  const inspect = async (state: RunnerState) => RunnerInspectionSchema.parse({ ...state, protocol: 1, ...trusted, observedAt: new Date().toISOString() })
  const server = createServer((req, res) => { void (async () => {
    const supplied = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''
    const expected = `Bearer ${key}`
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { reply(res, 401, { error: 'auth_failed' }); return }
    if (req.method === 'GET' && req.url === '/v1/inspection') { reply(res, 200, await inspect(await backend.inspect())); return }
    if (req.method === 'GET' && req.url?.startsWith('/v1/facts')) {
      if (!backend.facts) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      const query = new URL(req.url, 'http://runner').searchParams
      const since = Number(query.get('since') ?? '0')
      const maxBytes = Number(query.get('maxBytes') ?? '49152')
      if (!Number.isSafeInteger(since) || since < 0) { reply(res, 400, { error: 'invalid_since' }); return }
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1_048_576) { reply(res, 400, { error: 'invalid_page_budget' }); return }
      const replay = await backend.facts(since, maxBytes)
      if (!Array.isArray(replay.frames) || !Number.isSafeInteger(replay.next) || replay.next < since || typeof replay.done !== 'boolean') {
        reply(res, 503, { error: 'invalid_replay' }); return
      }
      // Every page carries the server's OWN registered producer identity, injected here rather than
      // trusted from the backend, so a caller can verify the page before it exposes any frame.
      reply(res, 200, { producer: trusted, frames: replay.frames, next: replay.next, done: replay.done })
      return
    }
    if (req.method === 'POST' && req.url === '/v1/commands') {
      if (!backend.command) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      const envelope = await body(req) as { producer?: unknown; command?: unknown }
      const command = RunnerCommandSchema.parse(envelope.command)
      // The previous check spread the trusted producer over the command, so source and identity always
      // matched itself and a foreign producer could still mutate before the mismatch surfaced. The
      // caller now has to state its producer and the statement is compared before any write.
      const claimed = envelope.producer
      if (!claimed || typeof claimed !== 'object') { reply(res, 409, { error: 'identity_mismatch' }); return }
      let claimedProducer: RuntimeProducer
      try { claimedProducer = identity(claimed as RuntimeProducer) } catch { reply(res, 409, { error: 'identity_mismatch' }); return }
      if (!matches(claimedProducer, trusted)) { reply(res, 409, { error: 'identity_mismatch' }); return }
      if (!matchesProducerAttempt(claimedProducer.attempt, command)) { reply(res, 409, { error: 'identity_mismatch' }); return }
      const content = JSON.stringify(command), existing = commands.get(command.id)
      if (existing && existing.body !== content) { reply(res, 409, { error: 'command_conflict' }); return }
      if (!existing && commands.size >= 256) { reply(res, 503, { error: 'control_capacity' }); return }
      const result = existing?.result ?? Promise.resolve().then(() => backend.command!(command)).then(inspect)
      if (!existing) { commands.set(command.id, { body: content, result }); void result.catch(() => undefined) }
      reply(res, 200, await result)
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/cancel') { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
    const command = RunnerCommandSchema.parse(await body(req))
    if (command.kind !== 'cancel') { reply(res, 403, { error: 'business_action_forbidden' }); return }
    if (!matches({ ...trusted, attempt: command }, trusted)) { reply(res, 409, { error: 'identity_mismatch' }); return }
    const content = JSON.stringify(command), existing = cancels.get(command.id)
    if (existing && existing.body !== content) { reply(res, 409, { error: 'command_conflict' }); return }
    if (!existing && cancels.size >= 128) { reply(res, 503, { error: 'control_capacity' }); return }
    const result = existing?.result ?? Promise.resolve().then(() => backend.cancel(command)).then(inspect)
    if (!existing) { cancels.set(command.id, { body: content, result }); void result.catch(() => undefined) }
    reply(res, 200, await result)
  })().catch(() => { if (!res.headersSent) reply(res, 503, { error: 'unknown_outcome' }); else res.destroy() }) })
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 16
  server.setTimeout(5000, socket => socket.destroy())
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint.socketPath, () => { server.off('error', reject); resolve() }) })
  chmodSync(endpoint.socketPath, 0o600)
  const stat = lstatSync(endpoint.socketPath)
  return { endpoint: { ...endpoint, socketIdentity: { dev: stat.dev, ino: stat.ino } } satisfies RunnerEndpoint,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

export type VerifiedRunnerInspection = Readonly<{ inspection: RunnerInspection }>
const verified = new WeakMap<object, { value: RunnerInspection; startedAt: number; endpoint: RunnerEndpoint }>()
export function verifiedRunnerInspection(proof: VerifiedRunnerInspection, maxAgeMs = 5000): { value: RunnerInspection; endpoint: RunnerEndpoint } {
  const record = verified.get(proof)
  if (!record) throw new RunnerLinkError('identity_mismatch', 'An inspection must come from an authenticated runner connection')
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || performance.now() - record.startedAt > maxAgeMs) throw new RunnerLinkError('stale_proof', 'Runner inspection is stale; inspect again')
  return { value: structuredClone(record.value), endpoint: structuredClone(record.endpoint) }
}

export function connectRunnerRecovery(input: RunnerEndpoint, context: RuntimeProducer, timeoutMs = 3000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RangeError('Runner timeout must be between 0 and 60000 milliseconds')
  const endpoint = structuredClone(input), trusted = identity(context), key = credential(endpoint.credentialPath)
  async function invoke(method: 'GET' | 'POST', path: string, data?: unknown): Promise<unknown> {
    privateDirectory(dirname(endpoint.socketPath))
    let stat
    try { stat = lstatSync(endpoint.socketPath) }
    catch { throw new RunnerLinkError('unavailable', 'Registered runner socket is unavailable') }
    if (!stat.isSocket() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()) || stat.dev !== endpoint.socketIdentity.dev || stat.ino !== endpoint.socketIdentity.ino) throw new RunnerLinkError('identity_mismatch', 'Registered runner socket identity changed')
    const startedAt = performance.now()
    const value = await new Promise<unknown>((resolve, reject) => {
      const bytes = data === undefined ? undefined : Buffer.from(JSON.stringify(data))
      if (bytes && bytes.length > MAX_BYTES) { reject(new RunnerLinkError('invalid_response', 'Runner control body is too large')); return }
      const req = request({ socketPath: endpoint.socketPath, method, path, agent: false,
        headers: { authorization: `Bearer ${key}`, ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, res => {
        const chunks: Buffer[] = []; let size = 0
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) req.destroy(new RunnerLinkError('invalid_response', 'Runner response exceeds the limit')); else chunks.push(chunk) })
        res.once('end', () => {
          if (res.statusCode !== 200) { reject(new RunnerLinkError(res.statusCode === 401 ? 'auth_failed' : res.statusCode === 409 ? 'identity_mismatch' : 'unknown_outcome', 'Runner recovery request was refused or indeterminate')); return }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new RunnerLinkError('invalid_response', 'Invalid runner response')) }
        })
        res.once('error', () => reject(new RunnerLinkError('unavailable', 'Runner response was interrupted')))
      })
      // An absolute deadline also bounds slow responses that continuously send a few bytes.
      const deadline = setTimeout(() => req.destroy(new RunnerLinkError('timeout', 'Runner recovery request timed out')), timeoutMs)
      req.once('close', () => clearTimeout(deadline))
      req.once('error', error => { clearTimeout(deadline); reject(error instanceof RunnerLinkError ? error : new RunnerLinkError('unavailable', 'Runner recovery connection is unavailable')) })
      req.end(bytes)
    })
    return { value, startedAt }
  }
  async function call(method: 'GET' | 'POST', path: string, data?: unknown): Promise<VerifiedRunnerInspection> {
    const { value, startedAt } = await invoke(method, path, data) as { value: unknown; startedAt: number }
    const parsed = RunnerInspectionSchema.safeParse(value)
    if (!parsed.success) throw new RunnerLinkError('invalid_response', 'Runner inspection did not match the recovery protocol')
    if (!matches(parsed.data, trusted)) throw new RunnerLinkError('identity_mismatch', 'Runner inspection belongs to another registered attempt')
    const proof = Object.freeze({ inspection: structuredClone(parsed.data) })
    verified.set(proof, { value: parsed.data, startedAt, endpoint })
    return proof
  }
  return Object.freeze({ inspect: () => call('GET', '/v1/inspection'),
    cancel: (command: Extract<ReturnType<typeof RunnerCommandSchema.parse>, { kind: 'cancel' }>) => call('POST', '/v1/cancel', command),
    facts: async (since = 0, maxBytes = 49_152) => {
      if (!Number.isSafeInteger(since) || since < 0) throw new RunnerLinkError('invalid_response', 'Fact replay cursor must be a nonnegative integer')
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new RunnerLinkError('invalid_response', 'Fact page budget must be at least 1024 bytes')
      // Replay is not an inspection, so it is validated as its own shape rather than forced through one.
      const { value } = await invoke('GET', `/v1/facts?since=${since}&maxBytes=${maxBytes}`) as { value: unknown }
      const replay = value as { producer?: unknown; frames?: unknown; next?: unknown; done?: unknown }
      if (!Array.isArray(replay?.frames) || !Number.isSafeInteger(replay?.next) || typeof replay?.done !== 'boolean')
        throw new RunnerLinkError('invalid_response', 'Runner fact replay did not match the attach protocol')
      // Each page must still be the registered producer. Holding a credential, or having inspected once
      // earlier, does not by itself authorise this page, so the producer is verified per page here
      // before any frame is handed back to the caller.
      const pageProducer = identity(replay.producer as RuntimeProducer)
      if (!matches(pageProducer, trusted)) throw new RunnerLinkError('identity_mismatch', 'Fact replay page belongs to another registered attempt')
      return { producer: pageProducer, frames: replay.frames as unknown[], next: replay.next as number, done: replay.done as boolean }
    },
    command: (command: ReturnType<typeof RunnerCommandSchema.parse>) => call('POST', '/v1/commands', { producer: trusted, command }) })
}
