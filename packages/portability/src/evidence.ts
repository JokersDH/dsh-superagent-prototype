/**
 * Evidence completeness summary for one product database snapshot.
 *
 * A consistent database copy is not by itself proof that evidence a user cares about is readable
 * after restore. This reader opens the *snapshot copy* read-only, then uses the existing public
 * storage read surface (workflow read index, project settings, decisions, assistant state, artifact
 * registry) to record what evidence was actually readable. Restore recomputes the same digest and
 * fails closed on any difference.
 *
 * Route advice / review reports / execution outcomes are not yet persisted in this merge: the A
 * `RoutingEvidencePort` exists as a contract but has no storage implementation. The summary records
 * that capability explicit as unavailable instead of claiming coverage.
 */
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ArtifactStore,
  EventLog,
  ProductDecisions,
  RoutingEvidence,
  UnitOfWork,
  WorkflowIndex,
  WorkflowRecords,
  canonicalDigest,
  readArtifactRegistry,
  readRoutingArtifactRefs,
} from '@personal-agent/storage'
import { PortabilityError } from './errors.ts'

export const EVIDENCE_FORMAT = 'personal-evidence' as const
export const EVIDENCE_FORMAT_VERSION = 2 as const

export interface EvidenceProject {
  readonly id: string
  readonly revision: number
  readonly digest: string
  readonly archived: boolean
  readonly history: readonly { readonly revision: number; readonly digest: string }[]
}

export interface EvidenceWork {
  readonly id: string
  readonly projectId: string
  readonly authority: { readonly revision: number; readonly digest: string } | null
  readonly contract: { readonly revision: number; readonly digest: string } | null
  readonly contractHistory: readonly { readonly revision: number; readonly digest: string }[]
  readonly links: readonly { readonly ticketId: string; readonly revision: number; readonly digest: string }[]
  readonly openQuestionIds: readonly string[]
  readonly verificationIds: readonly string[]
  readonly acceptanceIds: readonly string[]
  readonly deliverables: readonly { readonly verificationId: string; readonly artifactDigest: string; readonly criteriaDigest: string; readonly accepted: boolean }[]
}

export interface RoutingEvidenceSummary {
  readonly status: 'included'
  readonly reason: null
  /** Empty when included: the required ports exist and their records are covered below. */
  readonly requiredPorts: readonly string[]
  readonly advice: readonly { readonly id: string; readonly projectId: string; readonly createdAt: string; readonly expiresAt: string; readonly sourceRef: string; readonly digest: string }[]
  readonly reviews: readonly { readonly id: string; readonly projectId: string; readonly subjectDigest: string; readonly layer: string; readonly disposition: string; readonly observedAt: string; readonly reportArtifactRef: string; readonly digest: string }[]
  readonly outcomes: readonly { readonly id: string; readonly projectId: string; readonly profileKey: string; readonly attemptKey: string; readonly layer: string; readonly acceptance: string; readonly observedAt: string; readonly digest: string }[]
  /** Artifacts referenced by review evidence; they must also be present in the artifact registry. */
  readonly artifactRefs: readonly string[]
  readonly missingArtifactRefs: readonly string[]
}

export interface RoutingEvidenceUnavailable {
  readonly status: 'unavailable'
  readonly reason: string
  readonly requiredPorts: readonly string[]
}

export interface EvidenceAcceptedEvent {
  readonly seq: number
  readonly entityRef: string
  readonly payloadDigest: string
  readonly candidate: {
    readonly workId: string
    readonly ticketId: string
    readonly assignmentId: string
    readonly contractRevision: number
    readonly contractDigest: string
    readonly candidateGeneration: number
  } | null
  readonly actorRef: string | null
  readonly reviewTiming: unknown
}

