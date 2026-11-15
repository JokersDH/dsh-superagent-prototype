/**
 * Re-binding a project to a new root (migration / colleague hand-over).
 *
 * This module answers one question with data: *does the metadata we observe now match the facts a
 * previous suggestion was produced from, and if not, which fields moved?* It never decides that a
 * migration succeeded, never carries a credential or grant from the old project, and never writes a
 * registry, database or root mapping — main owns registration and the original confirmation.
 *
 * The report contains only digests, timestamps, field names and a bounded note list: no absolute
 * root, no metadata body, no secret.
 */
import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from '@personal-agent/contracts'
import type { Json } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProjectFactsSchema, factsContentDigest, type ProjectFacts } from './facts.ts'
import { observeProjectMetadata, MetadataRefused, type MetadataLimits, type RegisteredProjectRoots } from './observe.ts'

export const REBIND_PROTOCOL = 'project-facts-rebind/1' as const

/** Field-level reasons a previous observation no longer describes the project. */
export const REBIND_FIELDS = ['stack', 'manager', 'packageJson', 'lockfile', 'workspace', 'scripts', 'languages', 'observation'] as const
export type RebindField = (typeof REBIND_FIELDS)[number]

export const RebindReportSchema = z.strictObject({
  protocol: z.literal(REBIND_PROTOCOL),
  projectId: IdSchema,
  /** `unbound` = the project has no registered root right now; `foreign` = previous facts are another project. */
  status: z.enum(['current', 'changed', 'unbound', 'foreign']),
  changes: z.array(z.enum(REBIND_FIELDS)).max(REBIND_FIELDS.length).readonly(),
  previous: z
    .strictObject({ contentDigest: DigestSchema, observedAt: TimestampSchema, provider: z.string().trim().min(1).max(160) })
    .nullable(),
  current: z
    .strictObject({
      contentDigest: DigestSchema,
      digest: DigestSchema,
      observedAt: TimestampSchema,
      provider: z.string().trim().min(1).max(160),
      source: z.enum(['injected', 'authorized_metadata']),
    })
    .nullable(),
  notes: z.array(z.string().trim().min(1).max(400)).max(16).readonly(),
  /** Re-binding only re-observes metadata; the report is never an authorization. */
  authorization: z.literal('none'),
})
export type RebindReport = z.infer<typeof RebindReportSchema>

export type RebindErrorCode = 'invalid_previous' | 'invalid_clock'

export class RebindError extends Error {
  readonly code: RebindErrorCode
  constructor(code: RebindErrorCode, message: string) {
    super(message)
    this.name = 'RebindError'
    this.code = code
  }
}

const sorted = (values: readonly string[]): string => [...values].sort().join('\u0000')

/** Which observable fields differ between two facts of the same project. */
export function changedFields(previous: ProjectFacts, current: ProjectFacts): RebindField[] {
  const changes = new Set<RebindField>()
  if (previous.stack.kind !== current.stack.kind) changes.add('stack')
  if (previous.stack.kind === 'node' && current.stack.kind === 'node') {
    if (previous.stack.packageManagerField !== current.stack.packageManagerField) changes.add('manager')
    if (previous.stack.enginesNode !== current.stack.enginesNode) changes.add('packageJson')
  }
  const managerChanged =
    previous.manager.kind !== current.manager.kind ||
    ((previous.manager.kind === 'pnpm' || previous.manager.kind === 'npm') &&
      (current.manager.kind === 'pnpm' || current.manager.kind === 'npm') &&
      previous.manager.declaredVersion !== current.manager.declaredVersion)
  if (managerChanged) changes.add('manager')
  if (sorted(previous.locks.map((lock) => lock.name)) !== sorted(current.locks.map((lock) => lock.name)) ||
    sorted(previous.locks.map((lock) => lock.digest ?? '-')) !== sorted(current.locks.map((lock) => lock.digest ?? '-')))
    changes.add('lockfile')
  if (previous.workspace.declaration !== current.workspace.declaration) changes.add('workspace')
  if (sorted(previous.scripts) !== sorted(current.scripts)) changes.add('scripts')
  if (sorted(previous.languages) !== sorted(current.languages)) changes.add('languages')
  if (sorted(previous.missing) !== sorted(current.missing) ||
    JSON.stringify([...previous.omissions].sort((a, b) => a.field.localeCompare(b.field))) !==
      JSON.stringify([...current.omissions].sort((a, b) => a.field.localeCompare(b.field))))
    changes.add('observation')
  return (REBIND_FIELDS as readonly RebindField[]).filter((field) => changes.has(field))
}

/**
 * Compare a previous observation with a fresh one. Same project + same content is `current`; a
 * different project identity is `foreign` and never becomes a suggestion for the requested one.
 */
