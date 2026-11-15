#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSuccessorReadback } from './successor2.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--out')
const out = index >= 0 ? args[index + 1] : null
if (out === null) { console.error('usage: produce-successor2.mjs --out <new-dir>'); process.exit(2) }
mkdirSync(out, { mode: 0o700 })
const report = await runSuccessorReadback({
  root: join(out, 'run'),
  normalChild: join(import.meta.dirname, 'normal-child.mjs'),
  successorRead: join(import.meta.dirname, 'successor-read.mjs'),
})
writeFileSync(join(out, 'successor.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true).map(([id]) => id)
writeFileSync(join(out, 'report.json'), `${JSON.stringify({ status: failed.length === 0 ? 'OK_WITH_NOT_REACHED' : 'FAILED', failed, producer: report.producer, successor: report.successor, original: report.original, checks: report.checks, bRecovery: report.bRecovery }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ status: failed.length === 0 ? 'OK_WITH_NOT_REACHED' : 'FAILED', failed, producerPid: report.producer.pid, successorPid: report.successor.pid, checks: report.checks }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
