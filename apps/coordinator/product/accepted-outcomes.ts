import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { z } from 'zod'
import { AttemptSpecSchema, CandidateRefSchema, ExecutionProfileRefSchema, JsonSchema } from '@personal-agent/contracts'
import type { AttemptSpec, CandidateRef, ExecutionProfileRef } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore, AcceptanceProjectionResult } from '@personal-agent/storage'

const ProfileSnapshotSchema = z.strictObject({ protocol: z.literal('attempt-profile-snapshot/1'), spec: AttemptSpecSchema,
  executableDigest: z.string().regex(/^[a-f0-9]{64}$/), appliedPolicy: JsonSchema,
  platform: z.string(), architecture: z.string(), runtimeVersion: z.string() })
const SnapshotReceiptSchema = z.strictObject({ profileRef: ExecutionProfileRefSchema, snapshot: ProfileSnapshotSchema,
  layer: z.enum(['controlled', 'operator_note']) })
const receiptId = (assignmentId: string) => key('attempt-profile-snapshot', assignmentId)
const same = (a: unknown, b: unknown) => canonicalDigest(JsonSchema.parse(a)) === canonicalDigest(JsonSchema.parse(b))

/** Archive the actual prepared attempt inputs before begin. This is audit identity, not a Catalog admission. */
export async function captureAttemptProfile(store: ProductStore, input: AttemptSpec, preparedPolicyRef: string): Promise<void> {
  const spec = AttemptSpecSchema.parse(input), policy = await store.payloads.read(preparedPolicyRef)
  const executableHash = createHash('sha256')
  for await (const bytes of createReadStream(spec.profile.executable)) executableHash.update(bytes)
  const snapshot = ProfileSnapshotSchema.parse({ protocol: 'attempt-profile-snapshot/1', spec, appliedPolicy: policy.value,
    executableDigest: executableHash.digest('hex'),
    platform: process.platform, architecture: process.arch, runtimeVersion: process.version })
  const identityDigest = canonicalDigest(JsonSchema.parse(snapshot))
  const body = SnapshotReceiptSchema.parse({ snapshot,
    profileRef: { profileId: spec.profile.id, revision: spec.profile.revision, identityDigest },
    layer: spec.profile.driverId === 'controlled-product-fixture' ? 'controlled' : 'operator_note' })
  store.commands.record(receiptId(spec.assignmentId), canonicalDigest(JsonSchema.parse(body)), () => body)
}

/** Only a trusted accepted event plus its own archived attempt profile can feed A's projection. */
export function projectAcceptedOutcome(store: ProductStore, eventSeq: number, input: CandidateRef): AcceptanceProjectionResult {
  const candidate = CandidateRefSchema.parse(input)
  const event = store.events.after(eventSeq - 1, 1)[0]
  const eventCandidate = CandidateRefSchema.safeParse((event?.payload as { candidate?: unknown } | undefined)?.candidate)
  if (!event || event.seq !== eventSeq || event.topic !== 'application.candidate.accepted' || event.entityRef !== candidate.contract.workId ||
    !eventCandidate.success || !same(eventCandidate.data, candidate))
    return { status: 'conflict', eventSeq, reasons: ['accepted_event_identity_mismatch'] }
  const stored = store.commands.get(receiptId(candidate.assignmentId))
  const parsed = stored && SnapshotReceiptSchema.safeParse(stored.result)
  if (!parsed?.success) return { status: 'incomplete', eventSeq, reasons: ['profile_snapshot_missing'] }
  const { snapshot, profileRef, layer } = parsed.data, spec = snapshot.spec
  if (spec.ticketId !== candidate.ticketId || spec.assignmentId !== candidate.assignmentId || !same(spec.contract, candidate.contract) ||
    profileRef.identityDigest !== canonicalDigest(JsonSchema.parse(snapshot)))
    return { status: 'conflict', eventSeq, reasons: ['profile_snapshot_identity_mismatch'] }
  const binding = store.bindings.binding(spec.attemptId)
  const project = store.product.works.get(candidate.contract.workId)?.projectId
  if (!project || !binding || binding.assignmentId !== spec.assignmentId || binding.fenceEpoch !== spec.fenceEpoch ||
    !same(binding.contract, spec.contract) || (layer === 'controlled' && binding.source !== 'controlled-product-fixture'))
    return { status: 'incomplete', eventSeq, reasons: ['profile_attempt_source_mismatch'] }
  return store.workflows.acceptance.consume({ eventSeq, projectId: project, profileRef: profileRef as ExecutionProfileRef, layer })
}
