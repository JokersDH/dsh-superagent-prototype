import { randomUUID } from 'node:crypto'
import { ApplicationFault } from '@personal-agent/application'
import { ContextPreviewInputSchema, ContextPreviewSchema, ScopeSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { ApplicationService, ContextPreview, ContextPreviewInput, Scope, TrustedActor, Verification, WorkEvidence, WorkView } from '@personal-agent/contracts'
import { ContextComposer, ContextError, DEFAULT_COMPOSED_GROUPS, StaticContextPort, sha256Text } from '@personal-agent/context'
import type { ContextSourceKind, StaticContextSource } from '@personal-agent/context'
import { AssistantDecisionStore, DecisionGovernance, decisionContextProvider } from '@personal-agent/knowledge'
import { scopeWithin } from '@personal-agent/questions'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value ?? null)))
const kinds: Record<ContextPreviewInput['selections'][number], readonly ContextSourceKind[]> = {
  work: ['work', 'contract', 'verification', 'delivery'], decisions: ['decision'], project: ['project_metadata'],
  conversation: ['conversation_message'], artifacts: ['artifact'],
}
const ceilings = { maxFiles: 32, maxBytes: 131072, maxTokens: 32768 }
type Project = { id: string; displayName?: string; scope: Scope }
interface Readers {
  verification(id: string): Promise<Verification | undefined>
  workEvidence(id: string): Promise<WorkEvidence>
}
export interface GuardedContextPreview {
  readonly preview: ContextPreview
  readonly scope: Scope
  /** Valid only in this process; call synchronously immediately before the consuming commit/send. */
  assertCurrent(): void
}

/** Explicit local preview over immutable snapshots of approved production reads; no files or models. */
export class ProductContextPreview {
  private readonly store: ProductStore
  private readonly application: ApplicationService
  private readonly principal: { userId: string; authorityRef: string }
  private readonly projects: () => readonly Project[]
  private readonly readers: Readers
  private readonly now: () => string
  constructor(store: ProductStore, application: ApplicationService,
    principal: { userId: string; authorityRef: string }, projects: () => readonly Project[],
    readers: Readers, now = () => new Date().toISOString()) {
    this.store = store; this.application = application; this.principal = structuredClone(principal)
    this.projects = projects; this.readers = readers; this.now = now
  }

  private project(id: string) {
    const value = this.projects().find(project => project.id === id)
    if (!value) throw new ApplicationFault('forbidden', 'Context project is not configured', 'none')
    const scope = ScopeSchema.parse(value.scope)
    if (scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(this.now()))
      throw new ApplicationFault('stale_contract', 'Project authorization expired; renew it before previewing')
    return { id, displayName: value.displayName ?? id, scope }
  }

  async prepare(input: ContextPreviewInput, inputActor: TrustedActor): Promise<ContextPreview> {
    return (await this.prepareGuarded(input, inputActor)).preview
  }

