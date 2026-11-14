#!/usr/bin/env node
/**
 * Produce one wave-27 legal three-consumer package for B/I/main.
 *
 *   node tests/operational-soak/channel/produce.mjs --out <new-directory> [--json]
 *
 * Contents:
 *   frames.json            legal CoordinatorChannel requests/replies + refused negatives + limits
 *   consumer-allow.json    actual fact/payload/write callbacks over B's real stdio bridge (allow)
 *   consumer-deny.json     same consumers with the write admission refused
 *   report.json            summary, NOT_REACHED surface list and zero-model/no-signal facts
 *
 * I's attach-channel implementation is not present in this checkout, so generation/CAS/late/close/
 * capacity are recorded as contract scenarios and reported NOT_REACHED rather than simulated.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { EXIT, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactPath } from '../../../tools/trial-kit/lib/redact.mjs'
import { validateFrames } from './frames.mjs'
import { runServiceConsumer } from './service-consumer.mjs'

const USAGE = `produce — 合法三consumer输入包
用法: node tests/operational-soak/channel/produce.mjs --out <新目录> [--json]
输出: frames.json, consumer-allow.json, consumer-deny.json, report.json
退出: 0 全部按预期, 1 有未预期差异, 2 参数/材料拒绝, 3 INTERNAL
`

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write('produce: REFUSED usage: --out <new-directory> is required\n'); return EXIT.REFUSED }
  const root = resolve(values.out)
  try { mkdirSync(root, { mode: 0o700, recursive: false }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${root}\n`)
    return EXIT.REFUSED
  }
  try {
    const frames = validateFrames()
    writeFileSync(join(root, 'frames.json'), `${JSON.stringify(frames, null, 2)}\n`, { mode: 0o600 })

    const allowRoot = join(root, 'allow')
    mkdirSync(allowRoot, { mode: 0o700 })
    const allow = await runServiceConsumer({ root: allowRoot, admission: 'allow' })
    writeFileSync(join(root, 'consumer-allow.json'), `${JSON.stringify(allow, null, 2)}\n`, { mode: 0o600 })

    const denyRoot = join(root, 'deny')
    mkdirSync(denyRoot, { mode: 0o700 })
    const deny = await runServiceConsumer({ root: denyRoot, admission: 'deny' })
    writeFileSync(join(root, 'consumer-deny.json'), `${JSON.stringify(deny, null, 2)}\n`, { mode: 0o600 })

    const checks = {
      legalFramesAccepted: frames.positives.every((entry) => entry.ok === true),
      legalReplyFramesAccepted: frames.positives.filter((entry) => ['receipt', 'ack-failed', 'payload', 'write-admission'].includes(entry.type)).every((entry) => entry.ok),
      negativesRefused: frames.allNegativesRefused,
      factCallbackActual: allow.counts.factFrames === 3 && allow.counts.receiptsSent === 2 && allow.counts.ackFailedSent === 1,
      duplicateFactDeduplicated: allow.observed.duplicateReceiptSameSeq === true,
      payloadReaderActual: allow.counts.payloadReadFrames >= 1 && allow.counts.payloadReadsResolved === 1 && allow.observed.payload !== null,
      writeGuardAllowActual: allow.counts.writeIntentFrames === 1 && allow.observed.admittedWrite === true,
      writeGuardDenyActual: deny.counts.writeIntentFrames === 1 && deny.counts.writeDenied === 1 && deny.observed.admittedWrite === false,
      zeroModel: allow.modelCalls === 0 && deny.modelCalls === 0 && allow.vendorTurns === 0 && deny.vendorTurns === 0,
      zeroSignals: allow.signalsSent === 0 && deny.signalsSent === 0,
    }
    const report = {
      protocol: 'channel-consumer-report/1',
      generatedAt: nowIso(),
      source: 'tests/operational-soak/channel/produce.mjs',
      root: redactPath(root, homeDir()),
      surfaces: {
        actual: 'B runner-service original stdio bridge v1: fact ACK sink, payload reader, native-write guard',
        contractOnly: 'CoordinatorChannel requests/replies and limits (shared contracts)',
        notReached: [
          'I attach-channel module (apps/runner/src/attach-channel/) absent from this checkout',
          'generation/CAS binding, stale-lease isolation, late reply, close race and capacity enforcement',
          'same-Runner dual client and business reconnect',
          'SIGKILL cross-process recovery / original Work acceptance',
        ],
      },
      frames: { positives: frames.positives, negatives: frames.negatives, replyNegatives: frames.replyNegatives, contractScenarios: frames.contractScenarios },
      consumers: { allow, deny },
      checks,
      ok: Object.values(checks).every(Boolean),
      modelCalls: 0,
      vendorTurns: 0,
      signalsSent: 0,
      limits: [
        'fixture driver only; no model/vendor/native/profile/credential',
        'no coordinator, ledger, database writer or second execution lifecycle is created',
        'in-process runner service only; no SIGKILL and no global process/socket discovery',
      ],
    }
    writeFileSync(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    if (values.json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else process.stdout.write([
      `channel-produce: ${report.ok ? 'OK' : 'UNEXPECTED'}`,
      `  frames: legal ${frames.positives.length}, negatives refused ${frames.negatives.filter((entry) => entry.refused).length}/${frames.negatives.length}, reply negatives ${frames.replyNegatives.filter((entry) => entry.refused).length}/${frames.replyNegatives.length}`,
      `  allow: fact frames=${allow.counts.factFrames} receipts=${allow.counts.receiptsSent} ackFailed=${allow.counts.ackFailedSent} payloadReads=${allow.counts.payloadReadFrames}/${allow.counts.payloadReadsResolved} writeIntent=${allow.counts.writeIntentFrames} admitted=${allow.observed.admittedWrite}`,
      `  deny: writeIntent=${deny.counts.writeIntentFrames} denied=${deny.counts.writeDenied} admitted=${deny.observed.admittedWrite}`,
      `  not reached: I attach-channel generation/CAS/late/close/capacity, same-Runner dual client, SIGKILL/business resume`,
      `  root: ${redactPath(root, homeDir())}`,
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
