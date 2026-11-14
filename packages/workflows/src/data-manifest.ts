/** Wave-24 A: complete original subject, independent expected sets and UoW/payload guards. */
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { JsonSchema, type Json } from '@personal-agent/contracts'
import { canonicalJson } from '@personal-agent/contracts/canonical'
import type { ProductStore } from '@personal-agent/storage'

export interface DispatchExpectation { commandId: string; target: string }
export interface DataManifestLimits {
  maxCommands: number; maxDispatch: number; maxObservations: number; maxPayloads: number
  maxPayloadBytes: number; maxTotalPayloadBytes: number
}
export interface DataSubjectExpectation {
  sourceSha: string
  snapshotFormat: 1 | 2
  /** Expected actual state root; omitted means use the opened store root. */
  dataRoot?: string
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: { workId: string; revision: number; digest: string }
  questionId: string
  answerId: string
  requiredCommandIds: string[]
  requiredDispatch: DispatchExpectation[]
  requiredDeliveryTargets: string[]
  requiredObservationFactIds?: string[]
  limits?: Partial<DataManifestLimits>
}

export const DEFAULT_DATA_MANIFEST_LIMITS: DataManifestLimits = Object.freeze({
  maxCommands: 64, maxDispatch: 64, maxObservations: 256, maxPayloads: 128,
  maxPayloadBytes: 1024 * 1024, maxTotalPayloadBytes: 4 * 1024 * 1024,
})

export interface DataManifest {
  protocol: 'wave24-data-manifest/1'
  subject: {
    sourceSha: string; dataRoot: string; snapshotFormat: 1 | 2
    ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number
    contract: { workId: string; revision: number; digest: string }
  }
  sourceFingerprint: string | null
  binding: {
    attemptId: string; ticketId: string; assignmentId: string; fenceEpoch: number
    contract: { workId: string; revision: number; digest: string }
    state: string; runnerIdentityRef: string; sessionSource: string
    resources: { ref: string; ownership: string }[]
  }
  currentAttemptId: string | null
  question: { id: string; version: number; validity: string; targetIds: string[] }
  answer: { id: string; questionId: string; expectedVersion: number; digest: string }
  deliveries: { targetBindingId: string; status: string }[]
  commands: { id: string; status: string; payloadDigest: string; seq: number; resultDigest: string | null }[]
  dispatch: { commandId: string; target: string; delivery: string; nativeRef: string | null; error: string | null }[]
  observations: { factId: string; kind: string; disposition: string; payloadRef: string; payloadSha256: string; bytes: number }[]
  requirements: {
    commandIds: string[]; dispatch: DispatchExpectation[]; deliveryTargets: string[]; observationFactIds: string[]
  }
  coverage: { commands: 'complete'; dispatch: 'complete'; observations: 'complete'; deliveries: 'complete'; payloads: 'complete' }
  limits: DataManifestLimits
  counts: { commands: number; dispatch: number; observations: number; deliveries: number; payloads: number; payloadBytes: number }
  digest: string
}
type ManifestBody = Omit<DataManifest, 'digest'>

const sha = (value: Json): string => createHash('sha256').update(canonicalJson(value)).digest('hex')
const unique = (values: string[], name: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${name} contains duplicate IDs`)
}
const sortedUnique = (values: readonly string[], name: string): string[] => {
  if (values.length === 0) throw new Error(`${name} must contain at least one required item`)
  unique([...values], name)
  return [...values].sort()
}
function limitsFor(input?: Partial<DataManifestLimits>): DataManifestLimits {
  const limits = { ...DEFAULT_DATA_MANIFEST_LIMITS, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid manifest limit ${name}`)
  }
  return limits as DataManifestLimits
}

interface SyncSnapshot {
  binding: any; currentAttemptId: string | null; question: any; answer: any; deliveries: { targetBindingId: string; status: string }[]
  commands: DataManifest['commands']; dispatch: DataManifest['dispatch']; observations: DataManifest['observations']
  sourceFingerprint: string | null
}

