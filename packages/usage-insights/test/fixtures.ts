/**
 * Deterministic fixtures. Every record here is schema-valid product data; the layer names say
 * exactly what each fixture claims, and no fixture is presented as native execution.
 */
import { createHash } from 'node:crypto'
import type { ExecutionOutcome, WorkEvidence, WorkEvidenceHistory } from '@personal-agent/contracts'
import type { AttentionPage } from '@personal-agent/contracts'
import type { UsageInsightsInput } from '../src/protocol.ts'

const hex = (seed: string): string => createHash('sha256').update(seed).digest('hex')
const id = (seed: string): string => `f-${seed}`

export const CONTRACT_ATLAS = { workId: 'work-atlas-1', revision: 1, digest: hex('contract-atlas-1') }
export const CONTRACT_ORBIT = { workId: 'work-orbit-1', revision: 2, digest: hex('contract-orbit-2') }

export interface OutcomeOptions {
  seed: string
  projectId?: string
  contract?: { workId: string; revision: number; digest: string }
  attemptId?: string
  layer?: ExecutionOutcome['layer']
  acceptance?: ExecutionOutcome['acceptance']
  accepted?: boolean
  durationMs?: number
  readyToAcceptanceMs?: number
  activeReviewMs?: number | null
  inputTokens?: number
  outputTokens?: number
  cost?: { currency: string; amount: number }
  usageCompleteness?: 'observed' | 'partial' | 'unknown'
  observedAt?: string
  candidateGeneration?: number
  profile?: { profileId: string; revision: number; identityDigest: string }
}

export function makeOutcome(options: OutcomeOptions): ExecutionOutcome {
  const contract = options.contract ?? CONTRACT_ATLAS
  const profile = options.profile ?? { profileId: 'profile-codex', revision: 1, identityDigest: hex('profile-codex-1') }
  const attempt = {
    ticketId: id(`ticket-${options.seed}`),
    assignmentId: id(`assignment-${options.seed}`),
    contract,
    attemptId: options.attemptId ?? id(`attempt-${options.seed}`),
    fenceEpoch: 1,
  }
  const accepted = options.accepted ?? options.acceptance === 'accepted'
  const candidate = accepted || options.candidateGeneration !== undefined
    ? { ticketId: attempt.ticketId, assignmentId: attempt.assignmentId, contract, candidateGeneration: options.candidateGeneration ?? 1 }
    : undefined
  const usage: ExecutionOutcome['usage'] = {
    completeness: options.usageCompleteness ?? (options.inputTokens === undefined && options.outputTokens === undefined ? 'unknown' : 'observed'),
    evidenceRefs: [id(`usage-evidence-${options.seed}`)],
    ...(options.inputTokens === undefined ? {} : { inputTokens: options.inputTokens }),
    ...(options.outputTokens === undefined ? {} : { outputTokens: options.outputTokens }),
    ...(options.cost === undefined ? {} : { cost: options.cost }),
  }
  const reviewTiming = options.readyToAcceptanceMs === undefined
    ? undefined
    : {
        candidateReadyAt: '2026-11-13T10:00:00.000Z',
        acceptedAt: new Date(Date.parse('2026-11-13T10:00:00.000Z') + options.readyToAcceptanceMs).toISOString(),
        readyToAcceptanceMs: options.readyToAcceptanceMs,
        activeReviewMs: options.activeReviewMs === undefined ? null : options.activeReviewMs,
        activeReviewSource: options.activeReviewMs === undefined ? 'unknown' as const : 'ui_visibility_proxy' as const,
        activeReviewCompleteness: options.activeReviewMs === undefined ? 'unknown' as const : 'partial' as const,
        evidenceRefs: [id(`timing-evidence-${options.seed}`)],
      }
  const acceptedFields = accepted
    ? {
        candidate,
        acceptanceRef: id(`acceptance-${options.seed}`),
        verificationRef: id(`verification-${options.seed}`),
        artifactDigest: hex(`artifact-${options.seed}`),
      }
    : { ...(candidate ? { candidate } : {}) }
  return {
    protocol: 'execution-outcome/1',
    id: id(`outcome-${options.seed}`),
    projectId: options.projectId ?? 'project-atlas',
    attempt,
    profileRef: profile,
    ...acceptedFields,
    acceptance: options.acceptance ?? (accepted ? 'accepted' : 'unknown'),
    evidenceRefs: [id(`outcome-evidence-${options.seed}`)],
    layer: options.layer ?? 'controlled',
    usage,
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    observedAt: options.observedAt ?? '2026-11-13T10:00:01.000Z',
    ...(reviewTiming ? { reviewTiming } : {}),
  } as ExecutionOutcome
}

