import type { ContractRef, ContractRevision, Scope, WorkRecord } from '@personal-agent/contracts'
import { ContextSourceAccessError } from './errors.ts'
import { sha256Text } from './digest.ts'
import type {
  ContextReadPort,
  ContextSourceBaseline,
  ContextSourceDescriptor,
  ContextSourceKind,
} from './types.ts'

/** The subset of A's public read index consumed here; structurally compatible with workflows' ReadIndexPort. */
export interface ReadIndexProjectView {
  readonly projectId: string
  readonly revision: number
  readonly digest: string
  readonly createdAt: string
  readonly archivedAt?: string
  readonly archiveRevision?: number
  readonly settings: {
    readonly displayName?: string
    readonly check?: string
    readonly environment?: { readonly policy: string }
  }
}

export interface ReadIndexWorkView {
  readonly work: WorkRecord
  readonly authority?: ContractRef
  readonly authorityState: 'current' | 'missing'
  readonly contract?: ContractRevision
  readonly contractState: 'current' | 'missing' | 'stale'
  readonly verificationIds: readonly string[]
  readonly acceptanceIds: readonly string[]
  readonly deliverables: readonly {
    readonly verificationId: string
    readonly artifactDigest: string
    readonly criteriaDigest: string
    readonly accepted: boolean
  }[]
  readonly project: { readonly id: string; readonly state: 'current' | 'missing' | 'archived' }
}

export interface WorkspaceReadIndex {
  project(projectId: string): {
    readonly current: ReadIndexProjectView | undefined
    readonly history: readonly ReadIndexProjectView[]
    readonly state: 'current' | 'missing' | 'archived'
  }
  listWorks(input: {
    readonly projectIds: readonly string[]
    readonly query?: string
    readonly limit?: number
    readonly cursor?: string
  }): { readonly works: readonly WorkRecord[]; readonly nextCursor?: string; readonly hasMore: boolean }
  work(workId: string, projectIds: readonly string[]): ReadIndexWorkView | undefined
}

/** Effective, source-current decisions supplied by main from the knowledge governance. */
export interface ContextDecisionSource {
  readonly decisionId: string
  readonly content: string
  readonly scope: Scope
  readonly sourceMessageId: string
  readonly recordedAt: string
}

export interface ReadIndexContextPortOptions {
  readonly projectId: string
  readonly index: WorkspaceReadIndex
  /** Called on each list; must return only effective decisions with current sources. */
  readonly decisions?: () => Promise<readonly ContextDecisionSource[]>
  readonly workLimit?: number
  readonly now?: () => Date
  readonly maxContentEntries?: number
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Read-only ContextReadPort over A's persisted project/work index. It never reads account material,
 * source files or native sessions; metadata/work/contract/decision content is projected as bounded
 * JSON, and logical refs are not treated as filesystem paths.
 */
export class ReadIndexContextPort implements ContextReadPort {
  private readonly options: ReadIndexContextPortOptions
  private readonly contents = new Map<string, { readonly content: string; readonly digest: string }>()
  private baseline: { commit?: string; capturedAt: string } | undefined

  constructor(options: ReadIndexContextPortOptions) {
    this.options = options
  }

  async projectBaseline(projectId: string): Promise<{ commit?: string; capturedAt: string } | undefined> {
    if (projectId !== this.options.projectId) return undefined
    const view = this.options.index.project(projectId)
    if (!view.current || view.state !== 'current') {
      this.baseline = undefined
      return undefined
    }
    this.baseline = { commit: view.current.digest, capturedAt: view.current.createdAt }
    return this.baseline
  }

