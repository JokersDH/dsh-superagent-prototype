#!/usr/bin/env node
/** Wave-30 H2 producer: original Product/Broker ingress + A public readback. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runOriginalIngress } from './original-ingress2.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--out')
const out = index >= 0 ? args[index + 1] : null
if (out === null) { console.error('usage: produce-original2.mjs --out <new-dir>'); process.exit(2) }
mkdirSync(out, { mode: 0o700 })
const readback = await runOriginalIngress({ root: out })
writeFileSync(join(out, 'readback.json'), `${JSON.stringify(readback, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
const failed = Object.entries(readback.checks).filter(([, ok]) => ok !== true).map(([id]) => id)
const report = {
  tool: 'trial-kit/original-ingress2', wave: 30,
  status: failed.length === 0 ? 'OK' : 'FAILED',
  checks: readback.checks, failed,
  workId: readback.workId, questionId: readback.questionId, answerId: readback.answerId,
  commandId: readback.commandId, attemptId: readback.attemptId, deliveries: readback.deliveries,
  modelCalls: readback.modelCalls, vendorTurns: readback.vendorTurns,
  businessIngressJoin: readback.businessIngressJoin,
}
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ status: report.status, failed, workId: report.workId, questionId: report.questionId, answerId: report.answerId, attemptId: report.attemptId, deliveries: report.deliveries }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