export interface EvidenceSummary {
  readonly protocol: typeof EVIDENCE_FORMAT
  /** 2 when routing evidence is covered (schema 13+); 1 for a schema-12 database with no routing payload. */
  readonly formatVersion: 1 | 2
  readonly digest: string
  readonly productSchema: number | null
  readonly projects: readonly EvidenceProject[]
  readonly works: readonly EvidenceWork[]
  readonly decisions: readonly { readonly id: string; readonly version: number; readonly digest: string }[]
  readonly assistantDecisions: readonly { readonly id: string; readonly digest: string }[]
  readonly assistantProposals: readonly { readonly proposalId: string; readonly version: number; readonly state: string; readonly payloadDigest: string }[]
  readonly artifacts: readonly { readonly id: string; readonly digest: string; readonly bytes: number }[]
  /** Main writes application.candidate.accepted in the acceptance transaction; read via EventLog. */
  readonly acceptedEvents: readonly EvidenceAcceptedEvent[]
  readonly routingEvidence: RoutingEvidenceSummary | RoutingEvidenceUnavailable
  readonly counts: {
    readonly projects: number
    readonly works: number
    readonly decisions: number
    readonly assistantDecisions: number
    readonly assistantProposals: number
    readonly artifacts: number
    readonly acceptedEvents: number
    readonly routeAdvice: number
    readonly reviewEvidence: number
    readonly executionOutcomes: number
  }
  readonly limitations: readonly string[]
}

/** canonicalDigest accepts JSON values; these summaries are built from JSON-safe fields. */
const digestOf = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)) as never)

const ROUTING_PORTS = [
  'RoutingEvidencePort.advice/reviews/outcomes (packages/contracts/src/routing-review.ts)',
  'public readEvidenceManifest(databasePath) or equivalent storage port for routing tables',
] as const

const LIMITATIONS = [
  'Route advice, review reports and execution outcomes have no storage implementation in this merge; the public RoutingEvidencePort is a contract only.',
  'The evidence digest covers readable persisted facts from public storage ports, not model quality, native truth or human acceptance.',
  'Route advice, review evidence and execution outcomes are read from A v13 append-only tables through the public RoutingEvidence port; a record is an immutable fact, not proof of currentness, review PASS or model value.',
  'Review-evidence artifact references are listed explicitly; a bundle whose review evidence points outside the artifact registry fails closed instead of copying unreferenced bytes.',
  'Project/worktree content and native sessions are out of scope; only persisted references and digests are included.',
] as const

