#!/usr/bin/env node
// Read-only release check for the wave-28 successor. It validates the frozen tar, the source
// closure and the E handoff tuple recorded by D. It does not build, install, start or signal a
// product process and does not create a new release authority.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const status = read('tools/distribution/reports/wave28-status.json')
const artifact = read('tools/distribution/reports/wave28/artifacts.json')
const closure = read('tools/distribution/reports/wave28/ordinary-source-closure.json')
const checks = []
const check = (id, ok, detail = null) => checks.push({ id, ok, ...(detail === null ? {} : { detail }) })
const a = artifact.successor
check('status_protocol', status.protocol === 'wave28-status/1')
check('source', a.source.commit.startsWith(status.frozenSource) && a.source.dirty === false, { status: status.frozenSource, artifact: a.source.commit })
check('build', status.successor.buildId === a.buildId, { status: status.successor.buildId, artifact: a.buildId })
check('tar_exists', existsSync(a.tarPath), a.tarPath)
const tarSha = sha256(a.tarPath)
check('tar_sha256', tarSha === a.sha256, { expected: a.sha256, actual: tarSha })
check('tar_bytes', statSync(a.tarPath).size === a.tarBytes, { expected: a.tarBytes, actual: statSync(a.tarPath).size })
check('entry_count', a.files === 6778, a.files)
let closureTotal = 0
const mismatched = []
for (const entries of Object.values(closure.groups)) {
  for (const entry of entries) {
    closureTotal += 1
    const path = resolve(root, entry.path)
    if (!existsSync(path) || sha256(path) !== entry.sha256) mismatched.push(entry.path)
  }
}
check('closure_count', closureTotal === 109, closureTotal)
check('closure_hashes', mismatched.length === 0, { mismatched: mismatched.length })
const install = resolve(root, '..', 'pa-wave28-install-check')
const installed = existsSync(resolve(root, '../pa-artifacts/wave28-target/wave28-target-1ba0032.tar.gz'))
check('artifact_present', installed)
check('usage_insights_source', existsSync(resolve(root, 'packages/usage-insights/package.json')))
const recipe = readFileSync(resolve(root, 'tools/distribution/recipes/wave28-e-acceptance.zh-CN.md'), 'utf8')
check('recipe_tuple', recipe.includes(a.sha256) && recipe.includes(a.buildId) && recipe.includes(a.source.commit.slice(0, 7)))
check('j_absent_documented', /J recipes 不在本包/.test(recipe) && status.notDone.some((item) => /J recipe/.test(item)))
const failed = checks.filter((item) => !item.ok)
const result = {
  protocol: 'wave28-release-check/1',
  status: failed.length === 0 ? 'PASS_WITH_E_PENDING_J_ABSENT' : 'FAIL',
  checks,
  tuple: { source: a.source.commit, build: a.buildId, tarSha256: a.sha256, bytes: a.tarBytes, entries: a.files.count, closure: closureTotal },
  boundaries: ['no build/install/start/signal', 'E verdict independent and pending', 'J recipes absent from current main'],
}
console.log(JSON.stringify(result, null, 2))
if (failed.length) process.exitCode = 1