export interface EntryOptions { at?: string; kind: string; sourceRef: string; detail?: unknown }

export function makeWorkEvidence(workId: string, entries: EntryOptions[], options: {
  truncated?: boolean
  projection?: WorkEvidence['projection']
  outcomes?: ExecutionOutcome[]
} = {}): WorkEvidence {
  return {
    protocol: 'work-evidence/1',
    workId,
    projection: options.projection ?? 'recorded',
    entries: entries.map(entry => ({
      at: entry.at ?? '2026-11-13T09:00:00.000Z',
      kind: entry.kind,
      sourceRef: entry.sourceRef,
      detail: entry.detail ?? {},
    })),
    outcomes: options.outcomes ?? [],
    truncated: options.truncated ?? false,
  } as WorkEvidence
}

export function makeHistory(workId: string, contract: { workId: string; revision: number; digest: string },
  entries: EntryOptions[], options: { window?: WorkEvidenceHistory['window']; hasMore?: boolean; nextCursor?: string } = {}): WorkEvidenceHistory {
  const window = options.window ?? 'complete'
  return {
    protocol: 'work-evidence-history/1',
    workId,
    contract,
    observedAt: '2026-11-13T10:00:00.000Z',
    entries: entries.map(entry => ({
      at: entry.at ?? '2026-11-13T09:00:00.000Z',
      kind: entry.kind,
      sourceRef: entry.sourceRef,
      detail: entry.detail ?? {},
    })),
    hasMore: options.hasMore ?? false,
    ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
    window,
    sourcesCapped: window === 'storage_cap' ? ['outcomes'] : [],
  } as WorkEvidenceHistory
}

export function makeAttentionPage(options: {
  observedAt?: string
  items?: AttentionPage['items']
  hasMore?: boolean
  nextCursor?: string
  questionCoverage?: 'complete' | 'bounded'
} = {}): AttentionPage {
  const items = options.items ?? []
  return {
    protocol: 'attention-inbox/1',
    observedAt: options.observedAt ?? '2026-11-13T10:00:00.000Z',
    items,
    ranks: items.map(item => ({ id: item.id, reasons: ['waiting_age'] })),
    ranking: 'waiting_order',
    scannedWorks: items.length,
    questionCoverage: options.questionCoverage ?? 'complete',
    hasMore: options.hasMore ?? false,
    ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
  } as AttentionPage
}

const WINDOW = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }

function base(overrides: Partial<UsageInsightsInput> = {}): UsageInsightsInput {
  return {
    protocol: 'usage-insights-input/1',
    inputId: 'fixture-bundle',
    capturedAt: '2026-11-13T12:00:00.000Z',
    timezone: 'UTC',
    window: WINDOW,
    projects: [{ projectId: 'project-atlas' }],
    source: {
      kind: 'synthetic_fixture',
      descriptor: 'usage-insights test fixture',
      digest: null,
      layerAssertion: 'recorded_by_producer',
      capturedAt: '2026-11-13T12:00:00.000Z',
    },
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete' },
    outcomes: [],
    attentionPages: [],
    workEvidence: [],
    ...overrides,
  } as UsageInsightsInput
}

/** Two controlled outcomes with full timing, tokens and cost, plus interaction facts. */
export function completeBundle(): UsageInsightsInput {
  const first = makeOutcome({
    seed: 'a1', durationMs: 120_000, readyToAcceptanceMs: 60_000, activeReviewMs: 15_000,
    inputTokens: 1000, outputTokens: 500, cost: { currency: 'USD', amount: 0.5 }, accepted: true,
  })
  const second = makeOutcome({
    seed: 'a2', durationMs: 60_000, readyToAcceptanceMs: 120_000, activeReviewMs: 20_000,
    inputTokens: 2000, outputTokens: 800, cost: { currency: 'USD', amount: 0.75 }, accepted: true,
  })
  return base({
    outcomes: [first, second],
    workEvidence: [makeWorkEvidence(CONTRACT_ATLAS.workId, [
      { kind: 'question.opened', sourceRef: 'question-1', at: '2026-11-13T09:00:00.000Z' },
      { kind: 'runtime.answer.observed', sourceRef: 'answer-fact-1', at: '2026-11-13T09:05:00.000Z' },
      { kind: 'acceptance.recorded', sourceRef: 'acceptance-record-1', at: '2026-11-13T10:01:00.000Z' },
      { kind: 'work.created', sourceRef: CONTRACT_ATLAS.workId, at: '2026-11-13T08:00:00.000Z' },
    ], { outcomes: [first, second] })],
  })
}

