import { authorizeContextRequest, sourceAllowedByGrant } from './authorization.ts'
import { ContextError, ContextSourceAccessError } from './errors.ts'
import { detectInjectionPatterns } from './injection.ts'
import { isDeniedPath, isExternalReference } from './paths.ts'
import { estimateTokens, queryTerms, relevanceScore } from './tokens.ts'
import { ContextRequestSchema, DEFAULT_CONTEXT_BUDGET } from './types.ts'
import type {
  ContextBudget,
  ContextBundle,
  ContextInjectionFlag,
  ContextOmission,
  ContextReadPort,
  ContextRequest,
  ContextSlice,
  ContextSourceDescriptor,
  ContextValidation,
  ResolvedContextBudget,
} from './types.ts'

const KIND_ORDER: Record<ContextSourceDescriptor['kind'], number> = {
  contract: 8,
  work: 7,
  decision: 6,
  verification: 5,
  delivery: 4,
  project_metadata: 3,
  document: 2,
  source_file: 1,
}

export interface ContextReaderOptions {
  /** Injectable clock; tests use it to make time budgets deterministic. */
  readonly now?: () => Date
  /** Hard per-file read cap regardless of the aggregate request budget. */
  readonly maxPerFileBytes?: number
}

function resolveBudget(request: ContextRequest): ResolvedContextBudget {
  const asked: ContextBudget = request.budget ?? {}
  const caps = request.grant
  return {
    maxFiles: Math.min(asked.maxFiles ?? DEFAULT_CONTEXT_BUDGET.maxFiles, caps.maxFiles),
    maxBytes: Math.min(asked.maxBytes ?? DEFAULT_CONTEXT_BUDGET.maxBytes, caps.maxBytes),
    maxTokens: Math.min(asked.maxTokens ?? DEFAULT_CONTEXT_BUDGET.maxTokens, caps.maxTokens),
    maxDurationMs: Math.min(asked.maxDurationMs ?? DEFAULT_CONTEXT_BUDGET.maxDurationMs, caps.maxDurationMs),
    maxSlices: Math.min(asked.maxSlices ?? DEFAULT_CONTEXT_BUDGET.maxSlices, caps.maxFiles),
  }
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9][0-9]{0,8})$/.test(cursor)) {
    throw new ContextError('invalid_input', 'Cursor is not a non-negative integer')
  }
  return Number(cursor)
}

