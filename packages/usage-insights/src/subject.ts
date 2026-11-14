/**
 * Identity, de-duplication, scope and quarantine for the observation inputs.
 *
 * Every record class — outcomes, work evidence, work history and attention — is constrained the same
 * way: by the declared project set, by the requested observation window, and by an exact identity the
 * product already records. Nothing is joined by similar titles, close timestamps or matching text.
 *
 * A work whose project cannot be resolved from the collector's work index or from its own outcome is
 * *unmapped*. It is isolated and counted as unknown, never as "one observed problem" and never as a
 * proven zero.
 */
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import {
  AttentionPageSchema,
  ExecutionOutcomeSchema,
  WorkEvidenceHistorySchema,
  WorkEvidenceSchema,
  type ExecutionOutcome,
  type Json,
  type Timestamp,
} from '@personal-agent/contracts'
import type { QuarantineEntry, QuarantineCode, SourceLoss } from './protocol.ts'

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

export const emptyLoss = (): SourceLoss => ({
  seen: 0, accepted: 0, notParsed: 0, invalid: 0, conflicted: 0, outOfScope: 0, outsideWindow: 0, unmapped: 0,
})

export const lossTotal = (loss: SourceLoss): number =>
  loss.invalid + loss.conflicted + loss.notParsed + loss.unmapped

export interface DedupeResult<T> {
  records: T[]
  replayed: number
  quarantined: QuarantineEntry[]
  invalid: QuarantineEntry[]
  loss: SourceLoss
}

interface LedgerEntry<T> {
  record: T
  digest: string
}

function invalidEntry(recordClass: QuarantineEntry['recordClass'], ref: string, reason: string): QuarantineEntry {
  return { code: 'invalid_record', recordClass, ref, reason }
}

/**
 * Keep only unambiguous identities. A repeat with identical content counts once; a repeat whose body
 * differs removes *every* occurrence, because the module has no authority to decide which version is
 * the real fact.
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

/** Parse outcomes individually so one malformed row cannot void the whole observation. */
export function parseOutcomes(items: readonly unknown[]): DedupeResult<ExecutionOutcome> {
  const entries = new Map<string, LedgerEntry<ExecutionOutcome>>()
  const conflicted = new Set<string>()
  const invalid: QuarantineEntry[] = []
  const loss = { ...emptyLoss(), seen: items.length }
  let replayed = 0
  for (const [index, item] of items.entries()) {
    const parsed = ExecutionOutcomeSchema.safeParse(item)
    if (!parsed.success) {
      loss.invalid++
      invalid.push(invalidEntry('outcome', `outcomes[${index}]`, firstIssue(parsed.error)))
      continue
    }
    const record = parsed.data
    const digest = subjectDigest(record as unknown as Json)
    const existing = entries.get(record.id)
    if (!existing) entries.set(record.id, { record, digest })
    else if (existing.digest === digest) replayed++
    else conflicted.add(record.id)
  }
  const settled = settle(entries, conflicted, record => record.id, 'outcome')
  loss.conflicted = conflicted.size
  loss.accepted = settled.records.length
  return { records: settled.records, replayed, quarantined: [...invalid, ...settled.quarantined], invalid, loss }
}

export interface WorkEntry {
  workId: string
  at: string
  kind: string
  sourceRef: string
  detail: unknown
}

export type WorkMapping = 'index' | 'outcome' | 'unmapped' | 'conflict'

export interface WorkRecord {
  workId: string
  /** Resolved only from the collector's work index or from the work's own outcome. */
  projectId: string | null
  mapping: WorkMapping
  /** De-duplicated, unambiguous entries that fall inside the requested window. */
  entries: WorkEntry[]
  entriesOutsideWindow: number
  coverage: IngestWorkCoverage
  sourceRef: string
}

export type IngestWorkCoverage = 'complete' | 'caller_limit' | 'storage_cap' | 'source_missing' | 'unsupported'

export interface ParsedWorkEvidence {
  works: WorkRecord[]
  outcomes: ExecutionOutcome[]
  quarantined: QuarantineEntry[]
  invalid: QuarantineEntry[]
  loss: SourceLoss
  /** Works presented but excluded by project or mapping; they stay unknown, never zero. */
  unattributableWorks: number
}

