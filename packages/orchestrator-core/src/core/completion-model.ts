import type { CandidateRef, CompletionProposal, ContractRef, ContractRevision, Criterion, Verification } from '@personal-agent/contracts'

export interface CompletionConfiguration { mode: 'verified' | 'human_review'; contract: ContractRevision }
export interface PersonalCompletion {
  mode: CompletionConfiguration['mode']
  contract: ContractRef
  criteria: readonly Criterion[]
  generation: number
  candidate?: CandidateRef
  confirmed?: { proposal: CompletionProposal; at: string }
  retired?: { at: string; reason: string }
  resultReplyIds?: string[]
}
/** Resolved only from trusted records, on the same transaction connection as the core. */
export interface CompletionEvidence {
  verification: Verification
  quiescence: { id: string; candidate: CandidateRef; artifactDigest: string }
  humanAcceptance?: { id: string; candidate: CandidateRef; artifactDigest: string; criterionIds: readonly string[] }
}
export interface CompletionVerifier { resolve(proposal: CompletionProposal): CompletionEvidence | undefined }
