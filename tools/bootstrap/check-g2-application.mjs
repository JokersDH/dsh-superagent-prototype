import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const commands = [
  [
    '--filter',
    '@personal-agent/contracts',
    '--filter',
    '@personal-agent/orchestrator-core',
    '--filter',
    '@personal-agent/effects',
    '--filter',
    '@personal-agent/storage',
    '--filter',
    '@personal-agent/questions',
    '--filter',
    '@personal-agent/application',
    '-r',
    'build',
  ],
  ['--filter', '@personal-agent/questions', '--filter', '@personal-agent/application', '-r', 'typecheck'],
  ['--filter', '@personal-agent/coordinator', 'typecheck:http'],
  ['--filter', '@personal-agent/questions', '--filter', '@personal-agent/application', '-r', 'test'],
  ['--filter', '@personal-agent/coordinator', 'test:http'],
  ['--filter', '@personal-agent/coordinator', 'typecheck'],
  ['--filter', '@personal-agent/coordinator', 'test:runner-link'],
  ['--filter', '@personal-agent/coordinator', 'test:registered-recovery'],
  ['--filter', '@personal-agent/coordinator', 'test:production'],
  ['--filter', '@personal-agent/coordinator', 'test:recovery'],
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
  let count = 0
  for (const match of output.matchAll(/(?:ℹ\s*)?tests (\d+)/g)) count += Number(match[1])
  tests += count
  if (count) assert.doesNotMatch(output, /(?:ℹ\s*)?fail [1-9]/)
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS', ...(count ? { tests: count } : {}) })
}
assert.ok(tests >= 95, 'Application/HTTP local access, private model status, immutable startup grants and recovery scopes must execute')
const report = {
  status: 'PASS_APPLICATION_BROKER_HTTP_SLICE',
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  checkedAt: new Date().toISOString(),
  tests,
  results,
  limitations: [
    'Product repositories are integrated from A a6bb40a; full verification/console packages have separate acceptance',
    'Completion review port is trusted/injected; module tests use a controlled verifier and do not certify a full artifact pipeline',
    'HTTP API sandbox retains execution intents; actual independent Runner/native adapter composition remains pending',
    'No full G1/G2, vendor, power-loss, load/soak or usable full product certification',
  ],
}
mkdirSync(resolve(root, 'reports/releases'), { recursive: true })
writeFileSync(resolve(root, 'reports/releases/g2-application.json'), JSON.stringify(report, null, 2) + '\n')
console.log('PASS: application/Broker/HTTP slice only; complete product/native gates remain pending.')
