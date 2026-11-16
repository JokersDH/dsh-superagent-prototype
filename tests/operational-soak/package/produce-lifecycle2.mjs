#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runPackageLifecycle } from './lifecycle2.mjs'

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const out = value('--out')
const tar = value('--tar')
if (out === null || tar === null) { console.error('usage: produce-lifecycle2.mjs --out <new-dir> --tar <exact.tar.gz>'); process.exit(2) }
mkdirSync(out, { mode: 0o700 })
const extract = join(out, 'package')
mkdirSync(extract, { mode: 0o700 })
execFileSync('tar', ['-xzf', tar, '-C', extract])
const report = await runPackageLifecycle({
  packageRoot: join(extract, 'install', 'app'),
  releaseManifest: join(extract, 'install', 'var', 'config', 'release.json'),
  out: join(out, 'lifecycle'),
})
writeFileSync(join(out, 'lifecycle.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true).map(([id]) => id)
const summary = { status: failed.length === 0 ? 'OK' : 'FAILED', failed, checks: report.checks, statuses: report.statuses, ports: report.ports, instance: report.instance && { pid: report.instance.pid, apiPid: report.instance.apiPid, consolePid: report.instance.consolePid, buildId: report.instance.buildId, mode: report.instance.mode, startupMode: report.instance.startupMode }, readiness: report.readiness?.body && { mode: report.readiness.body.mode, startupMode: report.readiness.body.startupMode, authorization: report.readiness.body.authorization }, sse: report.sse, limits: report.limits }
writeFileSync(join(out, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify(summary, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
