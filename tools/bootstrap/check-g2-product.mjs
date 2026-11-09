import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const commands = [
  ['check:g2-application'],
  ['--filter', '@personal-agent/workspaces', '--filter', '@personal-agent/verification', '-r', 'build'],
  ['--filter', '@personal-agent/workspaces', '--filter', '@personal-agent/verification', '-r', 'typecheck'],
  ['--filter', '@personal-agent/coordinator', 'typecheck:product'],
  ['--filter', '@personal-agent/workspaces', '--filter', '@personal-agent/verification', '-r', 'test'],
  ['--filter', '@personal-agent/coordinator', 'test:product'],
]
let tests = 0
const results = []
for (const args of commands) {
  const output = execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(output)
  const count = [...output.matchAll(/(?:ℹ\s*)?tests (\d+)/g)].reduce((total, match) => total + Number(match[1]), 0)
  tests += count
  assert.doesNotMatch(output, /(?:ℹ\s*)?fail [1-9]/)
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS', ...(count ? { tests: count } : {}) })
}
assert.ok(tests >= 134, 'Run the prior 90 cases, WP-04 30 cases and controlled product 14 cases')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sourceWorktreeClean =
  execFileSync(
    'git',
    [
      'status',
      '--porcelain',
      '--',
      'apps',
      'packages',
      'package.json',
      'pnpm-lock.yaml',
      'tools/bootstrap/check-g2-product.mjs',
      'tools/bootstrap/smoke-product-api.mjs',
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim() === ''
const report = {
  status: 'PASS_CONTROLLED_PRODUCT_API_SLICE',
  sourceCommit,
  sourceWorktreeClean,
  checkedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  tests,
  results,
  scopes: { applicationAndRecovery: 90, workspaces: 8, verification: 22, actualControlledProduct: 14 },
  implementation:
    'SQLite application + real scratch subprocess + original native questions + trusted owned-resource barrier + registered verification + candidate acceptance',
  limitations: [
    'This is the controlled product API lane; browser product acceptance is separate',
    'Fixture profiles execute a fixed scratch operation; installed Codex/ZCode/DeepSeek Harness and model calls are NOT_TESTED',
    'The controlled host lives in the coordinator process; SIGKILL proves conservative no-replay behavior, not live independent Runner reconnect',
    'The imported workspace patch omits untracked file bytes; the controlled lane explicitly publishes its fixed output bytes as an additional immutable artifact',
    'No complete G1/G2 release, generic user-project security sandbox, power-loss or load/soak certification',
  ],
}
mkdirSync(resolve(root, 'reports/releases'), { recursive: true })
writeFileSync(resolve(root, 'reports/releases/g2-product.json'), JSON.stringify(report, null, 2) + '\n')
console.log('PASS: controlled product API slice; native Runner and browser gates remain separate.')