const severity: Record<IngestWorkCoverage, number> = {
  complete: 0, caller_limit: 1, storage_cap: 2, source_missing: 3, unsupported: 4,
}

const worst = (a: IngestWorkCoverage, b: IngestWorkCoverage) => (severity[b] > severity[a] ? b : a)

function coverageOfEvidence(projection: string): IngestWorkCoverage {
  if (projection === 'source_missing') return 'source_missing'
  return 'complete'
}

export interface WorkScopeOptions {
  projectIds: ReadonlySet<string>
  workIndex: ReadonlyMap<string, string>
  /**
   * Work identities whose project mapping was contradictory anywhere in this input. The set is
   * permanent for the whole analysis: no later or reordered index entry can revive a mapping, and the
   * work's entries and embedded outcomes are excluded from every count.
   */
  conflictedWorkIds: ReadonlySet<string>
  window: { from: Timestamp; to: Timestamp }
}

interface WorkSeed {
  workId: string
  coverage: IngestWorkCoverage
  sourceRef: string
  outcomeProjects: Set<string>
}

/**
 * Parse `WorkEvidence` and `WorkEvidenceHistory` bodies under the declared scope.
 *
 * Entries de-duplicate on (workId, kind, sourceRef) and are then filtered by `entry.at` against the
 * requested window: a question answered before the window is a reference, not a counted interaction.
 */
