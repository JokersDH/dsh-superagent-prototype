/**
 * Node-only composition over an already-authorized read port.
 *
 * Main owns authentication, project authorization and the HTTP surface. This module only accepts the
 * *facts* those layers already authorized — a work list with its project identity, work evidence,
 * work history and the attention inbox — and turns them into a bounded `usage-insights-input/1`
 * bundle. It creates no HTTP server, no route and no SQL, and it reads no credential.
 *
 * Every returned DTO is validated with the same shared schemas the analyzer uses, the record bound is
 * charged in the same units the analyzer charges (`recordUnits`), and the work index keeps every
 * distinct work→project pair so the analyzer's own permanent tombstone decides contradictions. There
 * is exactly one implementation of scope, conflict and bound semantics.
 */
import { AttentionPageSchema, WorkEvidenceHistorySchema, WorkEvidenceSchema } from '@personal-agent/contracts'
import { recordUnits } from './analyze.ts'
import {
  UsageInsightsInputSchema,
  type IngestCoverage,
  type InsightLimits,
  type InsightWindow,
  type UsageInsightsInput,
} from './protocol.ts'
import { firstIssue } from './subject.ts'

/** A work visible to the authenticated principal, with the project identity the product recorded. */
export interface AuthorizedWorkRef {
  workId: string
  projectId: string
}

/**
 * The read port main supplies after authorizing the principal. Implementations usually call the
 * existing product readers in-process; the composition never assumes an endpoint or a database.
 */
export interface AuthorizedReadsPort {
  listWorks(input: { projectIds: readonly string[]; limit: number; cursor?: string }):
    Promise<{ works: readonly AuthorizedWorkRef[]; hasMore: boolean; nextCursor?: string }>
  workEvidence(workId: string): Promise<unknown>
  workHistory?(workId: string, input: { limit: number; cursor?: string }): Promise<unknown>
  attention?(input: { projectId: string; limit: number; cursor?: string }): Promise<unknown>
}

export interface CompositionRequest {
  /** Opaque reference to the authorized principal; never a credential or a token. */
  principalRef: string
  projectIds: readonly string[]
  window: InsightWindow
  timezone: string
  capturedAt?: string
  inputId?: string
  includeAttention?: boolean
  sourceDescriptor?: string
  limits?: InsightLimits
}

export interface CompositionIssue {
  ref: string
  stage: 'works' | 'evidence' | 'history' | 'attention'
  code: 'invalid_dto' | 'port_error' | 'deadline' | 'limits' | 'unsupported'
  message: string
}

export interface ComposedInsightInput {
  bundle: UsageInsightsInput
  issues: readonly CompositionIssue[]
  stats: {
    worksListed: number
    worksRead: number
    unitsCharged: number
    historyPages: number
    attentionPages: number
    stoppedBy: 'records' | 'works' | 'pages' | 'deadline' | 'none'
  }
}

export class CompositionFault extends Error {
  readonly code: 'invalid_request' | 'unsupported'
  constructor(code: CompositionFault['code'], message: string) {
    super(message)
    this.name = 'CompositionFault'
    this.code = code
  }
}

const WORKS_PAGE = 100
const HISTORY_PAGE = 100
const ATTENTION_PAGE = 20

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new CompositionFault('invalid_request', `Unknown IANA time zone: ${timezone}`)
  }
}

function assertWindow(window: InsightWindow): void {
  if (Date.parse(window.to) <= Date.parse(window.from))
    throw new CompositionFault('invalid_request', 'Observation window must be a forward interval')
}

/**
 * Compose a bounded input bundle from authorized reads.
 *
 * The caller passes an `AbortSignal` to stop early; the composition also enforces its own deadline
 * from `limits.deadlineMs` and stops issuing reads once that expires, reporting `stoppedBy=deadline`.
 */
