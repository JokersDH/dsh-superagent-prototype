import type { ContractRef, Scope } from '@personal-agent/contracts'
import { ContextError } from './errors.ts'
import { detectInjectionPatterns } from './injection.ts'
import { sha256Text } from './digest.ts'
import { scopeWithin } from './paths.ts'
import { ContextReader } from './reader.ts'
import { estimateTokens } from './tokens.ts'
import { ContextGrantSchema, ContextRequestSchema, ContextSourceKindSchema } from './types.ts'
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
  /** Optional bounded-scan coverage; an incomplete scan must not look like a complete one. */
  coverage?(): { readonly complete: boolean }
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
  /** Optional lookup/return coverage; missing or unattempted ids are an incomplete selection. */
  coverage?(): { readonly complete: boolean }
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

/** Every group name owns a fixed source-kind family; a name can never borrow another provider. */
const GROUP_KIND_FAMILY: Record<ComposedGroupName, ReadonlySet<ContextSourceKind>> = {
  contract: new Set(['contract', 'work']),
  decisions: new Set(['decision']),
  project_facts: new Set(['project_metadata', 'verification', 'delivery']),
  conversation: new Set(['conversation_message']),
  artifacts: new Set(['artifact']),
  files: new Set(['document', 'source_file']),
}

/**
 * Validates a caller group plan before any provider call: known name, kinds inside that name's
 * family, no duplicates, sane priority/share, no NaN/negative/infinite budget inputs.
 */
export function validateComposedGroups(groups: readonly ComposedGroupPlan[]): void {
  if (groups.length === 0) throw new ContextError('composition_invalid', 'Composition needs at least one group')
  const names = new Set<string>()
  const priorities = new Set<number>()
  for (const group of groups) {
    if (!Object.hasOwn(GROUP_KIND_FAMILY, group.name)) {
      throw new ContextError('composition_invalid', `Unknown composition group: ${String(group.name)}`)
    }
    if (names.has(group.name)) throw new ContextError('composition_invalid', `Duplicate composition group: ${group.name}`)
    names.add(group.name)
    if (!Number.isInteger(group.priority) || group.priority < 1) {
      throw new ContextError('composition_invalid', `Group ${group.name} needs a positive integer priority`)
    }
    if (priorities.has(group.priority)) {
      throw new ContextError('composition_invalid', `Two groups share priority ${group.priority}`)
    }
    priorities.add(group.priority)
    if (typeof group.share !== 'number' || !Number.isFinite(group.share) || group.share < 0 || group.share > 1) {
      throw new ContextError('composition_invalid', `Group ${group.name} share must be a finite number in [0,1]`)
    }
    if (group.sourceKinds.length === 0) throw new ContextError('composition_invalid', `Group ${group.name} needs source kinds`)
    if (new Set(group.sourceKinds).size !== group.sourceKinds.length) {
      throw new ContextError('composition_invalid', `Group ${group.name} repeats a source kind`)
    }
    const family = GROUP_KIND_FAMILY[group.name]
    for (const kind of group.sourceKinds) {
      if (!ContextSourceKindSchema.safeParse(kind).success || !family.has(kind)) {
        throw new ContextError('composition_invalid', `Group ${group.name} cannot declare source kind ${String(kind)}`)
      }
    }
  }
}

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
  /** Dimensions the caller asked above the grant: clamped, never escalated. */
  readonly budgetClamped: readonly string[]
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

/** Hard ceilings, independent of any grant, so a malformed caller budget cannot demand unbounded work. */
export const COMPOSITION_BUDGET_CEILINGS = Object.freeze({
  maxFiles: 64,
  maxSlices: 64,
  maxBytes: 4 * 1024 * 1024,
  maxTokens: 500_000,
  maxDurationMs: 60_000,
})

export interface ResolvedCompositionBudget {
  readonly maxFiles: number
  readonly maxSlices: number
  readonly maxBytes: number
  readonly maxTokens: number
  readonly maxDurationMs: number
}

export interface CompositionAuthorization {
  readonly grant: ContextGrant
  readonly budget: ResolvedCompositionBudget
  /** Dimensions where the caller asked for more than the grant allowed and were clamped. */
  readonly clamped: readonly string[]
}

function assertFinitePositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new ContextError('invalid_input', `Composition budget ${name} must be a positive integer`)
  }
  return value
}

/**
 * The single authorization gate for every composition source (port, decisions, conversation,
 * artifacts). It runs before any provider call, so no provider is touched for an expired,
 * wrong-purpose or wrong-project grant, and it never widens the caller budget past the grant.
 *
 * Budget rules: missing dimension -> grant cap; zero/negative/NaN/non-integer -> `invalid_input`;
 * above the grant or above the hard ceiling -> clamped (reported in `clamped`), never escalated.
 */
