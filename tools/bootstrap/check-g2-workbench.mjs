import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const commands = [
  ['check:g2-product'],
  ['--filter', '@personal-agent/console', 'typecheck'],
  ['--filter', '@personal-agent/console', 'test'],
  ['--filter', '@personal-agent/console', 'build'],
]
const results = []
let tests = 0
for (const args of commands) {
  const output = execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(output)
  const count = [...output.matchAll(/(?:ℹ\s*)?tests (\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0)
  tests += count
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS', ...(count ? { tests: count } : {}) })
}
assert.ok(tests >= 336)
const report = {
  status: 'PASS_CONTROLLED_WORKBENCH_MODULES',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  checkedAt: new Date().toISOString(),
  node: process.version,
  tests,
  results,
  browserCheck: 'pnpm check:g2-browser against an explicitly started dev:workbench instance',
  limitations: [
    'Controlled fixture only',
    'Browser acceptance has a separate report',
    'A generic workspace candidate and B independent runtime remain blocked by dedicated admission probes',
  ],
}
writeFileSync(
  new URL('../../reports/releases/g2-workbench.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
)
