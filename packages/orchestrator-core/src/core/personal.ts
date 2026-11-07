import { Engine } from './engine.ts'
import type { EngineOptions } from './part.ts'
import type { CompletionConfiguration } from './completion-model.ts'
import { UserError } from './errors.ts'

export type PersonalEngineOptions = Omit<EngineOptions, 'completionPolicy' | 'isCurrentContract'> & {
  completionPolicy: (ticket: Parameters<NonNullable<EngineOptions['completionPolicy']>>[0], outcome: Parameters<NonNullable<EngineOptions['completionPolicy']>>[1]) => CompletionConfiguration
  isCurrentContract: NonNullable<EngineOptions['isCurrentContract']>
}

/** Product assembly uses this factory so a missing per-ticket policy cannot silently select legacy completion. */
export function createPersonalEngine(options: PersonalEngineOptions): Engine {
  if (typeof options.completionPolicy !== 'function' || typeof options.isCurrentContract !== 'function') throw new UserError('completionUnconfigured')
  return new Engine({ ...options, requirePersonalCompletion: true, completionPolicy: (ticket, outcome) => {
    const configuration = options.completionPolicy(ticket, outcome)
    if (!configuration) throw new UserError('completionUnconfigured')
    return configuration
  } })
}