export async function composeUsageInsightsInput(input: {
  port: AuthorizedReadsPort
  request: CompositionRequest
  signal?: AbortSignal
}): Promise<ComposedInsightInput> {
  const { port, request } = input
  if (typeof request.principalRef !== 'string' || request.principalRef.length === 0)
    throw new CompositionFault('invalid_request', 'An authorized principal reference is required')
  if (!Array.isArray(request.projectIds) || request.projectIds.length === 0)
    throw new CompositionFault('invalid_request', 'At least one authorized project is required')
  if (new Set(request.projectIds).size !== request.projectIds.length)
    throw new CompositionFault('invalid_request', 'Authorized projects must be unique')
  assertWindow(request.window)
  assertTimezone(request.timezone)

  const maxRecords = request.limits?.maxRecords ?? 50_000
  const maxWorks = request.limits?.maxWorks ?? 200
  const maxPages = request.limits?.maxPages ?? 200
  const deadlineMs = request.limits?.deadlineMs ?? 60_000
  const deadline = Date.now() + deadlineMs
  const projectIds = [...request.projectIds].sort()

  const issues: CompositionIssue[] = []
  const workIndex: { workId: string; projectId: string }[] = []
  const workEvidence: unknown[] = []
  const workHistories: unknown[] = []
  const attentionPages: unknown[] = []
  let unitsCharged = 0
  let worksRead = 0
  let historyPages = 0
  let attentionPagesSeen = 0
  let stoppedBy: ComposedInsightInput['stats']['stoppedBy'] = 'none'
  let failedWorks = 0
  let workSource: IngestCoverage = 'complete'
  let attentionSource: IngestCoverage = request.includeAttention === true ? 'complete' : 'not_collected'

  const expired = () => input.signal?.aborted === true || Date.now() > deadline

  // ---- authorized work list, with every distinct work→project pair ------------------------------
  const listed: AuthorizedWorkRef[] = []
  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page >= maxPages) { stoppedBy = 'pages'; workSource = 'caller_limit'; break }
    if (expired()) { stoppedBy = 'deadline'; workSource = 'caller_limit'; break }
    const remaining = maxWorks - listed.length
    if (remaining <= 0) { stoppedBy = 'works'; workSource = 'caller_limit'; break }
    let batch
    try {
      batch = await port.listWorks({ projectIds, limit: Math.min(WORKS_PAGE, remaining), ...(cursor ? { cursor } : {}) })
    } catch (error) {
      issues.push({ ref: 'works', stage: 'works', code: 'port_error', message: bounded(error) })
      workSource = 'source_missing'
      break
    }
    for (const work of batch.works) {
      if (!work || typeof work.workId !== 'string' || typeof work.projectId !== 'string') {
        issues.push({ ref: 'works', stage: 'works', code: 'invalid_dto', message: 'Work reference lacks an identity' })
        workSource = 'caller_limit'
        continue
      }
      listed.push(work)
      // Every pair is kept: if one work appears under two projects, the analyzer's permanent
      // tombstone decides it. The composition never resolves that contradiction itself.
      if (!workIndex.some(entry => entry.workId === work.workId && entry.projectId === work.projectId))
        workIndex.push({ workId: work.workId, projectId: work.projectId })
    }
    if (!batch.hasMore || batch.nextCursor === undefined || batch.nextCursor === cursor) break
    cursor = batch.nextCursor
  }

  const inScope = listed.filter(work => projectIds.includes(work.projectId))
  if (listed.length > inScope.length)
    issues.push({
      ref: 'works', stage: 'works', code: 'unsupported',
      message: `${listed.length - inScope.length} listed work(s) were outside the authorized projects and were not read`,
    })

  // ---- bounded evidence and history reads -------------------------------------------------------
  for (const work of inScope) {
    if (workEvidence.length >= maxWorks) { stoppedBy = 'works'; workSource = 'caller_limit'; break }
    if (expired()) { stoppedBy = 'deadline'; workSource = 'caller_limit'; break }
    let evidence
    try {
      evidence = await port.workEvidence(work.workId)
    } catch (error) {
      issues.push({ ref: work.workId, stage: 'evidence', code: 'port_error', message: bounded(error) })
      // The work is known to exist but its evidence is missing. Recording that as a `source_missing`
      // projection is a truthful absence, not a fabricated fact: the analyzer then counts it as
      // unknown instead of dropping it from every total.
      failedWorks++
      workEvidence.push({ protocol: 'work-evidence/1', workId: work.workId, projection: 'source_missing', entries: [], outcomes: [], truncated: false })
      workSource = workSource === 'source_missing' ? 'source_missing' : 'caller_limit'
      continue
    }
    const parsed = WorkEvidenceSchema.safeParse(evidence)
    if (!parsed.success || parsed.data.workId !== work.workId) {
      issues.push({ ref: work.workId, stage: 'evidence', code: 'invalid_dto', message: firstIssue(parsed.success ? { issues: [] } : parsed.error) })
      failedWorks++
      workEvidence.push({ protocol: 'work-evidence/1', workId: work.workId, projection: 'source_missing', entries: [], outcomes: [], truncated: false })
      workSource = workSource === 'source_missing' ? 'source_missing' : 'caller_limit'
      continue
    }
    const cost = recordUnits(parsed.data)
    if (unitsCharged + cost > maxRecords) { stoppedBy = 'records'; workSource = 'caller_limit'; break }
    unitsCharged += cost
    workEvidence.push(parsed.data)
    worksRead++
    if (parsed.data.truncated && workSource === 'complete') workSource = 'storage_cap'

    if (!port.workHistory) continue
    let historyCursor: string | undefined
    for (let page = 0; page < maxPages; page++) {
      if (expired()) { stoppedBy = 'deadline'; workSource = 'caller_limit'; break }
      let history
      try {
        history = await port.workHistory(work.workId, { limit: HISTORY_PAGE, ...(historyCursor ? { cursor: historyCursor } : {}) })
      } catch (error) {
        issues.push({ ref: work.workId, stage: 'history', code: 'port_error', message: bounded(error) })
        workSource = workSource === 'source_missing' ? 'source_missing' : 'caller_limit'
        break
      }
      const pageValue = WorkEvidenceHistorySchema.safeParse(history)
      if (!pageValue.success || pageValue.data.workId !== work.workId) {
        issues.push({ ref: work.workId, stage: 'history', code: 'invalid_dto', message: firstIssue(pageValue.success ? { issues: [] } : pageValue.error) })
        workSource = workSource === 'source_missing' ? 'source_missing' : 'caller_limit'
        break
      }
      const pageCost = recordUnits(pageValue.data)
      if (unitsCharged + pageCost > maxRecords) { stoppedBy = 'records'; workSource = 'caller_limit'; break }
      unitsCharged += pageCost
      workHistories.push(pageValue.data)
      historyPages++
      if (pageValue.data.window === 'caller_limit' && workSource === 'complete') workSource = 'caller_limit'
      if (pageValue.data.window === 'storage_cap' && workSource === 'complete') workSource = 'storage_cap'
      if (!pageValue.data.hasMore || pageValue.data.nextCursor === undefined || pageValue.data.nextCursor === historyCursor) break
      historyCursor = pageValue.data.nextCursor
    }
  }

  // ---- current attention snapshot ----------------------------------------------------------------
  if (request.includeAttention === true && port.attention) {
    for (const projectId of projectIds) {
      let cursor: string | undefined
      for (let page = 0; page < maxPages; page++) {
        if (expired()) { stoppedBy = 'deadline'; attentionSource = 'caller_limit'; break }
        let inbox
        try {
          inbox = await port.attention({ projectId, limit: ATTENTION_PAGE, ...(cursor ? { cursor } : {}) })
        } catch (error) {
          issues.push({ ref: projectId, stage: 'attention', code: 'port_error', message: bounded(error) })
          attentionSource = 'source_missing'
          break
        }
        const pageValue = AttentionPageSchema.safeParse(inbox)
        if (!pageValue.success) {
          issues.push({ ref: projectId, stage: 'attention', code: 'invalid_dto', message: firstIssue(pageValue.error) })
          attentionSource = 'source_missing'
          break
        }
        const pageCost = recordUnits(pageValue.data)
        if (unitsCharged + pageCost > maxRecords) { stoppedBy = 'records'; attentionSource = 'caller_limit'; break }
        unitsCharged += pageCost
        attentionPages.push(pageValue.data)
        attentionPagesSeen++
        if (!pageValue.data.hasMore || pageValue.data.nextCursor === undefined || pageValue.data.nextCursor === cursor) break
        cursor = pageValue.data.nextCursor
      }
    }
  } else if (request.includeAttention === true) {
    // The caller explicitly asked for the inbox; silently reporting zero items would be wrong.
    throw new CompositionFault('unsupported', 'The read port does not expose the attention inbox')
  }

  // A missing source is distinct from a declared bound: only an empty listing or an all-failed read
  // makes the source itself missing, while a bound keeps it partial.
  if (worksRead === 0 && (failedWorks > 0 || stoppedBy === 'none')) workSource = worstSource(workSource, 'source_missing')
  if (stoppedBy === 'records' || stoppedBy === 'pages' || stoppedBy === 'works' || stoppedBy === 'deadline') {
    if (workSource === 'complete') workSource = 'caller_limit'
  }

  // The capture time is stamped after the reads, so a snapshot can never be observed after the
  // observation it belongs to. An explicit caller timestamp is honoured as given.
  const capturedAt = request.capturedAt ?? new Date().toISOString()
  const bundle = UsageInsightsInputSchema.parse({
    protocol: 'usage-insights-input/1',
    inputId: request.inputId ?? `composed-${capturedAt.replace(/[-:]/g, '').replace(/\..*$/, '')}`,
    capturedAt,
    timezone: request.timezone,
    window: request.window,
    projects: projectIds.map(projectId => ({ projectId })),
    source: {
      kind: 'authorized_read',
      descriptor: request.sourceDescriptor ?? `authorized read for ${request.principalRef}`,
      digest: null,
      layerAssertion: 'recorded_by_producer',
      capturedAt,
    },
    declaredCoverage: { outcomes: workSource, workEvidence: workSource, attention: attentionSource },
    ...(request.limits ? { limits: request.limits } : {}),
    ...(workIndex.length ? { workIndex } : {}),
    outcomes: [],
    attentionPages,
    workEvidence,
    ...(workHistories.length ? { workHistories } : {}),
    ...(issues.length ? { collectionIssues: issues.slice(0, 512) } : {}),
  } satisfies UsageInsightsInput)

  return {
    bundle,
    issues,
    stats: {
      worksListed: listed.length,
      worksRead,
      unitsCharged,
      historyPages,
      attentionPages: attentionPagesSeen,
      stoppedBy,
    },
  }
}

const SOURCE_SEVERITY: Record<IngestCoverage, number> = {
  complete: 0, caller_limit: 1, storage_cap: 2, source_missing: 3, not_collected: 4, unsupported: 5,
}
const worstSource = (a: IngestCoverage, b: IngestCoverage): IngestCoverage =>
  SOURCE_SEVERITY[b] > SOURCE_SEVERITY[a] ? b : a

const bounded = (value: unknown): string => String((value as Error | undefined)?.message ?? value ?? 'unknown error')
  .replace(/\s+/g, ' ').slice(0, 240)
