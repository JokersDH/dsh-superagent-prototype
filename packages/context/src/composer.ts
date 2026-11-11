import type { ContractRef, Scope } from '@personal-agent/contracts'
import { ContextError } from './errors.ts'
import { detectInjectionPatterns } from './injection.ts'
import { sha256Text } from './digest.ts'
import { ContextReader } from './reader.ts'
import { estimateTokens } from './tokens.ts'
import { ContextGrantSchema, ContextRequestSchema } from './types.ts'
import type {
  ContextBudget,
  ContextBundle,
  ContextGrant,
  ContextInjectionFlag,
  ContextOmission,
  ContextPurpose,
  ContextReadPort,
  ContextRequest,
  ContextSlice,
  ContextSourceKind,
} from './types.ts'
import type { ContextPreview, ContextPreviewFile } from './preview.ts'

export type ComposedGroupName = 'contract' | 'decisions' | 'project_facts' | 'conversation' | 'artifacts' | 'files'

/** A decision projection that carries no authority; the composer never re-derives effectiveness. */
export interface ComposedDecisionView {
  readonly decisionId: string
  readonly content: string
  readonly scope: Scope
  readonly sourceMessageId: string
  readonly recordedAt: string
}

/**
 * Structural decision provider. It MUST throw when the effectiveness scan cannot complete
 * (knowledge's `DecisionError` code `scan_incomplete`); the composer maps that to a fatal
 * `ContextError('scan_incomplete')` instead of composing possibly-stale knowledge.
 */
export interface ComposedDecisionProvider {
  listEffective(
    projectId: string,
    max: number,
  ): Promise<{
    readonly decisions: readonly ComposedDecisionView[]
    /** The caller's own `max` cut the effective set. */
    readonly truncatedByLimit?: boolean
  }>
}

export interface ComposedConversationMessage {
  readonly messageId: string
  readonly conversationId: string
  readonly sequence: number
  readonly role: 'user' | 'assistant' | 'system'
  readonly provenance: string
  readonly text: string
  readonly createdAt: string
}

/** Bounded newest-first conversation reader; it must already be scoped to the authorized project. */
export interface ComposedConversationProvider {
  recent(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly limit: number
  }): Promise<readonly ComposedConversationMessage[]>
}

export interface ComposedArtifactView {
  readonly artifactId: string
  readonly digest: string
  readonly bytes: number
  readonly createdAt: string
}

/** Bounded newest-first artifact metadata reader; never returns a host filesystem path. */
export interface ComposedArtifactProvider {
  recent(input: { readonly projectId: string; readonly limit: number }): Promise<readonly ComposedArtifactView[]>
}

export interface ComposedGroupPlan {
  readonly name: ComposedGroupName
  readonly priority: number
  readonly sourceKinds: readonly ContextSourceKind[]
  /** Fraction of the caller budget reserved for the group; defaults sum to 1. */
  readonly share: number
}

export const DEFAULT_COMPOSED_GROUPS: readonly ComposedGroupPlan[] = Object.freeze([
  { name: 'contract', priority: 1, sourceKinds: ['contract', 'work'], share: 0.3 },
  { name: 'decisions', priority: 2, sourceKinds: ['decision'], share: 0.25 },
  { name: 'project_facts', priority: 3, sourceKinds: ['project_metadata', 'verification', 'delivery'], share: 0.15 },
  { name: 'conversation', priority: 4, sourceKinds: ['conversation_message'], share: 0.2 },
  { name: 'artifacts', priority: 5, sourceKinds: ['artifact'], share: 0.1 },
  // Raw project files last: only the budget left over by the structured groups.
  { name: 'files', priority: 6, sourceKinds: ['document', 'source_file'], share: 0 },
])

export interface ContextCompositionRequest {
  readonly requestId: string
  readonly projectId: string
  readonly purpose: ContextPurpose
  readonly query: string
  readonly grant: ContextGrant
  readonly budget: ContextBudget
  readonly conversationId?: string
  readonly workId?: string
  readonly contract?: ContractRef
  readonly groups?: readonly ComposedGroupPlan[]
}

