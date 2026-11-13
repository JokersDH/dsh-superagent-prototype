import { createHmac, timingSafeEqual } from 'node:crypto'
import { constants, fstatSync, openSync, closeSync, readFileSync, realpathSync } from 'node:fs'
import { arch, hostname, platform } from 'node:os'
import { dirname } from 'node:path'
import { z } from 'zod'
import { DigestSchema, IdSchema, ScopeSchema, TimestampSchema } from '@personal-agent/contracts'
import type { Scope } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { ApplicationFault } from '@personal-agent/application'
import { ProductRecovery } from './recovery.ts'

const SelectionSchema = z.strictObject({ projectId: IdSchema, allowedPaths: ScopeSchema.shape.allowedPaths,
  excludedPaths: ScopeSchema.shape.excludedPaths })
const PayloadSchema = z.strictObject({ protocol: z.literal('restored-personal-review/1'),
  stateRoot: z.string().min(1).max(4096), principal: z.strictObject({ userId: IdSchema, authorityRef: IdSchema }),
  markerDigest: DigestSchema, sourceFingerprint: DigestSchema, machineDigest: DigestSchema,
  createdAt: TimestampSchema, expiresAt: TimestampSchema,
  projects: z.array(SelectionSchema).min(1).max(20), access: z.literal('historical_data_read_only'), startupAvailable: z.literal(false) })
  .refine(value => new Set(value.projects.map(project => project.projectId)).size === value.projects.length &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt) && Date.parse(value.expiresAt) - Date.parse(value.createdAt) <= 300000,
  'A bounded review selection must have unique projects and a five-minute startup window')
const FileSchema = z.strictObject({ payload: PayloadSchema, signature: DigestSchema })
type Principal = { userId: string; authorityRef: string }
export type RestoredReviewProject = { id: string; displayName: string; scope: Scope; discussionOnly: true }
const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const machine = (secret: Uint8Array) => createHmac('sha256', secret).update(JSON.stringify({ host: hostname(), platform: platform(), arch: arch(), uid: process.getuid?.() ?? null })).digest('hex')
const signature = (payload: unknown, secret: Uint8Array) => createHmac('sha256', secret).update(`restored-personal-review/1:${digest(payload)}`).digest('hex')
const fault = () => new ApplicationFault('forbidden', 'The explicit restored review selection is unavailable, stale or belongs to another local state', 'none')

function source(store: ProductStore, stateRoot: string, principal: Principal) {
  if (dirname(realpathSync(store.db.name)) !== realpathSync(stateRoot)) throw fault()
  const inspection = new ProductRecovery(store, { stateRoot, startupMode: 'recovery_readonly', principal, projects: () => [] }).inspect()
  if (!inspection.markerDigest || inspection.logicalSource?.coverage !== 'complete' || !inspection.logicalSource.fingerprint ||
    inspection.blockers.some(blocker => ['marker_invalid', 'restore_evidence_unknown'].includes(blocker.code))) throw fault()
  return { root: realpathSync(stateRoot), markerDigest: inspection.markerDigest, sourceFingerprint: inspection.logicalSource.fingerprint }
}
function knownProject(store: ProductStore, projectId: string) {
  return !!store.workflows.projects.current(projectId) || store.product.works.listByProject(projectId, { limit: 1 }).length > 0 ||
    store.workflows.conversations.list({ projectIds: [projectId], includeArchived: true, limit: 1 }).conversations.length > 0
}

/** Explicit operator invocation creates private startup configuration, not a transferable or executable grant. */
export function prepareRestoredReview(store: ProductStore, stateRoot: string, principal: Principal, selections: unknown,
  secret: Uint8Array, now = new Date().toISOString()): z.infer<typeof FileSchema> {
  if (secret.byteLength < 32) throw new TypeError('Restored review requires the current local action key')
  const projects = z.array(SelectionSchema).min(1).max(20).parse(selections)
  return store.uow.atomic(() => {
    const current = source(store, stateRoot, principal)
    if (projects.some(project => !knownProject(store, project.projectId))) throw fault()
    const payload = PayloadSchema.parse({ protocol: 'restored-personal-review/1', stateRoot: current.root, principal,
      markerDigest: current.markerDigest, sourceFingerprint: current.sourceFingerprint, machineDigest: machine(secret),
      createdAt: now, expiresAt: new Date(Date.parse(now) + 300000).toISOString(), projects,
      access: 'historical_data_read_only', startupAvailable: false })
    return FileSchema.parse({ payload, signature: signature(payload, secret) })
  })
}

/** Applied only when the operator supplies this file on a restored personal startup; never auto-loaded from a backup. */
export function loadRestoredReview(path: string, store: ProductStore, stateRoot: string, principal: Principal,
  secret: Uint8Array, now = new Date().toISOString()): RestoredReviewProject[] {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let file: z.infer<typeof FileSchema>
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 131072 || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid())) throw fault()
      file = FileSchema.parse(JSON.parse(readFileSync(fd, 'utf8')))
    } finally { closeSync(fd) }
    const actual = Buffer.from(file.signature), expected = Buffer.from(signature(file.payload, secret))
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw fault()
    return store.uow.atomic(() => {
      const current = source(store, stateRoot, principal), payload = file.payload, at = Date.parse(now)
      if (payload.stateRoot !== current.root || digest(payload.principal) !== digest(principal) ||
        payload.sourceFingerprint !== current.sourceFingerprint || payload.markerDigest !== current.markerDigest ||
        payload.machineDigest !== machine(secret) || Date.parse(payload.createdAt) > at || Date.parse(payload.expiresAt) <= at) throw fault()
      return payload.projects.map(project => {
        if (!knownProject(store, project.projectId)) throw fault()
        return { id: project.projectId, displayName: store.workflows.projects.current(project.projectId)?.settings.displayName ?? project.projectId,
          scope: ScopeSchema.parse({ projectId: project.projectId, allowedPaths: project.allowedPaths, excludedPaths: project.excludedPaths, externalActions: [] }),
          discussionOnly: true as const }
      })
    })
  } catch { throw fault() }
}