  async prepareGuarded(input: ContextPreviewInput, inputActor: TrustedActor,
    options: { readonly conversationThrough?: number } = {}): Promise<GuardedContextPreview> {
    const value = ContextPreviewInputSchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Context preview requires the authenticated local user', 'none')
    const project = this.project(value.projectId), observedAt = this.now(), eventCursor = this.store.events.cursor()
    const conversation = this.store.workflows.conversations.get(value.conversationId)
    if (!conversation?.projectIds.includes(project.id))
      throw new ApplicationFault('forbidden', 'Context conversation is outside this project', 'none')
    if (options.conversationThrough !== undefined && (!Number.isSafeInteger(options.conversationThrough) ||
      options.conversationThrough < 0 || options.conversationThrough > conversation.lastSequence))
      throw new ApplicationFault('invalid_request', 'Context conversation cutoff is invalid')
    let work: WorkView | undefined
    if (value.workId) {
      work = (await this.application.inspect({ workId: value.workId })).works[0]
      if (!work || work.work.projectId !== project.id || work.work.conversationId !== value.conversationId)
        throw new ApplicationFault('forbidden', 'Context work does not belong to the selected conversation', 'none')
      if (!scopeWithin(work.contract.scope, project.scope))
        throw new ApplicationFault('stale_contract', 'Work scope is outside the current project authorization')
    }
    const selectedKinds = value.selections.flatMap(selection => kinds[selection])
    const contract = work ? { workId: work.contract.workId, revision: work.contract.revision, digest: work.contract.digest } : undefined
    let expiresAt = new Date(Math.min(Date.parse(observedAt) + 300000,
      project.scope.expiresAt ? Date.parse(project.scope.expiresAt) : Infinity,
      work?.contract.scope.expiresAt ? Date.parse(work.contract.scope.expiresAt) : Infinity)).toISOString()
    const sources: StaticContextSource[] = []
    const add = (kind: ContextSourceKind, identity: string, title: string, contentValue: unknown) => {
      const content = JSON.stringify(contentValue), sourceId = `context-${sha256Text(`${project.id}:${kind}:${identity}`).slice(0, 32)}`
      sources.push({ content, descriptor: { sourceId, projectId: project.id, kind, title,
        path: `context/${kind}/${sourceId}.json`, bytes: Buffer.byteLength(content), mediaType: 'json', validity: 'current',
        baseline: { contentDigest: sha256Text(content), digestScope: 'content', capturedAt: observedAt },
        ...(work ? { workId: work.work.id, contract: contract! } : {}) } })
    }
    if (value.selections.includes('project')) add('project_metadata', project.id, project.displayName, project)
    const verification = work?.actions.currentVerificationId && value.selections.includes('work')
      ? await this.readers.verification(work.actions.currentVerificationId) : undefined
    const evidence = work && value.selections.includes('work') ? await this.readers.workEvidence(work.work.id) : undefined
    if (work && value.selections.includes('work')) {
      add('work', work.work.id, work.work.title, { work: work.work, phase: work.phase, resourceStatus: work.resourceStatus })
      add('contract', work.contract.digest, '当前工作合同', work.contract)
      if (verification) add('verification', verification.id, '当前验证', verification)
      if (evidence) add('delivery', work.work.id, '接受记录', { projection: evidence.projection,
        outcomes: evidence.outcomes.filter(outcome => outcome.acceptance === 'accepted' && digest(outcome.attempt.contract) === digest(contract)) })
    }
    const issues: ContextPreview['issues'][number][] = []
    const messages = new Map<string, string>()
    const artifactRecords = new Map<string, string>()
    const governance = new DecisionGovernance(new AssistantDecisionStore(this.store.workflows.assistant), {
      getMessage: async id => {
        const source = this.store.workflows.index.sourceMessage(id, [project.id])
        if (!source?.projectId || source.role !== 'user' || source.provenance !== 'trusted_user' ||
          this.store.product.messages.getById(id)?.anchor?.questionId) return undefined
        messages.set(id, digest(this.store.product.messages.getById(id)))
        return { messageId: source.id, projectId: source.projectId, conversationId: source.conversationId,
          role: 'user' as const, provenance: 'trusted_user' as const, textDigest: source.textDigest, createdAt: source.createdAt }
      },
    }, { now: () => new Date(this.now()) })
    const effective = decisionContextProvider(governance, () => new Date(this.now()))
    const decisionWindows: { limit: number; digest: string }[] = []
    const decisionExpirations = new Map<string, string>()
    const port = new StaticContextPort({ projectId: project.id, baseline: { capturedAt: observedAt }, sources,
      works: work ? [{ workId: work.work.id, contract: contract!, scope: work.contract.scope, title: work.work.title, validity: 'current' }] : [] })
    const groups = DEFAULT_COMPOSED_GROUPS.filter(group => group.sourceKinds.some(kind => selectedKinds.includes(kind)))
      .map(group => ({ ...group, sourceKinds: group.sourceKinds.filter(kind => selectedKinds.includes(kind)) }))
    const shares = groups.reduce((sum, group) => sum + group.share, 0)
    const composer = new ContextComposer({ port,
      decisions: { listEffective: async (projectId, limit) => {
        const page = await effective.listEffective(projectId, limit)
        decisionWindows.push({ limit, digest: digest(page) })
        for (const decision of page.decisions) if (decision.scope.expiresAt)
          decisionExpirations.set(`decision-${sha256Text(`${project.id}\0${decision.decisionId}`).slice(0, 32)}`, decision.scope.expiresAt)
        return { ...page, decisions: page.decisions.filter(decision => scopeWithin(decision.scope, project.scope)) }
      } },
      conversation: { recent: async ({ limit }) => {
        const result = []
        let before = options.conversationThrough === undefined ? undefined : options.conversationThrough + 1
        for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
          const page = this.store.product.messages.page(value.conversationId, { limit: 200, ...(before ? { before } : {}) })
          for (const message of [...page.messages].reverse()) {
            if (message.projectId !== project.id || message.anchor?.questionId ||
              (message.anchor?.workId && message.anchor.workId !== work?.work.id) ||
              !((message.role === 'user' && message.provenance === 'trusted_user') ||
                (message.role === 'assistant' && message.provenance === 'reasoner_reply'))) continue
            messages.set(message.id, digest(message))
            result.push({ messageId: message.id, conversationId: message.conversationId, sequence: message.sequence,
              role: message.role, provenance: message.provenance, text: message.text, createdAt: message.createdAt })
            if (result.length > limit) return result
          }
          if (!page.hasMore) return result
          before = page.beforeCursor
          if (pageNumber === 2) issues.push('conversation_scan_incomplete')
        }
        return result
      } },
      artifacts: { recent: async ({ limit }) => {
        const records = []
        // Only artifact identities already published on this exact work are eligible. No file bytes.
        for (const id of work?.artifactIds ?? []) {
          const record = this.store.artifacts.get(id)
          if (!record) { if (!issues.includes('artifact_source_missing')) issues.push('artifact_source_missing'); continue }
          artifactRecords.set(id, digest(record))
          records.push({ artifactId: record.id, digest: record.digest, bytes: record.bytes, createdAt: record.createdAt })
        }
        return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.artifactId.localeCompare(b.artifactId)).slice(0, limit + 1)
      } },
    }, { now: () => new Date(this.now()) })
    try {
      const result = await composer.compose({ requestId: `context-${randomUUID()}`, projectId: project.id,
        conversationId: value.conversationId, purpose: 'conversation_discussion', query: value.query ?? '',
        ...(work ? { workId: work.work.id, contract: contract! } : {}),
        grant: { grantId: `context-grant-${randomUUID()}`, projectId: project.id, gateway: 'conversation',
          purpose: 'conversation_discussion', scope: project.scope, sourceKinds: selectedKinds, ...ceilings,
          maxDurationMs: 5000, confirmedBy: actor.authorityRef, confirmedAt: observedAt, expiresAt },
        budget: value.budget, groups: groups.map(group => ({ ...group, share: group.share / shares })) })
      for (const window of decisionWindows) if (digest(await effective.listEffective(project.id, window.limit)) !== window.digest)
        throw new ApplicationFault('conflict', 'Effective decisions changed; preview again')
      for (const source of result.slices) {
        const expiry = decisionExpirations.get(source.sourceId)
        if (expiry && Date.parse(expiry) < Date.parse(expiresAt)) expiresAt = expiry
      }
      if (Date.parse(this.now()) >= Date.parse(expiresAt) || digest(this.project(project.id)) !== digest(project) ||
        this.store.events.cursor() !== eventCursor || digest(this.store.workflows.conversations.get(value.conversationId)) !== digest(conversation) ||
        (work && digest((await this.application.inspect({ workId: work.work.id })).works[0]) !== digest(work)) ||
        (verification && digest(await this.readers.verification(verification.id)) !== digest(verification)) ||
        (evidence && digest(await this.readers.workEvidence(work!.work.id)) !== digest(evidence)) ||
        [...messages].some(([id, expected]) => digest(this.store.product.messages.getById(id)) !== expected) ||
        [...artifactRecords].some(([id, expected]) => digest(this.store.artifacts.get(id)) !== expected))
        throw new ApplicationFault('conflict', 'Context source, contract or authorization changed; preview again')
      if (this.store.events.cursor() !== eventCursor)
        throw new ApplicationFault('conflict', 'Context changed during validation; preview again')
      const preview = ContextPreviewSchema.parse({ protocol: 'context-preview/1', requestId: result.requestId, projectId: project.id,
        conversationId: value.conversationId, ...(contract ? { contract } : {}), observedAt, expiresAt,
        status: issues.length && result.status === 'sufficient' ? 'partial' : result.status, trust: 'untrusted_data', selections: value.selections,
        sources: result.slices.map(slice => ({ sourceId: slice.sourceId, kind: slice.kind, title: (slice.title ?? slice.path).slice(0, 256),
          path: slice.path, content: slice.content, sourceDigest: slice.baseline.contentDigest, previewDigest: sha256Text(slice.content),
          bytes: slice.bytes, estimatedTokens: slice.tokens, truncated: slice.truncated })),
        groups: result.groups.map(group => ({ name: group.name, status: group.status, used: group.used })),
        omitted: result.omitted.map(({ sourceId, path, reason }) => ({ ...(sourceId ? { sourceId } : {}), ...(path ? { path } : {}), reason })),
        injectionFlags: result.injectionFlags.map(({ sourceId, patterns }) => ({ sourceId, patterns })), issues,
        budgetClamped: result.budgetClamped,
        budget: { maxFiles: Math.min(value.budget.maxFiles, ceilings.maxFiles), maxBytes: result.budget.maxBytes, maxTokens: result.budget.maxTokens },
        totals: { files: result.totals.files, bytes: result.totals.bytes, tokens: result.totals.tokens } })
      const assertCurrent = () => {
        const currentContract = work ? this.store.product.contracts.history(work.work.id, { limit: 1 })[0] : undefined
        if (Date.parse(this.now()) >= Date.parse(expiresAt) || digest(this.project(project.id)) !== digest(project) ||
          this.store.events.cursor() !== eventCursor ||
          (work && (digest(currentContract) !== digest(work.contract) || digest(this.store.product.works.get(work.work.id)) !== digest(work.work))) ||
          [...messages].some(([id, expected]) => digest(this.store.product.messages.getById(id)) !== expected) ||
          [...artifactRecords].some(([id, expected]) => digest(this.store.artifacts.get(id)) !== expected))
          throw new ApplicationFault('conflict', 'Context source or authorization changed before use; preview again')
      }
      assertCurrent()
      return { preview, scope: structuredClone(project.scope), assertCurrent }
    } catch (error) {
      if (error instanceof ContextError) throw new ApplicationFault(error.code === 'scan_incomplete' ? 'storage_unavailable' : 'conflict',
        error.code === 'scan_incomplete' ? 'Decision scan incomplete; narrow the project or retry after repair' : 'Context authorization or source changed; preview again')
      throw error
    }
  }
}
