import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ContractRefSchema, DigestSchema, IdSchema, TimestampSchema, WorkEvidenceHistoryQuerySchema, WorkEvidenceHistorySchema } from '@personal-agent/contracts'
import type { ApplicationService, WorkEvidenceHistory, WorkEvidenceHistoryQuery } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { canonicalDigest, WorkflowConflict } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const CursorSchema = z.strictObject({ version: z.literal(1), workId: IdSchema, scopeDigest: DigestSchema,
  contract: ContractRefSchema, sourceCursor: z.string().min(1).max(4096), expiresAt: TimestampSchema })

/** Authenticated projection of A's bounded evidence pages. Cursors are not action tokens. */
export class ProductEvidenceHistory {
  private readonly store: ProductStore
  private readonly application: ApplicationService
  private readonly projectIds: () => readonly string[]
  private readonly secret: Buffer
  private readonly now: () => string
  constructor(store: ProductStore, application: ApplicationService, projectIds: () => readonly string[], secret: Uint8Array,
    now = () => new Date().toISOString()) {
    if (secret.byteLength < 32) throw new TypeError('Evidence cursors require a private signing key')
    this.store = store; this.application = application; this.projectIds = projectIds; this.secret = Buffer.from(secret); this.now = now
  }
  private sign(body: string) { return createHmac('sha256', this.secret).update(`evidence-history/1:${body}`).digest('base64url') }
  async read(workId: string, input: WorkEvidenceHistoryQuery): Promise<WorkEvidenceHistory> {
    const id = IdSchema.parse(workId), query = WorkEvidenceHistoryQuerySchema.parse(input)
    const view = (await this.application.inspect({ workId: id })).works[0]
    if (!view) throw new ApplicationFault('forbidden', 'Work history is outside the configured scope', 'none')
    return this.store.uow.atomic(() => {
      const projects = [...this.projectIds()].sort(), work = this.store.product.works.get(id)
      if (!work || !projects.includes(work.projectId)) throw new ApplicationFault('forbidden', 'Work history is outside the configured scope', 'none')
      const current = this.store.product.contracts.history(id, { limit: 1 })[0]
      if (!current || current.revision !== view.contract.revision || current.digest !== view.contract.digest)
        throw new ApplicationFault('conflict', 'Work contract changed; reload the record')
      const contract = { workId: id, revision: current.revision, digest: current.digest }, scopeDigest = digest(projects)
      let cursor: string | undefined
      if (query.cursor) {
        try {
          const [body, signature] = query.cursor.split('.') as [string, string]
          const expected = Buffer.from(this.sign(body)), actual = Buffer.from(signature)
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Signature mismatch')
          const value = CursorSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
          if (value.workId !== id || value.scopeDigest !== scopeDigest || digest(value.contract) !== digest(contract) ||
            Date.parse(value.expiresAt) <= Date.parse(this.now())) throw new Error('Cursor context changed')
          cursor = value.sourceCursor
        } catch { throw new ApplicationFault('conflict', 'History continuation changed or expired; reload the record') }
      }
      let page
      try { page = this.store.workflows.index.evidencePage({ workId: id, projectIds: projects, limit: query.limit ?? 20, ...(cursor ? { cursor } : {}) }) }
      catch (error) {
        if (error instanceof WorkflowConflict) throw new ApplicationFault('conflict', 'History window changed; reload the record')
        throw error
      }
      if (!page) throw new ApplicationFault('forbidden', 'Work history is outside the configured scope', 'none')
      const observedAt = this.now()
      const body = page.nextCursor ? Buffer.from(JSON.stringify({ version: 1, workId: id, scopeDigest, contract,
        sourceCursor: page.nextCursor, expiresAt: new Date(Date.parse(observedAt) + 300000).toISOString() })).toString('base64url') : undefined
      return WorkEvidenceHistorySchema.parse({ protocol: 'work-evidence-history/1', workId: id, contract, observedAt,
        entries: page.entries, hasMore: page.hasMore, window: page.window, sourcesCapped: page.sourcesCapped ?? [],
        ...(body ? { nextCursor: `${body}.${this.sign(body)}` } : {}) })
    })
  }
}
