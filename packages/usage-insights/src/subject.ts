/**
 * Identity, de-duplication and quarantine for the observation inputs.
 *
 * A record is joined to a subject only through the exact contract/attempt/profile identities the
 * product already records. Similar titles, close timestamps or matching text are never used to
 * build a join, and a repeated fact is counted once even when it arrives from several pages or
 * files.
 */
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import {
  AttentionPageSchema,
  WorkEvidenceHistorySchema,
  WorkEvidenceSchema,
  type ExecutionOutcome,
  type Json,
  type Timestamp,
} from '@personal-agent/contracts'
import { ExecutionOutcomeSchema } from '@personal-agent/contracts'
import type { QuarantineEntry, QuarantineCode } from './protocol.ts'

export interface SubjectIdentity {
  subjectKey: string
  projectId: string
  workId: string
  contract: { workId: string; revision: number; digest: string }
  attemptId: string
  candidateGeneration: number | null
  profileId: string
  layer: string
}

const subjectDigest = (value: Json) => canonicalDigest(value)

/** Attempt-and-candidate identity. Nothing here is inferred from text or timing. */
export function outcomeSubject(outcome: ExecutionOutcome): SubjectIdentity {
  const candidateGeneration = outcome.candidate?.candidateGeneration ?? null
  const identity = {
    projectId: outcome.projectId,
    workId: outcome.attempt.contract.workId,
    revision: outcome.attempt.contract.revision,
    digest: outcome.attempt.contract.digest,
    ticketId: outcome.attempt.ticketId,
    assignmentId: outcome.attempt.assignmentId,
    attemptId: outcome.attempt.attemptId,
    fenceEpoch: outcome.attempt.fenceEpoch,
    profileId: outcome.profileRef.profileId,
    profileRevision: outcome.profileRef.revision,
    profileIdentityDigest: outcome.profileRef.identityDigest,
    candidateGeneration,
  }
  return {
    subjectKey: subjectDigest(identity),
    projectId: outcome.projectId,
    workId: outcome.attempt.contract.workId,
    contract: {
      workId: outcome.attempt.contract.workId,
      revision: outcome.attempt.contract.revision,
      digest: outcome.attempt.contract.digest,
    },
    attemptId: outcome.attempt.attemptId,
    candidateGeneration,
    profileId: outcome.profileRef.profileId,
    layer: outcome.layer,
  }
}

export interface DedupeResult<T> {
  records: T[]
  replayed: number
  quarantined: QuarantineEntry[]
  invalid: QuarantineEntry[]
}

interface LedgerEntry<T> {
  record: T
  digest: string
  ref: string
}

/**
 * Keep only unambiguous identities. A repeat with identical content was already counted once; a
 * repeat whose body differs removes *every* occurrence of that identity, because the module has no
 * authority to decide which version is the real fact.
 */
function settle<T>(entries: Map<string, LedgerEntry<T>>, conflicted: Set<string>, refOf: (record: T) => string,
  recordClass: QuarantineEntry['recordClass']): { records: T[]; quarantined: QuarantineEntry[] } {
  const records = [...entries.values()].filter(entry => !conflicted.has(refOf(entry.record))).map(entry => entry.record)
  const quarantined: QuarantineEntry[] = [...conflicted].map(ref => ({
    code: 'identity_conflict' as QuarantineCode,
    recordClass,
    ref,
    reason: 'The same identity arrived with a different body; every occurrence is excluded',
  }))
  return { records, quarantined }
}

function invalidEntry(recordClass: QuarantineEntry['recordClass'], ref: string, reason: string): QuarantineEntry {
  return { code: 'invalid_record', recordClass, ref, reason }
}

/** Parse outcomes individually so one malformed row cannot void the whole observation. */
export function parseOutcomes(items: readonly unknown[]): DedupeResult<ExecutionOutcome> {
  const entries = new Map<string, LedgerEntry<ExecutionOutcome>>()
  const conflicted = new Set<string>()
  const invalid: QuarantineEntry[] = []
  let replayed = 0
  for (const [index, item] of items.entries()) {
    const parsed = ExecutionOutcomeSchema.safeParse(item)
    if (!parsed.success) {
      invalid.push(invalidEntry('outcome', `outcomes[${index}]`, firstIssue(parsed.error)))
      continue
    }
    const record = parsed.data
    const digest = subjectDigest(record as unknown as Json)
    const existing = entries.get(record.id)
    if (!existing) entries.set(record.id, { record, digest, ref: record.id })
    else if (existing.digest === digest) replayed++
    else conflicted.add(record.id)
  }
  const settled = settle(entries, conflicted, record => record.id, 'outcome')
  return { records: settled.records, replayed, quarantined: [...invalid, ...settled.quarantined], invalid }
}

