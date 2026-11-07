import { createHash } from 'node:crypto'
import type { CandidateRef, ContractRef, Criterion } from '@personal-agent/contracts'
import { UserError } from './errors.ts'
import type { Ticket } from './model.ts'
import type { EngineOptions } from './part.ts'
import type { CompletionConfiguration, PersonalCompletion } from './completion-model.ts'

export const sameContract = (a: ContractRef, b: ContractRef): boolean => !!a && !!b && a.workId === b.workId && a.revision === b.revision && a.digest === b.digest
export const sameCandidate = (a: CandidateRef, b: CandidateRef): boolean => !!a && !!b && a.ticketId === b.ticketId && a.assignmentId === b.assignmentId && a.candidateGeneration === b.candidateGeneration && sameContract(a.contract, b.contract)

export function completionCriteriaDigest(criteria: readonly Criterion[]): string {
  const normalized = criteria.map(item => ({ id: item.id, description: item.description, kind: item.kind, required: item.required,
    ...item.kind === 'machine' && item.checkDefinitionRef ? { checkDefinitionRef: item.checkDefinitionRef } : {} }))
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export function validateCompletionCriteria(criteria: readonly Criterion[]): void {
  if (!criteria.length || !criteria.some(item => item.required) || new Set(criteria.map(item => item.id)).size !== criteria.length
    || criteria.some(item => !item.id?.trim() || !item.description?.trim() || !['machine', 'human'].includes(item.kind) || typeof item.required !== 'boolean'
      || (item.kind === 'machine' && item.required && !item.checkDefinitionRef?.trim()))) throw new UserError('invalidCompletionCriteria')
}

export function initializeCompletion(configuration: CompletionConfiguration): PersonalCompletion {
  if (!['verified', 'human_review'].includes(configuration.mode)) throw new UserError('completionUnconfigured')
  validateCompletionCriteria(configuration.contract.criteria)
  const { workId, revision, digest } = configuration.contract
  if (!workId || !Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(digest)) throw new UserError('staleContract')
  return { mode: configuration.mode, contract: { workId, revision, digest }, criteria: structuredClone(configuration.contract.criteria), generation: 0 }
}

export function completionIsCurrent(options: EngineOptions, ticket: Ticket): boolean {
  return !ticket.completion || (!ticket.completion.retired && options.isCurrentContract?.(ticket.completion.contract) === true && options.policy().revalidate(ticket.mandate))
}
export function assertCompletionCurrent(options: EngineOptions, ticket: Ticket): void {
  if (!ticket.completion) return
  if (!options.isCurrentContract) throw new UserError('completionUnconfigured')
  if (!options.policy().revalidate(ticket.mandate)) throw new UserError('mandateRevoked')
  if (!completionIsCurrent(options, ticket)) throw new UserError('staleContract')
}

/** The counter survives retries; clearing a candidate never reuses an earlier generation. */
export function invalidateCompletionState(ticket: Ticket): number | undefined {
  const completion = ticket.completion
  if (!completion) return undefined
  if (!Number.isSafeInteger(completion.generation) || completion.generation < 0 || completion.generation >= Number.MAX_SAFE_INTEGER) throw new UserError('staleCandidate')
  completion.generation++
  delete completion.candidate
  delete completion.confirmed
  return completion.generation
}
