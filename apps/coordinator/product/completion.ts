import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  CandidateRefSchema,
  CompletionProposalSchema,
  IdSchema,
  JsonSchema,
  VerificationSchema,
} from '@personal-agent/contracts'
import type { CandidateRef, ContractRevision, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import type { CompletionReviewPort } from '@personal-agent/application'
import { key } from '@personal-agent/orchestrator-core'
import type { Ticket } from '@personal-agent/orchestrator-core'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { CheckRegistry, CompletionEvidenceStore, VerificationRunner } from '@personal-agent/verification'
import type { WorkspaceManager } from '@personal-agent/workspaces'
import type { OwnedQuiescenceReceipt } from '../resource-barrier.ts'

const ReviewSchema = z.strictObject({
  proposal: CompletionProposalSchema,
  verification: VerificationSchema,
  artifactIds: z.array(IdSchema),
  attemptId: IdSchema,
})
const same = (a: unknown, b: unknown) =>
  a !== undefined &&
  b !== undefined &&
  canonicalDigest(JSON.parse(JSON.stringify(a))) === canonicalDigest(JSON.parse(JSON.stringify(b)))
const candidateOf = (value: CandidateRef) =>
  CandidateRefSchema.parse({
    ticketId: value.ticketId,
    assignmentId: value.assignmentId,
    contract: value.contract,
    candidateGeneration: value.candidateGeneration,
  })
const reviewId = (candidate: CandidateRef) => key('product-review', canonicalDigest(candidateOf(candidate)))

/** Indexes trusted WP-04 evidence; the core remains the only completion authority. */
export class ProductCompletion implements CompletionReviewPort {
  readonly verifier: CompletionEvidenceStore
  private readonly runner: VerificationRunner
  private readonly store: ProductStore
  private readonly workspaces: WorkspaceManager
  constructor(store: ProductStore, workspaces: WorkspaceManager, checks: CheckRegistry) {
    this.store = store
    this.workspaces = workspaces
    this.verifier = new CompletionEvidenceStore(store)
    this.runner = new VerificationRunner(checks, { identity: 'verifier:personal-agent' })
  }
  current(candidate: CandidateRef) {
    const stored = this.store.commands.get(reviewId(candidate))
    if (!stored) return undefined
    const parsed = ReviewSchema.safeParse(stored.result)
    if (!parsed.success || !same(candidateOf(parsed.data.proposal), candidateOf(candidate))) return undefined
    // The current resource manifest and trusted host provenance are rechecked on every read.
    return this.verifier.resolve(parsed.data.proposal) ? parsed.data : undefined
  }
  async preflight(candidate: CandidateRef): Promise<() => void> {
    const review = this.store.uow.atomic(() => this.current(candidate))
    if (!review) throw new ApplicationFault('verification_failed', 'Trusted artifact review is unavailable')
    try {
      if (this.workspaces.digest(review) !== review.proposal.artifactDigest) throw new Error('Artifact changed')
      for (const id of review.artifactIds) if (!this.store.artifacts.read(id)) throw new Error('Artifact missing')
    } catch {
      throw new ApplicationFault('verification_failed', 'The reviewed artifact changed or is unavailable')
    }
    return () => {
      const current = this.current(candidate)
      if (!current || !same(current, review)) throw new ApplicationFault('stale_candidate', 'Artifact review changed')
    }
  }
  accept(
    proposal: Parameters<CompletionReviewPort['accept']>[0],
    actor: TrustedActor,
    criterionIds: readonly string[],
    id: string,
  ) {
    this.verifier.recordAcceptance({
      id,
      candidate: candidateOf(proposal),
      artifactDigest: proposal.artifactDigest,
      criterionIds,
      actorRef: actor.authorityRef,
    })
  }
  async verify(
    candidate: CandidateRef,
    contract: ContractRevision,
    attemptId: string,
    barrier: OwnedQuiescenceReceipt,
  ): Promise<void> {
    if (this.store.commands.get(reviewId(candidate))) return
    const frozen = this.workspaces.freeze({ attemptId })
    const run = await this.runner.run({
      candidate,
      criteria: contract.criteria,
      artifactDigest: frozen.artifactDigest,
      workspacePath: this.workspaces.attemptPath(attemptId),
      environmentRef: key('environment', attemptId),
      verifyArtifact: () => this.workspaces.digest({ attemptId }) === frozen.artifactDigest,
    })
    const outputPath = join(this.workspaces.attemptPath(attemptId), 'src/product-output.txt')
    const output =
      this.store.bindings.binding(attemptId)?.source === 'controlled-product-fixture' && existsSync(outputPath)
        ? readFileSync(outputPath)
        : undefined
    // Workspace content addresses may be shared; delivery metadata belongs to this exact candidate.
    const manifest = {
      kind: output ? 'controlled-product-artifact/1' : 'product-artifact/1',
      candidate,
      attemptId,
      artifactDigest: frozen.artifactDigest,
      baseCommit: frozen.baseCommit,
      headCommit: frozen.headCommit,
      environment: frozen.environment,
      ...(output
        ? {
            output: {
              path: 'src/product-output.txt',
              bytes: output.byteLength,
              sha256: createHash('sha256').update(output).digest('hex'),
            },
          }
        : {}),
    }
    const files = [
      this.store.artifacts.write(Buffer.from(JSON.stringify(manifest, null, 2))),
      this.store.artifacts.write(readFileSync(frozen.patchPath)),
      ...(output ? [this.store.artifacts.write(output)] : []),
    ]
    if (this.workspaces.digest({ attemptId }) !== frozen.artifactDigest)
      throw new ApplicationFault('verification_failed', 'Artifact changed while collecting delivery bytes')
    const checkEvidence = this.store.artifacts.write(Buffer.from(JSON.stringify(run.evidence, null, 2)))
    const proposal = CompletionProposalSchema.parse({
      ...candidate,
      artifactDigest: frozen.artifactDigest,
      verificationId: run.verification.id,
    })
    const review = ReviewSchema.parse({
      proposal,
      verification: run.verification,
      artifactIds: [...files, checkEvidence].map((file) => file.id),
      attemptId,
    })
    this.store.uow.atomic(() => {
      const ticket = this.store.domain.tickets.get<Ticket>(candidate.ticketId)
      const binding = this.store.bindings.current(candidate.ticketId)
      if (
        !ticket ||
        ticket.ended ||
        !this.store.authority.isCurrent(candidate.contract) ||
        !same(ticket.completion?.candidate, candidate) ||
        binding?.attemptId !== attemptId ||
        binding.state !== 'ended'
      )
        return
      this.verifier.recordVerification(run.verification)
      this.verifier.recordQuiescence({
        id: key('product-quiescence', reviewId(candidate)),
        candidate,
        artifactDigest: frozen.artifactDigest,
        attemptId,
        barrier,
      })
      for (const file of [...files, checkEvidence]) this.store.artifacts.insert(file)
      this.store.commands.record(reviewId(candidate), canonicalDigest(JsonSchema.parse(review)), () => review)
      for (const id of review.artifactIds)
        this.store.commands.record(
          key('product-artifact', id, candidate.contract.workId),
          canonicalDigest({ id, workId: candidate.contract.workId }),
          () => ({ id, workId: candidate.contract.workId }),
        )
      this.store.events.append({
        topic: 'application.verification.finished',
        entityRef: candidate.contract.workId,
        payload: {
          workId: candidate.contract.workId,
          verificationId: run.verification.id,
          artifactIds: review.artifactIds,
        },
      })
    })
  }
}