export interface WorkEntry {
  workId: string
  at: string
  kind: string
  sourceRef: string
  detail: unknown
}

export interface WorkRecord {
  workId: string
  entries: WorkEntry[]
  coverage: 'complete' | 'caller_limit' | 'storage_cap' | 'source_missing' | 'unsupported'
  outcomes: ExecutionOutcome[]
  sourceRef: string
}

export interface ParsedWorkEvidence {
  works: WorkRecord[]
  outcomes: ExecutionOutcome[]
  quarantined: QuarantineEntry[]
  invalid: QuarantineEntry[]
}

const severity: Record<WorkRecord['coverage'], number> = {
  complete: 0,
  caller_limit: 1,
  storage_cap: 2,
  source_missing: 3,
  unsupported: 4,
}

const worst = (a: WorkRecord['coverage'], b: WorkRecord['coverage']) => (severity[b] > severity[a] ? b : a)

function coverageOfEvidence(projection: string): WorkRecord['coverage'] {
  if (projection === 'source_missing') return 'source_missing'
  return 'complete'
}

/**
 * Parse `WorkEvidence` and `WorkEvidenceHistory` bodies. Entries are de-duplicated on
 * (workId, kind, sourceRef); the same fact reached through two files therefore counts once, while a
 * changed body for one identity is quarantined.
 */
export function parseWorkRecords(evidenceItems: readonly unknown[], historyItems: readonly unknown[]): ParsedWorkEvidence {
  const entries = new Map<string, LedgerEntry<WorkEntry>>()
  const conflicted = new Set<string>()
  const invalid: QuarantineEntry[] = []
  const works = new Map<string, { entries: Set<string>; coverage: WorkRecord['coverage']; sourceRef: string }>()
  const outcomes: ExecutionOutcome[] = []
  const quarantined: QuarantineEntry[] = []

  const addEntry = (workId: string, entry: WorkEntry, recordClass: QuarantineEntry['recordClass']) => {
    const key = `${workId}\u0000${entry.kind}\u0000${entry.sourceRef}`
    const digest = subjectDigest({ at: entry.at, kind: entry.kind, sourceRef: entry.sourceRef, detail: entry.detail } as Json)
    const existing = entries.get(key)
    if (!existing) {
      entries.set(key, { record: entry, digest, ref: key })
      return
    }
    if (existing.digest === digest) return
    conflicted.add(key)
    quarantined.push({
      code: 'identity_conflict', recordClass, ref: `${entry.kind}:${entry.sourceRef}`,
      reason: 'Two inputs described one work fact differently; both copies are excluded',
    })
  }

  const noteWork = (workId: string, coverage: WorkRecord['coverage'], sourceRef: string, entryKeys: string[]) => {
    const existing = works.get(workId)
    if (!existing) works.set(workId, { entries: new Set(entryKeys), coverage, sourceRef })
    else {
      existing.coverage = worst(existing.coverage, coverage)
      for (const key of entryKeys) existing.entries.add(key)
    }
  }

  for (const [index, item] of evidenceItems.entries()) {
    const parsed = WorkEvidenceSchema.safeParse(item)
    if (!parsed.success) { invalid.push(invalidEntry('work_evidence', `workEvidence[${index}]`, firstIssue(parsed.error))); continue }
    const record = parsed.data
    const coverage = worst(coverageOfEvidence(record.projection), record.truncated ? 'storage_cap' : 'complete')
    const keys: string[] = []
    for (const entry of record.entries) {
      addEntry(record.workId, { workId: record.workId, at: entry.at, kind: entry.kind, sourceRef: entry.sourceRef, detail: entry.detail }, 'work_evidence')
      keys.push(`${record.workId}\u0000${entry.kind}\u0000${entry.sourceRef}`)
    }
    noteWork(record.workId, coverage, `work-evidence:${record.workId}`, keys)
    outcomes.push(...record.outcomes)
  }

  for (const [index, item] of historyItems.entries()) {
    const parsed = WorkEvidenceHistorySchema.safeParse(item)
    if (!parsed.success) { invalid.push(invalidEntry('work_history', `workHistories[${index}]`, firstIssue(parsed.error))); continue }
    const record = parsed.data
    const coverage = record.window === 'caller_limit' ? 'caller_limit' : record.window === 'storage_cap' ? 'storage_cap' : 'complete'
    const keys: string[] = []
    for (const entry of record.entries) {
      addEntry(record.workId, { workId: record.workId, at: entry.at, kind: entry.kind, sourceRef: entry.sourceRef, detail: entry.detail }, 'work_history')
      keys.push(`${record.workId}\u0000${entry.kind}\u0000${entry.sourceRef}`)
    }
    noteWork(record.workId, coverage, `work-history:${record.workId}`, keys)
  }

  const acceptedEntries = [...entries.values()]
    .filter(entry => !conflicted.has(`${entry.record.workId}\u0000${entry.record.kind}\u0000${entry.record.sourceRef}`))
    .map(entry => entry.record)
  const results: WorkRecord[] = []
  for (const [workId, value] of works) {
    results.push({
      workId,
      entries: acceptedEntries.filter(entry => entry.workId === workId),
      coverage: value.coverage,
      outcomes: [],
      sourceRef: value.sourceRef,
    })
  }
  return { works: results, outcomes, quarantined: [...quarantined, ...invalid], invalid }
}