/** Reads related indexes in one synchronous UoW and verifies the complete subject before any payload await. */
function readSubject(store: ProductStore, expected: DataSubjectExpectation, limits: DataManifestLimits): SyncSnapshot {
  return store.uow.atomic(() => {
    const binding = store.bindings.binding<any>(expected.attemptId)
    if (!binding) throw new Error(`Unknown attempt ${expected.attemptId}`)
    if (binding.ticketId !== expected.ticketId || binding.assignmentId !== expected.assignmentId ||
      binding.fenceEpoch !== expected.fenceEpoch ||
      canonicalJson(binding.contract as Json) !== canonicalJson(expected.contract as Json))
      throw new Error('Attempt/ticket/assignment/contract/epoch does not match the expected original subject')
    const current = store.bindings.current<any>(expected.ticketId)
    const question = store.product.questions.get(expected.questionId)
    if (!question) throw new Error(`Unknown question ${expected.questionId}`)
    if (question.validity !== 'answered') throw new Error('Question is not answered')
    const target = question.targets.find((value: any) => value.id !== undefined &&
      value.attemptId === expected.attemptId && value.ticketId === expected.ticketId &&
      value.assignmentId === expected.assignmentId && value.fenceEpoch === expected.fenceEpoch &&
      canonicalJson(value.contract as Json) === canonicalJson(expected.contract as Json))
    if (!target) throw new Error('Question targets do not belong to the expected attempt/contract/epoch')
    const answer = store.answers.get(expected.answerId)
    if (!answer || answer.questionId !== question.id) throw new Error('Answer does not belong to the expected question')
    if (answer.expectedVersion > question.version) throw new Error('Answer expectedVersion is newer than the question')
    const deliveries = store.answers.deliveries(expected.answerId).map(value => ({ targetBindingId: value.targetBindingId, status: value.status }))
    unique(expected.requiredDeliveryTargets, 'requiredDeliveryTargets')
    const targetIds = question.targets.map((value: any) => String(value.id))
    for (const required of expected.requiredDeliveryTargets) {
      if (!targetIds.includes(required)) throw new Error(`Required delivery target ${required} is foreign to the question`)
      if (!deliveries.some(value => value.targetBindingId === required)) throw new Error(`Required delivery ${required} is missing`)
    }
    const commands = sortedUnique(expected.requiredCommandIds, 'requiredCommandIds').map(id => {
      const receipt = store.commands.get(id)
      if (!receipt) throw new Error(`Required command receipt ${id} is missing`)
      return { id, status: receipt.status, payloadDigest: receipt.payloadDigest, seq: receipt.seq,
        resultDigest: receipt.result === null || receipt.result === undefined ? null : sha(JsonSchema.parse(receipt.result) as Json) }
    })
    if (commands.length > limits.maxCommands) throw new Error('Command count exceeds manifest limit')
    unique(expected.requiredDispatch.map(value => `${value.commandId}\u0000${value.target}`), 'requiredDispatch')
    if (expected.requiredDispatch.length === 0) throw new Error('requiredDispatch must contain at least one item')
    if (expected.requiredDispatch.length > limits.maxDispatch) throw new Error('Dispatch count exceeds manifest limit')
    const dispatch = expected.requiredDispatch.map(({ commandId, target }) => {
      const value = store.dispatch.get(commandId, target)
      if (!value) throw new Error(`Required dispatch ${commandId}/${target} is missing`)
      return { commandId, target, delivery: value.delivery, nativeRef: value.nativeRef ?? null, error: value.error ?? null }
    }).sort((left, right) => `${left.commandId}\u0000${left.target}`.localeCompare(`${right.commandId}\u0000${right.target}`))
    const observations = store.observations.forAttempt(expected.attemptId).map(row => ({
      factId: row.factId, kind: row.kind, disposition: row.disposition, payloadRef: row.payloadRef,
      payloadSha256: row.payloadSha256, bytes: 0,
    })).sort((left, right) => left.factId.localeCompare(right.factId))
    if (observations.length === 0) throw new Error('Attempt has no observed facts')
    if (observations.length > limits.maxObservations) throw new Error('Observation count exceeds manifest limit')
    const requiredFacts = expected.requiredObservationFactIds
      ? sortedUnique(expected.requiredObservationFactIds, 'requiredObservationFactIds') : observations.map(value => value.factId)
    for (const factId of requiredFacts) if (!observations.some(value => value.factId === factId))
      throw new Error(`Required observation ${factId} is missing`)
    const source = store.workflows.recoverySource.inspect()
    if (source.coverage !== 'complete' || !source.sourceFingerprint) throw new Error('Logical source is not complete')
    return { binding, currentAttemptId: current?.attemptId ?? null, question, answer, deliveries, commands, dispatch,
      observations, sourceFingerprint: source.sourceFingerprint }
  })
}

