#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { produceNormalChain } from '../recovery/normal-chain.mjs'
import { runPackageBackupRestore } from './backup-restore2.mjs'

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const out = value('--out')
const tar = value('--tar')
if (out === null || tar === null) { console.error('usage: produce-restore2.mjs --out <new-dir> --tar <exact.tar.gz>'); process.exit(2) }
mkdirSync(out, { mode: 0o700 })
const extract = join(out, 'package')
mkdirSync(extract, { mode: 0o700 })
execFileSync('tar', ['-xzf', tar, '-C', extract])
const packageRoot = join(extract, 'install', 'app')
const releaseManifest = join(extract, 'install', 'var', 'config', 'release.json')
const sourceRun = join(out, 'source-run')
mkdirSync(sourceRun, { mode: 0o700 })
const normal = await produceNormalChain({ root: sourceRun })
const original = { workId: normal.work.id, questionId: normal.question.id, answerId: normal.answer.answerId, commandId: normal.answer.commandId }
const report = runPackageBackupRestore({
  packageRoot, releaseManifest, sourceState: join(sourceRun, 'state'), original,
  out: join(out, 'restore-work'),
})
writeFileSync(join(out, 'restore.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true).map(([id]) => id)
writeFileSync(join(out, 'report.json'), `${JSON.stringify({ status: failed.length === 0 ? 'OK_WITH_NOT_REACHED' : 'FAILED', failed, original, checks: report.checks, statuses: report.statuses, readback: report.readback, reviewStartup: report.reviewStartup }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ status: failed.length === 0 ? 'OK_WITH_NOT_REACHED' : 'FAILED', failed, checks: report.checks, statuses: report.statuses }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
