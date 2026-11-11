import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const commands = [
  ['check:contracts'],
  ['check:g2-application'],
  ['--filter', '@personal-agent/workspaces', '--filter', '@personal-agent/verification', '--filter', '@personal-agent/knowledge', '--filter', '@personal-agent/routing', '-r', 'build'],
  ['--filter', '@personal-agent/workspaces', '--filter', '@personal-agent/verification', '-r', 'typecheck'],
  ['--filter', '@personal-agent/coordinator', 'typecheck:product'],
  ['--filter', '@personal-agent/workspaces', '--filter', '@personal-agent/verification', '-r', 'test'],
  ['--filter', '@personal-agent/coordinator', 'test:product'],
  ['--filter', '@personal-agent/coordinator', 'test:configuration'],
  ['--filter', '@personal-agent/coordinator', 'test:assistant'],
  ['--filter', '@personal-agent/coordinator', 'test:projects'],
  ['--filter', '@personal-agent/environment-preparation', 'typecheck'],
  ['--filter', '@personal-agent/environment-preparation', 'test'],
  ['--filter', '@personal-agent/environment-preparation', 'build'],
  ['--filter', '@personal-agent/coordinator', 'test:environment'],
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
  results.push({
    command: `pnpm ${args.join(' ')}`,
    status: 'PASS',
    ...(count ? { tests: count } : {}),
  })
}
assert.ok(
  tests >= 363,
  'Run contracts 188, application/recovery 96, WP-04 40, product 14, configuration 5, assistant 17 and projects 3 cases',
)
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
const sourceWorktreeClean =
  execFileSync(
    'git',
    ['status', '--porcelain', '--', 'apps', 'packages', 'package.json', 'pnpm-lock.yaml', 'tools/bootstrap'],
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
  scopes: {
    contracts: 190,
    applicationAndRecovery: 98,
    workspaces: 19,
    verification: 23,
    actualControlledProduct: 14,
    configuration: 5,
    assistantDialogue: 17,
    projectRegistration: 4,
    environmentPreparation: 'Authoritative package checks and independent Runner composition; see command results',
  },
  implementation:
    'SQLite application + real scratch subprocess + native questions + trusted resource barrier + verification + candidate acceptance + durable model dialogue with local mock SDK endpoint',
  limitations: [
    'This is the controlled product API lane; browser product acceptance is separate',
    'Fixture profiles execute a fixed scratch operation; installed Codex/ZCode/DeepSeek Harness are NOT_TESTED',
    'Assistant tests use a local mock SDK endpoint; the separate manual model smoke is not part of this repeatable no-vendor suite',
    'The controlled host lives in the coordinator process; SIGKILL proves conservative no-replay behavior, not live independent Runner reconnect',
    'Generic workspace patch now includes staged/untracked files and commits since reserve; the separate native lane verifies actual code delivery',
    'No complete G1/G2 release, generic user-project security sandbox, power-loss or load/soak certification',
  ],
}
mkdirSync(resolve(root, 'reports/releases'), { recursive: true })
writeFileSync(resolve(root, 'reports/releases/g2-product.json'), JSON.stringify(report, null, 2) + '\n')
console.log('PASS: controlled product API slice; native Runner and browser gates remain separate.')