function stableSubject(snapshot: SyncSnapshot, expected: DataSubjectExpectation): Json {
  return {
    binding: { attemptId: snapshot.binding.attemptId, ticketId: snapshot.binding.ticketId,
      assignmentId: snapshot.binding.assignmentId, fenceEpoch: snapshot.binding.fenceEpoch,
      contract: snapshot.binding.contract, runnerIdentityRef: snapshot.binding.runnerIdentityRef,
      sessionSource: snapshot.binding.source,
      resources: snapshot.binding.resources.map((resource: any) => ({ ref: resource.ref, ownership: resource.ownership })) },
    currentAttemptId: snapshot.currentAttemptId,
    question: { id: snapshot.question.id, version: snapshot.question.version, validity: snapshot.question.validity,
      targetIds: snapshot.question.targets.map((value: any) => String(value.id)) },
    answer: { id: expected.answerId, questionId: snapshot.answer.questionId,
      expectedVersion: snapshot.answer.expectedVersion, digest: snapshot.answer.digest },
    deliveries: snapshot.deliveries,
    commands: snapshot.commands,
    dispatch: snapshot.dispatch,
    observations: snapshot.observations.map(value => ({ ...value, bytes: 0 })),
    requirements: { commandIds: [...expected.requiredCommandIds].sort(),
      dispatch: [...expected.requiredDispatch].sort((left, right) => `${left.commandId}\u0000${left.target}`.localeCompare(`${right.commandId}\u0000${right.target}`)),
      deliveryTargets: [...expected.requiredDeliveryTargets].sort(),
      observationFactIds: expected.requiredObservationFactIds ? [...expected.requiredObservationFactIds].sort() : snapshot.observations.map(value => value.factId) },
    sourceFingerprint: snapshot.sourceFingerprint,
  } as unknown as Json
}


