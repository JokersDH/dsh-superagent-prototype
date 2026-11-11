import type { ComposedDecisionProvider, ComposedDecisionView } from '@personal-agent/context'
import type { DecisionGovernance } from './governance.ts'
import type { DecisionRecord } from './types.ts'

function viewOf(record: DecisionRecord): ComposedDecisionView {
  return {
    decisionId: record.decision.id,
    content: record.decision.content,
    scope: record.decision.scope,
    sourceMessageId: record.sourceMessageId,
    recordedAt: record.recordedAt,
  }
}

/**
 * Structural adapter from knowledge's effectiveness rules to the context composer port.
 *
 * It deliberately does not re-derive effectiveness: `listEffectiveWindow` already excludes
 * revoked/superseded/expired/source-invalid decisions and throws `scan_incomplete` when the project
 * scan cannot complete. That error propagates so the composer fails instead of composing stale
 * knowledge. `truncatedByLimit` reports the caller's own cap.
 */
export function decisionContextProvider(
  governance: DecisionGovernance,
  now: () => Date = () => new Date(),
): ComposedDecisionProvider {
  return {
    async listEffective(projectId: string, max: number) {
      const window = await governance.listEffectiveWindow(projectId, max, now())
      return { decisions: window.decisions.map(viewOf), truncatedByLimit: window.truncatedByLimit }
    },
  }
}
