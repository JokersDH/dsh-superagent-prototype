import { request, createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFileSync, openSync, writeSync, fsyncSync, closeSync, lstatSync, readFileSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { AttemptRefSchema, IdSchema, RunnerCommandSchema, TimestampSchema } from '@personal-agent/contracts'
import type { RuntimeProducer } from './contracts.ts'

const MAX_BYTES = 64 * 1024
/** Inline page ceiling; a bigger frame is delivered by reference instead of widening this cap. */
const INLINE_PAGE_BYTES = 48 * 1024
/** Largest single payload chunk a caller may request. */
const PAYLOAD_CHUNK_BYTES = 32 * 1024
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
/** The authenticated caller for a control action: current registration producer plus its attach lease. */
export type RunnerControlAuth = { producer: RuntimeProducer; leaseId: string | null }
/** Postcommit finalize: the coordinator's authenticated confirmation that its original Store committed. */
export type RunnerFinalizeConfirmation = {
  attempt: RuntimeProducer['attempt']
  confirmationId: string
  resourceManifestDigest: string
  proofRef?: string
}
export type RunnerFinalizeResult = { finalized: true; alreadyFinalized: boolean }
/** Canonical digest of the complete owned-resource manifest (refs, ownership, writer, evidence). */
export function runnerResourceManifestDigest(resources: readonly { ref: string; ownership: string; writer: string; evidence?: readonly string[] }[]): string {
  const canonical = resources
    .map(resource => ({ ref: resource.ref, ownership: resource.ownership, writer: resource.writer, evidence: [...(resource.evidence ?? [])] }))
    .sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0)
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
export interface RecoveryRunnerPort {
  /** Inventory must include every owned writer; terminated/closed is irreversible for this endpoint. */
  inspect(): Promise<RunnerState>
  /** Must close business admission before attempting to stop owned resources. */
  cancel(command: Extract<ReturnType<typeof RunnerCommandSchema.parse>, { kind: 'cancel' }>, auth?: RunnerControlAuth): Promise<RunnerState>
  /**
   * Business facts already recorded by this Runner, from `since` onward. Replay is what lets a second
   * client recover the original work without a second ledger: the frames come from the Runner's own
   * durable journal, not from the caller's memory.
   */
  facts?(since: number, maxBytes: number): Promise<{ frames: unknown[]; next: number; done: boolean }>
  /**
   * One bounded chunk of an immutable payload. A payload larger than the response cap is transferred by
   * reference and read in chunks here, so a legitimate large frame stays readable without raising the
   * global cap or truncating the payload.
   */
  payload?(ref: string, offset: number, length: number): Promise<{ total: number; digest: string; base64: string }>
  /** Hand the current lease the next outbound callback the Runner is waiting to have answered. */
  /** Read-only generation for an authenticated producer; it grants nothing and binds nothing. */
  channelState?(producer: RuntimeProducer): Promise<{ generation: number }>
  /**
   * Explicit CAS bind plus poll. `expectedGeneration` is the generation the caller observed from
   * channelState; a caller that already owns `leaseId` only consumes its own lease and never rebinds.
   */
  channelNext?(producer: RuntimeProducer, leaseId: string, expectedGeneration: number): Promise<{ generation: number; request: unknown } | null>
  /** Route one reply to the outbound request it names; a reply for another lease is refused. */
  channelReply?(producer: RuntimeProducer, reply: unknown, leaseId: string): Promise<{ accepted: boolean; generation: number }>
  /**
   * Business command intake for an attached client. The Runner applies it to the SAME attempt and
   * child; this is admission of an authenticated command, not a second execution lifecycle.
   */
  command?(command: ReturnType<typeof RunnerCommandSchema.parse>, auth?: RunnerControlAuth): Promise<RunnerState>
  /** Optional, backward-compatible postcommit finalize; only a fully terminal/quiescent Runner accepts it. */
  finalize?(auth: RunnerControlAuth, confirmation: RunnerFinalizeConfirmation): Promise<RunnerFinalizeResult>
}
export class RunnerLinkError extends Error {
  /**
   * Transport-level base code. A named server refusal (stale_connection, identity_mismatch,
   * foreign_producer, generation_mismatch, stale_lease) keeps its own `serverError` for the caller but
   * the base code is `refused`: the request was understood and deliberately not granted.
   */
  readonly code: 'unavailable' | 'auth_failed' | 'identity_mismatch' | 'invalid_response' | 'timeout' | 'unknown_outcome' | 'stale_proof' | 'refused'
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
/**
 * A business command must name the SAME attempt it claims to act for: ticket, epoch, attempt id and the
 * full contract. Comparing only ticket and epoch accepted a command carrying a foreign assignment,
 * attempt or contract, which is why the whole tuple is required here.
 */
function matchesCommandIdentity(attempt: RuntimeProducer['attempt'], command: {
  ticketId?: unknown
  fenceEpoch?: unknown
  attemptId?: unknown
  assignmentId?: unknown
  contract?: { workId?: unknown; revision?: unknown; digest?: unknown } | undefined
}): boolean {
  return command.ticketId === attempt.ticketId
    && command.fenceEpoch === attempt.fenceEpoch
    && command.attemptId === attempt.attemptId
    && (command.assignmentId === undefined || command.assignmentId === attempt.assignmentId)
    && (command.contract === undefined
      || (command.contract.workId === attempt.contract.workId
        && command.contract.revision === attempt.contract.revision
        && command.contract.digest === attempt.contract.digest))
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
  // A caller may CLAIM which registered producer it expects. The claim is never authority: the credential
  // authenticates the connection, and the claim is only compared against this endpoint's immutable
  // registration, so a foreign claim is refused before any bind or callback exposure.
  const claimedProducer = (request: IncomingMessage): { producer: RuntimeProducer | null; error: string | null } => {
    const raw = request.headers['x-pa-producer']
    if (typeof raw !== 'string' || raw.length === 0) return { producer: null, error: null }
    try {
      const value = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>
      const attempt = value?.attempt as Record<string, unknown> | undefined
      if (!attempt || typeof value.runnerIdentityRef !== 'string' || typeof value.source !== 'string') return { producer: null, error: 'invalid_producer' }
      return {
        producer: {
          attempt: {
            ticketId: String(attempt.ticketId), assignmentId: String(attempt.assignmentId), attemptId: String(attempt.attemptId),
            fenceEpoch: Number(attempt.fenceEpoch), contract: attempt.contract as RuntimeProducer['attempt']['contract'],
          },
          runnerIdentityRef: value.runnerIdentityRef, source: value.source,
        } as RuntimeProducer,
        error: null,
      }
    } catch { return { producer: null, error: 'invalid_producer' } }
  }
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
      // The response cap is not raised. A page budget above it is honoured only up to the inline limit
      // and the effective budget is reported, so a caller can never be handed a silently truncated page.
      const inlineBudget = Math.min(maxBytes, INLINE_PAGE_BYTES)
      const replay = await backend.facts(since, inlineBudget)
      if (!Array.isArray(replay.frames) || !Number.isSafeInteger(replay.next) || replay.next < since || typeof replay.done !== 'boolean') {
        reply(res, 503, { error: 'invalid_replay' }); return
      }
      // Budget the WHOLE ENCODED PAGE, not just the sum of frame bodies: the producer envelope and wrapper
      // are part of the response, and a page that overran the cap used to fail as a 500 (unknown_outcome)
      // even though every frame was legal. A page that would overrun is trimmed and reported as not done,
      // so the caller continues from a real cursor instead of losing the replay.
      let frames = replay.frames
      let next = replay.next
      let done = replay.done
      const encode = (pageFrames: unknown[], pageNext: number, pageDone: boolean) => JSON.stringify({
        producer: trusted, frames: pageFrames, next: pageNext, done: pageDone,
        requestedMaxBytes: maxBytes, budget: inlineBudget, inlineLimit: INLINE_PAGE_BYTES,
      })
      // The page must respect the EFFECTIVE requested budget, not just the 64 KiB transport cap. Counting
      // only frame bodies let a 2048-byte request return 64753 bytes of envelope plus frames, which made
      // every small-page claim untrue. Trim against the effective budget so the encoded response the caller
      // actually receives is inside what it asked for.
      const effectiveBudget = Math.min(inlineBudget, MAX_BYTES)
      let encoded = encode(frames, next, done)
      const envelopeBytes = Buffer.byteLength(encode([], since, false))
      const limit = Math.max(effectiveBudget, envelopeBytes)
      while (Buffer.byteLength(encoded) > limit && frames.length > 0) {
        frames = frames.slice(0, -1)
        const last = frames[frames.length - 1] as { seq?: unknown } | undefined
        next = last && Number.isSafeInteger(last.seq) ? (last.seq as number) : since
        done = false
        encoded = encode(frames, next, done)
      }
      if (Buffer.byteLength(encoded) > MAX_BYTES) { reply(res, 503, { error: 'page_exceeds_cap' }); return }
      // Every page carries the server's OWN registered producer identity, injected here rather than
      // trusted from the backend, so a caller can verify the page before it exposes any frame.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(encoded)
      return
    }
    if (req.method === 'GET' && req.url === '/v1/channel/state') {
      if (!backend.channelState) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      const claim = claimedProducer(req)
      if (claim.error) { reply(res, 400, { error: claim.error }); return }
      // Read-only: it reports the generation an attaching caller must present to CAS on. It grants no
      // lease, starts no waiter and never binds, so a stale caller reading it changes nothing.
      reply(res, 200, await backend.channelState(claim.producer ?? trusted))
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/v1/channel/next')) {
      if (!backend.channelNext) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      // The lease is bound from the AUTHENTICATED producer; the lease id only scopes which client
      // instance owns the waiters, so it grants nothing on its own.
      const leaseId = typeof req.headers['x-pa-lease'] === 'string' ? req.headers['x-pa-lease'].trim() : ''
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(leaseId)) { reply(res, 400, { error: 'invalid_lease' }); return }
      const rawGeneration = new URL(req.url, 'http://runner').searchParams.get('generation') ?? '0'
      const expectedGeneration = Number(rawGeneration)
      if (!/^\d+$/.test(rawGeneration) || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
        reply(res, 400, { error: 'invalid_generation' }); return
      }
      try {
        const claim = claimedProducer(req)
        if (claim.error) { reply(res, 400, { error: claim.error }); return }
        const bound = await backend.channelNext(claim.producer ?? trusted, leaseId, expectedGeneration)
        reply(res, 200, bound ?? { generation: expectedGeneration, request: null })
      } catch (error) {
        const named = error as { code?: unknown; reason?: unknown }
        if (named?.code === 'stale_connection' || named?.code === 'identity_mismatch' || named?.code === 'foreign_producer') {
          reply(res, 409, { error: named.code, reason: typeof named.reason === 'string' ? named.reason : null }); return
        }
        throw error
      }
      return
    }
    if (req.method === 'POST' && req.url === '/v1/channel/reply') {
      if (!backend.channelReply) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      const leaseId = typeof req.headers['x-pa-lease'] === 'string' ? req.headers['x-pa-lease'].trim() : ''
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(leaseId)) { reply(res, 400, { error: 'invalid_lease' }); return }
      const bodyValue = await body(req)
      const claim = claimedProducer(req)
      if (claim.error) { reply(res, 400, { error: claim.error }); return }
      const routed = await backend.channelReply(claim.producer ?? trusted, bodyValue, leaseId)
      if (!routed?.accepted) { reply(res, 409, { error: 'stale_lease' }); return }
      reply(res, 200, routed)
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/v1/payload')) {
      if (!backend.payload) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      const query = new URL(req.url, 'http://runner').searchParams
      const ref = query.get('ref'), offset = Number(query.get('offset') ?? '0'), length = Number(query.get('length') ?? String(PAYLOAD_CHUNK_BYTES))
      if (!ref || ref.length > 512) { reply(res, 400, { error: 'invalid_ref' }); return }
      // A payload read is bound to the original producer/source: holding a credential and a ref is not
      // enough, so a foreign caller cannot read this Runner's payload bytes.
      const claimedHeader = typeof req.headers['x-pa-producer'] === 'string' ? req.headers['x-pa-producer'] : ''
      let claimedProducer: RuntimeProducer
      try { claimedProducer = identity(JSON.parse(Buffer.from(claimedHeader, 'base64').toString('utf8')) as RuntimeProducer) }
      catch { reply(res, 409, { error: 'identity_mismatch' }); return }
      if (!matches(claimedProducer, trusted)) { reply(res, 409, { error: 'identity_mismatch' }); return }
      if (!Number.isSafeInteger(offset) || offset < 0) { reply(res, 400, { error: 'invalid_offset' }); return }
      if (!Number.isSafeInteger(length) || length < 1 || length > PAYLOAD_CHUNK_BYTES) { reply(res, 400, { error: 'invalid_chunk_length' }); return }
      const chunk = await backend.payload(ref, offset, length)
      if (!chunk || typeof chunk.total !== 'number' || typeof chunk.digest !== 'string' || typeof chunk.base64 !== 'string') {
        reply(res, 503, { error: 'invalid_payload' }); return
      }
      const chunkBytes = Buffer.from(chunk.base64, 'base64')
      // Only the bounds are enforceable here: an intermediate chunk is legitimately shorter than the
      // remaining payload, so the previous equality test rejected every legal non-final chunk.
      if (offset + chunkBytes.length > chunk.total) { reply(res, 503, { error: 'invalid_payload' }); return }
      if (chunkBytes.length > length) { reply(res, 503, { error: 'invalid_payload' }); return }
      // length is the decoded byte length; reporting base64 characters was a unit error.
      reply(res, 200, { ref, offset, length: chunkBytes.length, total: chunk.total, digest: chunk.digest, base64: chunk.base64 })
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
      if (!matchesCommandIdentity(claimedProducer.attempt, command as unknown as Record<string, unknown>)) { reply(res, 409, { error: 'identity_mismatch' }); return }
      const leaseHeader = typeof req.headers['x-pa-lease'] === 'string' ? req.headers['x-pa-lease'].trim() : ''
      if (leaseHeader && !/^[A-Za-z0-9._:-]{1,128}$/.test(leaseHeader)) { reply(res, 400, { error: 'invalid_lease' }); return }
      const content = JSON.stringify(command), existing = commands.get(command.id)
      if (existing && existing.body !== content) { reply(res, 409, { error: 'command_conflict' }); return }
      if (!existing && commands.size >= 256) { reply(res, 503, { error: 'control_capacity' }); return }
      const result = existing?.result ?? Promise.resolve().then(() => backend.command!(command, { producer: claimedProducer, leaseId: leaseHeader || null })).then(inspect)
      if (!existing) { commands.set(command.id, { body: content, result }); void result.catch(() => undefined) }
      try {
        reply(res, 200, await result)
      } catch (error) {
        // An admission refusal is a REFUSAL with its own reason, not an unknown outcome. The caller has to
        // be able to tell duplicate_begin or admission_closed apart from a transport failure.
        const refusal = error as { code?: unknown; reason?: unknown; message?: unknown }
        reply(res, 409, {
          error: typeof refusal.code === 'string' ? refusal.code : 'unknown_outcome',
          ...(typeof refusal.reason === 'string' ? { reason: refusal.reason } : {}),
          message: String(refusal.message ?? '').slice(0, 200),
        })
      }
      return
    }
    if (req.method === 'POST' && req.url === '/v1/terminal/finalize') {
      if (!backend.finalize) { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
      const raw = await body(req) as { producer?: unknown; confirmation?: Record<string, unknown>; leaseId?: unknown }
      if (!raw || typeof raw !== 'object' || !raw.producer || typeof raw.producer !== 'object') { reply(res, 409, { error: 'identity_mismatch', reason: 'missing_producer' }); return }
      let finProducer: RuntimeProducer
      try { finProducer = identity(raw.producer as RuntimeProducer) } catch { reply(res, 409, { error: 'identity_mismatch' }); return }
      if (!matches(finProducer, trusted)) { reply(res, 409, { error: 'identity_mismatch' }); return }
      const confirmation = raw.confirmation as RunnerFinalizeConfirmation | undefined
      if (!confirmation || typeof confirmation !== 'object') { reply(res, 400, { error: 'invalid_confirmation' }); return }
      if (!confirmation.attempt || !matchesCommandIdentity(finProducer.attempt, confirmation.attempt as unknown as Record<string, unknown>)) { reply(res, 409, { error: 'identity_mismatch', reason: 'wrong_subject' }); return }
      if (typeof confirmation.confirmationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(confirmation.confirmationId)) { reply(res, 400, { error: 'invalid_confirmation_id' }); return }
      if (typeof confirmation.resourceManifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation.resourceManifestDigest)) { reply(res, 400, { error: 'invalid_resource_manifest' }); return }
      if (confirmation.proofRef !== undefined && (typeof confirmation.proofRef !== 'string' || confirmation.proofRef.length > 512)) { reply(res, 400, { error: 'invalid_proof_ref' }); return }
      const leaseHeader = typeof req.headers['x-pa-lease'] === 'string' ? req.headers['x-pa-lease'].trim() : ''
      try {
        const result = await backend.finalize({ producer: finProducer, leaseId: leaseHeader || null }, confirmation)
        reply(res, 200, result)
      } catch (error) {
        const refusal = error as { code?: unknown; reason?: unknown; message?: unknown }
        reply(res, 409, { error: typeof refusal.code === 'string' ? refusal.code : 'unknown_outcome',
          ...(typeof refusal.reason === 'string' ? { reason: refusal.reason } : {}), message: String(refusal.message ?? '').slice(0, 200) })
      }
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/cancel') { reply(res, 404, { error: 'unsupported_recovery_action' }); return }
    const raw = await body(req) as { producer?: unknown; command?: unknown; leaseId?: unknown }
    const commandBody = raw && typeof raw === 'object' && 'command' in raw ? raw.command : raw
    const command = RunnerCommandSchema.parse(commandBody)
    if (command.kind !== 'cancel') { reply(res, 403, { error: 'business_action_forbidden' }); return }
    // A cancel mutates the original service, so the caller's producer must be stated and compared BEFORE
    // the backend is touched. A bare command has no caller identity and is refused instead of being
    // applied and then failing an identity check.
    const claimed = (raw as { producer?: unknown })?.producer
    if (!claimed || typeof claimed !== 'object') { reply(res, 409, { error: 'identity_mismatch', reason: 'missing_producer' }); return }
    let cancelProducer: RuntimeProducer
    try { cancelProducer = identity(claimed as RuntimeProducer) } catch { reply(res, 409, { error: 'identity_mismatch' }); return }
    if (!matches(cancelProducer, trusted) || !matchesCommandIdentity(cancelProducer.attempt, command as unknown as Record<string, unknown>)) { reply(res, 409, { error: 'identity_mismatch' }); return }
    const leaseHeader = typeof req.headers['x-pa-lease'] === 'string' ? req.headers['x-pa-lease'].trim()
      : typeof (raw as { leaseId?: unknown })?.leaseId === 'string' ? ((raw as { leaseId: string }).leaseId).trim() : ''
    if (leaseHeader && !/^[A-Za-z0-9._:-]{1,128}$/.test(leaseHeader)) { reply(res, 400, { error: 'invalid_lease' }); return }
    const content = JSON.stringify(command), existing = cancels.get(command.id)
    if (existing && existing.body !== content) { reply(res, 409, { error: 'command_conflict' }); return }
    if (!existing && cancels.size >= 128) { reply(res, 503, { error: 'control_capacity' }); return }
    const result = existing?.result ?? Promise.resolve().then(() => backend.cancel(command, { producer: cancelProducer, leaseId: leaseHeader || null })).then(inspect)
    if (!existing) { cancels.set(command.id, { body: content, result }); void result.catch(() => undefined) }
    try { reply(res, 200, await result) } catch (error) {
      const refusal = error as { code?: unknown; reason?: unknown; message?: unknown }
      reply(res, 409, { error: typeof refusal.code === 'string' ? refusal.code : 'unknown_outcome',
        ...(typeof refusal.reason === 'string' ? { reason: refusal.reason } : {}), message: String(refusal.message ?? '').slice(0, 200) })
    }
  })().catch(() => { if (!res.headersSent) reply(res, 503, { error: 'unknown_outcome' }); else res.destroy() }) })
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 16
  server.setTimeout(5000, socket => socket.destroy())
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint.socketPath, () => { server.off('error', reject); resolve() }) })
  chmodSync(endpoint.socketPath, 0o600)
  const stat = lstatSync(endpoint.socketPath)
  return { endpoint: { ...endpoint, socketIdentity: { dev: stat.dev, ino: stat.ino } } satisfies RunnerEndpoint,
    // server.close() waits for open connections, so a caller that still holds one would keep the socket
    // and credential alive and the endpoint would never report its resources returned. Closing stops
    // accepting and drops the idle connections that remain.
    close: () => new Promise<void>((resolve, reject) => {
      const done = server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections?.()
      void done
    }) }
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
  async function invoke(method: 'GET' | 'POST', path: string, data?: unknown, extraHeaders?: Record<string, string>): Promise<unknown> {
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
        headers: { authorization: `Bearer ${key}`, ...(extraHeaders ?? {}), ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, res => {
        const chunks: Buffer[] = []; let size = 0
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) req.destroy(new RunnerLinkError('invalid_response', 'Runner response exceeds the limit')); else chunks.push(chunk) })
        res.once('end', () => {
          if (res.statusCode !== 200) {
            // Keep the server's own refusal reason: a generic message hides whether the begin window was
            // closed, the identity was foreign or the admission was closed.
            let refused: { error?: unknown; reason?: unknown } = {}
            try { refused = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof refused } catch {}
            const serverError = typeof refused.error === 'string' ? refused.error : null
            const named = serverError === 'stale_connection' || serverError === 'identity_mismatch' || serverError === 'foreign_producer' || serverError === 'generation_mismatch' || serverError === 'stale_lease'
            // The base code is a transport classification; the named server refusal stays exact in serverError.
            const code: RunnerLinkError['code'] = res.statusCode === 401 ? 'auth_failed' : named || res.statusCode === 409 ? 'refused' : 'unknown_outcome'
            reject(Object.assign(new RunnerLinkError(code, `Runner recovery request was refused (${serverError ?? `status_${res.statusCode}`})`), { serverError, status: res.statusCode }))
            return
          }
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
  async function call(method: 'GET' | 'POST', path: string, data?: unknown, extraHeaders?: Record<string, string>): Promise<VerifiedRunnerInspection> {
    const { value, startedAt } = await invoke(method, path, data, extraHeaders) as { value: unknown; startedAt: number }
    const parsed = RunnerInspectionSchema.safeParse(value)
    if (!parsed.success) throw new RunnerLinkError('invalid_response', 'Runner inspection did not match the recovery protocol')
    if (!matches(parsed.data, trusted)) throw new RunnerLinkError('identity_mismatch', 'Runner inspection belongs to another registered attempt')
    const proof = Object.freeze({ inspection: structuredClone(parsed.data) })
    verified.set(proof, { value: parsed.data, startedAt, endpoint })
    return proof
  }
  return Object.freeze({ inspect: () => call('GET', '/v1/inspection'),
    cancel: (command: Extract<ReturnType<typeof RunnerCommandSchema.parse>, { kind: 'cancel' }>, leaseId?: string) => call('POST', '/v1/cancel', { producer: trusted, command }, leaseId ? { 'x-pa-lease': leaseId } : undefined),
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
    command: (command: ReturnType<typeof RunnerCommandSchema.parse>, leaseId?: string) => call('POST', '/v1/commands', { producer: trusted, command }, leaseId ? { 'x-pa-lease': leaseId } : undefined),
    finalize: async (confirmation: Omit<RunnerFinalizeConfirmation, 'attempt'> & { attempt?: RunnerFinalizeConfirmation['attempt'] }, leaseId?: string) => {
      const body = { producer: trusted, confirmation: { ...confirmation, attempt: confirmation.attempt ?? trusted.attempt } }
      const response = await invoke('POST', '/v1/terminal/finalize', body, leaseId ? { 'x-pa-lease': leaseId } : undefined) as { value: unknown }
      const result = response?.value as RunnerFinalizeResult | undefined
      if (!result || result.finalized !== true || typeof result.alreadyFinalized !== 'boolean') throw new RunnerLinkError('invalid_response', 'Runner finalize response did not match the private protocol')
      return result
    },
    channelState: async () => {
      const { value } = await invoke('GET', '/v1/channel/state', undefined, { 'x-pa-producer': Buffer.from(JSON.stringify(trusted), 'utf8').toString('base64') }) as { value: unknown }
      const state = value as { generation?: unknown }
      if (!Number.isSafeInteger(state?.generation)) throw new RunnerLinkError('invalid_response', 'Runner channel state did not match the attach protocol')
      return { generation: state.generation as number }
    },
    channelNext: async (leaseId: string, expectedGeneration = 0) => {
      const { value } = await invoke('GET', `/v1/channel/next?generation=${encodeURIComponent(String(expectedGeneration))}`, undefined, {
        'x-pa-lease': leaseId,
        'x-pa-producer': Buffer.from(JSON.stringify(trusted), 'utf8').toString('base64'),
      }) as { value: unknown }
      const page = value as { generation?: unknown; request?: unknown }
      if (!Number.isSafeInteger(page?.generation)) throw new RunnerLinkError('invalid_response', 'Runner channel page did not match the attach protocol')
      // The page always carries the generation so a caller can CAS on it; a request-less page is normal.
      return { generation: page.generation as number, request: page.request ?? null }
    },
    channelReply: async (leaseId: string, reply: unknown) => {
      const { value } = await invoke('POST', '/v1/channel/reply', reply, {
        'x-pa-lease': leaseId,
        'x-pa-producer': Buffer.from(JSON.stringify(trusted), 'utf8').toString('base64'),
      }) as { value: unknown }
      const routed = value as { accepted?: unknown; generation?: unknown }
      if (typeof routed?.accepted !== 'boolean') throw new RunnerLinkError('invalid_response', 'Runner channel reply result did not match the attach protocol')
      return { accepted: routed.accepted, generation: Number(routed.generation ?? 0) }
    },
    payload: async (ref: string, offset = 0, length = 32_768) => {
      const producerHeader = Buffer.from(JSON.stringify(trusted), 'utf8').toString('base64')
      const { value } = await invoke('GET', `/v1/payload?ref=${encodeURIComponent(ref)}&offset=${offset}&length=${length}`, undefined, { 'x-pa-producer': producerHeader }) as { value: unknown }
      const chunk = value as { total?: unknown; digest?: unknown; base64?: unknown; offset?: unknown; length?: unknown }
      if (typeof chunk?.base64 !== 'string' || typeof chunk?.digest !== 'string' || !Number.isSafeInteger(chunk?.total))
        throw new RunnerLinkError('invalid_response', 'Runner payload chunk did not match the attach protocol')
      return { total: chunk.total as number, digest: chunk.digest as string, base64: chunk.base64 as string, offset: chunk.offset as number, length: chunk.length as number }
    } })
}
