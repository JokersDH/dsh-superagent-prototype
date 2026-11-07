import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const steps = [
  ['--filter', '@personal-agent/contracts', '--filter', '@personal-agent/orchestrator-core', '--filter', '@personal-agent/effects', '--filter', '@personal-agent/storage', '-r', 'run', 'build'],
  ['--filter', '@personal-agent/coordinator', 'typecheck'],
  ['exec', 'tsc', '-p', 'tests/integration/tsconfig.runtime.json'],
  ['--filter', '@personal-agent/coordinator', 'test:production'],
];
const results = [];
let tests = 0;
for (const args of steps) {
  const output = execFileSync(pnpm, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(output);
  const count = output.match(/(?:ℹ\s*)?tests (\d+)/);
  if (count) { tests += Number(count[1]); assert.match(output, /(?:ℹ\s*)?fail 0/); }
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS' });
}
assert.ok(tests >= 5, 'Production storage/controlled-process integration tests did not execute');
const identity = JSON.parse(readFileSync(resolve(root, 'packages/contracts/generated/manifest.json'), 'utf8'));
const report = {
  status: 'PASS_PRODUCTION_STORAGE_AND_CONTROLLED_FAKE_PROCESS_SLICE', tests,
  contractIdentity: { version: identity.version, schemaHash: identity.schemaHash },
  node: process.version, platform: process.platform, architecture: process.arch, recordedAt: new Date().toISOString(), results,
  notProven: ['Full G1 crash/reconnect/durable journal admission', 'Per-attempt resource/authority invariants assigned to Agent A next batch', 'Strict question/answer fixture coverage and persistent replay assigned to Agent B next batch', 'Vendor Driver compatibility, real native permissions or model task', 'Usable UI/HTTP personal-assistant product'],
};
mkdirSync(resolve(root, 'reports/releases'), { recursive: true });
writeFileSync(resolve(root, 'reports/releases/g1-production-runtime.json'), JSON.stringify(report, null, 2) + '\n');
console.log('PASS: real production repositories and controlled fake-process slice only; full G1 remains pending.');
