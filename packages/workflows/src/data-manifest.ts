/** Wave-23 A: bounded data manifest and cross-process reader input. Data only; no grant/ledger. */
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { JsonSchema, type Json } from '@personal-agent/contracts'
import { canonicalJson } from '@personal-agent/contracts/canonical'
import type { ProductStore } from '@personal-agent/storage'

export interface DataManifestInput {
  sourceSha: string
  snapshotFormat: 1 | 2
  ticketId: string
  attemptId: string
  questionId: string
  answerId: string
  commandIds: readonly string[]
  dispatch: readonly { commandId: string; target: string }[]
}

export interface DataManifest {
  protocol: 'wave23-data-manifest/1'
  sourceSha: string
  dataRoot: string
  snapshotFormat: 1 | 2
  sourceFingerprint: string | null
  binding: {
    attemptId: string; ticketId: string; assignmentId: string; fenceEpoch: number
    contract: { workId: string; revision: number; digest: string }
    state: string; runnerIdentityRef: string; sessionSource: string
    resources: { ref: string; ownership: string }[]
  }
  currentAttemptId: string | null
  question: { id: string; version: number; validity: string }
  answer: { id: string; questionId: string; expectedVersion: number; digest: string }
  deliveries: { targetBindingId: string; status: string }[]
  commands: { id: string; status: string; payloadDigest: string; seq: number; resultDigest: string | null }[]
  dispatch: { commandId: string; target: string; delivery: string; nativeRef: string | null; error: string | null }[]
  observations: { factId: string; kind: string; disposition: string; payloadRef: string; payloadSha256: string; bytes: number }[]
  counts: { commands: number; dispatch: number; observations: number; deliveries: number; payloads: number }
  digest: string
}

const sha = (value: Json): string => createHash('sha256').update(canonicalJson(value)).digest('hex')
type ManifestBody = Omit<DataManifest, 'digest'>

/** Builds a manifest only from public store reads and actual payload bytes. */
export async function buildDataManifest(store: ProductStore, input: DataManifestInput): Promise<DataManifest> {
  const binding = store.bindings.binding<any>(input.attemptId)
  if (!binding) throw new Error(`Unknown attempt ${input.attemptId}`)
  if (binding.ticketId !== input.ticketId) throw new Error('Attempt and ticket identities disagree')
  const current = store.bindings.current<any>(input.ticketId)
  const question = store.product.questions.get(input.questionId)
  const answer = store.answers.get(input.answerId)
  if (!question || !answer || answer.questionId !== input.questionId) throw new Error('Question/answer identities are missing or disagree')
  const deliveries = store.answers.deliveries(input.answerId).map(value => ({ targetBindingId: value.targetBindingId, status: value.status }))
  const commands = input.commandIds.map(id => {
    const receipt = store.commands.get(id)
    if (!receipt) throw new Error(`Unknown command receipt ${id}`)
    return { id, status: receipt.status, payloadDigest: receipt.payloadDigest, seq: receipt.seq,
      resultDigest: receipt.result === null || receipt.result === undefined ? null : sha(JsonSchema.parse(receipt.result) as Json) }
  })
  const dispatch = input.dispatch.map(({ commandId, target }) => {
    const value = store.dispatch.get(commandId, target)
    if (!value) throw new Error(`Unknown dispatch ${commandId}/${target}`)
    return { commandId, target, delivery: value.delivery, nativeRef: value.nativeRef ?? null, error: value.error ?? null }
  })
  const observations = store.observations.forAttempt(input.attemptId).map(row => ({
    factId: row.factId, kind: row.kind, disposition: row.disposition, payloadRef: row.payloadRef,
    payloadSha256: row.payloadSha256, bytes: 0,
  }))
  const payloads = new Map<string, number>()
  for (const observation of observations) {
    if (payloads.has(observation.payloadRef)) { observation.bytes = payloads.get(observation.payloadRef)!; continue }
    const payload = await store.payloads.read(observation.payloadRef)
    if (payload.sha256 !== observation.payloadSha256) throw new Error(`Payload ${observation.payloadRef} digest differs from observation`)
    const bytes = new TextEncoder().encode(canonicalJson(JsonSchema.parse(payload.value) as Json)).byteLength
    payloads.set(observation.payloadRef, bytes)
    observation.bytes = bytes
  }
  const source = store.workflows.recoverySource.inspect()
  const body: ManifestBody = {
    protocol: 'wave23-data-manifest/1', sourceSha: input.sourceSha,
    dataRoot: dirname(store.database.path), snapshotFormat: input.snapshotFormat,
    sourceFingerprint: source.sourceFingerprint,
    binding: { attemptId: binding.attemptId, ticketId: binding.ticketId, assignmentId: binding.assignmentId,
      fenceEpoch: binding.fenceEpoch, contract: binding.contract, state: binding.state,
      runnerIdentityRef: binding.runnerIdentityRef, sessionSource: binding.source,
      resources: binding.resources.map((resource: any) => ({ ref: resource.ref, ownership: resource.ownership })) },
    currentAttemptId: current?.attemptId ?? null,
    question: { id: question.id, version: question.version, validity: question.validity },
    answer: { id: input.answerId, questionId: answer.questionId, expectedVersion: answer.expectedVersion, digest: answer.digest },
    deliveries,
    commands: [...commands].sort((left, right) => left.id.localeCompare(right.id)),
    dispatch: [...dispatch].sort((left, right) => `${left.commandId}:${left.target}`.localeCompare(`${right.commandId}:${right.target}`)),
    observations: [...observations].sort((left, right) => left.factId.localeCompare(right.factId)),
    counts: { commands: commands.length, dispatch: dispatch.length, observations: observations.length,
      deliveries: deliveries.length, payloads: payloads.size },
  }
  return { ...body, digest: sha(body as Json) }
}

/** Rebuilds from live public reads and rejects any ID/digest/root/format/source drift. */
export async function verifyDataManifest(store: ProductStore, manifest: DataManifest,
  expected: { sourceSha?: string; snapshotFormat?: 1 | 2 } = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (manifest.protocol !== 'wave23-data-manifest/1') return { ok: false, reason: 'unsupported manifest protocol' }
  if (expected.sourceSha && manifest.sourceSha !== expected.sourceSha) return { ok: false, reason: 'source SHA differs' }
  if (expected.snapshotFormat && manifest.snapshotFormat !== expected.snapshotFormat) return { ok: false, reason: 'snapshot format differs' }
  const { digest, ...body } = manifest
  if (digest !== sha(body)) return { ok: false, reason: 'manifest digest is inconsistent' }
  let rebuilt: DataManifest
  try {
    rebuilt = await buildDataManifest(store, { sourceSha: manifest.sourceSha, snapshotFormat: manifest.snapshotFormat,
      ticketId: manifest.binding.ticketId, attemptId: manifest.binding.attemptId, questionId: manifest.question.id,
      answerId: manifest.answer.id, commandIds: manifest.commands.map(value => value.id),
      dispatch: manifest.dispatch.map(value => ({ commandId: value.commandId, target: value.target })) })
  } catch (error) { return { ok: false, reason: `manifest input is no longer readable: ${String(error)}` } }
  const rebuiltBody = (({ digest: _digest, ...rest }) => rest)(rebuilt)
  if (canonicalJson(rebuiltBody) !== canonicalJson(body)) return { ok: false, reason: 'live data differs from manifest' }
  return { ok: true }
}
