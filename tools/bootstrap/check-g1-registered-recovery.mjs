import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const commands = [
  ['--filter', '@personal-agent/contracts', '--filter', '@personal-agent/orchestrator-core', '--filter', '@personal-agent/effects', '--filter', '@personal-agent/storage', '-r', 'run', 'build'],
  ['--filter', '@personal-agent/coordinator', 'typecheck'],
  ['exec', 'tsc', '-p', 'tests/integration/tsconfig.runtime.json'],
  ['--filter', '@personal-agent/coordinator', 'test:runner-link'],
  ['--filter', '@personal-agent/coordinator', 'test:registered-recovery'],
  ['--filter', '@personal-agent/coordinator', 'test:production'],
  ['--filter', '@personal-agent/coordinator', 'test:recovery'],
]
let tests = 0
const results = []
for (const args of commands) {
  const output = execFileSync(pnpm, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write(output)
  const count = output.match(/(?:ℹ\s*)?tests (\d+)/)
  if (count) { tests += Number(count[1]); assert.match(output, /(?:ℹ\s*)?fail 0/) }
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS', ...(count ? { tests: Number(count[1]) } : {}) })
}
assert.ok(tests >= 56, 'All prior integration cases, registered recovery guards, durable queue and three new crash windows must run')
const report = {
  status: 'PASS_REGISTERED_LOCAL_RECOVERY_AND_DURABLE_QUEUE_SLICE', tests, realSigkillWindows: 6,
  node: process.version, platform: process.platform, architecture: process.arch, checkedAt: new Date().toISOString(), results,
  proven: ['Trusted launcher registration uses existing immutable command receipts and events, survives SQLite reopen, and rejects endpoint replacement', 'Recovery discovers the peer from the database without launcher manifests', 'Cancellation identity commits before peer I/O and survives real coordinator SIGKILL', 'Fresh repeated terminal inspections reuse the first complete-inventory barrier receipt without new proof files or observations', 'Configuration-drift facts feed the existing durable Effects queue with correctly encoded JSON', 'Held recovery survives reopen with bounded retry; coalesced queue generations are preserved'],
  limitations: ['The actual AttemptRunner recovery backend/daemon is still owner integration work; independent service is a ProcessHost fixture', 'No candidate Journal writer admission, vendor compatibility, power-loss durability, full G1 or usable product claim', 'Registry uses the existing single-writer command receipt ledger; a future dedicated storage index must preserve these identities and receipts', 'Recovery retries only inspection and the same pinned cancellation ID; this does not permit business/native-send replay', 'Daemon heartbeat must kick the existing Effects scheduler; this helper adds no background process or polling timer', 'Legacy unreleased raw-reference recovery queue rows require explicit re-enqueue; no automatic database rewrite is performed'],
}
mkdirSync(resolve(root, 'reports/releases'), { recursive: true })
writeFileSync(resolve(root, 'reports/releases/g1-registered-recovery.json'), JSON.stringify(report, null, 2) + '\n')
console.log('PASS: registered local recovery and durable queue slice only; full G1 remains pending.')