function truncateToTokenBudget(text: string, maxTokens: number): { content: string; truncated: boolean } {
  if (maxTokens <= 0) return { content: '', truncated: text.length > 0 }
  let end = 0
  let tokens = 0
  for (const char of text) {
    const cost = (char.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.25
    if (tokens + cost > maxTokens) break
    tokens += cost
    end += char.length
  }
  return { content: text.slice(0, end), truncated: end < text.length }
}

function omissionReasonFromFailure(reason: ContextSourceAccessError['reason']): ContextOmission['reason'] {
  switch (reason) {
    case 'missing':
      return 'missing'
    case 'binary':
      return 'binary'
    case 'oversized':
      return 'oversized'
    case 'denied_path':
      return 'denied_path'
    case 'cross_project':
      return 'cross_project'
    case 'stale':
      return 'stale'
    default:
      return 'unreadable'
  }
}

/**
 * Bounded context reader. It never uploads a whole repository: every request needs an explicit
 * conversation grant, every slice carries provenance and a baseline, and budgets are enforced before
 * content is returned. Content is always `untrusted_data` and grants no tool or write permission.
 */
export class ContextReader {
  private readonly now: () => Date
  private readonly maxPerFileBytes: number

  constructor(options: ContextReaderOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.maxPerFileBytes = options.maxPerFileBytes ?? 256 * 1024
  }

  async read(requestInput: unknown, port: ContextReadPort): Promise<ContextBundle> {
    let request: ContextRequest
    try {
      request = ContextRequestSchema.parse(requestInput)
    } catch (error) {
      throw new ContextError('invalid_input', 'Invalid context request', { issues: error instanceof Error ? error.message : String(error) })
    }
    const startedAt = this.now()
    await authorizeContextRequest(request, port, startedAt)
    const budget = resolveBudget(request)
    const started = startedAt.getTime()

    let baseline: { commit?: string; capturedAt: string } | undefined
    try {
      baseline = await port.projectBaseline(request.projectId)
    } catch {
      throw new ContextError('unsupported_port', 'The read port failed to report a project baseline')
    }
    if (!baseline) {
      return this.buildBundle({
        request,
        budget,
        status: 'insufficient',
        baseline: { capturedAt: startedAt.toISOString() },
        slices: [],
        omitted: [{ reason: 'missing', detail: 'project baseline unavailable' }],
        injectionFlags: [],
        explanations: ['The project baseline is unavailable; no repository facts were read.'],
        used: { files: 0, bytes: 0, tokens: 0, durationMs: 0 },
      })
    }

    const terms = queryTerms(request.query)
    const scanLimit = Math.max(budget.maxFiles * 4, 32)
    let listed: readonly ContextSourceDescriptor[]
    try {
      listed = await port.listSources({
        projectId: request.projectId,
        kinds: request.grant.sourceKinds,
        allowedPaths: request.grant.scope.allowedPaths,
        excludedPaths: request.grant.scope.excludedPaths,
        limit: scanLimit,
      })
    } catch {
      throw new ContextError('unsupported_port', 'The read port failed to list sources')
    }

    const omitted: ContextOmission[] = []
    const candidates: { descriptor: ContextSourceDescriptor; score: number }[] = []
    for (const descriptor of listed) {
      const allowed = sourceAllowedByGrant(descriptor, request)
      if (allowed !== 'ok') {
        omitted.push({ ...(descriptor.sourceId ? { sourceId: descriptor.sourceId } : {}), path: descriptor.path, reason: allowed })
        continue
      }
      if (!request.grant.sourceKinds.includes(descriptor.kind)) {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'denied_kind' })
        continue
      }
      if (descriptor.validity === 'missing') {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'missing' })
        continue
      }
      if (descriptor.validity === 'stale') {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'stale' })
        continue
      }
      if (isDeniedPath(descriptor.path) || isExternalReference(descriptor.path)) {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'denied_path' })
        continue
      }
      if (descriptor.mediaType === 'binary') {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'binary' })
        continue
      }
      candidates.push({
        descriptor,
        score: relevanceScore({ terms, kind: descriptor.kind, path: descriptor.path, ...(descriptor.title === undefined ? {} : { title: descriptor.title }) }),
      })
    }

    candidates.sort(
      (left, right) =>
        right.score - left.score ||
        KIND_ORDER[right.descriptor.kind] - KIND_ORDER[left.descriptor.kind] ||
        left.descriptor.path.localeCompare(right.descriptor.path),
    )

    const offset = parseCursor(request.cursor)
    if (offset > candidates.length) {
      return this.buildBundle({
        request,
        budget,
        status: 'insufficient',
        baseline,
        slices: [],
        omitted: [...omitted, { reason: 'missing', detail: 'cursor is past the available sources' }],
        injectionFlags: [],
        explanations: ['The cursor is past the available authorized sources.'],
        used: { files: 0, bytes: 0, tokens: 0, durationMs: 0 },
      })
    }

    const slices: ContextSlice[] = []
    const injectionFlags: ContextInjectionFlag[] = []
    let bytesUsed = 0
    let tokensUsed = 0
    let nextCursor: string | undefined
    let index = offset

    for (; index < candidates.length; index += 1) {
      const candidate = candidates[index]!
      const descriptor = candidate.descriptor
      const stop = (reason: ContextOmission['reason'], detail?: string): void => {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason, ...(detail === undefined ? {} : { detail }) })
      }
      if (slices.length >= budget.maxSlices) {
        stop('budget_slices')
        nextCursor = String(index)
        break
      }
      if (slices.length >= budget.maxFiles) {
        stop('budget_files')
        nextCursor = String(index)
        break
      }
      if (this.now().getTime() - started > budget.maxDurationMs) {
        stop('budget_time')
        nextCursor = String(index)
        break
      }
      const remainingBytes = budget.maxBytes - bytesUsed
      if (remainingBytes <= 0) {
        stop('budget_bytes')
        nextCursor = String(index)
        break
      }
      const perFile = Math.min(remainingBytes, this.maxPerFileBytes)
      if (descriptor.bytes > perFile) {
        stop('oversized', 'source exceeds the per-file or remaining byte budget')
        continue
      }

      let read: { content: string; bytes: number; digest: string }
      try {
        read = await port.readSource({ source: descriptor, maxBytes: perFile })
      } catch (error) {
        if (error instanceof ContextSourceAccessError) {
          omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: omissionReasonFromFailure(error.reason) })
        } else {
          omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'unreadable' })
        }
        continue
      }
      if (read.bytes > perFile || read.bytes > remainingBytes) {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'oversized' })
        continue
      }
      if (descriptor.baseline.digestScope === 'content' && read.digest !== descriptor.baseline.contentDigest) {
        omitted.push({ sourceId: descriptor.sourceId, path: descriptor.path, reason: 'stale', detail: 'content changed since listing' })
        continue
      }

      const remainingTokens = budget.maxTokens - tokensUsed
      if (remainingTokens <= 0) {
        stop('budget_tokens')
        nextCursor = String(index)
        break
      }
      const truncated = truncateToTokenBudget(read.content, remainingTokens)
      if (truncated.truncated && truncated.content.length === 0) {
        stop('budget_tokens')
        nextCursor = String(index)
        break
      }
      const tokens = estimateTokens(truncated.content)
      const score = relevanceScore({
        terms,
        kind: descriptor.kind,
        path: descriptor.path,
        ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
        content: truncated.content,
      })
      const patterns = detectInjectionPatterns(truncated.content)
      if (patterns.length > 0) {
        injectionFlags.push({ sourceId: descriptor.sourceId, path: descriptor.path, patterns })
      }

      slices.push({
        sourceId: descriptor.sourceId,
        kind: descriptor.kind,
        path: descriptor.path,
        ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
        content: truncated.content,
        range: { start: 0, end: truncated.content.length },
        truncated: truncated.truncated,
        bytes: Buffer.byteLength(truncated.content, 'utf8'),
        tokens,
        relevance: score,
        trust: 'untrusted_data',
        baseline: descriptor.baseline,
        ...(descriptor.workId === undefined ? {} : { workId: descriptor.workId }),
        ...(descriptor.contract === undefined ? {} : { contract: descriptor.contract }),
      })
      bytesUsed += read.bytes
      tokensUsed += tokens
    }

    if (index < candidates.length && nextCursor === undefined) nextCursor = String(index)
    slices.sort((left, right) => right.relevance - left.relevance || left.path.localeCompare(right.path))

    const explanations: string[] = []
    if (slices.length === 0) explanations.push('No authorized source could be read within the request budgets.')
    if (omitted.some((item) => item.reason.startsWith('budget_'))) {
      explanations.push('Some sources were omitted because of request budgets; request the next page for more.')
    }
    if (injectionFlags.length > 0) {
      explanations.push('Some content contains instruction-like text. It remains untrusted data and grants no permission.')
    }
    const status = slices.length === 0 ? 'insufficient' : omitted.length > 0 || nextCursor !== undefined ? 'partial' : 'sufficient'
    return this.buildBundle({
      request,
      budget,
      status,
      baseline,
      slices,
      omitted,
      injectionFlags,
      explanations,
      used: { files: slices.length, bytes: bytesUsed, tokens: tokensUsed, durationMs: Math.max(0, this.now().getTime() - started) },
      ...(nextCursor === undefined ? {} : { nextCursor }),
    })
  }

  /** Checks that every slice still matches the current baseline and source content. */
  async revalidate(bundle: ContextBundle, port: ContextReadPort): Promise<ContextValidation> {
    let baseline: { commit?: string; capturedAt: string } | undefined
    try {
      baseline = await port.projectBaseline(bundle.projectId)
    } catch {
      baseline = undefined
    }
    if (!baseline) {
      return {
        validity: 'missing',
        baselineChanged: true,
        slices: bundle.slices.map((slice) => ({ sourceId: slice.sourceId, path: slice.path, validity: 'missing' as const })),
      }
    }
    const baselineChanged = baseline.commit !== bundle.baseline.commit || baseline.capturedAt !== bundle.baseline.capturedAt
    let listed: readonly ContextSourceDescriptor[]
    try {
      listed = await port.listSources({
        projectId: bundle.projectId,
        kinds: bundle.authorization.sourceKinds,
        allowedPaths: bundle.authorization.allowedPaths,
        excludedPaths: bundle.authorization.excludedPaths,
        limit: Math.max(bundle.slices.length * 4, 32),
      })
    } catch {
      listed = []
    }
    const byId = new Map(listed.map((source) => [source.sourceId, source]))
    const byPath = new Map(listed.map((source) => [source.path, source]))
    const slices = bundle.slices.map((slice) => {
      const current = byId.get(slice.sourceId) ?? byPath.get(slice.path)
      if (!current || current.validity === 'missing') {
        return { sourceId: slice.sourceId, path: slice.path, validity: 'missing' as const }
      }
      if (baselineChanged || current.validity === 'stale' || current.baseline.contentDigest !== slice.baseline.contentDigest) {
        return { sourceId: slice.sourceId, path: slice.path, validity: 'stale' as const }
      }
      return { sourceId: slice.sourceId, path: slice.path, validity: 'current' as const }
    })
    const validity = slices.some((slice) => slice.validity === 'missing')
      ? 'missing'
      : slices.some((slice) => slice.validity === 'stale')
        ? 'stale'
        : 'current'
    return { validity, baselineChanged, slices }
  }

  private buildBundle(input: {
    request: ContextRequest
    budget: ResolvedContextBudget
    status: ContextBundle['status']
    baseline: { commit?: string; capturedAt: string }
    slices: readonly ContextSlice[]
    omitted: readonly ContextOmission[]
    injectionFlags: readonly ContextInjectionFlag[]
    explanations: readonly string[]
    used: ContextBundle['used']
    nextCursor?: string
  }): ContextBundle {
    const { request } = input
    return {
      protocol: 'context-bundle/1',
      requestId: request.requestId,
      projectId: request.projectId,
      purpose: request.purpose,
      grantId: request.grant.grantId,
      status: input.status,
      trust: 'untrusted_data',
      baseline: input.baseline,
      authorization: {
        sourceKinds: request.grant.sourceKinds,
        allowedPaths: request.grant.scope.allowedPaths,
        excludedPaths: request.grant.scope.excludedPaths,
      },
      slices: input.slices,
      omitted: input.omitted,
      injectionFlags: input.injectionFlags,
      explanations: input.explanations,
      budget: input.budget,
      used: input.used,
      ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
    }
  }
}