export interface AttentionItemRecord {
  id: string
  kind: 'question' | 'candidate' | 'blocked'
  projectId: string
  sinceAt: string | null
  contract: { workId: string; revision: number; digest: string }
  reasons: string[]
  detail: Json
}

export interface ParsedAttention {
  items: AttentionItemRecord[]
  observedAt: string | null
  hasMore: boolean
  questionCoverage: 'complete' | 'bounded' | null
  coverage: 'complete' | 'caller_limit' | 'source_missing' | 'unsupported'
  quarantined: QuarantineEntry[]
  invalid: QuarantineEntry[]
}

/** Attention is a current snapshot, so overlapping pages merge by item id instead of accumulating. */
export function parseAttentionPages(items: readonly unknown[]): ParsedAttention {
  const records = new Map<string, AttentionItemRecord>()
  const conflicted = new Set<string>()
  const invalid: QuarantineEntry[] = []
  const quarantined: QuarantineEntry[] = []
  let observedAt: string | null = null
  let hasMore = false
  let questionCoverage: 'complete' | 'bounded' | null = null
  // Zero pages is an *unobserved* page set, not a missing source; the declared coverage decides
  // whether it was a complete empty window or simply not collected.
  let coverage: ParsedAttention['coverage'] = 'complete'

  for (const [index, item] of items.entries()) {
    const parsed = AttentionPageSchema.safeParse(item)
    if (!parsed.success) { invalid.push(invalidEntry('attention_page', `attentionPages[${index}]`, firstIssue(parsed.error))); continue }
    const page = parsed.data
    observedAt = observedAt === null || Date.parse(page.observedAt) > Date.parse(observedAt) ? page.observedAt : observedAt
    hasMore = hasMore || page.hasMore
    questionCoverage = questionCoverage === 'bounded' || page.questionCoverage === 'bounded' ? 'bounded' : 'complete'
    if (page.hasMore) coverage = coverage === 'complete' ? 'caller_limit' : coverage
    const ranks = new Map(page.ranks.map(rank => [rank.id, rank.reasons]))
    for (const entry of page.items) {
      const record: AttentionItemRecord = {
        id: entry.id,
        kind: entry.kind,
        projectId: entry.projectId,
        sinceAt: entry.sinceAt,
        contract: { workId: entry.contract.workId, revision: entry.contract.revision, digest: entry.contract.digest },
        reasons: [...(ranks.get(entry.id) ?? [])],
        detail: entry as unknown as Json,
      }
      const digest = subjectDigest(record.detail)
      const existing = records.get(record.id)
      if (!existing) records.set(record.id, record)
      else if (subjectDigest(existing.detail) !== digest) {
        conflicted.add(record.id)
        quarantined.push({
          code: 'identity_conflict', recordClass: 'attention_page', ref: record.id,
          reason: 'One attention identity appeared with two different bodies; both are excluded',
        })
      }
    }
  }
  return {
    items: [...records.values()].filter(record => !conflicted.has(record.id)),
    observedAt,
    hasMore,
    questionCoverage,
    coverage,
    quarantined: [...quarantined, ...invalid],
    invalid,
  }
}

export function firstIssue(error: { issues: readonly { message: string; path: readonly PropertyKey[] }[] }): string {
  const issue = error.issues[0]
  if (!issue) return 'Record failed validation'
  const path = issue.path.length ? `${issue.path.map(String).join('.')}: ` : ''
  return `${path}${issue.message}`.slice(0, 512)
}

/** Bounds-limited record selection: the caller learns exactly which bound stopped collection. */
export const withinWindow = (at: Timestamp, from: Timestamp, to: Timestamp): boolean =>
  Date.parse(at) >= Date.parse(from) && Date.parse(at) < Date.parse(to)
