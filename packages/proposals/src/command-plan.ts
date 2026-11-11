import { UserCommandSchema } from '@personal-agent/contracts'
import type { RequiredCriteria, Scope, UserCommand } from '@personal-agent/contracts'
import { ProposalError } from './errors.ts'
import type { ProposalIntent } from './types.ts'

/**
 * Inputs the user must confirm for an executable command. The intent never carries a scope, criteria
 * list or profile: main collects those from the explicit confirmation and re-checks authority.
 */
export interface CommandPlanInput {
  readonly commandId: string
  readonly conversationId: string
  /** Required for `create_work`: the user-confirmed scope/criteria/profile. */
  readonly work?: { readonly scope: Scope; readonly criteria: RequiredCriteria; readonly profileId: string }
  /** Required for `revise_work`: the complete new contract the user confirmed. */
  readonly revision?: { readonly goal: string; readonly scope: Scope; readonly criteria: RequiredCriteria }
}

export type CommandPlan =
  | { readonly kind: 'command'; readonly command: UserCommand }
  | { readonly kind: 'no_effect'; readonly reason: 'reply' }
  | {
      readonly kind: 'needs_user_input'
      readonly intent: ProposalIntent['kind']
      readonly missing: readonly string[]
    }

function missingFor(intent: ProposalIntent, input: CommandPlanInput): readonly string[] {
  const missing: string[] = []
  if (intent.kind === 'create_work') {
    if (!input.work?.scope) missing.push('work.scope')
    if (!input.work?.criteria) missing.push('work.criteria')
    if (!input.work?.profileId) missing.push('work.profileId')
  }
  if (intent.kind === 'revise_work') {
    if (!input.revision?.goal) missing.push('revision.goal')
    if (!input.revision?.scope) missing.push('revision.scope')
    if (!input.revision?.criteria) missing.push('revision.criteria')
  }
  return missing
}

/**
 * Maps a confirmed proposal intent to the **existing** `UserCommand` that main already dispatches.
 *
 * - No new command kind, no actor field, no widened scope and no execution here.
 * - `reply` has no business effect.
 * - Missing user-confirmed scope/criteria/profile (or the complete new contract for a revision)
 *   returns `needs_user_input` instead of guessing from the rationale.
 * - A project/scope disagreement between the intent and the confirmed input is refused.
 */
export function planProposalCommand(intent: ProposalIntent, input: CommandPlanInput): CommandPlan {
  if (intent.kind === 'reply') return { kind: 'no_effect', reason: 'reply' }
  const missing = missingFor(intent, input)
  if (missing.length > 0) return { kind: 'needs_user_input', intent: intent.kind, missing }

  if (intent.kind === 'create_work') {
    const work = input.work!
    if (work.scope.projectId !== intent.projectId) {
      throw new ProposalError('cross_project', 'Confirmed work scope belongs to another project')
    }
    return {
      kind: 'command',
      command: UserCommandSchema.parse({
        kind: 'create_work',
        commandId: input.commandId,
        conversationId: input.conversationId,
        projectId: intent.projectId,
        goal: intent.goal,
        scope: work.scope,
        criteria: work.criteria,
        profileId: work.profileId,
      }),
    }
  }

  if (intent.kind === 'revise_work') {
    const revision = input.revision!
    // The intent carries only the expected contract ref; main re-checks the new scope against the
    // current contract and authorization. No project is inferred from `workId`.
    return {
      kind: 'command',
      command: UserCommandSchema.parse({
        kind: 'revise_work',
        commandId: input.commandId,
        conversationId: input.conversationId,
        expected: intent.expected,
        goal: revision.goal,
        scope: revision.scope,
        criteria: revision.criteria,
      }),
    }
  }

  return {
    kind: 'command',
    command: UserCommandSchema.parse({
      kind: 'record_decision',
      commandId: input.commandId,
      conversationId: input.conversationId,
      content: intent.content,
      scope: intent.scope,
      sourceMessageId: intent.sourceMessageId,
    }),
  }
}