const safeOpen = (databasePath: string): Database.Database => {
  try {
    return new Database(databasePath, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new PortabilityError('database_unavailable', 'Evidence snapshot database cannot be opened read-only', {
      cause: String((error as Error)?.message ?? error).slice(0, 300),
    })
  }
}

/** Read the evidence summary from a read-only snapshot copy. Never opens or writes the live state. */
export function readEvidenceSummary(databasePath: string): EvidenceSummary {
  const db = safeOpen(databasePath)
  // The public read index requires an ArtifactStore handle; give it a disposable empty reader root
  // outside the state so no state file is created or modified.
  const scratch = mkdtempSync(join(tmpdir(), 'pa-evidence-read-'))
  try {
    const uow = new UnitOfWork(db, () => {})
    const decisionsStore = new ProductDecisions(db, uow)
    const artifactsStore = new ArtifactStore(db, scratch)
    const workflows = new WorkflowRecords(db, uow, artifactsStore)
    const index = new WorkflowIndex(db, artifactsStore, workflows.projects)
    let productSchema: number | null = null
    try {
      const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value: string } | undefined
      if (row) productSchema = Number(JSON.parse(String(row.value)))
    } catch {
      productSchema = null
    }

    const projects: EvidenceProject[] = []
    const works: EvidenceWork[] = []
    const decisions: { id: string; version: number; digest: string }[] = []
    const assistantDecisions: { id: string; digest: string }[] = []
    const assistantProposals: { proposalId: string; version: number; state: string; payloadDigest: string }[] = []

    let projectCursor: string | undefined
    do {
      const page = index.listProjects({ includeArchived: true, limit: 100, ...(projectCursor ? { cursor: projectCursor } : {}) })
      for (const project of page.projects) {
        const history = index.project(project.projectId).history.map((version) => ({ revision: version.revision, digest: version.digest }))
        projects.push({
          id: project.projectId,
          revision: project.revision,
          digest: project.digest,
          archived: project.archivedAt !== undefined,
          history,
        })
        let workCursor: string | undefined
        do {
          const workPage = index.listWorks({ projectIds: [project.projectId], limit: 100, ...(workCursor ? { cursor: workCursor } : {}) })
          for (const work of workPage.works) {
            const entry = index.work(work.id, [project.projectId])
            if (entry === undefined) continue
            works.push({
              id: work.id,
              projectId: project.projectId,
              authority: entry.authority ? { revision: entry.authority.revision, digest: entry.authority.digest } : null,
              contract: entry.contract ? { revision: entry.contract.revision, digest: entry.contract.digest } : null,
              contractHistory: entry.contractHistory.map((revision) => ({ revision: revision.revision, digest: revision.digest })),
              links: entry.links.map((link) => ({ ticketId: link.ticketId, revision: link.contract.revision, digest: link.contract.digest })),
              openQuestionIds: [...entry.openQuestionIds],
              verificationIds: [...entry.verificationIds],
              acceptanceIds: [...entry.acceptanceIds],
              deliverables: entry.deliverables.map((item) => ({
                verificationId: item.verificationId,
                artifactDigest: item.artifactDigest,
                criteriaDigest: item.criteriaDigest,
                accepted: item.accepted,
              })),
            })
          }
          workCursor = workPage.hasMore ? workPage.nextCursor : undefined
        } while (workCursor !== undefined)

        let decisionCursor: string | undefined
        do {
          const page = decisionsStore.list({
            projectIds: [project.projectId],
            includeRevoked: true,
            limit: 100,
            ...(decisionCursor ? { cursor: decisionCursor } : {}),
          })
          for (const record of page.records) decisions.push({ id: record.decision.id, version: record.decision.version, digest: record.digest })
          decisionCursor = page.hasMore ? page.nextCursor : undefined
        } while (decisionCursor !== undefined)

        let assistantCursor: string | undefined
        do {
          const page = workflows.assistant.list({ projectId: project.projectId, limit: 100, ...(assistantCursor ? { cursor: assistantCursor } : {}) })
          for (const record of page.records) assistantDecisions.push({ id: record.decision.id, digest: digestOf(record) })
          assistantCursor = page.nextCursor
        } while (assistantCursor !== undefined)

        let proposalCursor: string | undefined
        do {
          const page = workflows.assistant.proposalList({ projectId: project.projectId, limit: 100, ...(proposalCursor ? { cursor: proposalCursor } : {}) })
          for (const proposal of page.records) assistantProposals.push({
            proposalId: proposal.proposalId,
            version: proposal.version,
            state: proposal.state,
            payloadDigest: proposal.payloadDigest,
          })
          proposalCursor = page.nextCursor
        } while (proposalCursor !== undefined)
      }
      projectCursor = page.hasMore ? page.nextCursor : undefined
    } while (projectCursor !== undefined)

    const registryRows = readArtifactRegistry(databasePath).map((row) => ({ id: row.id, digest: row.digest, bytes: row.bytes }))

    // Outcome/ReviewTiming evidence as actually persisted by main: the acceptance event carries the
    // candidate, actorRef and reviewTiming in the same transaction as acceptance.
    const eventLog = new EventLog(db)
    const eventCursor = eventLog.cursor()
    const acceptedEvents: EvidenceAcceptedEvent[] = []
    let afterSeq = 0
    let scanned = 0
    while (afterSeq < eventCursor && scanned < 100_000) {
      const rows = eventLog.after(afterSeq, 1000)
      if (rows.length === 0) break
      scanned += rows.length
      for (const row of rows) {
        afterSeq = row.seq
        if (row.topic !== 'application.candidate.accepted') continue
        const payload = (row.payload ?? null) as { candidate?: Record<string, unknown>; actorRef?: unknown; reviewTiming?: unknown } | null
        const candidate = payload?.candidate
        acceptedEvents.push({
          seq: row.seq,
          entityRef: row.entityRef,
          payloadDigest: digestOf(row.payload),
          candidate: candidate && typeof candidate === 'object' ? (() => {
            const contract = (candidate.contract ?? {}) as { workId?: unknown; revision?: unknown; digest?: unknown }
            return {
              workId: String(contract.workId ?? candidate.workId),
              ticketId: String(candidate.ticketId),
              assignmentId: String(candidate.assignmentId),
              contractRevision: Number(contract.revision),
              contractDigest: String(contract.digest),
              candidateGeneration: Number(candidate.candidateGeneration),
            }
          })() : null,
          actorRef: typeof payload?.actorRef === 'string' ? payload.actorRef : null,
          reviewTiming: payload?.reviewTiming ?? null,
        })
      }
    }
    projects.sort((a, b) => a.id.localeCompare(b.id))
    works.sort((a, b) => `${a.projectId}/${a.id}`.localeCompare(`${b.projectId}/${b.id}`))
    decisions.sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`))
    assistantDecisions.sort((a, b) => a.id.localeCompare(b.id))
    assistantProposals.sort((a, b) => `${a.proposalId}@${a.version}`.localeCompare(`${b.proposalId}@${b.version}`))
    const artifacts = registryRows.sort((a, b) => a.id.localeCompare(b.id))

    // A v13 routing evidence, read through the public append-only port. A schema-12 database has no
    // such tables; that stays explicitly unavailable instead of being reported as zero records.
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name),
    )
    const routingTablesPresent = ['route_advice', 'review_evidence', 'execution_outcome'].every((name) => tables.has(name))
    const advice: { id: string; projectId: string; createdAt: string; expiresAt: string; sourceRef: string; digest: string }[] = []
    const reviews: { id: string; projectId: string; subjectDigest: string; layer: string; disposition: string; observedAt: string; reportArtifactRef: string; digest: string }[] = []
    const outcomes: { id: string; projectId: string; profileKey: string; attemptKey: string; layer: string; acceptance: string; observedAt: string; digest: string }[] = []
    let routingArtifactRefs: string[] = []
    if (routingTablesPresent) {
      const routing = new RoutingEvidence(db, uow)
      for (const project of projects) {
        const advicePage = routing.advice.list({ projectId: project.id, limit: 200 })
        for (const record of advicePage.records)
          advice.push({ id: record.id, projectId: record.projectId, createdAt: record.createdAt, expiresAt: record.expiresAt, sourceRef: record.sourceRef, digest: digestOf(record) })
        const reviewPage = routing.reviews.list({ projectId: project.id, limit: 200 })
        for (const record of reviewPage.records)
          reviews.push({ id: record.id, projectId: record.projectId, subjectDigest: digestOf(record.subject), layer: record.layer, disposition: record.disposition, observedAt: record.observedAt, reportArtifactRef: record.reportArtifactRef, digest: digestOf(record) })
        const outcomePage = routing.outcomes.list({ projectId: project.id, limit: 200 })
        for (const record of outcomePage.records)
          outcomes.push({
            id: record.id,
            projectId: record.projectId,
            profileKey: record.profileRef.profileId,
            attemptKey: `${record.attempt.ticketId}/${record.attempt.assignmentId}/${record.attempt.attemptId}@${record.attempt.fenceEpoch}`,
            layer: record.layer,
            acceptance: record.acceptance,
            observedAt: record.observedAt,
            digest: digestOf(record),
          })
      }
      routingArtifactRefs = readRoutingArtifactRefs(databasePath)
    }
    const adviceIds = new Set(advice.map((record) => record.id))
    const reviewIds = new Set(reviews.map((record) => record.id))
    const outcomeIds = new Set(outcomes.map((record) => record.id))
    advice.sort((a, b) => a.id.localeCompare(b.id))
    reviews.sort((a, b) => a.id.localeCompare(b.id))
    outcomes.sort((a, b) => a.id.localeCompare(b.id))
    if (advice.length !== adviceIds.size || reviews.length !== reviewIds.size || outcomes.length !== outcomeIds.size)
      throw new PortabilityError('evidence_unreadable', 'Routing evidence pagination returned duplicate records')
    const routingEvidence: EvidenceSummary['routingEvidence'] = routingTablesPresent
      ? {
          status: 'included',
          reason: null,
          requiredPorts: [],
          advice,
          reviews,
          outcomes,
          artifactRefs: routingArtifactRefs,
          missingArtifactRefs: routingArtifactRefs.filter((id) => !registryRows.some((row) => row.id === id)),
        }
      : {
          status: 'unavailable',
          reason: 'This database predates A schema 13 (route_advice/review_evidence/execution_outcome); routing evidence is absent, not empty.',
          requiredPorts: [...ROUTING_PORTS],
        }
    // A schema-12 database has no routing evidence payload, so its manifest is written as format 1:
    // the bundle must not claim to have covered classes that did not exist when it was produced.
    const body = {
      protocol: EVIDENCE_FORMAT,
      formatVersion: routingTablesPresent ? EVIDENCE_FORMAT_VERSION : (1 as const),
      productSchema,
      projects,
      works,
      decisions,
      assistantDecisions,
      assistantProposals,
      artifacts,
      acceptedEvents,
      routingEvidence,
      counts: {
        projects: projects.length,
        works: works.length,
        decisions: decisions.length,
        assistantDecisions: assistantDecisions.length,
        assistantProposals: assistantProposals.length,
        artifacts: artifacts.length,
        acceptedEvents: acceptedEvents.length,
        routeAdvice: advice.length,
        reviewEvidence: reviews.length,
        executionOutcomes: outcomes.length,
      },
      limitations: [...LIMITATIONS],
    }
    return { ...body, digest: digestOf(body) }
  } catch (error) {
    if (error instanceof PortabilityError) throw error
    throw new PortabilityError('evidence_unreadable', 'Evidence summary could not be read from the snapshot', {
      cause: String((error as Error)?.message ?? error).slice(0, 300),
    })
  } finally {
    db.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

const same = (left: unknown, right: unknown): boolean => digestOf(left) === digestOf(right)

/**
 * Recompute the evidence summary from a restored database and require exact agreement with the
 * bundle manifest. A readable database is not enough: every covered evidence class must match.
 */
export interface EvidenceVerification {
  readonly ok: boolean
  readonly actual: EvidenceSummary
  readonly mismatches: readonly string[]
  readonly legacyFormat: boolean
  readonly migratedSchema: boolean
}

/**
 * Recompute the evidence summary from a restored database and require exact agreement with the
 * bundle manifest. A readable database is not enough: every covered evidence class must match.
 *
 * A bundle written before routing evidence existed (formatVersion 1) can still be restored: the
 * recorded classes must match, and the routing tables must be empty after the append-only migration.
 * A schema upgrade is reported as `migratedSchema`; it is never reported as if the old bundle had
 * contained routing records.
 */
export function verifyEvidenceSummary(databasePath: string, expected: EvidenceSummary): EvidenceVerification {
  const actual = readEvidenceSummary(databasePath)
  const legacyFormat = expected.formatVersion < 2
  const migratedSchema = expected.productSchema !== actual.productSchema
  const mismatches: string[] = []
  if (actual.protocol !== expected.protocol) mismatches.push('format')
  if (legacyFormat) {
    // A pre-v13 bundle had no routing payload at all; after the append-only migration those tables
    // must be empty, and every class recorded by the old format must still match its count.
    if (actual.routingEvidence.status === 'included') {
      const routing = actual.routingEvidence
      if (routing.advice.length + routing.reviews.length + routing.outcomes.length > 0) mismatches.push('routing_present_in_legacy_restore')
    }
    const recorded = expected.counts
    if (
      actual.counts.projects !== recorded.projects ||
      actual.counts.works !== recorded.works ||
      actual.counts.decisions !== recorded.decisions ||
      actual.counts.assistantDecisions !== recorded.assistantDecisions ||
      actual.counts.assistantProposals !== recorded.assistantProposals ||
      actual.counts.artifacts !== recorded.artifacts ||
      actual.counts.acceptedEvents !== recorded.acceptedEvents
    ) mismatches.push('counts')
  } else {
    if (actual.digest !== expected.digest) mismatches.push('digest')
    if (!same(actual.counts, expected.counts)) mismatches.push('counts')
    if (!same(actual.routingEvidence, expected.routingEvidence)) mismatches.push('routing_evidence')
  }
  return { ok: mismatches.length === 0, actual, mismatches, legacyFormat, migratedSchema }
}