export interface ComposedGroupResult {
  readonly name: ComposedGroupName
  readonly priority: number
  readonly sourceKinds: readonly ContextSourceKind[]
  readonly status: 'included' | 'empty' | 'unavailable' | 'truncated'
  readonly budget: { readonly bytes: number; readonly tokens: number; readonly files: number }
  readonly used: { readonly bytes: number; readonly tokens: number; readonly files: number }
  readonly slices: readonly ContextSlice[]
  readonly omitted: readonly ContextOmission[]
  readonly explanations: readonly string[]
}

export interface ContextComposition {
  readonly protocol: 'context-composition/1'
  readonly requestId: string
  readonly projectId: string
  readonly conversationId?: string
  readonly workId?: string
  readonly contract?: ContractRef
  readonly grantId: string
  readonly purpose: ContextPurpose
  readonly status: ContextBundle['status']
  readonly trust: 'untrusted_data'
  readonly baseline: { readonly commit?: string; readonly capturedAt: string }
  readonly budget: { readonly maxBytes: number; readonly maxTokens: number; readonly maxSlices: number; readonly maxDurationMs: number }
  readonly groups: readonly ComposedGroupResult[]
  readonly slices: readonly ContextSlice[]
  readonly omitted: readonly ContextOmission[]
  readonly injectionFlags: readonly ContextInjectionFlag[]
  readonly explanations: readonly string[]
  readonly totals: { readonly files: number; readonly bytes: number; readonly tokens: number; readonly durationMs: number }
}

type GroupOutcome = {
  readonly result: ComposedGroupResult
  readonly baseline?: { readonly commit?: string; readonly capturedAt: string }
  readonly injectionFlags: readonly ContextInjectionFlag[]
}

export interface ContextComposerSources {
  readonly port: ContextReadPort
  readonly decisions?: ComposedDecisionProvider
  readonly conversation?: ComposedConversationProvider
  readonly artifacts?: ComposedArtifactProvider
}

export interface ContextComposerOptions {
  readonly now?: () => Date
  readonly reader?: ContextReader
}

const PORT_GROUP_KINDS: ReadonlySet<ContextSourceKind> = new Set([
  'project_metadata',
  'work',
  'contract',
  'verification',
  'delivery',
  'document',
  'source_file',
])

function isIncompleteScan(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === 'scan_incomplete'
  )
}

function decisionContent(decision: ComposedDecisionView): string {
  return JSON.stringify({
    decisionId: decision.decisionId,
    content: decision.content,
    scope: decision.scope,
    sourceMessageId: decision.sourceMessageId,
    recordedAt: decision.recordedAt,
  })
}

function messageContent(message: ComposedConversationMessage): string {
  return JSON.stringify({
    messageId: message.messageId,
    sequence: message.sequence,
    role: message.role,
    provenance: message.provenance,
    createdAt: message.createdAt,
    text: message.text,
  })
}