export function parseWorkRecords(evidenceItems: readonly unknown[], historyItems: readonly unknown[],
  options: WorkScopeOptions): ParsedWorkEvidence {
  const entries = new Map<string, LedgerEntry<WorkEntry>>()
  const conflicted = new Set<string>()
  const invalid: QuarantineEntry[] = []
  const quarantined: QuarantineEntry[] = []
  const seeds = new Map<string, WorkSeed>()
  const outcomes: ExecutionOutcome[] = []
  const loss = { ...emptyLoss(), seen: evidenceItems.length + historyItems.length }
  let unattributableWorks = 0

  const entryKey = (workId: string, kind: string, sourceRef: string) => `${workId}\u0000${kind}\u0000${sourceRef}`

  const addEntry = (workId: string, entry: WorkEntry, recordClass: QuarantineEntry['recordClass']) => {
    const key = entryKey(workId, entry.kind, entry.sourceRef)
    const digest = subjectDigest({ at: entry.at, kind: entry.kind, sourceRef: entry.sourceRef, detail: entry.detail } as Json)
    const existing = entries.get(key)
    if (!existing) {
      entries.set(key, { record: entry, digest })
      return
    }
    if (existing.digest === digest) return
    if (conflicted.has(key)) return
    conflicted.add(key)
    quarantined.push({
      code: 'identity_conflict', recordClass, ref: `${entry.kind}:${entry.sourceRef}`,
      reason: 'Two inputs described one work fact differently; both copies are excluded',
    })
  }

  const noteWork = (workId: string, coverage: IngestWorkCoverage, sourceRef: string, outcomeProjectIds: readonly string[]) => {
    const existing = seeds.get(workId)
    if (!existing) {
      seeds.set(workId, { workId, coverage, sourceRef, outcomeProjects: new Set(outcomeProjectIds) })
      return
    }
    existing.coverage = worst(existing.coverage, coverage)
    for (const projectId of outcomeProjectIds) existing.outcomeProjects.add(projectId)
  }

  for (const [index, item] of evidenceItems.entries()) {
    const parsed = WorkEvidenceSchema.safeParse(item)
    if (!parsed.success) {
      loss.invalid++
      invalid.push(invalidEntry('work_evidence', `workEvidence[${index}]`, firstIssue(parsed.error)))
      continue
    }
    const record = parsed.data
    if (options.conflictedWorkIds.has(record.workId)) {
      // A permanent tombstone from the work index: this work can never be attributed in this input.
      loss.conflicted++
      unattributableWorks++
      continue
    }
    const coverage = worst(coverageOfEvidence(record.projection), record.truncated ? 'storage_cap' : 'complete')
    for (const entry of record.entries)
      addEntry(record.workId, { workId: record.workId, at: entry.at, kind: entry.kind, sourceRef: entry.sourceRef, detail: entry.detail }, 'work_evidence')
    noteWork(record.workId, coverage, `work-evidence:${record.workId}`, record.outcomes.map(outcome => outcome.projectId))
    outcomes.push(...record.outcomes)
  }

  for (const [index, item] of historyItems.entries()) {
    const parsed = WorkEvidenceHistorySchema.safeParse(item)
    if (!parsed.success) {
      loss.invalid++
      invalid.push(invalidEntry('work_history', `workHistories[${index}]`, firstIssue(parsed.error)))
      continue
    }
    const record = parsed.data
    if (options.conflictedWorkIds.has(record.workId)) {
      loss.conflicted++
      continue
    }
    const coverage: IngestWorkCoverage =
      record.window === 'caller_limit' ? 'caller_limit' : record.window === 'storage_cap' ? 'storage_cap' : 'complete'
    for (const entry of record.entries)
      addEntry(record.workId, { workId: record.workId, at: entry.at, kind: entry.kind, sourceRef: entry.sourceRef, detail: entry.detail }, 'work_history')
    noteWork(record.workId, coverage, `work-history:${record.workId}`, [])
  }

  const works: WorkRecord[] = []
  for (const seed of [...seeds.values()].sort((a, b) => a.workId.localeCompare(b.workId))) {
    const indexed = options.workIndex.get(seed.workId)
    const outcomeProjects = [...seed.outcomeProjects]
    let projectId: string | null = null
    let mapping: WorkMapping = 'unmapped'

    if (indexed !== undefined) {
      // The collector's index and the work's own outcome must agree; a disagreement is not narrowed
      // by preference, because either side could be the stale one.
      if (outcomeProjects.some(project => project !== indexed)) {
        mapping = 'conflict'
        quarantined.push({
          code: 'subject_mismatch', recordClass: 'work_evidence', ref: seed.workId,
          reason: 'The work index and the work outcome name different projects; the work is excluded',
        })
        loss.conflicted++
        unattributableWorks++
        works.push({ workId: seed.workId, projectId: null, mapping, entries: [], entriesOutsideWindow: 0, coverage: seed.coverage, sourceRef: seed.sourceRef })
        continue
      }
      projectId = indexed
      mapping = 'index'
    } else if (outcomeProjects.length === 1) {
      projectId = outcomeProjects[0]!
      mapping = 'outcome'
    } else if (outcomeProjects.length > 1) {
      mapping = 'conflict'
      quarantined.push({
        code: 'subject_mismatch', recordClass: 'work_evidence', ref: seed.workId,
        reason: 'The work carries outcomes from more than one project; the work is excluded',
      })
      loss.conflicted++
      unattributableWorks++
      works.push({ workId: seed.workId, projectId: null, mapping, entries: [], entriesOutsideWindow: 0, coverage: seed.coverage, sourceRef: seed.sourceRef })
      continue
    }

    if (projectId !== null && !options.projectIds.has(projectId)) {
      quarantined.push({
        code: 'out_of_scope_project', recordClass: 'work_evidence', ref: seed.workId,
        reason: 'The work belongs to a project outside the declared scope; isolated rather than counted',
      })
      loss.outOfScope++
      unattributableWorks++
      works.push({ workId: seed.workId, projectId, mapping, entries: [], entriesOutsideWindow: 0, coverage: seed.coverage, sourceRef: seed.sourceRef })
      continue
    }
    if (projectId === null) {
      quarantined.push({
        code: 'project_unknown', recordClass: 'work_evidence', ref: seed.workId,
        reason: 'No verifiable project mapping exists for this work; it cannot be attributed or counted',
      })
      loss.unmapped++
      unattributableWorks++
      works.push({ workId: seed.workId, projectId: null, mapping, entries: [], entriesOutsideWindow: 0, coverage: seed.coverage, sourceRef: seed.sourceRef })
      continue
    }

    const from = Date.parse(options.window.from)
    const to = Date.parse(options.window.to)
    const inWindow: WorkEntry[] = []
    let outside = 0
    for (const entry of entries.values()) {
      if (conflicted.has(entryKey(entry.record.workId, entry.record.kind, entry.record.sourceRef))) continue
      if (entry.record.workId !== seed.workId) continue
      const at = Date.parse(entry.record.at)
      if (at >= from && at < to) inWindow.push(entry.record)
      else outside++
    }
    loss.outsideWindow += outside
    works.push({
      workId: seed.workId,
      projectId,
      mapping,
      entries: inWindow.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind) || a.sourceRef.localeCompare(b.sourceRef)),
      entriesOutsideWindow: outside,
      coverage: seed.coverage,
      sourceRef: seed.sourceRef,
    })
  }

  loss.accepted = works.filter(work => work.projectId !== null && work.mapping !== 'conflict').length
  return { works, outcomes, quarantined: [...quarantined, ...invalid], invalid, loss, unattributableWorks }
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
  stale: boolean
  quarantined: QuarantineEntry[]
  invalid: QuarantineEntry[]
  loss: SourceLoss
}

