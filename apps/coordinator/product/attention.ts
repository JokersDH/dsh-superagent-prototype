import { z } from 'zod'
import { AttentionPageSchema, AttentionQuerySchema, DigestSchema } from '@personal-agent/contracts'
import type { AttentionItem, AttentionPage, AttentionQuery, AttentionRanker, WorkVerificationStatus, WorkView } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import type { ProductApplication } from '@personal-agent/application'
import { key } from '@personal-agent/orchestrator-core'
import { WorkflowConflict, canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import type { ProductCompletion } from './completion.ts'

const contractOf = (work: WorkView) => ({ workId: work.contract.workId, revision: work.contract.revision, digest: work.contract.digest })
interface AttentionOptions {
  projectIds: () => readonly string[]
  verification: (work: WorkView) => WorkVerificationStatus
  ranker?: AttentionRanker
  now?: () => string
}
const CursorSchema = z.strictObject({ version: z.literal(1), scopeDigest: DigestSchema, sourceCursor: z.string().min(1).max(1024) })

/** This read model proposes no commands. Every action is re-read in the original work and conversation. */
export class ProductAttention {
  private readonly store: ProductStore
  private readonly application: ProductApplication
  private readonly completion: ProductCompletion
  private readonly options: AttentionOptions
  constructor(store: ProductStore, application: ProductApplication, completion: ProductCompletion, options: AttentionOptions) {
    this.store = store; this.application = application; this.completion = completion; this.options = options
  }

  async read(input: AttentionQuery): Promise<AttentionPage> {
    const query = AttentionQuerySchema.parse(input), allowed = this.options.projectIds()
    if (query.projectId && !allowed.includes(query.projectId))
      throw new ApplicationFault('forbidden', 'Attention project is not configured', 'none')
    const scopeDigest = canonicalDigest({ projects: [...allowed].sort(), projectId: query.projectId ?? null, limit: query.limit ?? 10 })
    let sourceCursor: string | undefined
    if (query.cursor) {
      try {
        const bytes = Buffer.from(query.cursor, 'base64url')
        if (bytes.toString('base64url') !== query.cursor) throw new Error('Noncanonical continuation')
        const decoded = CursorSchema.parse(JSON.parse(bytes.toString('utf8')))
        if (decoded.scopeDigest !== scopeDigest) throw new Error('Continuation scope changed')
        sourceCursor = decoded.sourceCursor
      } catch { throw new ApplicationFault('invalid_request', 'Invalid attention continuation') }
    }
    let page: ReturnType<ProductStore['workflows']['index']['listWorks']>
    try { page = this.store.workflows.index.listWorks({ projectIds: query.projectId ? [query.projectId] : allowed,
      limit: query.limit ?? 10, ...(sourceCursor ? { cursor: sourceCursor } : {}) }) }
    catch (error) { if (error instanceof WorkflowConflict) throw new ApplicationFault('invalid_request', 'Invalid attention continuation'); throw error }
    const items: AttentionItem[] = []
    let bounded = false
    for (const record of page.works) {
      if (!allowed.includes(record.projectId) || (query.projectId && record.projectId !== query.projectId))
        throw new ApplicationFault('storage_unavailable', 'Attention source scope mismatch', 'none')
      const snapshot = await this.application.inspect({ workId: record.id })
      const work = snapshot.works[0]
      if (!work || work.work.id !== record.id || work.work.projectId !== record.projectId)
        throw new ApplicationFault('storage_unavailable', 'Attention work source mismatch', 'none')
      bounded ||= this.store.product.questions.listOpen({ workId: record.id, limit: 200 }).length === 200
      const common = { projectId: record.projectId, conversationId: record.conversationId,
        contract: contractOf(work), workTitle: work.work.title, deadlineAt: null, expiresAt: null, blockedWorkIds: [] }
      for (const question of snapshot.questions) items.push({ ...common, kind: 'question',
        id: key('attention-question', question.id, String(question.version)), questionId: question.id, questionVersion: question.version,
        questionKind: question.kind, summary: question.prompt.slice(0, 512), sinceAt: question.openedAt,
        deadlineAt: question.decisionDeadline ?? null, expiresAt: question.expiresAt ?? null })
      if (['delivered', 'ended'].includes(work.phase)) continue
      const candidate = work.actions.currentCandidate
      if (work.actions.available.includes('accept_candidate') && candidate && work.actions.currentVerificationId)
        items.push({ ...common, kind: 'candidate', id: key('attention-candidate', canonicalDigest(candidate)), candidate,
          verificationId: work.actions.currentVerificationId, summary: '变更已验证，等待审阅。',
          sinceAt: this.completion.metadata(candidate)?.readyAt ?? null })
      const status = this.options.verification(work)
      const review = candidate && this.completion.current(candidate)
      const code = work.resourceStatus === 'indeterminate' ? 'writer_indeterminate'
        : status.state === 'blocked' ? 'verification_blocked'
        : review && review.verification.results.some(result => result.outcome === 'FAIL') ? 'machine_failed'
        : work.actions.dispatchHold.paused && work.actions.available.includes('resume_dispatch') ? 'dispatch_paused' : undefined
      if (code) items.push({ ...common, kind: 'blocked', id: key('attention-blocked', canonicalDigest(common.contract), code), code,
        summary: { writer_indeterminate: '执行资源待核对', verification_blocked: '验证受阻，自动重试已停止',
          machine_failed: '检查未通过', dispatch_paused: '派工已暂停' }[code], sinceAt: null })
    }
    const now = this.options.now?.() ?? new Date().toISOString()
    const ranks = this.options.ranker ? this.options.ranker({ items: structuredClone(items), now })
      : [...items].sort((a, b) => ((a.sinceAt ? Date.parse(a.sinceAt) : Infinity) - (b.sinceAt ? Date.parse(b.sinceAt) : Infinity)) || a.id.localeCompare(b.id))
        .map(item => ({ id: item.id, reasons: [item.sinceAt ? 'waiting_age' as const : 'unknown_wait' as const] }))
    return AttentionPageSchema.parse({ protocol: 'attention-inbox/1', observedAt: now, items, ranks,
      ranking: this.options.ranker ? 'deterministic_priority' : 'waiting_order', scannedWorks: page.works.length,
      questionCoverage: bounded ? 'bounded' : 'complete', hasMore: page.hasMore,
      ...(page.nextCursor ? { nextCursor: Buffer.from(JSON.stringify({ version: 1, scopeDigest, sourceCursor: page.nextCursor })).toString('base64url') } : {}) })
  }
}