export function compareProjectFacts(previous: ProjectFacts, current: ProjectFacts): RebindReport {
  const previousIdentity = {
    contentDigest: factsContentDigest(previous),
    observedAt: previous.observedAt,
    provider: previous.provenance.provider,
  }
  const contentDigest = factsContentDigest(current)
  const currentIdentity = {
    contentDigest,
    digest: canonicalDigest(current as unknown as Json),
    observedAt: current.observedAt,
    provider: current.provenance.provider,
    source: current.provenance.source,
  }
  if (previous.projectId !== current.projectId)
    return {
      protocol: REBIND_PROTOCOL,
      projectId: current.projectId,
      status: 'foreign',
      changes: [],
      previous: previousIdentity,
      current: currentIdentity,
      notes: [`上一次观察属于另一个项目（${previous.projectId}），不能复用为当前项目的建议。`],
      authorization: 'none',
    }
  if (contentDigest === previousIdentity.contentDigest)
    return {
      protocol: REBIND_PROTOCOL,
      projectId: current.projectId,
      status: 'current',
      changes: [],
      previous: previousIdentity,
      current: currentIdentity,
      notes: ['内容未变化；可沿用已生成建议，仍以原确认流程为准。'],
      authorization: 'none',
    }
  const changes = changedFields(previous, current)
  return {
    protocol: REBIND_PROTOCOL,
    projectId: current.projectId,
    status: 'changed',
    changes,
    previous: previousIdentity,
    current: currentIdentity,
    notes: [`项目元数据已变化（${changes.join(', ')}）；请用当前配置重新生成建议，旧草稿不再适用。`],
    authorization: 'none',
  }
}

/** Observation without a registered root: the report says `unbound` instead of guessing a path. */
const foreign = (previous: ProjectFacts, projectId: string): RebindReport => ({
  protocol: REBIND_PROTOCOL,
  projectId,
  status: 'foreign',
  changes: [],
  previous: { contentDigest: factsContentDigest(previous), observedAt: previous.observedAt, provider: previous.provenance.provider },
  current: null,
  notes: [`请求的项目 ${projectId} 与上一次观察的项目 ${previous.projectId} 不一致；不能复用旧观察。`],
  authorization: 'none',
})

const unbound = (projectId: string, previous: ProjectFacts): RebindReport => ({
  protocol: REBIND_PROTOCOL,
  projectId,
  status: 'unbound',
  changes: [],
  previous: { contentDigest: factsContentDigest(previous), observedAt: previous.observedAt, provider: previous.provenance.provider },
  current: null,
  notes: ['该项目当前没有已登记的元数据根目录；请先在原项目设置流程中重新登记后再生成建议。'],
  authorization: 'none',
})

export interface RebindInput {
  /** The previous `project-facts/1` observation (e.g. stored with an earlier suggestion). */
  readonly previous: unknown
  /** Explicit project identity; a mismatch with the previous facts yields `foreign`. */
  readonly projectId?: string
  readonly observedAt: string
  readonly roots: RegisteredProjectRoots
  readonly provider?: string
  readonly limits?: Partial<MetadataLimits>
}

export interface RebindResult {
  /** `null` when there is no registered root (`unbound`). */
  readonly facts: ProjectFacts | null
  readonly report: RebindReport
}

const parsePrevious = (previous: unknown): ProjectFacts => {
  const parsed = ProjectFactsSchema.safeParse(previous)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new RebindError('invalid_previous', `上一次观察不是合法的 project-facts/1：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim())
  }
  return parsed.data
}

const assertClock = (observedAt: string): void => {
  if (!Number.isFinite(Date.parse(observedAt))) throw new RebindError('invalid_clock', 'observedAt 必须是有效的 ISO 时间')
}

/** Re-observe through the caller's registered lookup (main owns the mapping). */
export function rebindRegisteredProject(input: RebindInput): RebindResult {
  const previous = parsePrevious(input.previous)
  assertClock(input.observedAt)
  const projectId = input.projectId ?? previous.projectId
  if (input.projectId !== undefined && input.projectId !== previous.projectId)
    return { facts: null, report: foreign(previous, projectId) }
  const root = input.roots.rootFor(projectId)
  if (root === undefined) return { facts: null, report: unbound(projectId, previous) }
  const observation = observeProjectMetadata({
    root,
    projectId,
    observedAt: input.observedAt,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
  })
  return { facts: observation.facts, report: compareProjectFacts(previous, observation.facts) }
}

/** Re-observe through an explicitly authorized root (the operator CLI path). */
export function reobserveProjectFacts(input: {
  readonly previous: unknown
  readonly root: string
  readonly projectId?: string
  readonly observedAt: string
  readonly provider?: string
  readonly limits?: Partial<MetadataLimits>
}): RebindResult {
  const previous = parsePrevious(input.previous)
  assertClock(input.observedAt)
  const projectId = input.projectId ?? previous.projectId
  if (input.projectId !== undefined && input.projectId !== previous.projectId)
    return { facts: null, report: foreign(previous, projectId) }
  try {
    const observation = observeProjectMetadata({
      root: input.root,
      projectId,
      observedAt: input.observedAt,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.limits === undefined ? {} : { limits: input.limits }),
    })
    return { facts: observation.facts, report: compareProjectFacts(previous, observation.facts) }
  } catch (error) {
    // A missing/unreadable root is "not rebound yet", not a fabricated current observation.
    if (error instanceof MetadataRefused && (error.code === 'root_missing' || error.code === 'root_not_registered')) return { facts: null, report: unbound(projectId, previous) }
    throw error
  }
}