const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HEX64 = /^[a-f0-9]{64}$/
/** Runtime parser for JSON/typed producer input; rejects unknown fields and incomplete sets. */
export function parseDataSubjectExpectation(value: unknown): DataSubjectExpectation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected subject must be an object')
  const allowed = new Set(['sourceSha', 'snapshotFormat', 'dataRoot', 'ticketId', 'assignmentId', 'attemptId',
    'fenceEpoch', 'contract', 'questionId', 'answerId', 'requiredCommandIds', 'requiredDispatch',
    'requiredDeliveryTargets', 'requiredObservationFactIds', 'limits'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown expected subject field ${key}`)
  const input = value as Record<string, any>
  const id = (name: string): string => { if (typeof input[name] !== 'string' || !ID.test(input[name])) throw new Error(`Invalid ${name}`); return input[name] }
  if (typeof input.sourceSha !== 'string' || !/^[a-f0-9]{7,128}$/.test(input.sourceSha)) throw new Error('Invalid sourceSha')
  if (input.snapshotFormat !== 1 && input.snapshotFormat !== 2) throw new Error('snapshotFormat must be 1 or 2')
  if (input.dataRoot !== undefined && (typeof input.dataRoot !== 'string' || !input.dataRoot.startsWith('/'))) throw new Error('dataRoot must be absolute')
  const contract = input.contract
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('Invalid contract')
  for (const key of Object.keys(contract)) if (!['workId', 'revision', 'digest'].includes(key)) throw new Error(`Unknown contract field ${key}`)
  if (typeof contract.workId !== 'string' || !ID.test(contract.workId) || !Number.isSafeInteger(contract.revision) || contract.revision < 1 || !HEX64.test(contract.digest))
    throw new Error('Invalid contract identity')
  if (!Number.isSafeInteger(input.fenceEpoch) || input.fenceEpoch < 1) throw new Error('Invalid fenceEpoch')
  const required = (name: string): string[] => { const list = input[name]; if (!Array.isArray(list) || list.length === 0 || list.some(item => typeof item !== 'string' || !ID.test(item))) throw new Error(`Invalid ${name}`); return [...list] }
  const dispatches = input.requiredDispatch
  if (!Array.isArray(dispatches) || dispatches.length === 0) throw new Error('Invalid requiredDispatch')
  const dispatch = dispatches.map((entry: any) => {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'commandId,target' ||
      typeof entry.commandId !== 'string' || !ID.test(entry.commandId) || typeof entry.target !== 'string' || !entry.target.length || entry.target.length > 1024)
      throw new Error('Invalid requiredDispatch entry')
    return { commandId: entry.commandId, target: entry.target }
  })
  const limits = input.limits
  if (limits !== undefined && (!limits || typeof limits !== 'object' || Array.isArray(limits))) throw new Error('Invalid limits')
  if (limits) for (const key of Object.keys(limits)) if (!(key in DEFAULT_DATA_MANIFEST_LIMITS)) throw new Error(`Unknown manifest limit ${key}`)
  return {
    sourceSha: input.sourceSha, snapshotFormat: input.snapshotFormat,
    ...(input.dataRoot === undefined ? {} : { dataRoot: input.dataRoot }),
    ticketId: id('ticketId'), assignmentId: id('assignmentId'), attemptId: id('attemptId'),
    fenceEpoch: input.fenceEpoch, contract: { workId: contract.workId, revision: contract.revision, digest: contract.digest },
    questionId: id('questionId'), answerId: id('answerId'),
    requiredCommandIds: required('requiredCommandIds'), requiredDispatch: dispatch,
    requiredDeliveryTargets: required('requiredDeliveryTargets'),
    ...(input.requiredObservationFactIds === undefined ? {} : { requiredObservationFactIds: required('requiredObservationFactIds') }),
    ...(limits === undefined ? {} : { limits: { ...limits } }),
  }
}

export async function buildDataManifest(store: ProductStore, input: DataSubjectExpectation | unknown): Promise<DataManifest> {
  const expected = parseDataSubjectExpectation(input)
  const limits = limitsFor(expected.limits)
  const dataRoot = dirname(store.database.path)
  if (expected.dataRoot && expected.dataRoot !== dataRoot) throw new Error('Expected data root does not match the opened store')
  const before = readSubject(store, expected, limits)
  const payloads = new Map<string, number>()
  let totalPayloadBytes = 0
  for (const observation of before.observations) {
    if (payloads.has(observation.payloadRef)) { observation.bytes = payloads.get(observation.payloadRef)!; continue }
    if (payloads.size >= limits.maxPayloads) throw new Error('Payload count exceeds manifest limit')
    const payload = await store.payloads.read(observation.payloadRef)
    if (payload.sha256 !== observation.payloadSha256) throw new Error(`Payload ${observation.payloadRef} digest differs from observation`)
    const bytes = new TextEncoder().encode(canonicalJson(JsonSchema.parse(payload.value) as Json)).byteLength
    if (bytes > limits.maxPayloadBytes) throw new Error(`Payload ${observation.payloadRef} exceeds byte limit`)
    totalPayloadBytes += bytes
    if (totalPayloadBytes > limits.maxTotalPayloadBytes) throw new Error('Total payload bytes exceed manifest limit')
    payloads.set(observation.payloadRef, bytes); observation.bytes = bytes
  }
  const after = readSubject(store, expected, limits)
  if (canonicalJson(stableSubject(before, expected)) !== canonicalJson(stableSubject(after, expected)))
    throw new Error('Original subject or source changed while payload bytes were read')
  for (const observation of after.observations) observation.bytes = payloads.get(observation.payloadRef) ?? 0
  const body: ManifestBody = {
    protocol: 'wave24-data-manifest/1',
    subject: { sourceSha: expected.sourceSha, dataRoot, snapshotFormat: expected.snapshotFormat,
      ticketId: expected.ticketId, assignmentId: expected.assignmentId, attemptId: expected.attemptId,
      fenceEpoch: expected.fenceEpoch, contract: expected.contract },
    sourceFingerprint: after.sourceFingerprint,
    binding: { attemptId: after.binding.attemptId, ticketId: after.binding.ticketId,
      assignmentId: after.binding.assignmentId, fenceEpoch: after.binding.fenceEpoch,
      contract: after.binding.contract, state: after.binding.state, runnerIdentityRef: after.binding.runnerIdentityRef,
      sessionSource: after.binding.source,
      resources: after.binding.resources.map((resource: any) => ({ ref: resource.ref, ownership: resource.ownership })) },
    currentAttemptId: after.currentAttemptId,
    question: { id: after.question.id, version: after.question.version, validity: after.question.validity,
      targetIds: after.question.targets.map((value: any) => String(value.id)) },
    answer: { id: expected.answerId, questionId: after.answer.questionId,
      expectedVersion: after.answer.expectedVersion, digest: after.answer.digest },
    deliveries: after.deliveries,
    commands: after.commands,
    dispatch: after.dispatch,
    observations: after.observations,
    requirements: { commandIds: [...expected.requiredCommandIds].sort(),
      dispatch: [...expected.requiredDispatch].sort((left, right) => `${left.commandId}\u0000${left.target}`.localeCompare(`${right.commandId}\u0000${right.target}`)),
      deliveryTargets: [...expected.requiredDeliveryTargets].sort(),
      observationFactIds: expected.requiredObservationFactIds ? [...expected.requiredObservationFactIds].sort() : after.observations.map(value => value.factId) },
    coverage: { commands: 'complete', dispatch: 'complete', observations: 'complete', deliveries: 'complete', payloads: 'complete' },
    limits,
    counts: { commands: after.commands.length, dispatch: after.dispatch.length, observations: after.observations.length,
      deliveries: after.deliveries.length, payloads: payloads.size, payloadBytes: totalPayloadBytes },
  }
  return { ...body, digest: sha(body as unknown as Json) }
}

export async function verifyDataManifest(store: ProductStore, manifest: DataManifest,
  input: DataSubjectExpectation | unknown): Promise<{ ok: true; coverage: DataManifest['coverage'] } | { ok: false; reason: string }> {
  let expected: DataSubjectExpectation
  try { expected = parseDataSubjectExpectation(input) } catch (error) { return { ok: false, reason: `invalid expected subject: ${String(error)}` } }
  if (manifest.protocol !== 'wave24-data-manifest/1') return { ok: false, reason: 'unsupported manifest protocol' }
  if (manifest.subject.sourceSha !== expected.sourceSha) return { ok: false, reason: 'source SHA differs from expectation' }
  if (manifest.subject.snapshotFormat !== expected.snapshotFormat) return { ok: false, reason: 'snapshot format differs from expectation' }
  const { digest, ...body } = manifest
  if (digest !== sha(body as unknown as Json)) return { ok: false, reason: 'manifest digest is inconsistent' }
  let rebuilt: DataManifest
  try { rebuilt = await buildDataManifest(store, expected) }
  catch (error) { return { ok: false, reason: `expected subject is no longer readable: ${String(error)}` } }
  const rebuiltBody = (({ digest: _digest, ...rest }) => rest)(rebuilt)
  if (canonicalJson(rebuiltBody as unknown as Json) !== canonicalJson(body as unknown as Json)) return { ok: false, reason: 'manifest differs from the expected complete subject' }
  return { ok: true, coverage: rebuilt.coverage }
}
