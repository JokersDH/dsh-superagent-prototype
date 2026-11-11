import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Exercises the pilot runner's own accounting and process adapter on a disposable ledger and a fake
 * `codex` executable. It sends no model request and never touches the committed ledger: the point is
 * to prove that reservations precede sends, that one turn is in flight at most, that an unknown send
 * is charged at its bound rather than refunded, and that usage/session parsing reads the real JSON
 * event shape.
 */
export async function runnerSelftest() {
  const dir = mkdtempSync(join(tmpdir(), 'pa-pilot-selftest-'))
  const ledgerPath = join(dir, 'ledger.json')
  const fakeCodex = join(dir, 'codex')
  writeFileSync(
    fakeCodex,
    [
      '#!/bin/sh',
      'printf \'%s\\n\' \'{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}\'',
      'printf \'%s\\n\' \'{"type":"turn.completed","info":{"total_token_usage":{"input_tokens":1200,"cached_input_tokens":100,"output_tokens":300,"reasoning_output_tokens":50,"total_tokens":1500}}}\'',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  chmodSync(fakeCodex, 0o755)

  const previousLedger = process.env.PA_PILOT_LEDGER
  const previousCodex = process.env.PA_PILOT_CODEX
  process.env.PA_PILOT_LEDGER = ledgerPath
  process.env.PA_PILOT_CODEX = fakeCodex
  const runner = await import(`./runner.mjs?selftest=${Date.now()}`)
  const pricing = {
    model: 'fake-model',
    inputPerMillion: 1,
    outputPerMillion: 1,
    currency: 'USD',
    source: 'selftest',
    observedAt: new Date().toISOString(),
  }
  const assertions = []
  const check = (id, ok, detail) => assertions.push({ id, ok: ok === true, detail: detail === undefined ? null : String(detail).slice(0, 300) })
  const reset = (value) => writeFileSync(ledgerPath, JSON.stringify({ ...runner.readLedger(), ...value }, null, 2))

  try {
    check('LEDGER_DEFAULT', runner.readLedger().actual.turns === 0 && runner.readLedger().reservations.length === 0)

    const first = runner.reserveTurn({ caseId: 'case-01', arm: 'author', prompt: 'fix the failing test', pricing })
    check('RESERVE_AUTHOR', first.ok === true, JSON.stringify(first))
    check('RESERVATION_BOUNDED', first.ok && first.reservation.upperTokens > 0 && first.reservation.upperUSD > 0, JSON.stringify(first.reservation))
    const whileInFlight = runner.reserveTurn({ caseId: 'case-01', arm: 'self_review', prompt: 'review', pricing })
    check('ONE_IN_FLIGHT', whileInFlight.ok === false && whileInFlight.reason === 'one_turn_in_flight', JSON.stringify(whileInFlight))

    const turn = await runner.runCodexTurn({ prompt: 'fix', cwd: dir, sandbox: 'read-only' })
    check('FAKE_CODEX_EXIT', turn.exit?.code === 0 && turn.exit?.signal === null, JSON.stringify(turn.exit))
    check('USAGE_PARSED', turn.usage?.totalTokens === 1500 && turn.usage.outputTokens === 300, JSON.stringify(turn.usage))
    check('SESSION_PARSED', turn.sessionId === '11111111-1111-4111-8111-111111111111', String(turn.sessionId))
    const cost = runner.costOf(turn.usage, pricing)
    check('COST_COMPUTED', typeof cost === 'number' && cost > 0, String(cost))

    const settled = runner.settleTurn({
      turnId: first.reservation.turnId,
      usage: turn.usage,
      costUSD: cost,
      sessionId: turn.sessionId,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      exit: turn.exit,
    })
    check('SETTLE_TURN', settled.actual.turns === 1 && settled.actual.tokens === 1500 && settled.actual.unknownTurns === 0, JSON.stringify(settled.actual))
    check('SETTLE_RECEIPT', settled.turns.at(-1)?.usage?.totalTokens === 1500 && settled.reservations[0].status === 'settled')

    const unknown = runner.reserveTurn({ caseId: 'case-02', arm: 'author', prompt: 'second author turn', pricing })
    check('RESERVE_SECOND', unknown.ok === true, JSON.stringify(unknown))
    const unknownSettled = runner.settleTurn({
      turnId: unknown.reservation.turnId,
      usage: null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exit: 'timeout',
    })
    check('UNKNOWN_BLOCKS', unknownSettled.status === 'BLOCKED_UNKNOWN_USAGE', unknownSettled.status)
    check('UNKNOWN_NOT_REFUNDED', unknownSettled.actual.tokens === 1500 + unknown.reservation.upperTokens && unknownSettled.actual.unknownTurns === 1, JSON.stringify(unknownSettled.actual))
    const afterUnknown = runner.reserveTurn({ caseId: 'case-03', arm: 'fresh_review', prompt: 'review', pricing })
    check('NO_SEND_AFTER_UNKNOWN', afterUnknown.ok === false && afterUnknown.reason === 'unknown_usage_unresolved', JSON.stringify(afterUnknown))

    reset({ status: 'IN_PROGRESS', actual: { turns: 1, tokens: 199998, costUSD: 0, unknownTurns: 0 }, reservations: [] })
    const overTokens = runner.reserveTurn({ caseId: 'case-04', arm: 'author', prompt: 'x'.repeat(4000), pricing })
    check('TOKEN_CEILING', overTokens.ok === false && overTokens.reason === 'budget_ceiling', JSON.stringify(overTokens))

    reset({
      status: 'IN_PROGRESS',
      actual: { turns: 8, tokens: 8000, costUSD: 0.1, unknownTurns: 0 },
      reservations: Array.from({ length: 8 }, (_, index) => ({ turnId: `author-${index}`, caseId: `case-0${index}`, arm: 'author', upperTokens: 1000, upperUSD: 0.01, status: 'settled' })),
    })
    const overAuthor = runner.reserveTurn({ caseId: 'case-05', arm: 'author', prompt: 'ninth author', pricing })
    check('AUTHOR_TURN_CAP', overAuthor.ok === false && overAuthor.reason === 'author_turn_cap', JSON.stringify(overAuthor))
    const reviewAllowed = runner.reserveTurn({ caseId: 'case-05', arm: 'self_review', prompt: 'review', pricing })
    check('REVIEW_STILL_ALLOWED', reviewAllowed.ok === true, JSON.stringify(reviewAllowed))
  } finally {
    if (previousLedger === undefined) delete process.env.PA_PILOT_LEDGER
    else process.env.PA_PILOT_LEDGER = previousLedger
    if (previousCodex === undefined) delete process.env.PA_PILOT_CODEX
    else process.env.PA_PILOT_CODEX = previousCodex
  }

  return {
    protocol: 'review-pilot-runner-selftest/1',
    createdAt: new Date().toISOString(),
    passes: assertions.filter((item) => item.ok).length,
    failures: assertions.filter((item) => !item.ok),
    assertions,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runnerSelftest()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.failures.length === 0 ? 0 : 1)
}
