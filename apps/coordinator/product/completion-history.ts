import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ApplicationFault } from '@personal-agent/application'
import { canonicalDigest, WorkflowConflict } from '@personal-agent/storage'
import type { CompletionHistoryPage, ProductStore } from '@personal-agent/storage'
import { ContractRefSchema, DigestSchema, IdSchema, TimestampSchema, WorkCompletionHistoryQuerySchema, WorkCompletionHistorySchema } from '@personal-agent/contracts'
import type { ApplicationService, WorkCompletionHistory, WorkCompletionHistoryQuery } from '@personal-agent/contracts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const positive = z.number().int().positive().safe()
const contract = z.strictObject({ revision: positive, digest: DigestSchema })
const candidate = { id: IdSchema, ticketId: IdSchema, assignmentId: IdSchema, candidateGeneration: positive, artifactDigest: DigestSchema }
const verification = z.object({ ...candidate, createdAt: TimestampSchema, criteriaDigest: DigestSchema })
const acceptance = z.object({ ...candidate, acceptedAt: TimestampSchema, criterionIds: z.array(IdSchema).max(1024) })
const Cursor = z.strictObject({ version: z.literal(1), workId: IdSchema, projectId: IdSchema, contextDigest: DigestSchema,
  kind: WorkCompletionHistoryQuerySchema.shape.kind, limit: positive.max(20), currentContract: ContractRefSchema,
  sourceCursor: z.string().min(1).max(4096), expiresAt: TimestampSchema })

/** Public metadata over A's original facts. Signed cursors are scoped read state, never permission. */
export class ProductCompletionHistory {
  private readonly store: ProductStore
  private readonly application: ApplicationService
  private readonly context: () => { principal: unknown; projects: readonly { id: string; scope: unknown }[] }
  private readonly secret: Uint8Array
  private readonly now: () => string
  constructor(store: ProductStore, application: ApplicationService,
    context: () => { principal: unknown; projects: readonly { id: string; scope: unknown }[] },
    secret: Uint8Array, now = () => new Date().toISOString()) {
    if (secret.byteLength < 32) throw new TypeError('History requires a private signing key')
    this.store = store; this.application = application; this.context = context
    this.secret = Uint8Array.from(secret); this.now = now
  }
  private sign(body: string) { return createHmac('sha256', this.secret).update(`completion-history/1:${body}`).digest('base64url') }
  async read(workId: string, input: WorkCompletionHistoryQuery): Promise<WorkCompletionHistory> {
    if (typeof this.store.workflows.index.completionHistory !== 'function')
      throw new ApplicationFault('unsupported_capability', 'Completion history is not available in this storage version', 'none')
    const id = IdSchema.parse(workId), query = WorkCompletionHistoryQuerySchema.parse(input)
    const view = (await this.application.inspect({ workId: id })).works[0]
    if (!view) throw new ApplicationFault('forbidden', 'Work history is outside the current scope', 'none')
    return this.store.uow.atomic(() => {
      const context = this.context(), project = context.projects.find(project => project.id === view.work.projectId)
      const work = this.store.product.works.get(id), current = this.store.product.contracts.history(id, { limit: 1 })[0]
      if (!project || !work || work.projectId !== project.id)
        throw new ApplicationFault('forbidden', 'Work history is outside the current scope', 'none')
      if (!current || current.revision !== view.contract.revision || current.digest !== view.contract.digest)
        throw new ApplicationFault('conflict', 'Work changed; reload history', 'none')
      const currentContract = { workId: id, revision: current.revision, digest: current.digest }
      const contextDigest = digest(context), observedAt = TimestampSchema.parse(this.now())
      let sourceCursor: string | undefined
      if (query.cursor) {
        try {
          const [body, signature] = query.cursor.split('.') as [string, string]
          const expected = Buffer.from(this.sign(body)), actual = Buffer.from(signature)
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Signature mismatch')
          const value = Cursor.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
          if (value.workId !== id || value.projectId !== project.id || value.contextDigest !== contextDigest ||
            value.kind !== query.kind || value.limit !== query.limit || digest(value.currentContract) !== digest(currentContract) ||
            Date.parse(value.expiresAt) <= Date.parse(observedAt)) throw new Error('Cursor context changed')
          sourceCursor = value.sourceCursor
        } catch { throw new ApplicationFault('conflict', 'History continuation changed or expired; reload it', 'none') }
      }
      let page: CompletionHistoryPage
      try { page = this.store.workflows.index.completionHistory({ workId: id, projectIds: [project.id], kind: query.kind,
        limit: query.limit, ...(sourceCursor ? { cursor: sourceCursor } : {}) }) }
      catch (error) {
        if (error instanceof WorkflowConflict) throw new ApplicationFault('conflict', 'History continuation is unavailable', 'none')
        throw error
      }
      if (page.protocol !== 'completion-history/1' || page.workId !== id || page.projectId !== project.id || page.kind !== query.kind ||
        page.limit !== query.limit || page.returned !== page.entries.length || page.entries.length > query.limit ||
        !Number.isSafeInteger(page.available) || page.available < page.returned || page.unclassifiedReviews.length || page.omittedUnclassifiedReviews !== 0 ||
        !['ok', 'blocked'].includes(page.status) || Buffer.byteLength(JSON.stringify(page)) > 4194304 ||
        (page.status === 'ok' && page.hasMore && (!page.entries.length || !page.nextCursor || page.nextCursor === sourceCursor)) ||
        (page.status === 'blocked' && (page.entries.length || page.nextCursor || page.reason !== 'entry_too_large')))
        throw new ApplicationFault('storage_unavailable', 'History metadata is invalid or cannot progress', 'none')
      const entries = page.entries.map(entry => {
        if (query.kind === 'contracts') {
          const value = contract.parse(entry)
          return { kind: 'contracts' as const, id: `${value.revision}:${value.digest}`, ...value }
        }
        if (query.kind === 'verifications') {
          const value = verification.parse(z.object({ verification: z.unknown() }).parse(entry).verification)
          return { kind: 'verifications' as const, id: value.id, ticketId: value.ticketId, assignmentId: value.assignmentId,
            generation: value.candidateGeneration, artifactDigest: value.artifactDigest, criteriaDigest: value.criteriaDigest, at: value.createdAt }
        }
        const value = acceptance.parse(z.object({ acceptance: z.unknown() }).parse(entry).acceptance)
        return { kind: 'acceptances' as const, id: value.id, ticketId: value.ticketId, assignmentId: value.assignmentId,
          generation: value.candidateGeneration, artifactDigest: value.artifactDigest, criterionCount: value.criterionIds.length, at: value.acceptedAt }
      })
      const body = page.status === 'ok' && page.hasMore && page.nextCursor ? Buffer.from(JSON.stringify({ version: 1, workId: id,
        projectId: project.id, contextDigest, kind: query.kind, limit: query.limit, currentContract, sourceCursor: page.nextCursor,
        expiresAt: new Date(Date.parse(observedAt) + 300000).toISOString() })).toString('base64url') : undefined
      return WorkCompletionHistorySchema.parse({ protocol: 'work-completion-history/1', workId: id, projectId: project.id,
        currentContract, kind: query.kind, observedAt, mode: 'live_keyset', authorization: 'none', status: page.status,
        reason: page.reason, limit: query.limit, returned: entries.length, available: page.available, entries, hasMore: page.hasMore,
        ...(body ? { nextCursor: `${body}.${this.sign(body)}` } : {}), coverage: page.hasMore ? 'partial' : 'complete', maxBytes: 131072 })
    })
  }
}
