import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { caseResult, notTested, STATUS, LAYERS } from '../lib/status.mjs'

/**
 * Wave-06 release-decision inputs that cannot be produced from this checkout: a real native control
 * result and a completed review pilot. They are recorded as NOT_TESTED so the higher tiers fail
 * closed instead of being satisfied by fixture or zero-turn evidence.
 */
export async function runRelease({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }

  let preflight
  try {
    preflight = JSON.parse(readFileSync(join(root, 'tests/product-acceptance/pilot/reports/preflight.json'), 'utf8'))
  } catch {
    preflight = undefined
  }

  let executed
  try {
    executed = JSON.parse(readFileSync(join(root, 'tests/product-acceptance/pilot/reports/result.json'), 'utf8'))
  } catch {
    executed = undefined
  }
  if (executed?.status === 'EXECUTED' && ['promising', 'no_go_for_current_recipe'].includes(executed.decision)) {
    cases.push(
      caseResult({
        id: 'E6-REVIEW-PILOT',
        title: 'Eight-case three-arm independent review pilot',
        layer: LAYERS.NATIVE,
        status: STATUS.PASS,
        assertions: [{ id: 'PILOT_EXECUTED', ok: true, detail: executed.decision }],
        evidence: {
          pilot: {
            protocol: 'independent-review-pilot/1',
            grantId: 'wave05-independent-review-pilot-01',
            executed: true,
            turnsUsed: executed.totals.turns,
            tokensUsed: executed.totals.tokens,
            costUSD: executed.totals.costUSD,
            usageCompleteness: executed.totals.unknown > 0 ? 'unknown' : 'observed',
            oracleDigest: executed.oracleDigest,
            decision: executed.decision,
            sourceCommit: executed.sourceCommit,
            arms: executed.arms,
            refusals: executed.refusals,
          },
        },
        limitations: ['Eight cases screen the mechanism; they are not statistical proof or product admission.'],
      }),
    )
  } else {
    const pilot = notTested(
      {
        id: 'E6-REVIEW-PILOT',
        title: 'Eight-case three-arm independent review pilot',
        layer: LAYERS.NOT_TESTED,
        limitations: [
          'Owner: E (grant execution) + B (bounded runtime). Protocol and cases are frozen; no turn was sent.',
          'BLOCKED is not a value result and must not be reported as promising/no-go.',
        ],
      },
      executed?.status === 'BLOCKED'
        ? `Pilot BLOCKED: ${executed.code ?? 'unknown'}; no value result.`
        : preflight?.status === 'BLOCKED'
          ? `Preflight BLOCKED: ${preflight.reasons.map((item) => item.code).join(', ')}; 0/24 turns used.`
          : 'No executed pilot result exists in this checkout.',
    )
    pilot.evidence.pilot = {
      unavailable: true,
      status: executed?.status ?? preflight?.status ?? 'NOT_EXECUTED',
      grantId: 'wave05-independent-review-pilot-01',
      turnsUsed: 0,
      tokensUsed: 0,
      costUSD: null,
      reasons:
        executed?.code
          ? [executed.code]
          : preflight?.reasons?.map((item) => item.code) ?? ['no_preflight'],
    }
    cases.push(pilot)
  }

  const native = notTested(
    {
      id: 'E5-NATIVE-CONTROL',
      title: 'Real native stop, question and recovery control',
      layer: LAYERS.NOT_TESTED,
      limitations: [
        'Owner: B. No current native control result is supplied as an input to E.',
        'E has no budget for native tasks and will not substitute fixture processes.',
      ],
    },
    'No executed native stop/question/recovery evidence is available in this checkout.',
  )
  native.evidence.nativeControl = {
    unavailable: true,
    required: ['executed', 'version', 'attempt', 'command', 'stop', 'question', 'recovery', 'budget', 'evidenceRefs'],
    owner: 'B',
  }
  cases.push(native)

  return { cases, artifacts }
}
