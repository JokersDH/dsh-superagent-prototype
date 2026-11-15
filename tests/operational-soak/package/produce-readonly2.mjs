#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runPackageReadonly } from './readonly2.mjs'

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const out = value('--out')
const tar = value('--tar')
if (out === null || tar === null) { console.error('usage: produce-readonly2.mjs --out <new-dir> --tar <exact.tar.gz>'); process.exit(2) }
mkdirSync(out, { mode: 0o700 })
const extract = join(out, 'package')
mkdirSync(extract, { mode: 0o700 })
execFileSync('tar', ['-xzf', tar, '-C', extract])
const report = runPackageReadonly({ packageRoot: join(extract, 'install', 'app'), out: join(out, 'roots') })
writeFileSync(join(out, 'readonly.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true).map(([id]) => id)
const summary = { status: failed.length === 0 ? 'OK_WITH_NOT_REACHED' : 'FAILED', failed, checks: report.checks, commandExits: report.commandExits, contentRead: report.contentRead, sse: report.sse }
writeFileSync(join(out, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify(summary, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
