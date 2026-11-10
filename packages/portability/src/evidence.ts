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
  ProductDecisions,
  UnitOfWork,
  WorkflowIndex,
  WorkflowRecords,
  canonicalDigest,
  readArtifactRegistry,
} from '@personal-agent/storage'
import { PortabilityError } from './errors.ts'

export const EVIDENCE_FORMAT = 'personal-evidence' as const
export const EVIDENCE_FORMAT_VERSION = 1 as const

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

export interface EvidenceSummary {
  readonly protocol: typeof EVIDENCE_FORMAT
  readonly formatVersion: typeof EVIDENCE_FORMAT_VERSION
  readonly digest: string
  readonly productSchema: number | null
  readonly projects: readonly EvidenceProject[]
  readonly works: readonly EvidenceWork[]
  readonly decisions: readonly { readonly id: string; readonly version: number; readonly digest: string }[]
  readonly assistantDecisions: readonly { readonly id: string; readonly digest: string }[]
  readonly assistantProposals: readonly { readonly proposalId: string; readonly version: number; readonly state: string; readonly payloadDigest: string }[]
  readonly artifacts: readonly { readonly id: string; readonly digest: string; readonly bytes: number }[]
  readonly routingEvidence: {
    readonly status: 'unavailable' | 'included'
    readonly reason: string
    readonly requiredPorts: readonly string[]
  }
  readonly counts: {
    readonly projects: number
    readonly works: number
    readonly decisions: number
    readonly assistantDecisions: number
    readonly assistantProposals: number
    readonly artifacts: number
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
    projects.sort((a, b) => a.id.localeCompare(b.id))
    works.sort((a, b) => `${a.projectId}/${a.id}`.localeCompare(`${b.projectId}/${b.id}`))
    decisions.sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`))
    assistantDecisions.sort((a, b) => a.id.localeCompare(b.id))
    assistantProposals.sort((a, b) => `${a.proposalId}@${a.version}`.localeCompare(`${b.proposalId}@${b.version}`))
    const artifacts = registryRows.sort((a, b) => a.id.localeCompare(b.id))

    const routingEvidence = {
      status: 'unavailable' as const,
      reason: 'No storage implementation of RoutingEvidencePort exists in this merge; route advice/review reports/outcomes are not in the database yet.',
      requiredPorts: [...ROUTING_PORTS],
    }
    const body = {
      protocol: EVIDENCE_FORMAT,
      formatVersion: EVIDENCE_FORMAT_VERSION,
      productSchema,
      projects,
      works,
      decisions,
      assistantDecisions,
      assistantProposals,
      artifacts,
      routingEvidence,
      counts: {
        projects: projects.length,
        works: works.length,
        decisions: decisions.length,
        assistantDecisions: assistantDecisions.length,
        assistantProposals: assistantProposals.length,
        artifacts: artifacts.length,
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
export function verifyEvidenceSummary(databasePath: string, expected: EvidenceSummary): { ok: boolean; actual: EvidenceSummary; mismatches: readonly string[] } {
  const actual = readEvidenceSummary(databasePath)
  const mismatches: string[] = []
  if (actual.protocol !== expected.protocol || actual.formatVersion !== expected.formatVersion) mismatches.push('format')
  if (actual.productSchema !== expected.productSchema) mismatches.push('product_schema')
  for (const key of ['projects', 'works', 'decisions', 'assistantDecisions', 'assistantProposals', 'artifacts'] as const) {
    if (!same(actual[key], expected[key])) mismatches.push(key)
  }
  if (!same(actual.counts, expected.counts)) mismatches.push('counts')
  if (!same(actual.routingEvidence, expected.routingEvidence)) mismatches.push('routing_capability')
  if (actual.digest !== expected.digest) mismatches.push('digest')
  return { ok: mismatches.length === 0, actual, mismatches }
}