export function authorizeComposition(
  input: { readonly projectId: string; readonly purpose: ContextPurpose; readonly grant: ContextGrant; readonly budget: ContextBudget },
  now: Date,
): CompositionAuthorization {
  let grant: ContextGrant
  try {
    grant = ContextGrantSchema.parse(input.grant)
  } catch {
    throw new ContextError('invalid_input', 'Composition grant is invalid')
  }
  if (grant.gateway !== 'conversation') {
    throw new ContextError('grant_gateway', 'Executor authorization cannot drive a conversation composition')
  }
  if (grant.projectId !== input.projectId || grant.scope.projectId !== input.projectId) {
    throw new ContextError('grant_project', 'Composition grant belongs to another project')
  }
  if (grant.purpose !== input.purpose) {
    throw new ContextError('grant_purpose', 'Composition purpose does not match the grant')
  }
  const confirmedAt = Date.parse(grant.confirmedAt)
  if (!Number.isFinite(confirmedAt) || confirmedAt > now.getTime()) {
    throw new ContextError('grant_unconfirmed', 'Composition grant has no past explicit confirmation')
  }
  if (grant.expiresAt !== undefined && Date.parse(grant.expiresAt) <= now.getTime()) {
    throw new ContextError('grant_expired', 'Composition grant has expired')
  }

  const clamped: string[] = []
  const cap = (name: keyof ResolvedCompositionBudget, asked: number | undefined, allowed: number): number => {
    if (asked === undefined) return allowed
    const value = assertFinitePositive(asked, name)
    const limit = Math.min(allowed, COMPOSITION_BUDGET_CEILINGS[name])
    if (value > limit) {
      clamped.push(name)
      return limit
    }
    return value
  }
  const maxFiles = cap('maxFiles', input.budget.maxFiles, grant.maxFiles)
  const maxBytes = cap('maxBytes', input.budget.maxBytes, grant.maxBytes)
  const maxTokens = cap('maxTokens', input.budget.maxTokens, grant.maxTokens)
  const maxDurationMs = cap('maxDurationMs', input.budget.maxDurationMs, grant.maxDurationMs)
  const maxSlices = Math.min(
    maxFiles,
    cap('maxSlices', input.budget.maxSlices, Math.min(grant.maxFiles, COMPOSITION_BUDGET_CEILINGS.maxSlices)),
  )
  return { grant, budget: { maxFiles, maxSlices, maxBytes, maxTokens, maxDurationMs }, clamped }
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
    // Unified gate: no provider is touched before this returns.
    const authorization = authorizeComposition(
      { projectId: input.projectId, purpose: input.purpose, grant: input.grant, budget: input.budget },
      startedAt,
    )
    const grant = authorization.grant
    if (input.conversationId !== undefined && input.conversationId.length === 0) {
      throw new ContextError('composition_invalid', 'Conversation id cannot be empty')
    }
    const groups = [...(input.groups ?? DEFAULT_COMPOSED_GROUPS)].sort((a, b) => a.priority - b.priority)
    validateComposedGroups(groups)

    const totalBytes = authorization.budget.maxBytes
    const totalTokens = authorization.budget.maxTokens
    const totalFiles = authorization.budget.maxFiles
    const totalSlices = authorization.budget.maxSlices
    const maxDurationMs = authorization.budget.maxDurationMs

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
      // No allocation means no read: never force one extra slice/byte past the caller budget.
      const allocatedSlices = Math.min(remainingSlices, allocated.files)
      if (allocatedSlices < 1 || allocated.bytes < 1 || allocated.tokens < 1) {
        const reason: ContextOmission = allocatedSlices < 1
          ? { reason: 'budget_slices' }
          : allocated.bytes < 1
            ? { reason: 'budget_bytes' }
            : { reason: 'budget_tokens' }
        results.push({
          name: group.name,
          priority: group.priority,
          sourceKinds: group.sourceKinds,
          status: 'truncated',
          budget: allocated,
          used: { bytes: 0, tokens: 0, files: 0 },
          slices: [],
          omitted: [reason],
          explanations: ['Caller budget is exhausted for this group; no source was read.'],
        })
        continue
      }

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
      const groupAllocation = { bytes: allocated.bytes, tokens: allocated.tokens, files: allocatedSlices }
      // Long provider awaits can outlive the grant: re-check before and after each group.
      this.assertStillAuthorized(input, authorization)
      const outcome = await this.composeGroup({ ...group, sourceKinds: effectiveKinds }, input, groupAllocation, allocatedSlices)
      this.assertStillAuthorized(input, authorization)
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

    this.assertStillAuthorized(input, authorization)
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
      budgetClamped: authorization.clamped,
      groups: results,
      slices,
      omitted,
      injectionFlags,
      explanations,
      totals: used,
    }
  }

  /** Re-runs the authorization gate with the current clock; expiry mid-composition refuses. */
  private assertStillAuthorized(input: ContextCompositionRequest, authorization: CompositionAuthorization): void {
    const current = authorizeComposition(
      { projectId: input.projectId, purpose: input.purpose, grant: authorization.grant, budget: authorization.budget },
      this.now(),
    )
    if (current.budget.maxBytes !== authorization.budget.maxBytes) {
      throw new ContextError('composition_invalid', 'Composition authorization changed during the read')
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
      // The conversation grant scope is an authorization boundary for decision bodies too: a
      // same-project decision that reaches outside it never enters the composition or manifest.
      if (!scopeWithin(decision.scope, input.grant.scope)) {
        omitted.push({
          path: `decisions/${decision.decisionId}.json`,
          reason: 'excluded_path',
          detail: 'decision scope is outside the conversation grant',
        })
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
    // A scoped provider that walked only part of the conversation keeps that fact visible here, so
    // the composition and manifest can never report a bounded scan as complete.
    const incompleteScan = this.sources.conversation.coverage?.().complete === false
    if (incompleteScan) {
      omitted.push({ reason: 'source_unavailable', detail: 'conversation provider scan is incomplete' })
    }
    return {
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status:
          output.length === 0
            ? 'empty'
            : incompleteScan || messages.length >= limit || omitted.some((item) => item.reason === 'budget_group')
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
    const incompleteScan = this.sources.artifacts.coverage?.().complete === false
    if (incompleteScan) {
      omitted.push({ reason: 'source_unavailable', detail: 'artifact provider selection is incomplete' })
    }
    return {
      result: {
        name: group.name,
        priority: group.priority,
        sourceKinds: group.sourceKinds,
        status:
          slices.length === 0
            ? 'empty'
            : incompleteScan || artifacts.length >= limit || omitted.some((item) => item.reason === 'budget_group')
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

/** Stable, transport-neutral source manifest for main's own DTO; no absolute paths or authority. */
export interface ComposedSourceManifestEntry {
  readonly sourceId: string
  readonly kind: ContextSourceKind
  readonly group: ComposedGroupName
  readonly path: string
  readonly title?: string
  /** Whole-source digest (the full source, not the possibly truncated preview). */
  readonly contentDigest: string
  readonly wholeSourceDigest: string
  /** Digest of exactly what the preview contains (differs when the slice was truncated). */
  readonly visiblePreviewDigest: string
  /** `content` means the whole source; `prefix` means only a bounded prefix was hashed. */
  readonly digestScope: 'content' | 'prefix' | 'metadata'
  readonly baselineCommit?: string
  readonly truncated: boolean
  readonly bytes: number
  readonly tokens: number
  readonly trust: 'untrusted_data'
}

export interface ComposedSourceManifestSelection {
  readonly projectId: string
  readonly conversationId?: string
  readonly workId?: string
  readonly contract?: ContractRef
}

/** The resolved budget actually applied after the grant/caller/ceiling clamp — never the request. */
export interface ComposedSourceManifestBudget {
  readonly maxSlices: number
  readonly maxBytes: number
  readonly maxTokens: number
  readonly maxDurationMs: number
}

export interface ComposedSourceManifestCoverage {
  /** True only when the composition was sufficient: no omitted/truncated source and no unavailable group. */
  readonly complete: boolean
  readonly groups: readonly { readonly name: ComposedGroupName; readonly status: ComposedGroupResult['status'] }[]
  readonly omitted: number
  readonly truncated: number
  readonly budgetClamped: readonly string[]
}

export interface ComposedSourceManifest {
  readonly protocol: 'context-source-manifest/1'
  readonly projectId: string
  readonly conversationId?: string
  readonly workId?: string
  readonly status: ContextComposition['status']
  readonly selection: ComposedSourceManifestSelection
  /** Resolved budget after the grant/caller/ceiling clamp; a request-level change alone is not enough. */
  readonly budget: ComposedSourceManifestBudget
  readonly coverage: ComposedSourceManifestCoverage
  readonly sources: readonly ComposedSourceManifestEntry[]
  readonly omitted: readonly ContextOmission[]
  readonly injectionFlagPaths: readonly string[]
  readonly budgetClamped: readonly string[]
}

/**
 * Projects a composition into stable per-source identities for main. It adds no authorization and no
 * field a client could use to claim actor/tool permission; content itself stays untrusted data.
 */
export function buildSourceManifest(composition: ContextComposition): ComposedSourceManifest {
  const groupOf = new Map<string, ComposedGroupName>()
  for (const group of composition.groups) {
    for (const slice of group.slices) groupOf.set(slice.sourceId, group.name)
  }
  const truncated = composition.slices.filter((slice) => slice.truncated).length
  return {
    protocol: 'context-source-manifest/1',
    projectId: composition.projectId,
    ...(composition.conversationId === undefined ? {} : { conversationId: composition.conversationId }),
    ...(composition.workId === undefined ? {} : { workId: composition.workId }),
    status: composition.status,
    selection: {
      projectId: composition.projectId,
      ...(composition.conversationId === undefined ? {} : { conversationId: composition.conversationId }),
      ...(composition.workId === undefined ? {} : { workId: composition.workId }),
      ...(composition.contract === undefined ? {} : { contract: composition.contract }),
    },
    budget: {
      maxSlices: composition.budget.maxSlices,
      maxBytes: composition.budget.maxBytes,
      maxTokens: composition.budget.maxTokens,
      maxDurationMs: composition.budget.maxDurationMs,
    },
    coverage: {
      // Scan completeness: no group was left unread/truncated and no budget cap hid a source.
      // A `missing`/`stale` source is a definite observation, not an incomplete scan; an empty
      // composition is still not knowledge anyone can rely on.
      complete:
        composition.slices.length > 0 &&
        composition.groups.every((group) => group.status !== 'unavailable' && group.status !== 'truncated') &&
        !composition.omitted.some((item) => item.reason.startsWith('budget_') || item.reason === 'source_unavailable'),
      groups: composition.groups.map((group) => ({ name: group.name, status: group.status })),
      omitted: composition.omitted.length,
      truncated,
      budgetClamped: composition.budgetClamped,
    },
    sources: composition.slices.map((slice) => ({
      sourceId: slice.sourceId,
      kind: slice.kind,
      group: groupOf.get(slice.sourceId) ?? 'files',
      path: slice.path,
      ...(slice.title === undefined ? {} : { title: slice.title }),
      contentDigest: slice.baseline.contentDigest,
      wholeSourceDigest: slice.baseline.contentDigest,
      visiblePreviewDigest: sha256Text(slice.content),
      digestScope: slice.baseline.digestScope,
      ...(slice.baseline.commit === undefined ? {} : { baselineCommit: slice.baseline.commit }),
      truncated: slice.truncated,
      bytes: slice.bytes,
      tokens: slice.tokens,
      trust: 'untrusted_data' as const,
    })),
    omitted: composition.omitted,
    injectionFlagPaths: composition.injectionFlags.map((flag) => flag.path),
    budgetClamped: composition.budgetClamped,
  }
}

export type SourceManifestChangeReason =
  | 'content'
  | 'preview'
  | 'truncation'
  | 'budget'
  | 'selection'
  | 'contract'
  | 'baseline'
  | 'digest_scope'
  | 'omitted'
  | 'missing'
  | 'added'
  | 'replaced'

export interface SourceManifestChange {
  readonly sourceId?: string
  readonly path: string
  readonly kind: string
  readonly reason: SourceManifestChangeReason
}

export interface SourceManifestComparison {
  readonly protocol: 'context-source-manifest-comparison/1'
  readonly status: 'unchanged' | 'changed' | 'incomplete'
  readonly changes: readonly SourceManifestChange[]
  readonly incompleteReasons: readonly (
    | 'previous_incomplete'
    | 'current_incomplete'
    | 'selection_changed'
    | 'contract_changed'
    | 'digest_unverifiable'
  )[]
}

function selectionKey(manifest: ComposedSourceManifest): string {
  return JSON.stringify([manifest.selection.projectId, manifest.selection.conversationId ?? null, manifest.selection.workId ?? null])
}

function contractKey(manifest: ComposedSourceManifest): string {
  const contract = manifest.selection.contract
  return contract === undefined ? 'none' : JSON.stringify([contract.workId, contract.revision, contract.digest])
}

function budgetKey(manifest: ComposedSourceManifest): string {
  const budget = manifest.budget
  return JSON.stringify([budget.maxSlices, budget.maxBytes, budget.maxTokens, budget.maxDurationMs])
}

function omissionsKey(manifest: ComposedSourceManifest): string {
  return JSON.stringify(
    manifest.omitted.map((item) => [item.sourceId ?? null, item.path ?? null, item.reason, item.detail ?? null]),
  )
}

/**
 * Pure comparison of two manifests (for example before and after re-authorization or a re-read).
 * It only reports data movement: it never signs a grant, stores a confirmation or promises that a
 * source is unchanged for any time window.
 *
 * A same `sourceId` cannot hide a replacement: path/kind changes are reported as `replaced`, whole
 * content changes as `content`, preview-only changes as `preview`, and truncation/budget movement as
 * `truncation`/`budget`. An incomplete scan on either side is `incomplete`, never `unchanged`.
 */
export function compareSourceManifests(
  previous: ComposedSourceManifest,
  current: ComposedSourceManifest,
): SourceManifestComparison {
  const changes: SourceManifestChange[] = []
  const incompleteReasons: SourceManifestComparison['incompleteReasons'][number][] = []
  let unverifiableDigests = false
  if (selectionKey(previous) !== selectionKey(current)) {
    incompleteReasons.push('selection_changed')
    changes.push({ path: '', kind: '', reason: 'selection' })
  }
  if (contractKey(previous) !== contractKey(current)) {
    incompleteReasons.push('contract_changed')
    changes.push({ path: '', kind: '', reason: 'contract' })
  }
  if (!previous.coverage.complete) incompleteReasons.push('previous_incomplete')
  if (!current.coverage.complete) incompleteReasons.push('current_incomplete')

  const previousByKey = new Map(previous.sources.map((source) => [`${source.kind}\u0000${source.path}`, source]))
  const currentByKey = new Map(current.sources.map((source) => [`${source.kind}\u0000${source.path}`, source]))
  const previousById = new Map(previous.sources.map((source) => [source.sourceId, source]))

  for (const [key, before] of previousByKey) {
    const after = currentByKey.get(key)
    if (!after) {
      const sameId = current.sources.find((source) => source.sourceId === before.sourceId)
      changes.push({
        sourceId: before.sourceId,
        path: before.path,
        kind: before.kind,
        reason: sameId ? 'replaced' : 'missing',
      })
      continue
    }
    if (before.sourceId !== after.sourceId) {
      // A different identity at the same kind/path is a replacement, never unchanged.
      changes.push({ sourceId: after.sourceId, path: after.path, kind: after.kind, reason: 'replaced' })
      continue
    }
    if ((before.baselineCommit ?? null) !== (after.baselineCommit ?? null)) {
      changes.push({ sourceId: before.sourceId, path: before.path, kind: before.kind, reason: 'baseline' })
      continue
    }
    if (before.digestScope !== after.digestScope) {
      // The two sides hash different amounts of the source; equality of the digest strings would not
      // mean the same thing, so this is never unchanged.
      changes.push({ sourceId: before.sourceId, path: before.path, kind: before.kind, reason: 'digest_scope' })
      continue
    }
    if (before.digestScope !== 'content') {
      // Prefix/metadata digests cannot prove whole-source equality on their own.
      unverifiableDigests = true
    }
    if (before.wholeSourceDigest !== after.wholeSourceDigest || before.contentDigest !== after.contentDigest) {
      changes.push({ sourceId: before.sourceId, path: before.path, kind: before.kind, reason: 'content' })
      continue
    }
    if (before.visiblePreviewDigest !== after.visiblePreviewDigest) {
      changes.push({ sourceId: before.sourceId, path: before.path, kind: before.kind, reason: 'preview' })
      continue
    }
    if (before.truncated !== after.truncated) {
      changes.push({ sourceId: before.sourceId, path: before.path, kind: before.kind, reason: 'truncation' })
    }
  }
  for (const [key, after] of currentByKey) {
    if (previousByKey.has(key)) continue
    const replaced = previousById.get(after.sourceId)
    changes.push({
      sourceId: after.sourceId,
      path: after.path,
      kind: after.kind,
      reason: replaced && (replaced.path !== after.path || replaced.kind !== after.kind) ? 'replaced' : 'added',
    })
  }
  if (
    budgetKey(previous) !== budgetKey(current) ||
    JSON.stringify(previous.budgetClamped) !== JSON.stringify(current.budgetClamped)
  ) {
    changes.push({ path: '', kind: '', reason: 'budget' })
  }
  if (omissionsKey(previous) !== omissionsKey(current)) {
    changes.push({ path: '', kind: '', reason: 'omitted' })
  }
  if (unverifiableDigests) incompleteReasons.push('digest_unverifiable')

  const status: SourceManifestComparison['status'] =
    incompleteReasons.length > 0 ? 'incomplete' : changes.length > 0 ? 'changed' : 'unchanged'
  return {
    protocol: 'context-source-manifest-comparison/1',
    status,
    changes,
    incompleteReasons: [...new Set(incompleteReasons)],
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
