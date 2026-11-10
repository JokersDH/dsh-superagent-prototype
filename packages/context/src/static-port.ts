import { ContextSourceAccessError } from './errors.ts'
import { sha256Text } from './digest.ts'
import { pathWithin } from './paths.ts'
import type {
  ContextReadPort,
  ContextSourceDescriptor,
  ContextWorkDescriptor,
} from './types.ts'

export interface StaticContextSource {
  readonly descriptor: ContextSourceDescriptor
  readonly content: string
}

export interface StaticContextPortOptions {
  readonly projectId: string
  readonly baseline: { readonly commit?: string; readonly capturedAt: string }
  readonly sources: readonly StaticContextSource[]
  readonly works?: readonly ContextWorkDescriptor[]
}

/**
 * Read-only reference port over already-approved descriptors (project metadata, works, checks,
 * deliveries, decisions) and fixture content. It is the fake port used by negative tests and the
 * shape a production read-index adapter can implement; it never writes, fetches or runs project code.
 */
export class StaticContextPort implements ContextReadPort {
  private readonly options: StaticContextPortOptions
  private readonly sources: Map<string, StaticContextSource>
  private readonly works: Map<string, ContextWorkDescriptor>
  constructor(options: StaticContextPortOptions) {
    this.options = options
    this.sources = new Map(options.sources.map((source) => [source.descriptor.sourceId, source]))
    this.works = new Map((options.works ?? []).map((work) => [work.workId, work]))
  }

  async projectBaseline(projectId: string): Promise<{ commit?: string; capturedAt: string } | undefined> {
    if (projectId !== this.options.projectId) return undefined
    return { ...this.options.baseline }
  }

  async listSources(input: {
    readonly projectId: string
    readonly kinds: readonly import('./types.ts').ContextSourceKind[]
    readonly allowedPaths: readonly string[]
    readonly excludedPaths: readonly string[]
    readonly limit: number
  }): Promise<readonly ContextSourceDescriptor[]> {
    if (input.projectId !== this.options.projectId) return []
    const result: ContextSourceDescriptor[] = []
    for (const { descriptor } of this.options.sources) {
      if (result.length >= input.limit) break
      if (descriptor.projectId !== this.options.projectId) continue
      if (!input.kinds.includes(descriptor.kind)) continue
      if (descriptor.kind === 'document' || descriptor.kind === 'source_file') {
        if (!input.allowedPaths.some((root) => pathWithin(descriptor.path, root))) continue
        if (input.excludedPaths.some((root) => pathWithin(descriptor.path, root))) continue
      }
      result.push(descriptor)
    }
    return result
  }

  async readSource(input: {
    readonly source: ContextSourceDescriptor
    readonly maxBytes: number
  }): Promise<{ content: string; bytes: number; digest: string }> {
    const entry = this.sources.get(input.source.sourceId)
    if (!entry) throw new ContextSourceAccessError('missing', 'Source no longer exists')
    if (entry.descriptor.projectId !== input.source.projectId) {
      throw new ContextSourceAccessError('cross_project', 'Source belongs to another project')
    }
    const bytes = Buffer.byteLength(entry.content, 'utf8')
    if (bytes > input.maxBytes) throw new ContextSourceAccessError('oversized', 'Source exceeds the read budget')
    return { content: entry.content, bytes, digest: sha256Text(entry.content) }
  }

  async workContext(workId: string): Promise<ContextWorkDescriptor | undefined> {
    return this.works.get(workId)
  }
}
