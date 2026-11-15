#!/usr/bin/env node
/** Wave-31 H3 producer: original same-Store receiver join + explicit B join NOT_REACHED. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSameStoreReceiver } from './same-store-join2.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--out')
const out = index >= 0 ? args[index + 1] : null
if (out === null) { console.error('usage: produce-join2.mjs --out <new-dir>'); process.exit(2) }
mkdirSync(out, { mode: 0o700 })
const report = await runSameStoreReceiver({ root: out })
writeFileSync(join(out, 'join.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true).map(([id]) => id)
const summary = { status: failed.length === 0 ? 'OK_WITH_NOT_REACHED' : 'FAILED', failed, original: report.original, checks: report.checks, bCallbackJoin: report.bCallbackJoin, businessIngressJoin: report.businessIngressJoin }
writeFileSync(join(out, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify(summary, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