  async listSources(input: {
    readonly projectId: string
    readonly kinds: readonly ContextSourceKind[]
    readonly allowedPaths: readonly string[]
    readonly excludedPaths: readonly string[]
    readonly limit: number
  }): Promise<readonly ContextSourceDescriptor[]> {
    if (input.projectId !== this.options.projectId) return []
    const baseline = this.baseline ?? (await this.projectBaseline(input.projectId))
    if (!baseline) return []
    const kinds = new Set(input.kinds)
    const descriptors: ContextSourceDescriptor[] = []
    const push = (descriptor: ContextSourceDescriptor): void => {
      if (descriptors.length >= input.limit) return
      descriptors.push(descriptor)
    }

    if (kinds.has('project_metadata')) {
      const view = this.options.index.project(input.projectId)
      if (view.current) {
        push(
          this.descriptor('project_metadata', 'project/settings.json', 'Project settings metadata', serialize({
            projectId: view.current.projectId,
            revision: view.current.revision,
            digest: view.current.digest,
            displayName: view.current.settings.displayName ?? null,
            check: view.current.settings.check ?? null,
            environmentPolicy: view.current.settings.environment?.policy ?? null,
            archived: view.current.archivedAt !== undefined,
          }), baseline),
        )
      }
    }

    if (kinds.has('work') || kinds.has('contract')) {
      const works = this.options.index.listWorks({
        projectIds: [input.projectId],
        limit: Math.min(this.options.workLimit ?? 32, input.limit),
      })
      for (const work of works.works) {
        if (descriptors.length >= input.limit) break
        const entry = this.options.index.work(work.id, [input.projectId])
        if (!entry || entry.project.id !== input.projectId) continue
        if (kinds.has('work')) {
          push(
            this.descriptor('work', `work/${work.id}.json`, work.title, serialize({
              workId: work.id,
              title: work.title,
              conversationId: work.conversationId,
              createdAt: work.createdAt,
              authorityState: entry.authorityState,
              contractState: entry.contractState,
              contractRevision: entry.contract?.revision ?? null,
              contractDigest: entry.contract?.digest ?? null,
              verificationIds: entry.verificationIds,
              acceptanceIds: entry.acceptanceIds,
              deliverables: entry.deliverables.map((item) => ({ verificationId: item.verificationId, accepted: item.accepted })),
              projectState: entry.project.state,
            }), baseline, work.id),
          )
        }
        if (kinds.has('contract') && entry.contract && entry.contractState === 'current' && entry.authorityState === 'current') {
          push(
            this.descriptor('contract', `work/${work.id}/contract.json`, `${work.title} contract`, serialize({
              workId: entry.contract.workId,
              revision: entry.contract.revision,
              digest: entry.contract.digest,
              goal: entry.contract.goal,
              scope: entry.contract.scope,
              criteria: entry.contract.criteria,
            }), baseline, work.id, {
              workId: entry.contract.workId,
              revision: entry.contract.revision,
              digest: entry.contract.digest,
            }),
          )
        }
      }
    }

    if (kinds.has('decision') && this.options.decisions) {
      const decisions = await this.options.decisions()
      for (const decision of decisions) {
        if (descriptors.length >= input.limit) break
        if (decision.scope.projectId !== input.projectId) continue
        push(
          this.descriptor('decision', `decisions/${decision.decisionId}.json`, 'Explicit user decision', serialize({
            decisionId: decision.decisionId,
            content: decision.content,
            scope: decision.scope,
            sourceMessageId: decision.sourceMessageId,
            recordedAt: decision.recordedAt,
          }), baseline),
        )
      }
    }

    return descriptors
  }

  async readSource(input: {
    readonly source: ContextSourceDescriptor
    readonly maxBytes: number
  }): Promise<{ content: string; bytes: number; digest: string }> {
    const entry = this.contents.get(input.source.sourceId)
    if (!entry) throw new ContextSourceAccessError('missing', 'Indexed source is no longer available')
    const bytes = Buffer.byteLength(entry.content, 'utf8')
    if (bytes > input.maxBytes) throw new ContextSourceAccessError('oversized', 'Indexed source exceeds the read budget')
    return { content: entry.content, bytes, digest: entry.digest }
  }

  async workContext(workId: string): Promise<
    { workId: string; contract: ContractRef; scope: Scope; title: string; validity: 'current' } | undefined
  > {
    const entry = this.options.index.work(workId, [this.options.projectId])
    if (!entry || entry.project.id !== this.options.projectId) return undefined
    if (!entry.contract || entry.contractState !== 'current' || entry.authorityState !== 'current') return undefined
    return {
      workId,
      contract: { workId: entry.contract.workId, revision: entry.contract.revision, digest: entry.contract.digest },
      scope: entry.contract.scope,
      title: entry.work.title,
      validity: 'current',
    }
  }

  private descriptor(
    kind: ContextSourceKind,
    path: string,
    title: string,
    content: string,
    baseline: { commit?: string; capturedAt: string },
    workId?: string,
    contract?: ContractRef,
  ): ContextSourceDescriptor {
    const digest = sha256Text(content)
    const sourceId = `${kind}-${sha256Text(`${this.options.projectId}\0${path}`).slice(0, 32)}`
    this.contents.set(sourceId, { content, digest })
    this.evict()
    const sourceBaseline: ContextSourceBaseline = {
      ...(baseline.commit === undefined ? {} : { commit: baseline.commit }),
      contentDigest: digest,
      digestScope: 'content',
      capturedAt: baseline.capturedAt,
    }
    return {
      sourceId,
      projectId: this.options.projectId,
      kind,
      path,
      title,
      bytes: Buffer.byteLength(content, 'utf8'),
      mediaType: 'json',
      baseline: sourceBaseline,
      validity: 'current',
      ...(workId === undefined ? {} : { workId }),
      ...(contract === undefined ? {} : { contract }),
    }
  }

  private evict(): void {
    const max = this.options.maxContentEntries ?? 512
    while (this.contents.size > max) {
      const oldest = this.contents.keys().next().value
      if (oldest === undefined) break
      this.contents.delete(oldest)
    }
  }
}
