import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const commands = [
  ['--filter', '@personal-agent/contracts', '--filter', '@personal-agent/orchestrator-core', '--filter', '@personal-agent/effects', '--filter', '@personal-agent/storage', '-r', 'run', 'build'],
  ['--filter', '@personal-agent/coordinator', 'typecheck'],
  ['exec', 'tsc', '-p', 'tests/integration/tsconfig.runtime.json'],
  ['--filter', '@personal-agent/coordinator', 'test:production'],
  ['--filter', '@personal-agent/coordinator', 'test:recovery'],
];
let tests = 0;
const results = [];
for (const args of commands) {
  const output = execFileSync(pnpm, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(output);
  const count = output.match(/(?:ℹ\s*)?tests (\d+)/);
  if (count) { tests += Number(count[1]); assert.match(output, /(?:ℹ\s*)?fail 0/); }
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS' });
}
assert.ok(tests >= 14, 'Both production-store and fact-recovery suites must run');
const report = { status: 'PASS_FACT_RECOVERY_AND_PROCESS_CRASH_SLICE', tests, realSigkillWindows: 2, node: process.version, platform: process.platform, architecture: process.arch, checkedAt: new Date().toISOString(), results, pending: ['Candidate Journal writer admission (see g1-journal-review.json)', 'IPC-authenticated reconnect to an independent live Runner', 'Whole resource-barrier/reconciliation workflow', 'Full G1, vendor compatibility and usable product release'], limitations: ['Crash snapshots are fsynced test decoder exports, not the unaccepted Journal writer', 'SIGKILL/reopen does not prove power-loss behavior', 'No replay issues new begin/deliver/answer/native commands'] };
mkdirSync(resolve(root, 'reports/releases'), { recursive: true });
writeFileSync(resolve(root, 'reports/releases/g1-recovery.json'), JSON.stringify(report, null, 2) + '\n');
console.log('PASS: recovery adapter/production-store and real process-crash slice only; full G1 remains pending.');