function truncateToTokens(text: string, maxTokens: number): { content: string; truncated: boolean } {
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

/**
 * Deterministic, read-only composition with an explicit caller budget.
 *
 * Priority is fixed by the group plan (not by a model): the current contract/work is read first,
 * then effective decisions, project facts, conversation messages and artifacts. Each group receives
 * a documented share of the caller budget; unused shares carry to later groups. Bytes and tokens are
 * **estimates** for bounded composition, never a billing guarantee.
 *
 * Safety properties:
 * - an incomplete decision-effectiveness scan fails the whole composition (`scan_incomplete`); it is
 *   never silently included as valid knowledge;
 * - revoked/superseded decisions must already be absent from the provider; the composer does not
 *   re-derive or resurrect them;
 * - every slice is `untrusted_data`, and document/message text stays data, never authority;
 * - a missing optional provider is reported as `source_unavailable`, not as an empty group.
 */
export class ContextComposer {
  private readonly sources: ContextComposerSources
  private readonly reader: ContextReader
  private readonly now: () => Date

  constructor(sources: ContextComposerSources, options: ContextComposerOptions = {}) {
    this.sources = sources
    this.reader = options.reader ?? new ContextReader(options.now === undefined ? {} : { now: options.now })
    this.now = options.now ?? (() => new Date())
  }

  async compose(input: ContextCompositionRequest): Promise<ContextComposition> {
    const startedAt = this.now()
    const started = startedAt.getTime()
    if (input.projectId.length === 0) throw new ContextError('invalid_input', 'Composition needs a project')
    let grant: ContextGrant
    try {
      grant = ContextGrantSchema.parse(input.grant)
    } catch {
      throw new ContextError('invalid_input', 'Composition grant is invalid')
    }
    if (grant.projectId !== input.projectId) {
      throw new ContextError('grant_project', 'Composition grant belongs to another project')
    }
    if (grant.gateway !== 'conversation') {
      throw new ContextError('grant_gateway', 'Executor authorization cannot drive a conversation composition')
    }
    if (input.conversationId !== undefined && input.conversationId.length === 0) {
      throw new ContextError('composition_invalid', 'Conversation id cannot be empty')
    }
    const groups = [...(input.groups ?? DEFAULT_COMPOSED_GROUPS)].sort((a, b) => a.priority - b.priority)
    if (groups.length === 0) throw new ContextError('composition_invalid', 'Composition needs at least one group')

    const totalBytes = Math.max(1, input.budget.maxBytes ?? grant.maxBytes)
    const totalTokens = Math.max(1, input.budget.maxTokens ?? grant.maxTokens)
    const totalFiles = Math.max(1, input.budget.maxFiles ?? grant.maxFiles)
    const totalSlices = Math.max(1, input.budget.maxSlices ?? grant.maxFiles)
    const maxDurationMs = Math.max(1, input.budget.maxDurationMs ?? grant.maxDurationMs)

    let remainingBytes = totalBytes
    let remainingTokens = totalTokens
    let remainingFiles = totalFiles
    let remainingSlices = totalSlices
    let carryBytes = 0
    let carryTokens = 0
    let carryFiles = 0

    const grantedKinds = new Set(grant.sourceKinds)
    const results: ComposedGroupResult[] = []
    const injectionFlags: ContextInjectionFlag[] = []
    const explanations: string[] = []
    let baseline: { commit?: string; capturedAt: string } | undefined

    for (const group of groups) {
      const shareBytes = Math.floor(totalBytes * group.share) + carryBytes
      const shareTokens = Math.floor(totalTokens * group.share) + carryTokens
      const shareFiles = Math.max(1, Math.floor(totalFiles * group.share))
      const allocated = {
        bytes: Math.min(shareBytes, remainingBytes),
        tokens: Math.min(shareTokens, remainingTokens),
        files: Math.min(shareFiles, remainingFiles),
      }
      if (remainingSlices <= 0) {
        results.push({
          name: group.name,
          priority: group.priority,
          sourceKinds: group.sourceKinds,
          status: 'truncated',
          budget: { bytes: 0, tokens: 0, files: 0 },
          used: { bytes: 0, tokens: 0, files: 0 },
          slices: [],
          omitted: [{ reason: 'budget_slices' }],
          explanations: ['Caller slice budget exhausted; this group was not read.'],
        })
        continue
      }
      const allocatedSlices = Math.min(remainingSlices, Math.max(1, allocated.files))

      if (this.now().getTime() - started > maxDurationMs) {
        results.push({
          name: group.name,
          priority: group.priority,
          sourceKinds: group.sourceKinds,
          status: 'truncated',
          budget: allocated,
          used: { bytes: 0, tokens: 0, files: 0 },
          slices: [],
          omitted: [{ reason: 'budget_time' }],
          explanations: ['Composition stopped: caller time budget reached before this group.'],
        })
        continue
      }

      // A group may only read kinds the caller actually granted; the plan never widens authorization.
      const effectiveKinds = group.sourceKinds.filter((kind) => grantedKinds.has(kind))
      if (effectiveKinds.length === 0) {
        results.push({
          name: group.name,
          priority: group.priority,
          sourceKinds: group.sourceKinds,
          status: 'empty',
          budget: allocated,
          used: { bytes: 0, tokens: 0, files: 0 },
          slices: [],
          omitted: [{ reason: 'denied_kind', detail: 'group kinds are not granted' }],
          explanations: ['Group skipped: the conversation grant does not include these source kinds.'],
        })
        carryBytes = Math.max(0, allocated.bytes)
        carryTokens = Math.max(0, allocated.tokens)
        // Files are an absolute count cap, not a proportional budget: unused slots do not inflate.
        carryFiles = 0
        continue
      }

      // One global slice cap: per-group allocations can never add up past the caller's maxSlices.
      const groupAllocation = {
        bytes: allocated.bytes,
        tokens: allocated.tokens,
        files: Math.max(1, Math.min(allocated.files, allocatedSlices)),
      }
      const outcome = await this.composeGroup(
        { ...group, sourceKinds: effectiveKinds },
        input,
        groupAllocation,
        Math.max(1, Math.min(allocated.files, allocatedSlices)),
      )
      results.push(outcome.result)
      if (baseline === undefined && outcome.baseline !== undefined) baseline = outcome.baseline
      for (const flag of outcome.result.slices.length === 0 ? [] : outcome.injectionFlags) injectionFlags.push(flag)

      remainingBytes -= outcome.result.used.bytes
      remainingTokens -= outcome.result.used.tokens
      remainingFiles -= outcome.result.used.files
      remainingSlices -= outcome.result.slices.length
      carryBytes = Math.max(0, allocated.bytes - outcome.result.used.bytes)
      carryTokens = Math.max(0, allocated.tokens - outcome.result.used.tokens)
      carryFiles = 0
      if (remainingBytes <= 0 && remainingTokens <= 0) {
        explanations.push('Caller byte/token budget exhausted; later groups were not read.')
        break
      }
    }

    const slices = results.flatMap((group) => group.slices)
    const omitted = results.flatMap((group) => group.omitted)
    const files = slices.length
    const bytes = slices.reduce((total, slice) => total + slice.bytes, 0)
    const tokens = slices.reduce((total, slice) => total + slice.tokens, 0)
    const used = { files, bytes, tokens, durationMs: Math.max(0, this.now().getTime() - started) }

    const hasTruncation = results.some((group) => group.status === 'truncated' || group.status === 'unavailable')
    const status: ContextBundle['status'] =
      slices.length === 0 ? 'insufficient' : hasTruncation || omitted.length > 0 ? 'partial' : 'sufficient'

    if (slices.length === 0) explanations.push('No authorized source fit inside the caller budget.')
    if (hasTruncation) explanations.push('Some groups were unavailable or truncated; see their omissions.')
    if (injectionFlags.length > 0) {
      explanations.push('Some content contains instruction-like text; it stays untrusted data and grants no permission.')
    }

    return {
      protocol: 'context-composition/1',
      requestId: input.requestId,
      projectId: input.projectId,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.workId === undefined ? {} : { workId: input.workId }),
      ...(input.contract === undefined ? {} : { contract: input.contract }),
      grantId: grant.grantId,
      purpose: grant.purpose,
      status,
      trust: 'untrusted_data',
      baseline: baseline ?? { capturedAt: startedAt.toISOString() },
      budget: { maxBytes: totalBytes, maxTokens: totalTokens, maxSlices: totalSlices, maxDurationMs },
      groups: results,
      slices,
      omitted,
      injectionFlags,
      explanations,
      totals: used,
    }
  }

  private async composeGroup(
    group: ComposedGroupPlan,
    input: ContextCompositionRequest,
    allocated: { bytes: number; tokens: number; files: number },
    slices: number,
  ): Promise<GroupOutcome> {
    const empty = (
      status: ComposedGroupResult['status'],
      omitted: ContextOmission[],
      explanation: string,
    ): { result: ComposedGroupResult; injectionFlags: readonly ContextInjectionFlag[] } => ({
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status,
        budget: allocated,
        used: { bytes: 0, tokens: 0, files: 0 },
        slices: [],
        omitted,
        explanations: [explanation],
      },
      injectionFlags: [] as readonly ContextInjectionFlag[],
    })

    if (group.name === 'decisions') return this.composeDecisions(group, input, allocated, empty)
    if (group.name === 'conversation') return this.composeConversation(group, input, allocated, slices, empty)
    if (group.name === 'artifacts') return this.composeArtifacts(group, input, allocated, empty)
    if (!group.sourceKinds.every((kind) => PORT_GROUP_KINDS.has(kind))) {
      return empty('unavailable', [{ reason: 'source_unavailable', detail: 'group kind is not port-backed' }], 'Group has no readable port.')
    }

    const request: ContextRequest = ContextRequestSchema.parse({
      requestId: `${input.requestId}:${group.name}`,
      projectId: input.projectId,
      purpose: input.purpose,
      query: input.query,
      grant: {
        ...input.grant,
        sourceKinds: group.sourceKinds,
        maxFiles: Math.max(1, Math.min(allocated.files, slices)),
        maxBytes: Math.max(1, allocated.bytes),
        maxTokens: Math.max(1, allocated.tokens),
      },
      budget: {
        maxFiles: Math.max(1, Math.min(allocated.files, slices)),
        maxBytes: Math.max(1, allocated.bytes),
        maxTokens: Math.max(1, allocated.tokens),
        maxSlices: Math.max(1, slices),
      },
      ...(input.workId === undefined ? {} : { workId: input.workId }),
      ...(input.contract === undefined ? {} : { contract: input.contract }),
    })
    const bundle = await this.reader.read(request, this.sources.port)
    return {
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status: bundle.slices.length === 0 ? (bundle.status === 'insufficient' ? 'empty' : 'truncated') : 'included',
        budget: allocated,
        used: { bytes: bundle.used.bytes, tokens: bundle.used.tokens, files: bundle.slices.length },
        slices: bundle.slices,
        omitted: bundle.omitted,
        explanations: bundle.explanations,
      },
      baseline: bundle.baseline,
      injectionFlags: bundle.injectionFlags,
    }
  }

  private async composeDecisions(
    group: ComposedGroupPlan,
    input: ContextCompositionRequest,
    allocated: { bytes: number; tokens: number; files: number },
    empty: (
      status: ComposedGroupResult['status'],
      omitted: ContextOmission[],
      explanation: string,
    ) => GroupOutcome,
  ): Promise<GroupOutcome> {
    if (!this.sources.decisions) {
      return empty('unavailable', [{ reason: 'source_unavailable', detail: 'no decision provider' }], 'Effective decisions are not connected.')
    }
    let page: { decisions: readonly ComposedDecisionView[]; truncatedByLimit?: boolean }
    try {
      page = await this.sources.decisions.listEffective(input.projectId, allocated.files)
    } catch (error) {
      if (isIncompleteScan(error)) {
        throw new ContextError('scan_incomplete', 'Decision effectiveness scan could not complete', { group: group.name })
      }
      throw error
    }
    const created = this.now().toISOString()
    const slices: ContextSlice[] = []
    const omitted: ContextOmission[] = []
    let bytes = 0
    let tokens = 0
    const injectionFlags: ContextInjectionFlag[] = []

    for (const decision of page.decisions) {
      if (slices.length >= allocated.files) {
        omitted.push({ path: `decisions/${decision.decisionId}.json`, reason: 'budget_group' })
        continue
      }
      if (decision.scope.projectId !== input.projectId) {
        omitted.push({ path: `decisions/${decision.decisionId}.json`, reason: 'cross_project' })
        continue
      }
      if (bytes >= allocated.bytes || tokens >= allocated.tokens) {
        omitted.push({ path: `decisions/${decision.decisionId}.json`, reason: 'budget_group' })
        continue
      }
      const raw = decisionContent(decision)
      const truncated = truncateToTokens(raw, allocated.tokens - tokens)
      if (truncated.content.length === 0) {
        omitted.push({ path: `decisions/${decision.decisionId}.json`, reason: 'budget_group' })
        continue
      }
      const contentBytes = Buffer.byteLength(truncated.content, 'utf8')
      if (bytes + contentBytes > allocated.bytes) {
        omitted.push({ path: `decisions/${decision.decisionId}.json`, reason: 'budget_group' })
        continue
      }
      const sliceTokens = estimateTokens(truncated.content)
      const sourceId = `decision-${sha256Text(`${input.projectId}\0${decision.decisionId}`).slice(0, 32)}`
      slices.push({
        sourceId,
        kind: 'decision',
        path: `decisions/${decision.decisionId}.json`,
        title: 'Explicit user decision',
        content: truncated.content,
        range: { start: 0, end: truncated.content.length },
        truncated: truncated.truncated,
        bytes: contentBytes,
        tokens: sliceTokens,
        relevance: 0,
        trust: 'untrusted_data',
        baseline: { contentDigest: sha256Text(raw), digestScope: 'content', capturedAt: created },
      })
      const patterns = detectInjectionPatterns(truncated.content)
      if (patterns.length > 0) injectionFlags.push({ sourceId, path: `decisions/${decision.decisionId}.json`, patterns })
      bytes += contentBytes
      tokens += sliceTokens
    }
    if (page.truncatedByLimit === true) {
      omitted.push({ reason: 'budget_group', detail: 'decision provider cap reached; request a narrower scope' })
    }

    return {
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status:
          slices.length === 0
            ? 'empty'
            : page.truncatedByLimit === true || omitted.some((item) => item.reason === 'budget_group')
              ? 'truncated'
              : 'included',
        budget: allocated,
        used: { bytes, tokens, files: slices.length },
        slices,
        omitted,
        explanations:
          slices.length === 0
            ? ['No effective decision fit inside the caller budget.']
            : ['Effective decisions only: revoked, superseded, expired or source-invalid records are excluded by the provider.'],
      },
      injectionFlags,
    }
  }

  private async composeConversation(
    group: ComposedGroupPlan,
    input: ContextCompositionRequest,
    allocated: { bytes: number; tokens: number; files: number },
    slices: number,
    empty: (
      status: ComposedGroupResult['status'],
      omitted: ContextOmission[],
      explanation: string,
    ) => GroupOutcome,
  ): Promise<GroupOutcome> {
    if (!this.sources.conversation) {
      return empty('unavailable', [{ reason: 'source_unavailable', detail: 'no conversation provider' }], 'Conversation history is not connected.')
    }
    if (!input.conversationId) {
      return empty('empty', [{ reason: 'source_unavailable', detail: 'composition has no conversation id' }], 'No conversation selected; history was not read.')
    }
    const limit = Math.max(1, Math.min(allocated.files, slices))
    const messages = await this.sources.conversation.recent({
      projectId: input.projectId,
      conversationId: input.conversationId,
      limit,
    })
    const created = this.now().toISOString()
    const output: ContextSlice[] = []
    const omitted: ContextOmission[] = []
    const injectionFlags: ContextInjectionFlag[] = []
    let bytes = 0
    let tokens = 0
    for (const message of messages) {
      if (output.length >= limit) {
        omitted.push({ path: `conversation/${message.messageId}.json`, reason: 'budget_group' })
        continue
      }
      if (message.conversationId !== input.conversationId) {
        omitted.push({ path: `conversation/${message.messageId}.json`, reason: 'source_unavailable', detail: 'another conversation' })
        continue
      }
      if (bytes >= allocated.bytes || tokens >= allocated.tokens) {
        omitted.push({ path: `conversation/${message.messageId}.json`, reason: 'budget_group' })
        continue
      }
      const raw = messageContent(message)
      const truncated = truncateToTokens(raw, allocated.tokens - tokens)
      if (truncated.content.length === 0) {
        omitted.push({ path: `conversation/${message.messageId}.json`, reason: 'budget_group' })
        continue
      }
      const contentBytes = Buffer.byteLength(truncated.content, 'utf8')
      if (bytes + contentBytes > allocated.bytes) {
        omitted.push({ path: `conversation/${message.messageId}.json`, reason: 'budget_group' })
        continue
      }
      const sliceTokens = estimateTokens(truncated.content)
      const sourceId = `message-${sha256Text(`${input.projectId}\0${message.messageId}`).slice(0, 32)}`
      const path = `conversation/${String(message.sequence).padStart(6, '0')}-${message.messageId}.json`
      output.push({
        sourceId,
        kind: 'conversation_message',
        path,
        title: `${message.role} message`,
        content: truncated.content,
        range: { start: 0, end: truncated.content.length },
        truncated: truncated.truncated,
        bytes: contentBytes,
        tokens: sliceTokens,
        relevance: 0,
        trust: 'untrusted_data',
        baseline: { contentDigest: sha256Text(raw), digestScope: 'content', capturedAt: created },
      })
      const patterns = detectInjectionPatterns(message.text)
      if (patterns.length > 0) injectionFlags.push({ sourceId, path, patterns })
      bytes += contentBytes
      tokens += sliceTokens
    }
    if (messages.length >= limit) {
      omitted.push({ reason: 'budget_group', detail: 'conversation limit reached; older messages were not read' })
    }
    return {
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status:
          output.length === 0
            ? 'empty'
            : messages.length >= limit || omitted.some((item) => item.reason === 'budget_group')
              ? 'truncated'
              : 'included',
        budget: allocated,
        used: { bytes, tokens, files: output.length },
        slices: output,
        omitted,
        explanations: output.length === 0 ? ['No conversation message fit inside the caller budget.'] : [],
      },
      injectionFlags,
    }
  }

  private async composeArtifacts(
    group: ComposedGroupPlan,
    input: ContextCompositionRequest,
    allocated: { bytes: number; tokens: number; files: number },
    empty: (
      status: ComposedGroupResult['status'],
      omitted: ContextOmission[],
      explanation: string,
    ) => GroupOutcome,
  ): Promise<GroupOutcome> {
    if (!this.sources.artifacts) {
      return empty('unavailable', [{ reason: 'source_unavailable', detail: 'no artifact provider' }], 'Artifact metadata is not connected.')
    }
    const limit = Math.max(1, allocated.files)
    const artifacts = await this.sources.artifacts.recent({ projectId: input.projectId, limit })
    const created = this.now().toISOString()
    const slices: ContextSlice[] = []
    const omitted: ContextOmission[] = []
    let bytes = 0
    let tokens = 0
    for (const artifact of artifacts) {
      if (slices.length >= limit || bytes >= allocated.bytes || tokens >= allocated.tokens) {
        omitted.push({ path: `artifacts/${artifact.artifactId}.json`, reason: 'budget_group' })
        continue
      }
      // Only identity/digest/size/time: an artifact store path is not part of the model context.
      const raw = JSON.stringify({
        artifactRef: artifact.artifactId,
        digest: artifact.digest,
        bytes: artifact.bytes,
        createdAt: artifact.createdAt,
      })
      const truncated = truncateToTokens(raw, allocated.tokens - tokens)
      const contentBytes = Buffer.byteLength(truncated.content, 'utf8')
      if (truncated.content.length === 0 || bytes + contentBytes > allocated.bytes) {
        omitted.push({ path: `artifacts/${artifact.artifactId}.json`, reason: 'budget_group' })
        continue
      }
      const sliceTokens = estimateTokens(truncated.content)
      slices.push({
        sourceId: `artifact-${sha256Text(`${input.projectId}\0${artifact.artifactId}`).slice(0, 32)}`,
        kind: 'artifact',
        path: `artifacts/${artifact.artifactId}.json`,
        title: 'Artifact metadata',
        content: truncated.content,
        range: { start: 0, end: truncated.content.length },
        truncated: truncated.truncated,
        bytes: contentBytes,
        tokens: sliceTokens,
        relevance: 0,
        trust: 'untrusted_data',
        baseline: { contentDigest: sha256Text(raw), digestScope: 'content', capturedAt: created },
      })
      bytes += contentBytes
      tokens += sliceTokens
    }
    if (artifacts.length >= limit) {
      omitted.push({ reason: 'budget_group', detail: 'artifact limit reached; older artifacts were not read' })
    }
    return {
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status:
          slices.length === 0
            ? 'empty'
            : artifacts.length >= limit || omitted.some((item) => item.reason === 'budget_group')
              ? 'truncated'
              : 'included',
        budget: allocated,
        used: { bytes, tokens, files: slices.length },
        slices,
        omitted,
        explanations: slices.length === 0 ? ['No artifact metadata fit inside the caller budget.'] : [],
      },
      injectionFlags: [],
    }
  }
}