/** A snapshot older than this relative to the capture time cannot claim to be the current inbox. */
export const ATTENTION_FRESH_MS = 3_600_000

/**
 * Attention is a *current snapshot*. Items are kept only for declared projects, pages observed after
 * the capture time are refused, and a stale page can never report `complete` coverage.
 */
export function parseAttentionPages(items: readonly unknown[], options: {
  projectIds: ReadonlySet<string>
  capturedAt: string
}): ParsedAttention {
  const records = new Map<string, AttentionItemRecord>()
  const conflicted = new Set<string>()
  const invalid: QuarantineEntry[] = []
  const quarantined: QuarantineEntry[] = []
  const loss = { ...emptyLoss(), seen: items.length }
  let observedAt: string | null = null
  let hasMore = false
  let questionCoverage: 'complete' | 'bounded' | null = null
  let coverage: ParsedAttention['coverage'] = 'complete'
  let stale = false
  const captured = Date.parse(options.capturedAt)

  for (const [index, item] of items.entries()) {
    const parsed = AttentionPageSchema.safeParse(item)
    if (!parsed.success) {
      loss.invalid++
      invalid.push(invalidEntry('attention_page', `attentionPages[${index}]`, firstIssue(parsed.error)))
      continue
    }
    const page = parsed.data
    const observed = Date.parse(page.observedAt)
    if (!Number.isFinite(observed) || observed > captured) {
      // A snapshot from the future cannot describe this observation.
      loss.invalid++
      invalid.push({
        code: 'time_inconsistent', recordClass: 'attention_page', ref: `attentionPages[${index}]`,
        reason: 'The snapshot was observed after the capture time; it is excluded',
      })
      continue
    }
    if (captured - observed > ATTENTION_FRESH_MS) stale = true
    observedAt = observedAt === null || observed > Date.parse(observedAt) ? page.observedAt : observedAt
    hasMore = hasMore || page.hasMore
    questionCoverage = questionCoverage === 'bounded' || page.questionCoverage === 'bounded' ? 'bounded' : 'complete'
    if (page.hasMore) coverage = 'caller_limit'

    const ranks = new Map(page.ranks.map(rank => [rank.id, rank.reasons]))
    for (const entry of page.items) {
      if (!options.projectIds.has(entry.projectId)) {
        loss.outOfScope++
        quarantined.push({
          code: 'out_of_scope_project', recordClass: 'attention_page', ref: entry.id,
          reason: 'The pending item belongs to a project outside the declared scope; excluded from the current total',
        })
        continue
      }
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

  const kept = [...records.values()].filter(record => !conflicted.has(record.id))
  loss.conflicted = conflicted.size
  loss.accepted = kept.length
  // A refused or conflicting page means the snapshot is not fully enumerable; it cannot stay complete.
  if ((stale || loss.invalid > 0 || loss.conflicted > 0) && coverage === 'complete') coverage = 'caller_limit'
  return {
    items: kept,
    observedAt,
    hasMore,
    questionCoverage,
    coverage,
    stale,
    quarantined: [...quarantined, ...invalid],
    invalid,
    loss,
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
