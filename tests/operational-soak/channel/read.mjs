#!/usr/bin/env node
/**
 * Re-read one channel consumer package through the shared validators and recorded counts.
 *
 *   node tests/operational-soak/channel/read.mjs --run <produced-root> [--json]
 *
 * Read-only; it does not start the runner service. It is the datareader B/I/main can call to confirm
 * the package before using its frames or expectations.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { CoordinatorChannelReplySchema, parseCoordinatorChannelRequest } from '../../../packages/contracts/src/coordinator-channel.ts'

const USAGE = `read — 复核三consumer包
用法: node tests/operational-soak/channel/read.mjs --run <produced-root> [--json]
退出: 0 一致, 1 差异/缺材料, 2 参数/材料拒绝, 3 INTERNAL
`

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }

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
    const frames = readJson(join(root, 'frames.json'))
    const report = readJson(join(root, 'report.json'))
    const allow = readJson(join(root, 'consumer-allow.json'))
    const deny = readJson(join(root, 'consumer-deny.json'))
    // Re-validate the serialized legal frames and negatives from the recorded data.
    const requestOk = ['fact', 'payload', 'write'].every((name) => {
      try { parseCoordinatorChannelRequest(frames.requests[name], frames.producer); return true } catch { return false }
    })
    const replyOk = ['receipt', 'ackFailed', 'payload', 'admission'].every((name) => CoordinatorChannelReplySchema.safeParse(frames.replies[name]).success)
    const negativesOk = frames.negatives.every((entry) => {
      let refused = false
      try { parseCoordinatorChannelRequest(entry.value, entry.producer ?? frames.producer) } catch { refused = true }
      return refused && entry.sends === 0 && entry.executes === 0
    })
    const replyNegativesOk = frames.replyNegatives.every((entry) => CoordinatorChannelReplySchema.safeParse(entry.value).success === false)
    const countsOk = allow.counts.factFrames === 3 && allow.counts.receiptsSent === 2 && allow.counts.ackFailedSent === 1
      && allow.counts.payloadReadsResolved === 1 && allow.counts.writeIntentFrames === 1 && allow.observed.admittedWrite === true
      && deny.counts.writeIntentFrames === 1 && deny.counts.writeDenied === 1 && deny.observed.admittedWrite === false
    const zeroOk = report.modelCalls === 0 && report.vendorTurns === 0 && report.signalsSent === 0
      && allow.modelCalls === 0 && deny.modelCalls === 0
    const notReached = report.surfaces.notReached.length >= 3
    const result = {
      protocol: 'channel-read/1',
      root,
      checks: { requestOk, replyOk, negativesOk, replyNegativesOk, countsOk, zeroOk, notReached },
      ok: requestOk && replyOk && negativesOk && replyNegativesOk && countsOk && zeroOk && notReached,
      surfaces: report.surfaces,
      contractScenarios: frames.contractScenarios,
    }
    if (values.json === true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write([
      `channel-read: ${result.ok ? 'OK' : 'DIFF'}`,
      `  frames: requests=${requestOk} replies=${replyOk} negatives=${negativesOk} replyNegatives=${replyNegativesOk}`,
      `  consumers: allow fact=${allow.counts.factFrames}/receipts=${allow.counts.receiptsSent} payload=${allow.counts.payloadReadsResolved} write=${allow.counts.writeIntentFrames} admit=${allow.observed.admittedWrite}; deny admitted=${deny.observed.admittedWrite}`,
      `  zero: modelCalls=${report.modelCalls} signals=${report.signalsSent}`,
      `  NOT_REACHED: generation/CAS/late/close/capacity, same-Runner dual client, SIGKILL/business resume`,
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
