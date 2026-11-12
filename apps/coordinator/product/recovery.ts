import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { JsonSchema, RecoveryInspectionSchema, RecoveryPlanSchema, RecoveryPrepareSchema, RecoverySourceCheckpointSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { AgentProfile, RecoveryInspection, RecoveryPlan, RecoveryPrepare, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { NativeProjectRegistry } from './project-registry.ts'
import { admittedNativeProfile } from './native-startup.ts'

const RestoreEnvelopeSchema = z.object({ protocol: z.literal('personal-restore/1'), targetPath: z.string().min(1),
  database: z.object({ integrity: z.literal('ok'), foreignKeyViolations: z.literal(0), productSchema: z.number().int().nonnegative().nullable() }).passthrough(),
  evidence: z.object({ status: z.enum(['verified', 'not_recorded']) }).passthrough().optional(),
}).passthrough()
const digest = (value: unknown) => canonicalDigest(JsonSchema.parse(value))
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Read-only restore diagnostics and binding preflight. This class has no execution-authority writer. */
export class ProductRecovery {
  private readonly store: ProductStore
  private readonly options: {
    stateRoot: string; startupMode: 'normal' | 'recovery_readonly'; principal: { userId: string; authorityRef: string }
    projects(): readonly { id: string; displayName?: string }[]
    executor?: () => AgentProfile
    now?: () => string
  }
  constructor(store: ProductStore, options: ProductRecovery['options']) { this.store = store; this.options = options }
  private now() { return this.options.now?.() ?? new Date().toISOString() }
  private logicalSource(): NonNullable<RecoveryInspection['logicalSource']> {
    try {
      const source = RecoverySourceCheckpointSchema.parse(this.store.workflows.recoverySource.inspect())
      return { coverage: source.coverage, fingerprint: source.coverage === 'complete' ? source.sourceFingerprint : null }
    } catch { return { coverage: 'unsupported', fingerprint: null } }
  }
  inspect(): RecoveryInspection {
    return this.store.uow.atomic(() => this.inspectSnapshot())
  }
  private inspectSnapshot(): RecoveryInspection {
    const facts = this.store.workflows.index.stateFacts(), eventCursor = this.store.events.cursor()
    const logicalSource = this.logicalSource()
    const projects = this.options.projects().map(project => ({ id: project.id, displayName: project.displayName ?? project.id }))
    const blockers: RecoveryInspection['blockers'][number][] = []
    if (logicalSource.coverage !== 'complete') blockers.push({ code: 'source_checkpoint_unavailable', owner: 'A',
      detail: 'The logical source is bounded, unsupported or unreadable; no binding plan can be prepared' })
    const file = join(this.options.stateRoot, 'restore-report.json')
    let markerDigest: string | null = null
    const active = this.options.startupMode === 'recovery_readonly'
    if (!active) blockers.push({ code: 'not_restored', owner: 'main', detail: 'This instance is not a restored read-only state' })
    else {
      try {
        const stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 256 * 1024 ||
          (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe restore marker')
        const bytes = readFileSync(file), marker = RestoreEnvelopeSchema.parse(JSON.parse(bytes.toString('utf8')))
        markerDigest = sha(bytes)
        if (realpathSync(marker.targetPath) !== realpathSync(this.options.stateRoot)) throw new Error('Marker belongs to another state')
        if (marker.evidence?.status !== 'verified') blockers.push({ code: 'restore_evidence_unknown', owner: 'D', detail: 'The restore marker does not attest complete bundle evidence' })
      } catch { blockers.push({ code: 'marker_invalid', owner: 'D', detail: 'Restore marker is missing, unsafe, invalid or bound to another state' }) }
    }
    const works = [], projectIds = projects.map(project => project.id)
    let cursor: string | undefined
    for (let page = 0; page < 2; page++) {
      const result = this.store.workflows.index.listWorks({ projectIds, limit: 100, ...(cursor ? { cursor } : {}) })
      works.push(...result.works); cursor = result.nextCursor
      if (!cursor) break
    }
    if (cursor) blockers.push({ code: 'source_scan_bounded', owner: 'main', detail: 'More than 200 source works require additional resource inspection' })
    const attempts = new Map<string, RecoveryInspection['historicalAttempts'][number]>()
    const bindingDigests: string[] = []
    for (const work of works) for (const link of this.store.product.links.listByWork(work.id)) {
      const binding = this.store.bindings.current(link.ticketId)
      if (!binding) continue
      bindingDigests.push(digest(binding))
      if (attempts.size < 1024) attempts.set(binding.attemptId, { attemptId: binding.attemptId, state: binding.state, proof: 'needs_fresh_revalidation' })
    }
    if (attempts.size) blockers.push({ code: 'historical_resources_need_revalidation', owner: 'B', detail: 'Historical binding states and old quiescence records are not fresh local resource proof' })
    blockers.push({ code: 'authorization_not_implemented', owner: 'main', detail: 'Recovery authorization commit is not connected; old business queues remain disabled' })
    const body = { markerDigest, productSchema: facts.productSchema, eventCursor, heldQueue: facts.queue,
      projects, works: works.map(work => work.id), bindings: bindingDigests.sort(), writer: facts.writerClaim, logicalSource }
    return RecoveryInspectionSchema.parse({ protocol: 'recovery-inspection/1', state: active ? 'recovery_readonly' : 'normal',
      observedAt: this.now(), inspectionFingerprint: digest(body), markerDigest, productSchema: facts.productSchema, eventCursor,
      heldQueue: facts.queue, sourceWorksScanned: works.length, sourceScanTruncated: !!cursor,
      logicalSource,
      projects, historicalAttempts: [...attempts.values()], blockers, commitAvailable: false })
  }
  prepare(input: RecoveryPrepare, inputActor: TrustedActor): RecoveryPlan {
    const value = RecoveryPrepareSchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (actor.userId !== this.options.principal.userId || actor.authorityRef !== this.options.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Recovery preflight requires the authenticated local user', 'none')
    const before = this.inspect()
    if (before.state !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Recovery preflight is only available for restored state')
    if (before.inspectionFingerprint !== value.expectedFingerprint) throw new ApplicationFault('conflict', 'Recovery inspection changed; inspect again')
    if (before.blockers.some(blocker => blocker.code === 'marker_invalid')) throw new ApplicationFault('verification_failed', 'Restore marker cannot be verified')
    if (before.logicalSource?.coverage !== 'complete') throw new ApplicationFault('verification_failed', 'The recovery logical source is not complete')
    const registry = new NativeProjectRegistry(this.options.stateRoot)
    const proposed = new Set<string>()
    const bindings = value.bindings.map(binding => {
      if (!before.projects.some(project => project.id === binding.sourceProjectId)) throw new ApplicationFault('forbidden', 'Recovery binding refers to an unconfigured source project', 'none')
      const record = registry.prepare(binding.project, { allowSettingsChange: true, readOnlyInspection: true })
      if (proposed.has(record.id)) throw new ApplicationFault('invalid_request', 'Multiple source projects cannot silently collapse into the same target')
      proposed.add(record.id)
      const headCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: record.path, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
      return { sourceProjectId: binding.sourceProjectId, proposedProjectId: record.id, path: record.path, headCommit,
        configurationDigest: digest({ record, check: registry.check(record), environment: registry.environment(record) ?? null }),
        scopeDigest: digest(registry.scope(record)) }
    })
    const blockers = [...before.blockers]
    let executor: RecoveryPlan['executor'] = null
    try {
      const profile = (this.options.executor ?? admittedNativeProfile)()
      executor = { profileId: profile.id, revision: profile.revision, version: profile.expectedVersion,
        executableDigest: sha(readFileSync(profile.executable)) }
    } catch { blockers.push({ code: 'executor_unavailable', owner: 'B', detail: 'The current local executable/version cannot be verified; no native task was started' }) }
    let artifactsChecked = 0, next: string | undefined
    for (let page = 0; page < 5; page++) {
      const result = this.store.artifacts.list({ limit: 200, ...(next ? { before: next } : {}) })
      for (const artifact of result.artifacts) {
        try { if (!this.store.artifacts.read(artifact.id)) throw new Error('Missing artifact'); artifactsChecked++ }
        catch { if (!blockers.some(blocker => blocker.code === 'artifact_missing_or_corrupt')) blockers.push({ code: 'artifact_missing_or_corrupt', owner: 'D', detail: 'At least one registered artifact is missing or corrupt' }) }
      }
      next = result.nextCursor
      if (!next) break
    }
    if (next) blockers.push({ code: 'artifact_scan_bounded', owner: 'main', detail: 'More than 1000 artifacts require additional byte verification' })
    if (this.inspect().inspectionFingerprint !== before.inspectionFingerprint) throw new ApplicationFault('conflict', 'Recovery source changed while preparing bindings')
    const createdAt = this.now()
    return RecoveryPlanSchema.parse({ protocol: 'recovery-plan/1', planId: `recovery-plan-${randomUUID()}`,
      inspectionFingerprint: before.inspectionFingerprint, createdAt, expiresAt: new Date(Date.parse(createdAt) + 300000).toISOString(),
      logicalSource: before.logicalSource,
      bindings, executor, artifactsChecked, artifactScanTruncated: !!next, blockers, authorization: 'not_granted', commitAvailable: false })
  }
}
