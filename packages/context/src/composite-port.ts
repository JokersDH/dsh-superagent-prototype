import { ContextSourceAccessError } from './errors.ts'
import type {
  ContextReadPort,
  ContextSourceDescriptor,
  ContextWorkDescriptor,
} from './types.ts'

/**
 * Merges read-only ports (for example a local file port plus an approved-evidence port). Ownership
 * of a source id is recorded during `listSources` so `readSource` is dispatched to the same port and
 * no arbitrary port can be probed by the caller.
 */
export class CompositeContextPort implements ContextReadPort {
  private readonly ports: readonly ContextReadPort[]
  private readonly owners = new Map<string, ContextReadPort>()
  constructor(ports: readonly ContextReadPort[]) {
    if (ports.length === 0) throw new Error('CompositeContextPort needs at least one port')
    this.ports = ports
  }

  async projectBaseline(projectId: string): Promise<{ commit?: string; capturedAt: string } | undefined> {
    for (const port of this.ports) {
      const baseline = await port.projectBaseline(projectId)
      if (baseline) return baseline
    }
    return undefined
  }

  async listSources(input: {
    readonly projectId: string
    readonly kinds: readonly import('./types.ts').ContextSourceKind[]
    readonly allowedPaths: readonly string[]
    readonly excludedPaths: readonly string[]
    readonly limit: number
  }): Promise<readonly ContextSourceDescriptor[]> {
    const merged: ContextSourceDescriptor[] = []
    const seen = new Set<string>()
    for (const port of this.ports) {
      if (merged.length >= input.limit) break
      const sources = await port.listSources({ ...input, limit: input.limit - merged.length })
      for (const source of sources) {
        if (seen.has(source.sourceId)) continue
        seen.add(source.sourceId)
        this.owners.set(source.sourceId, port)
        merged.push(source)
      }
    }
    return merged
  }

  async readSource(input: {
    readonly source: ContextSourceDescriptor
    readonly maxBytes: number
  }): Promise<{ content: string; bytes: number; digest: string }> {
    const owner = this.owners.get(input.source.sourceId)
    if (!owner) throw new ContextSourceAccessError('missing', 'Unknown source owner')
    return owner.readSource(input)
  }

  async workContext(workId: string): Promise<ContextWorkDescriptor | undefined> {
    for (const port of this.ports) {
      if (!port.workContext) continue
      const work = await port.workContext(workId)
      if (work) return work
    }
    return undefined
  }
}
