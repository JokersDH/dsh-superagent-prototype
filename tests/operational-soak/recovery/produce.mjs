#!/usr/bin/env node
/**
 * Produce one legal zero-model recovery input package for B/main.
 *
 *   node tests/operational-soak/recovery/produce.mjs --out <new-directory> [--json]
 *
 * Writes only into the new root (normal.json, journal/, journal.json, recovery-port.json, read.json,
 * report.json; 0600) and uses one short owned temporary directory for the Unix socket. It starts the
 * product's original controlled-fixture runtime (local Node script, no model/provider/native), the
 * original journal producer, the original journal decoder and the admitted recovery port. It does
 * not create a coordinator, ledger or business session, and it does not signal any process.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EXIT, TrialKitError, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactPath } from '../../../tools/trial-kit/lib/redact.mjs'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { produceNormalChain } from './normal-chain.mjs'
import { createLegalJournal, journalNegativeCases } from './journal.mjs'
import { runRecoveryPortRecipe } from './recovery-port.mjs'
import { readChainFacts } from './reader.mjs'

const USAGE = `produce — 合法零模型恢复输入包（B/main 可复用）
用法: node tests/operational-soak/recovery/produce.mjs --out <新目录> [--json]
输出: normal.json, journal/critical.ndjson, journal.json, recovery-port.json, read.json, report.json
退出: 0 全部正例/负例按预期, 1 有未预期差异, 2 参数/材料拒绝, 3 INTERNAL
`

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write(`produce: REFUSED usage: --out <new-directory> is required\n`); return EXIT.REFUSED }
  const root = resolve(values.out)
  try {
    mkdirSync(root, { mode: 0o700, recursive: false })
  } catch (error) {
    process.stderr.write(`produce: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${root}\n`)
    return EXIT.REFUSED
  }
  try {
    const facts = await produceNormalChain({ root })
    const journal = await createLegalJournal({ root, attempt: facts.attempt, factSource: facts.factSource, answerDelivery: facts.deliveries[0], artifactRef: facts.work.artifactIds[0] })
    const negatives = journalNegativeCases(journal.bytes, facts.deliveries[0])
    const journalReport = {
      protocol: 'recovery-journal-report/1', generatedAt: nowIso(),
      summary: journal.summary,
      negatives,
      negativeControls: { expectedRefusals: negatives.length, observedRefusals: negatives.filter((entry) => ['refused', 'partial_tail_refused'].includes(entry.result)).length, sends: 0, executes: 0 },
    }
    writeFileSync(join(root, 'journal.json'), `${JSON.stringify(journalReport, null, 2)}\n`, { mode: 0o600 })

    const port = await runRecoveryPortRecipe({ root, attempt: facts.attempt, factSource: facts.factSource })
    writeFileSync(join(root, 'recovery-port.json'), `${JSON.stringify(port, null, 2)}\n`, { mode: 0o600 })

    const read = readChainFacts({ root })
    writeFileSync(join(root, 'read.json'), `${JSON.stringify(read, null, 2)}\n`, { mode: 0o600 })

    const journalOk = journalReport.negativeControls.observedRefusals === journalReport.negativeControls.expectedRefusals
    const report = {
      protocol: 'recovery-fixture-report/1',
      generatedAt: nowIso(),
      source: 'tests/operational-soak/recovery/produce.mjs',
      root: redactPath(root, homeDir()),
      executor: facts.executor,
      modelCalls: facts.modelCalls,
      vendorTurns: facts.vendorTurns,
      nativeProfile: null,
      subject: {
        workId: facts.work.id, projectId: facts.work.projectId, phase: facts.work.phase,
        contract: facts.work.contract, attempt: facts.attempt,
        questionId: facts.question.id, answerId: facts.answer.answerId,
        deliveryStatus: facts.answer.deliveryStatus, nativeApplied: facts.answer.deliveryStatus === 'native_applied',
        journalFactSource: facts.factSource,
      },
      entries: {
        normal: 'normal.json', journal: 'journal/critical.ndjson', journalReport: 'journal.json',
        recoveryPort: 'recovery-port.json', reader: 'read.json',
      },
      results: {
        chainRead: read.ok, checks: read.checks,
        journal: { verdict: journalOk ? 'EXPECTED_REFUSALS' : 'UNEXPECTED', summary: journal.summary, negatives },
        recoveryPort: { positive: port.positive, faults: port.faults, faultsOk: port.faultsOk, businessSurface: port.businessSurface },
      },
      businessResume: 'NOT_REACHED (no admitted business session/attach; this package is fixture input only)',
      sends: 0, executes: 0,
      limits: [
        'controlled fixture executor (local Node check), no model/provider/vendor CLI/native profile',
        'journal facts and recovery-port observations are data; they grant no execution or recovery authority',
        'business reconnect, SIGKILL and original Work acceptance remain NOT_REACHED',
      ],
    }
    writeFileSync(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    const ok = read.ok && journalOk && port.faultsOk === true
    if (values.json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else {
      process.stdout.write([
        `recovery-produce: ${ok ? 'OK' : 'UNEXPECTED'}`,
        `  subject: work=${facts.work.id} attempt=${facts.attempt.attemptId} question=${facts.question.id} answer=${facts.answer.answerId} delivery=${facts.answer.deliveryStatus}`,
        `  journal: ${journal.summary.bytes} bytes, ${journal.summary.expected.entries} entries, lastSeq=${journal.summary.expected.lastSeq}, sha256=${journal.summary.sha256.slice(0, 16)}...`,
        `  journal negatives: ${journalReport.negativeControls.observedRefusals}/${journalReport.negativeControls.expectedRefusals} refused`,
        `  recovery port: inspect=${port.positive.inspect.state} cancel=${port.positive.cancel.state}; faults ${port.faults.map((fault) => `${fault.id}=${fault.actual}`).join(', ')}`,
        `  reader: ${read.ok ? 'OK' : 'FAILED'} checks=${Object.entries(read.checks).filter(([, value]) => !value).map(([key]) => key).join(',') || 'none'}`,
        `  business resume: NOT_REACHED (fixture input only)`,
        `  root: ${root}`,
      ].join('\n'))
    }
    return ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('internal', String(error?.message ?? error), undefined, EXIT.INTERNAL)
    process.stderr.write(`produce: REFUSED ${known.code}: ${known.message}\n`)
    return known.exitCode ?? EXIT.REFUSED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`produce: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