/** Compact preview for main's UI; identical safety fields to `buildContextPreview`. */
export function buildCompositionPreview(composition: ContextComposition): ContextPreview {
  const files: ContextPreviewFile[] = composition.groups.flatMap((group) =>
    group.slices.map((slice) => ({
      path: slice.path,
      kind: slice.kind,
      bytes: slice.bytes,
      tokens: slice.tokens,
      truncated: slice.truncated,
      relevance: slice.relevance,
    })),
  )
  return {
    projectId: composition.projectId,
    purpose: composition.purpose,
    grantId: composition.grantId,
    status: composition.status,
    validity: 'unknown',
    baseline: composition.baseline,
    sourceKinds: composition.groups.flatMap((group) => group.sourceKinds),
    allowedPaths: [],
    selectedFiles: composition.slices
      .filter((slice) => slice.kind === 'document' || slice.kind === 'source_file')
      .map((slice) => slice.path),
    files,
    totals: { files: files.length, bytes: composition.totals.bytes, tokens: composition.totals.tokens },
    omitted: composition.omitted.map((item) => ({
      ...(item.path === undefined ? {} : { path: item.path }),
      reason: item.reason,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    })),
    injectionFlags: composition.injectionFlags.map((flag) => ({ path: flag.path, patterns: flag.patterns })),
  }
}
