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
  ['--filter', '@personal-agent/coordinator', 'test:runner-link'],
]
let tests = 0
const results = []
for (const args of commands) {
  const output = execFileSync(pnpm, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write(output)
  const count = output.match(/(?:ℹ\s*)?tests (\d+)/)
  if (count) { tests += Number(count[1]); assert.match(output, /(?:ℹ\s*)?fail 0/) }
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS' })
}
assert.ok(tests >= 17, 'Protocol guards and the independent-process reconnect scenario must run')
const report = {
  status: 'PASS_LOCAL_RECOVERY_TRANSPORT_AND_OWNED_RESOURCE_BARRIER_SLICE', tests, realCoordinatorSigkillWindows: 1,
  node: process.version, platform: process.platform, architecture: process.arch, checkedAt: new Date().toISOString(), results,
  proven: ['Authenticated private Unix socket; pinned endpoint and full attempt identity', 'Recovery API limited to inspection/cancellation', 'Real coordinator SIGKILL leaves the independent fixture Runner and its owned process alive', 'New coordinator cancels the original process without a second begin', 'Fresh peer inspection + exact registered manifest + closed admission + complete quiescence', 'Same-transaction observation/binding/barrier event/receipt; rollback on receipt failure'],
  limitations: ['Fixture service wraps the accepted ProcessHost, not the complete production AttemptRunner daemon', 'Endpoint registry is a private test launcher manifest; durable product registration still pending', 'Same-user local transport only, not isolation against malicious same-UID code', 'ProcessHost quiescence is limited to tracked process groups; escaped descendants and external effects need additional reconciliation', 'Barrier receipt covers registered owned resources only; it is not candidate/artifact-bound completion evidence', 'No certification of candidate durable Journal, native vendors, power-loss behavior, full G1 or usable product release'],
}
mkdirSync(resolve(root, 'reports/releases'), { recursive: true })
writeFileSync(resolve(root, 'reports/releases/g1-runner-link.json'), JSON.stringify(report, null, 2) + '\n')
console.log('PASS: local Runner recovery/owned-resource barrier slice only; full G1 remains pending.')
