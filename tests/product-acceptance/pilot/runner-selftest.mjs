import { chmodSync, existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digestOf, evaluateAdapter, makeTestAdapter } from './admission.mjs'

/**
 * Exercises the pilot runner's admission and accounting on a disposable ledger and a fake adapter.
 * No model is called: the fake executable only prints protocol-shaped JSON and appends to a send
 * counter. The negative cases assert that the counter stays at zero, i.e. a refusal never spawns.
 */
export async function runnerSelftest() {
  const dir = mkdtempSync(join(tmpdir(), 'pa-pilot-selftest-'))
  const ledgerPath = join(dir, 'ledger.json')
  const counterPath = join(dir, 'sends.log')
  const fakeCodex = join(dir, 'fake-codex')
  writeFileSync(
    fakeCodex,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "fake-cli 1.0.0"; exit 0; fi',
      `echo "$@" >> ${JSON.stringify(counterPath)}`,
      'printf \'%s\\n\' \'{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}\'',
      'printf \'%s\\n\' \'{"type":"turn.completed","info":{"total_token_usage":{"input_tokens":1200,"cached_input_tokens":100,"output_tokens":300,"reasoning_output_tokens":50,"total_tokens":1500}}}\'',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  chmodSync(fakeCodex, 0o755)
  const writes = () => (existsSync(counterPath) ? readFileSync(counterPath, 'utf8').split('\n').filter(Boolean).length : 0)

  const previousLedger = process.env.PA_PILOT_LEDGER
  process.env.PA_PILOT_LEDGER = ledgerPath
  const runner = await import(`./runner.mjs?selftest=${Date.now()}`)
  const assertions = []
  const check = (id, ok, detail) => assertions.push({ id, ok: ok === true, detail: detail === undefined ? null : String(detail).slice(0, 400) })
  const baseLedger = () => ({
    schema: 'review-pilot-ledger/2',
    grantId: runner.GRANT.id,
    ledgerId: runner.GRANT.id,
    historyComplete: true,
    createdAt: new Date().toISOString(),
    caps: {
      maxTotalTurnStarts: 24,
      maxAuthorTurnStarts: 8,
      maxReviewTurnStarts: 16,
      maxTotalBillableTokens: 200000,
      maxTotalCostUSD: 5,
    },
    status: 'NOT_STARTED',
    reservation: { turns: 0, tokens: 0, unknownTurns: 0 },
    actual: { turns: 0, tokens: 0, costUSD: 0, unknownTurns: 0 },
    reservations: [],
    turns: [],
  })
  const seal = (data) => {
    const { integrity, ...body } = data
    return { ...body, integrity: digestOf(body) }
  }
  const resetLedger = (value) => {
    const data = value ?? baseLedger()
    writeFileSync(ledgerPath, JSON.stringify(seal(data), null, 2) + '\n')
  }
  const now = Date.now()
  const validAdapter = makeTestAdapter({ executable: fakeCodex, now })
  const admission = evaluateAdapter(validAdapter, { now })

  try {
    check('ADAPTER_VALID', admission.ok === true, JSON.stringify(admission.blockers))
    check('BOUND_IS_DECLARED_NOT_CLIPPED', admission.bound?.tokens === 144000, JSON.stringify(admission.bound))
    check('BOUND_USD_POSITIVE', typeof admission.bound?.usd === 'number' && admission.bound.usd > 0, String(admission.bound?.usd))

    const first = runner.reserveTurn({ caseId: 'case-01', arm: 'author', admission })
    check('RESERVE_USES_FULL_BOUND', first.ok === true && first.reservation.upperTokens === 144000, JSON.stringify(first))
    const replay = runner.reserveTurn({ caseId: 'case-01', arm: 'author', admission })
    check('RESERVE_REPLAY', replay.ok === true && replay.replayed === true && replay.reservation.turnId === first.reservation.turnId, JSON.stringify(replay))
    const other = runner.reserveTurn({ caseId: 'case-01', arm: 'self_review', admission })
    check('ONE_IN_FLIGHT', other.ok === false && other.reason === 'one_turn_in_flight', JSON.stringify(other))

    const sent = await runner.guardedSend({ admission, prompt: 'fix', cwd: dir, sandbox: 'read-only' })
    check('ADMITTED_SEND_RUNS', sent.ok === true && sent.result.usage?.totalTokens === 1500 && sent.result.sessionId === '11111111-1111-4111-8111-111111111111', JSON.stringify(sent))
    check('SEND_COUNTER_ONE', writes() === 1, String(writes()))

    const settled = runner.settleTurn({
      turnId: first.reservation.turnId,
      usage: sent.result.usage,
      costUSD: runner.costOf(sent.result.usage, validAdapter.pricing),
      sessionId: sent.result.sessionId,
      startedAt: sent.result.startedAt,
      endedAt: sent.result.endedAt,
      exit: sent.result.exit,
    })
    check('SETTLE_ONCE', settled.state === 'SETTLED' && settled.data.actual.turns === 1 && settled.data.actual.unknownTurns === 0, JSON.stringify(settled))
    const settleAgain = runner.settleTurn({ turnId: first.reservation.turnId, usage: sent.result.usage, costUSD: 0.01 })
    check('SETTLE_REPLAY_IDEMPOTENT', settleAgain.state === 'REPLAYED' && settleAgain.data.actual.turns === 1, JSON.stringify(settleAgain))

    const unknown = runner.reserveTurn({ caseId: 'case-02', arm: 'self_review', admission })
    check('RESERVE_UNKNOWN_CASE', unknown.ok === true, JSON.stringify(unknown))
    const unknownSettled = runner.settleTurn({ turnId: unknown.reservation.turnId, usage: null, exit: 'timeout' })
    check('UNKNOWN_BLOCKS', unknownSettled.state === 'UNKNOWN_USAGE' && unknownSettled.data.status === 'BLOCKED_UNKNOWN_USAGE', JSON.stringify(unknownSettled.state))
    check('UNKNOWN_CHARGED_AT_BOUND', unknownSettled.data.actual.tokens === 1500 + 144000 && unknownSettled.data.actual.unknownTurns === 1, JSON.stringify(unknownSettled.data.actual))
    const afterUnknown = runner.reserveTurn({ caseId: 'case-03', arm: 'author', admission })
    check('NO_SEND_AFTER_UNKNOWN', afterUnknown.ok === false && afterUnknown.reason === 'unknown_usage_unresolved', JSON.stringify(afterUnknown))

    // Overrun: measured spend above the declared bound blocks and is not treated as covered.
    resetLedger()
    const over = runner.reserveTurn({ caseId: 'case-04', arm: 'author', admission })
    const overSettled = runner.settleTurn({
      turnId: over.reservation.turnId,
      usage: { totalTokens: 144001, inputTokens: 1000, outputTokens: 1000 },
      costUSD: 0.001,
    })
    check('OVERRUN_BLOCKS', overSettled.state === 'BOUND_VIOLATION' && overSettled.data.status === 'BLOCKED_BOUND_VIOLATION', JSON.stringify(overSettled.state))
    const afterOverrun = runner.reserveTurn({ caseId: 'case-05', arm: 'author', admission })
    check('NO_SEND_AFTER_OVERRUN', afterOverrun.ok === false && afterOverrun.reason === 'bound_violation_unresolved', JSON.stringify(afterOverrun))

    // Caps.
    resetLedger({
      ...baseLedger(),
      status: 'IN_PROGRESS',
      actual: { turns: 8, tokens: 8000, costUSD: 0.08, unknownTurns: 0 },
      reservations: Array.from({ length: 8 }, (_, index) => ({ turnId: `author-${index}`, caseId: `case-0${index}`, arm: 'author', upperTokens: 10000, upperUSD: 0.01, admissionDigest: 'x', status: 'settled' })),
      turns: Array.from({ length: 8 }, (_, index) => ({ turnId: `author-${index}`, usage: { totalTokens: 1000 }, unknown: false, exit: { code: 0 } })),
    })
    const overAuthor = runner.reserveTurn({ caseId: 'case-09', arm: 'author', admission })
    check('AUTHOR_TURN_CAP', overAuthor.ok === false && overAuthor.reason === 'author_turn_cap', JSON.stringify(overAuthor))
    const reviewAllowed = runner.reserveTurn({ caseId: 'case-09', arm: 'self_review', admission })
    check('REVIEW_STILL_ALLOWED', reviewAllowed.ok === true, JSON.stringify(reviewAllowed))

    resetLedger({
      ...baseLedger(),
      status: 'IN_PROGRESS',
      actual: { turns: 1, tokens: 100000, costUSD: 0.1, unknownTurns: 0 },
      reservations: [{ turnId: 'big', caseId: 'case-big', arm: 'author', upperTokens: 1, upperUSD: 0.01, admissionDigest: 'x', status: 'settled' }],
      turns: [{ turnId: 'big', usage: { totalTokens: 100000 }, unknown: false, exit: { code: 0 } }],
    })
    const budget = runner.reserveTurn({ caseId: 'case-10', arm: 'author', admission })
    check('TOKEN_CEILING', budget.ok === false && budget.reason === 'budget_ceiling', JSON.stringify(budget))

    // Damaged and forged ledgers: never a zero-filled fallback.
    const seeded = seal({ ...baseLedger(), status: 'IN_PROGRESS', actual: { turns: 1, tokens: 100, costUSD: 0.1, unknownTurns: 0 },
      reservations: [{ turnId: 'seeded', caseId: 'case-seeded', arm: 'author', upperTokens: 100, upperUSD: 0.01, admissionDigest: 'x', status: 'settled' }],
      turns: [{ turnId: 'seeded', usage: { totalTokens: 100 }, unknown: false, exit: { code: 0 } }] })
    const damaged = [
      ['BAD_JSON', '{ not json'],
      ['NAMED_NAN', JSON.stringify({ ...seeded, actual: { turns: 1, tokens: 'NaN', costUSD: 0.1, unknownTurns: 0 } })],
      ['NEGATIVE_USAGE', JSON.stringify(seal({ ...seeded, actual: { turns: 1, tokens: -5, costUSD: 0.1, unknownTurns: 0 } }))],
      ['WRONG_GRANT', JSON.stringify(seal({ ...seeded, grantId: 'wave03-b-native' }))],
      ['MISSING_HISTORY', JSON.stringify(seal({ ...seeded, actual: { turns: 2, tokens: 10, costUSD: 0.1, unknownTurns: 0 }, turns: [{ turnId: 'seeded', usage: { totalTokens: 10 }, unknown: false }] }))],
      ['INTEGRITY_MISMATCH', JSON.stringify({ ...seeded, actual: { turns: 0, tokens: 0, costUSD: 0, unknownTurns: 0 }, integrity: 'f'.repeat(64) })],
      ['INFINITY_TOKENS', JSON.stringify(seal({ ...seeded, actual: { turns: 1, tokens: null, costUSD: 0.1, unknownTurns: 0 } })).replace('"tokens":null', '"tokens":1e999')],
      ['NAN_COST', JSON.stringify(seal({ ...seeded, actual: { turns: 1, tokens: 100, costUSD: null, unknownTurns: 0 } }))],
      ['MISSING_CAPS', JSON.stringify(seal({ ...baseLedger(), caps: {} }))],
      ['DUPLICATE_TURN_ID', JSON.stringify(seal({ ...seeded, reservations: [...seeded.reservations, { ...seeded.reservations[0] }], turns: [...seeded.turns, { ...seeded.turns[0] }], actual: { turns: 2, tokens: 200, costUSD: 0.2, unknownTurns: 0 } }))],
      ['V1_WITH_USAGE', JSON.stringify({ schema: 'review-pilot-ledger/1', grantId: runner.GRANT.id, actual: { turns: 3, tokens: 100, costUSD: 0.1, unknownTurns: 0 }, reservations: [], turns: [] })],
      ['FORGED_IDENTITY', JSON.stringify(seal({ ...seeded, ledgerId: 'forged-other' }))],
    ]
    for (const [id, content] of damaged) {
      writeFileSync(ledgerPath, content)
      const view = runner.readLedgerView()
      const reserve = runner.reserveTurn({ caseId: 'case-x', arm: 'author', admission })
      check(`CORRUPT_${id}`, view.state === 'CORRUPT' && reserve.ok === false && reserve.reason === 'ledger_corrupt', `${view.state} ${reserve.reason}`)
    }

    // A held lock refuses a second writer instead of racing it.
    resetLedger()
    writeFileSync(`${ledgerPath}.lock`, 'held\n', { mode: 0o600 })
    const lockedReserve = runner.reserveTurn({ caseId: 'locked', arm: 'author', admission })
    const lockedView = runner.readLedgerView()
    check('LEDGER_LOCKED', lockedReserve.ok === false && lockedReserve.reason === 'ledger_locked' && lockedView.data.reservations.length === 0, JSON.stringify(lockedReserve))
    unlinkSync(`${ledgerPath}.lock`)

    // Admission negatives: each facet is named and no send happens.
    const negativeCases = [
      ['MISSING', undefined, 'adapter_missing'],
      ['WRONG_SCHEMA', makeTestAdapter({ executable: fakeCodex, overrides: { schema: 'other/1' } }), 'adapter_invalid'],
      ['VERSION_DRIFT', makeTestAdapter({ executable: fakeCodex, version: 'fake-cli 9.9.9' }), 'adapter_version_drift'],
      ['PRICE_ONLY', makeTestAdapter({ executable: fakeCodex, overrides: { bound: {}, isolation: {}, session: {}, material: {}, admission: {} } }), 'whole_turn_bound_unavailable'],
      ['BOOLEAN_ISOLATION', makeTestAdapter({ executable: fakeCodex, overrides: { isolation: { safe: true } } }), 'isolation_unproven'],
      ['NO_SESSION_EVIDENCE', makeTestAdapter({ executable: fakeCodex, overrides: { session: { resumeSupported: true } } }), 'session_evidence_missing'],
      ['NO_MAIN_ADMISSION', makeTestAdapter({ executable: fakeCodex, overrides: { admission: { by: 'agent-b' } } }), 'main_admission_missing'],
      ['STALE_EVIDENCE', makeTestAdapter({ executable: fakeCodex, overrides: { isolation: { proven: true, covers: ['author_credential', 'author_material', 'network_egress'], evidenceDigest: 'b'.repeat(64), observedAt: '2026-01-01T00:00:00.000Z' } } }), 'isolation_unproven'],
      ['NEGATIVE_PRICE', makeTestAdapter({ executable: fakeCodex, overrides: { pricing: { ...makeTestAdapter({ executable: fakeCodex }).pricing, inputPerMillion: -1 } } }), 'price_basis_incomplete'],
      ['TRUNCATED_BOUND', makeTestAdapter({ executable: fakeCodex, overrides: { bound: { ...makeTestAdapter({ executable: fakeCodex }).bound, maxInputTokens: 0 } } }), 'whole_turn_bound_unavailable'],
      ['FALLBACK_PATH', makeTestAdapter({ executable: fakeCodex, overrides: { fallbackExecutable: '/usr/local/bin/codex' } }), 'adapter_invalid'],
    ]
    resetLedger()
    for (const [id, adapter, expected] of negativeCases) {
      const evaluation = adapter === undefined ? { ok: false, blockers: [{ code: 'adapter_missing', detail: 'absent' }] } : evaluateAdapter(adapter, { now })
      const reserve = runner.reserveTurn({ caseId: `neg-${id}`, arm: 'author', admission: evaluation })
      const send = await runner.guardedSend({ admission: evaluation, prompt: 'x', cwd: dir })
      check(`ADMISSION_${id}`, evaluation.ok === false && evaluation.blockers.some((item) => item.code === expected) && reserve.ok === false && send.ok === false, JSON.stringify(evaluation.blockers))
    }
    check('NO_SEND_FOR_ALL_REFUSALS', writes() === 1, String(writes()))
    check('NO_RESERVATION_FOR_ALL_REFUSALS', runner.readLedgerView().data.reservations.length === 0, JSON.stringify(runner.readLedgerView().data.reservations))
  } finally {
    if (previousLedger === undefined) delete process.env.PA_PILOT_LEDGER
    else process.env.PA_PILOT_LEDGER = previousLedger
  }

  return {
    protocol: 'review-pilot-runner-selftest/2',
    createdAt: new Date().toISOString(),
    passes: assertions.filter((item) => item.ok).length,
    failures: assertions.filter((item) => !item.ok),
    assertions,
    modelSends: writes(),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runnerSelftest()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.failures.length === 0 ? 0 : 1)
}
