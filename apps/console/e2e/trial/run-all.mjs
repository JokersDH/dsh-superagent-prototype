/**
 * One bounded command for the whole trial-experience evidence set. Sequential because every suite owns
 * private ports; no suite touches user instances or the twelve preserved services.
 *
 * Usage: node e2e/trial/run-all.mjs
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const suites = [
  { id: 'unit-mapping', command: process.execPath, args: ['--test', 'test/trial/trial-view.case.ts'], timeout: 120000 },
  { id: 'typecheck-app', command: 'npx', args: ['tsc', '-p', 'tsconfig.json', '--noEmit'], timeout: 240000 },
  { id: 'typecheck-e2e', command: 'npx', args: ['tsc', '-p', 'e2e/trial/tsconfig.json', '--noEmit'], timeout: 240000 },
  { id: 'build', command: 'npx', args: ['vite', 'build'], timeout: 240000 },
  { id: 'hook-async', command: process.execPath, args: ['e2e/trial/trial-async.mjs'], timeout: 420000 },
  { id: 'browser-states', command: process.execPath, args: ['e2e/trial/trial-states.mjs'], timeout: 420000 },
  { id: 'http-journey', command: process.execPath, args: ['e2e/trial/trial-http.mjs'], timeout: 420000 },
  { id: 'app-targets', command: process.execPath, args: ['e2e/trial/app-targets.mjs'], timeout: 420000 },
  { id: 'app-two-projects', command: process.execPath, args: ['e2e/trial/app-two-projects.mjs'], timeout: 420000 },
]
const results = []
for (const suite of suites) {
  const started = Date.now()
  const run = spawnSync(suite.command, suite.args, { cwd: consoleDir, stdio: 'inherit', timeout: suite.timeout })
  results.push({
    id: suite.id, command: [suite.command, ...suite.args].join(' '), exitCode: run.status, signal: run.signal,
    timeoutMs: suite.timeout, ms: Date.now() - started,
  })
}
const failed = results.filter(result => result.exitCode !== 0)
writeFileSync(join(here, 'report-all.json'), JSON.stringify({
  subject: 'trial experience suites (controlled fixtures / isolated services; not a release verdict)',
  generatedAt: new Date().toISOString(), results, failed: failed.map(result => result.id),
}, null, 2))
console.log(failed.length === 0
  ? `PASS trial-experience suites: ${results.length}/${results.length}`
  : `FAIL trial-experience suites: ${results.length - failed.length}/${results.length}; failed: ${failed.map(result => `${result.id}(${result.exitCode}${result.signal ? `,${result.signal}` : ''})`).join(', ')}`)
process.exitCode = failed.length === 0 ? 0 : 1
