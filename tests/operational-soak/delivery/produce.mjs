#!/usr/bin/env node
/**
 * Produce the wave-28 original delivery/candidate/slot package.
 *
 *   node tests/operational-soak/delivery/produce.mjs --out <new-directory> [--json]
 *
 * Uses the original controlled ProductRuntime/Broker/A Store/Verifier path: normal question/answer,
 * native_applied, currentCandidate, manual accept, delivered artifacts; ACK replay/conflict; 2 and 4
 * controlled works. Native slot resources and recovered candidate/accept are NOT_REACHED.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { EXIT, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactPath, redactValue } from '../../../tools/trial-kit/lib/redact.mjs'
import { runDeliveryConsumer } from './consumer.mjs'

const USAGE = `produce — 原交付/候选/接受/slot 输入
用法: node tests/operational-soak/delivery/produce.mjs --out <新目录> [--json]
输出: delivery.json, report.json
退出: 0 全部按预期, 1 有未预期差异, 2 参数拒绝, 3 INTERNAL
`

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write('produce: REFUSED usage: --out <new-directory> is required\n'); return EXIT.REFUSED }
  const out = resolve(values.out)
  try { mkdirSync(out, { mode: 0o700, recursive: false }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${out}\n`)
    return EXIT.REFUSED
  }
  try {
    const delivery = await runDeliveryConsumer({ root: out })
    writeFileSync(join(out, 'delivery.json'), `${JSON.stringify(redactValue(delivery, { home: homeDir() }), null, 2)}\n`, { mode: 0o600 })
    const report = {
      protocol: 'delivery-report/1', generatedAt: nowIso(), root: redactPath(out, homeDir()),
      source: 'tests/operational-soak/delivery/produce.mjs',
      surface: delivery.surface,
      checks: delivery.checks,
      ok: Object.values(delivery.checks).every(Boolean),
      modelCalls: delivery.modelCalls, vendorTurns: delivery.vendorTurns, signalsSent: delivery.signalsSent,
      notReached: delivery.notReached,
      limits: ['controlled fixture executor only; no vendor/native execution', 'no recovered Work candidate/accept; no native 2/4 slot resource set', 'workView identity is view.work.id, never view.id'],
    }
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(redactValue(report, { home: homeDir() }), null, 2)}\n`, { mode: 0o600 })
    if (values.json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else process.stdout.write([
      `delivery-produce: ${report.ok ? 'OK' : 'UNEXPECTED'}`,
      `  normal: work=${delivery.normal?.workId} question=${delivery.normal?.questionId} answer=${delivery.normal?.answerDelivery} candidateGen=${delivery.normal?.currentCandidate?.candidateGeneration} accept=${delivery.normal?.acceptedStatus} phase=${delivery.normal?.phaseAfterAccept} artifacts=${delivery.normal?.artifactCount}`,
      `  wrong candidate: ${delivery.normal?.wrongCandidateStatus} (${delivery.normal?.wrongCandidateError}); ACK replay same=${delivery.normal?.answerReplaySame} conflict=${delivery.normal?.answerConflictStatus}`,
      `  slots: 2 delivered=${delivery.slots['2']?.delivered} begin=${delivery.slots['2']?.beginFrames}; 4 delivered=${delivery.slots['4']?.delivered} begin=${delivery.slots['4']?.beginFrames}`,
      `  NOT_REACHED: recovered candidate/accept; native 2/4 slot resource set`,
      `  root: ${redactPath(out, homeDir())}`,
    ].join('\n'))
    return report.ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    process.stderr.write(`produce: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return EXIT.DEGRADED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`produce: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
