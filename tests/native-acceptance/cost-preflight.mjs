/**
 * B4: cost/usage/single-turn bound preflight (wave-06, zero model calls).
 *
 * The packet is precise about why this is hard: a wall-clock timeout, an already-sent cancel, a
 * single `max_output_tokens` field, or usage that only arrives at the end cannot by themselves
 * prove that a whole native turn is bounded. A preflight that cannot bound every billed component
 * must return BLOCKED instead of admitting the run.
 *
 * Verified against the installed codex-cli 0.164.0 protocol surface
 * (`codex app-server generate-ts`, 751 bindings):
 *
 *   - There is NO pricing/cost field anywhere in the protocol. A search for price/Price across
 *     every generated binding returns nothing, so price cannot be read from the protocol at all.
 *   - Usage IS reported, and in fine detail: `TokenUsageBreakdown` carries totalTokens,
 *     inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens and
 *     reasoningOutputTokens, delivered by `ThreadTokenUsageUpdatedNotification` with a `total` and
 *     a `last` breakdown per turn.
 *   - But it arrives as a NOTIFICATION after a turn runs. It is an observation of what was spent,
 *     not a ceiling that can be enforced before spending.
 *
 * Therefore: the usage basis is real and nameable, while the price basis is unavailable, and no
 * single field bounds a turn. The honest preflight result is BLOCKED with each missing component
 * named - not an estimate, not a 0, and not a subscription assumption.
 */

/** Every component that can be billed for one native turn. */
const BILLED_COMPONENTS = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'toolRounds',
]




/**
 * Evaluate whether a real billable send may proceed.
 *
 * Fail-closed by construction: every billed component must be positively bounded. A component
 * counts as bounded only when there is an authoritative price AND a limit the runtime enforces
 * before the spend happens.
 */
export function preflight(input) {
  const blockers = []
  const measurable = []

  const priceUsable = Boolean(input.priceSource && input.provider && input.model && input.priceObservedAt)
  if (!priceUsable) {
    const missing = [
      !input.priceSource && 'no authoritative price source',
      !input.provider && 'no concrete provider (an alias is not a price identity)',
      !input.model && 'no concrete model id',
      !input.priceObservedAt && 'no observed-at date for the price table',
    ].filter(Boolean)
    blockers.push(`price basis incomplete: ${missing.join(', ')}`)
  }

  // Usage detail is genuinely available and worth naming - but only after the fact.
  if (input.usageAvailableBeforeCompletion) {
    measurable.push('usage reported before completion: a per-turn ceiling could be enforced mid-turn')
  } else {
    measurable.push(
      'usage is reported per turn (total + last) as a post-turn notification; it measures spend but cannot cap it',
    )
    blockers.push('usage arrives only after the turn, so it cannot bound the turn it reports')
  }

  const components = BILLED_COMPONENTS.map(component => {
    if (component === 'toolRounds') {
      const bounded = priceUsable && typeof input.fields.maxTurns === 'number' && input.fields.maxTurns > 0 && input.canStopWithinQuota
      return {
        component,
        bounded,
        why: bounded
          ? `maxTurns=${input.fields.maxTurns} caps round-trips and the runtime can stop inside the quota`
          : 'no enforced cap on underlying model round-trips together with an in-quota stop',
      }
    }
    const bounded = priceUsable && input.canStopWithinQuota
    return {
      component,
      bounded,
      why: bounded
        ? 'priced and the runtime can stop inside the remaining quota'
        : priceUsable
          ? 'priced, but the runtime cannot stop inside the remaining quota'
          : 'no authoritative price, so the ceiling has no unit',
    }
  })

  for (const item of components) {
    if (!item.bounded) blockers.push(`${item.component} is not bounded: ${item.why}`)
  }

  // Whether the protocol can carry a per-turn ceiling at all. On this runtime it cannot (measured),
  // so the caller passes false; the generic evaluator stays able to return READY for a runtime that
  // can, otherwise this guard could never be shown to open.
  if (input.turnBoundExpressedViaProtocol === false) {
    blockers.push(
      'turn/start exposes no token bound field, so a per-turn ceiling cannot be attached to the turn at all',
    )
  }

  // A single maxOutputTokens field alone is explicitly not sufficient; say so rather than let it
  // look like coverage.
  if (typeof input.fields.maxOutputTokens === 'number') {
    blockers.push('maxOutputTokens alone bounds output only; input, cache, reasoning and tool rounds stay unbounded')
  }

  const verdict = blockers.length === 0 ? 'READY' : 'BLOCKED'
  return { verdict, components, blockers, measurable }
}

/**
 * The current, measured answer for the installed Codex runtime.
 *
 * Kept as a value (not a doc) so a consumer can print it and so a test can assert it stays honest
 * as the runtime evolves.
 */
/**
 * Measured protocol facts behind the BLOCKED verdict, so a consumer can re-check them rather than
 * trust this comment.
 *
 *   pricing       - `codex app-server generate-ts` yields 751 bindings; searching all of them for
 *                   price/Price returns nothing. There is no price or cost surface to read.
 *   turn bound    - TurnStartParams carries threadId, clientUserMessageId, turnTrigger,
 *                   parentTurnId, rootTurnId, cwd, model, serviceTier, serviceTierForTurn. It has
 *                   NO maxOutputTokens / maxTokens / tokenLimit field, so a per-turn ceiling
 *                   cannot be expressed through turn/start at all.
 *   usage timing  - usage arrives in thread/tokenUsage/updated AFTER the turn runs, with total and
 *                   last breakdowns (input, cachedInput, cacheWriteInput, output,
 *                   reasoningOutput). It measures spend; it cannot cap it.
 *   model identity- a real run reports model `gpt-6.1-sol`, provider `OpenAI`. No public,
 *                   checkable price exists for that identifier, so naming it does not produce a
 *                   price basis.
 */
export const MEASURED_PROTOCOL_FACTS = Object.freeze({
  pricingSurface: 'absent',
  turnStartBoundFields: [],
  turnStartFields: [
    'threadId', 'clientUserMessageId', 'turnTrigger', 'parentTurnId', 'rootTurnId',
    'cwd', 'model', 'serviceTier', 'serviceTierForTurn',
  ],
  usageTiming: 'post-turn notification only',
  observedModelIdentity: { model: 'gpt-6.1-sol', provider: 'OpenAI', priceSource: null },
})

export function currentRuntimePreflight() {
  return preflight({
    priceSource: null, // no price surface exists in the protocol, and no external table was supplied
    provider: 'openai',
    model: null, // the CLI does not report a concrete model here without a run
    priceObservedAt: null,
    canStopWithinQuota: false,
    usageAvailableBeforeCompletion: false,
    turnBoundExpressedViaProtocol: false,
    fields: {},
  })
}
