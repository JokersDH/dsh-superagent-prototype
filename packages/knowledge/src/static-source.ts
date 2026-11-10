import type { DecisionSource, DecisionSourcePort } from './types.ts'

/** Read-only fixture port for conversation-message provenance; it never writes messages. */
export class StaticDecisionSourcePort implements DecisionSourcePort {
  private readonly messages = new Map<string, DecisionSource>()
  private readonly missing = new Set<string>()

  constructor(messages: readonly DecisionSource[]) {
    for (const message of messages) this.messages.set(message.messageId, message)
  }

  async getMessage(messageId: string): Promise<DecisionSource | undefined> {
    if (this.missing.has(messageId)) return undefined
    return this.messages.get(messageId)
  }

  /** Simulates a source that disappeared after the decision was recorded. */
  markMissing(messageId: string): void {
    this.missing.add(messageId)
  }

  /** Simulates a source whose content/conversation changed after the decision was recorded. */
  replace(message: DecisionSource): void {
    this.messages.set(message.messageId, message)
    this.missing.delete(message.messageId)
  }
}