/** Records exist, but timing, usage and interactions were not recorded. */
export function unknownBundle(): UsageInsightsInput {
  const outcome = makeOutcome({ seed: 'u1', acceptance: 'unknown', layer: 'controlled' })
  return base({
    outcomes: [outcome],
    workEvidence: [makeWorkEvidence(CONTRACT_ATLAS.workId, [
      { kind: 'work.created', sourceRef: CONTRACT_ATLAS.workId },
    ], { outcomes: [outcome] })],
  })
}

/** A page and a stored scan both truncated: coverage must stay partial. */
export function partialBundle(): UsageInsightsInput {
  const outcome = makeOutcome({ seed: 'p1', durationMs: 30_000, acceptance: 'unknown' })
  return base({
    declaredCoverage: { outcomes: 'caller_limit', workEvidence: 'caller_limit', attention: 'caller_limit' },
    outcomes: [outcome],
    workEvidence: [makeWorkEvidence(CONTRACT_ATLAS.workId, [
      { kind: 'work.created', sourceRef: CONTRACT_ATLAS.workId },
    ], { truncated: true, outcomes: [outcome] })],
    attentionPages: [makeAttentionPage({ hasMore: true, nextCursor: 'page-2' })],
  })
}

/** Two projects and two layers so a caller cannot silently merge them. */
export function multiProjectBundle(): UsageInsightsInput {
  const atlasControlled = makeOutcome({ seed: 'm1', layer: 'controlled', durationMs: 10_000, acceptance: 'unknown' })
  const atlasNative = makeOutcome({ seed: 'm2', layer: 'actual_native', durationMs: 20_000, acceptance: 'unknown' })
  const orbitControlled = makeOutcome({
    seed: 'm3', projectId: 'project-orbit', contract: CONTRACT_ORBIT, layer: 'controlled', durationMs: 30_000, acceptance: 'unknown',
  })
  return base({
    projects: [{ projectId: 'project-atlas' }, { projectId: 'project-orbit' }],
    outcomes: [atlasControlled, atlasNative, orbitControlled],
    workEvidence: [
      makeWorkEvidence(CONTRACT_ATLAS.workId, [{ kind: 'question.opened', sourceRef: 'question-atlas-1' }], { outcomes: [atlasControlled, atlasNative] }),
      makeWorkEvidence(CONTRACT_ORBIT.workId, [{ kind: 'question.opened', sourceRef: 'question-orbit-1' }], { outcomes: [orbitControlled] }),
    ],
  })
}

/** Costs in two currencies; they must never be added together. */
export function multiCurrencyBundle(): UsageInsightsInput {
  const usd = makeOutcome({ seed: 'c1', cost: { currency: 'USD', amount: 1.25 }, inputTokens: 10, acceptance: 'unknown' })
  const eur = makeOutcome({ seed: 'c2', cost: { currency: 'EUR', amount: 2.5 }, inputTokens: 20, acceptance: 'unknown' })
  const none = makeOutcome({ seed: 'c3', acceptance: 'unknown' })
  return base({ outcomes: [usd, eur, none] })
}

/** One identity with two different bodies: both copies must be quarantined. */
export function conflictBundle(): UsageInsightsInput {
  const outcome = makeOutcome({ seed: 'x1', durationMs: 5_000, acceptance: 'unknown' })
  const altered = { ...outcome, durationMs: 9_000 } as ExecutionOutcome
  return base({ outcomes: [outcome, altered] })
}

/** One outcome far outside the window: kept as a reference, excluded from metrics. */
export function outsideWindowBundle(): UsageInsightsInput {
  const inside = makeOutcome({ seed: 'w1', durationMs: 10_000, acceptance: 'unknown' })
  const outside = makeOutcome({ seed: 'w2', durationMs: 90_000, acceptance: 'unknown', observedAt: '2026-12-01T00:00:00.000Z' })
  return base({ outcomes: [inside, outside] })
}

/** Explicit queued/dispatched endpoints for the same attempt. */
export function queueBundle(): UsageInsightsInput {
  const outcome = makeOutcome({ seed: 'q1', acceptance: 'unknown' })
  return base({
    outcomes: [outcome],
    queueFacts: [{
      projectId: 'project-atlas',
      attempt: outcome.attempt,
      queuedAt: '2026-11-13T09:00:00.000Z',
      dispatchedAt: '2026-11-13T09:02:30.000Z',
      evidenceRef: 'queue-fact-1',
    }],
  })
}

export const FIXTURE_WINDOW = WINDOW
