#!/usr/bin/env node
/**
 * Re-read one produced recovery package through the original public readers.
 *
 *   node tests/operational-soak/recovery/read.mjs --run <produced-root> [--json]
 *
 * Read-only over the fixture root. It does not start the product, send anything or touch a personal
 * state; it is the datareader B/main can call to confirm the imported facts before using them.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { readChainFacts } from './reader.mjs'

const USAGE = `read — 复核一个 recovery fixture 包（原公共 reader）
用法: node tests/operational-soak/recovery/read.mjs --run <produced-root> [--json]
退出: 0 全部一致, 1 有差异/缺材料, 2 参数/材料拒绝, 3 INTERNAL
`

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { run: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`read: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return 2
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return 0 }
  if (values.run === undefined) { process.stderr.write('read: REFUSED usage: --run <produced-root> is required\n'); return 2 }
  const root = resolve(values.run)
  try {
    const chain = readChainFacts({ root })
    const journalReport = JSON.parse(readFileSync(join(root, 'journal.json'), 'utf8'))
    const portReport = JSON.parse(readFileSync(join(root, 'recovery-port.json'), 'utf8'))
    const negativesOk = journalReport.negativeControls.observedRefusals === journalReport.negativeControls.expectedRefusals
    const result = {
      protocol: 'recovery-read/1',
      root,
      chain,
      journal: { summary: journalReport.summary, negativesOk, negatives: journalReport.negatives },
      recoveryPort: { positive: portReport.positive, faultsOk: portReport.faultsOk, faults: portReport.faults, businessSurface: portReport.businessSurface },
      ok: chain.ok && negativesOk && portReport.faultsOk === true,
      businessResume: 'NOT_REACHED',
    }
    if (values.json === true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write([
      `recovery-read: ${result.ok ? 'OK' : 'DIFF'}`,
      `  work=${chain.subject.workId} attempt=${chain.subject.attempt.attemptId} question=${chain.subject.questionId} answer=${chain.subject.answerId} delivery=${chain.subject.deliveryStatus}`,
      `  chain checks: ${Object.entries(chain.checks).filter(([, value]) => !value).map(([key]) => key).join(',') || 'all pass'}`,
      `  journal: ${journalReport.summary.expected.entries} entries, negatives ${journalReport.negativeControls.observedRefusals}/${journalReport.negativeControls.expectedRefusals} refused`,
      `  recovery port faults: ${portReport.faults.map((fault) => `${fault.id}=${fault.actual}`).join(', ')}`,
      '  business resume: NOT_REACHED (fixture data only, no execution authority)',
    ].join('\n'))
    return result.ok ? 0 : 1
  } catch (error) {
    process.stderr.write(`read: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return 2
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`read: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = 3
})
